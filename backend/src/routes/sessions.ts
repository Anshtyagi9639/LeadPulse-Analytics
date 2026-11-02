import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { AI_TASKS, generateInsight, type AiClient } from '../ai/insights.js';
import type { AppConfig } from '../config.js';
import { buildWorkbook } from '../export/excel.js';
import { buildPdf } from '../export/pdf.js';
import { buildComparisonExport, buildLeadExport, buildQualityExport } from '../export/leads.js';
import { buildTable, TABLE_KEYS, type TableKey } from '../export/tables.js';
import { FLAG_LABELS, LEAD_FLAGS, STATUS_LABELS, filterLeads, leadFacets, originalColumns, sortLeads, standardColumns, type LeadQuery } from '../domain/leads.js';
import { clientHash } from '../lib/client.js';
import { buildRecommendations } from '../domain/recommendations.js';
import { AppError } from '../lib/errors.js';
import { safeFilename, toCsv } from '../lib/sanitize.js';
import { fileSummary, sessionSummary } from '../session/serialize.js';
import type { SessionService } from '../session/service.js';
import type { ReportService } from '../session/reports.js';
import type { Session } from '../session/store.js';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');
const nonNeg = z.number().finite().min(0).max(1e12);

const CreateSessionBody = z.object({ reportingDate: isoDay, mode: z.enum(['production', 'test']).default('production') });
const SettingsBody = z
  .object({
    reportingDate: isoDay,
    dateRange: z.object({ from: isoDay, to: isoDay }).nullable(),
    dateFilter: z.enum(['include_all', 'restrict']),
    duplicateMode: z.enum(['count_all', 'exclude_duplicates', 'keep_latest', 'manual_review']),
    cautiousMatching: z.boolean(),
    overallTargetLeads: nonNeg.nullable(),
    overallBudget: nonNeg.nullable(),
    filters: z.object({ campaigns: z.array(z.string().max(200)).max(200), sources: z.array(z.string().max(200)).max(100) }),
    matchRules: z.object({ leadId: z.boolean(), phone: z.boolean(), email: z.boolean() }),
  })
  .partial()
  .strict();
const FileConfigBody = z
  .object({
    sheetIndex: z.number().int().min(0).max(1000),
    headerRow: z.number().int().min(0).max(1000),
    kind: z.enum(['leads', 'ad_spend']),
    mapping: z.record(z.string().regex(/^\d{1,4}$/), z.string().max(40)),
    dateOrder: z.enum(['auto', 'DMY', 'MDY', 'YMD']),
    templateId: z.string().uuid(),
  })
  .partial()
  .strict();
const ProcessBody = z.object({ fileIds: z.array(z.string().uuid()).max(100).optional() }).strict();
const CampaignInputsBody = z.object({
  inputs: z
    .array(
      z
        .object({
          campaignName: z.string().trim().max(200).nullable(),
          source: z.string().trim().max(200).nullable(),
          spend: nonNeg.nullable(),
          budget: nonNeg.nullable(),
          targetLeads: nonNeg.nullable(),
          impressions: nonNeg.nullable(),
          clicks: nonNeg.nullable(),
          baselineCpl: nonNeg.nullable(),
        })
        .refine((v) => v.campaignName || v.source, 'Enter a campaign name or source'),
    )
    .max(200),
});
const DecisionsBody = z.object({
  decisions: z.record(z.string().regex(/^[0-9a-f]{12}$/), z.enum(['keep_all', 'keep_first', 'keep_latest']).nullable()),
});
const AiBody = z.object({ task: z.enum(AI_TASKS), question: z.string().max(500).optional() }).strict();

const csvList = z
  .string()
  .max(5000)
  .transform((v) => v.split(',').map((x) => x.trim()).filter(Boolean))
  .optional();
const STATUS = z.enum(['valid', 'duplicate', 'possible_duplicate', 'invalid']);
const FLAG = z.enum(LEAD_FLAGS);
const LeadQueryParams = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(500).default(25),
  search: z.string().max(200).optional(),
  fileIds: csvList,
  statuses: csvList.pipe(z.array(STATUS).optional()),
  flags: csvList.pipe(z.array(FLAG).optional()),
  sources: csvList,
  campaigns: csvList,
  leadStatuses: csvList,
  dateFrom: isoDay.optional(),
  dateTo: isoDay.optional(),
  presence: z.enum(['all', 'unique_to_file', 'in_multiple_files']).optional(),
  owners: csvList,
  stages: csvList,
  dispositions: csvList,
  followUp: csvList.pipe(z.array(z.enum(['overdue', 'upcoming', 'none'])).optional()),
  sort: z.string().max(200).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});
const ContactFiltersBody = z
  .object({
    owners: z.array(z.string().max(200)).max(200).optional(),
    stages: z.array(z.string().max(200)).max(200).optional(),
    dispositions: z.array(z.string().max(200)).max(200).optional(),
    followUp: z.array(z.enum(['overdue', 'upcoming', 'none'])).optional(),
  })
  .strict();
const GenerateBody = z
  .object({
    type: z.enum(['contact', 'individual', 'comparison', 'quality']),
    fileIds: z.array(z.string().uuid()).max(100).optional(),
    format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
    columns: z.array(z.object({ key: z.string().max(320), header: z.string().max(100) })).max(300).optional(),
    filters: ContactFiltersBody.optional(),
    reportDate: isoDay.optional(),
    includeStatus: z.boolean().optional(),
    timezoneLabel: z.string().max(80).optional(),
  })
  .strict();
const LeadQueryBody = z
  .object({
    search: z.string().max(200).optional(),
    fileIds: z.array(z.string().uuid()).max(100).optional(),
    statuses: z.array(STATUS).optional(),
    flags: z.array(FLAG).optional(),
    sources: z.array(z.string().max(200)).max(200).optional(),
    campaigns: z.array(z.string().max(200)).max(500).optional(),
    leadStatuses: z.array(z.string().max(200)).max(200).optional(),
    dateFrom: isoDay.optional(),
    dateTo: isoDay.optional(),
    presence: z.enum(['all', 'unique_to_file', 'in_multiple_files']).optional(),
    owners: z.array(z.string().max(200)).max(200).optional(),
    stages: z.array(z.string().max(200)).max(200).optional(),
    dispositions: z.array(z.string().max(200)).max(200).optional(),
    followUp: z.array(z.enum(['overdue', 'upcoming', 'none'])).optional(),
    sort: z.string().max(200).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
  })
  .strict();
const LeadExportBody = z
  .object({
    format: z.enum(['csv', 'xlsx']),
    variant: z.enum(['cleaned', 'original', 'both']).default('both'),
    query: LeadQueryBody.default({}),
    uids: z.array(z.string().max(80)).max(200000).optional(),
    stdColumns: z.array(z.string().max(60)).max(100).optional(),
    originalColumns: z.array(z.string().max(300)).max(500).optional(),
    timezoneLabel: z.string().max(80).optional(),
  })
  .strict();

export function sessionRoutes(service: SessionService, config: AppConfig, aiClient: AiClient | null, reports: ReportService): Router {
  const r = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024, files: config.MAX_FILES_PER_SESSION, fields: 10, parts: config.MAX_FILES_PER_SESSION + 10 },
  });
  const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many uploads. Wait a minute and try again.' } } });
  const exportLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many export requests. Wait a minute and try again.' } } });
  const aiLimiter = rateLimit({ windowMs: 60_000, limit: config.AI_RATE_LIMIT_PER_MINUTE, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests. Wait a minute and try again.' } } });

  const sid = (req: Request) => String(req.params.sessionId);
  const summary = (s: Session) => sessionSummary(s, config);
  const requireReport = (s: Session) => {
    if (!s.report) throw new AppError(409, 'NO_REPORT', 'Process at least one file to generate a report first.');
    return s.report;
  };
  const noStore = (res: Response) => res.setHeader('Cache-Control', 'no-store');

  // Sessions created by the portal belong to the browser that created them (X-Client-Id).
  // Other browsers get "not found", so ids that leak (e.g. in a screenshot) cannot be used elsewhere.
  r.param('sessionId', (req, _res, next, id) => {
    try {
      const s = service.store.has(String(id)) ? service.store.get(String(id)) : null;
      if (s?.ownerHash && s.ownerHash !== clientHash(req)) throw new AppError(404, 'SESSION_NOT_FOUND', 'Reporting session not found.');
      next();
    } catch (e) {
      next(e);
    }
  });

  r.post('/', async (req, res) => {
    const body = CreateSessionBody.parse(req.body);
    const s = await service.store.create(body.reportingDate, clientHash(req), body.mode);
    res.status(201).json(summary(s));
  });

  r.get('/:sessionId', (req, res) => {
    res.json(summary(service.store.get(sid(req))));
  });

  r.delete('/:sessionId', async (req, res) => {
    const id = sid(req);
    service.store.get(id);
    await service.mutex.run(id, () => service.store.delete(id));
    res.json({ deleted: true });
  });

  r.patch('/:sessionId/settings', async (req, res) => {
    const patch = SettingsBody.parse(req.body);
    const s = await service.withSession(sid(req), async (s) => {
      await service.updateSettings(s, patch);
      return s;
    });
    res.json(summary(s));
  });

  // Files ------------------------------------------------------------------------------------
  r.post('/:sessionId/files', uploadLimiter, (req, res, next) => {
    res.locals.uploadStartedAt = new Date().toISOString();
    try {
      service.store.get(sid(req)); // reject before buffering uploads for unknown/expired sessions
    } catch (e) {
      // Drain a reasonably sized body first so the client receives the 404/410 instead of a connection reset.
      const len = Number(req.headers['content-length'] ?? 0);
      if (len > 0 && len <= config.MAX_FILE_SIZE_MB * 1024 * 1024 * config.MAX_FILES_PER_SESSION) {
        req.on('end', () => next(e));
        req.resume();
        return;
      }
      res.setHeader('Connection', 'close');
      return next(e);
    }
    upload.array('files', config.MAX_FILES_PER_SESSION)(req, res, next);
  }, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const replace = z.string().uuid().optional().parse(req.query.replace);
    const result = await service.withSession(sid(req), async (s) => {
      const added = await service.addFiles(
        s,
        files.map((f) => ({ originalname: f.originalname, buffer: f.buffer, size: f.size })),
        { startedAt: res.locals.uploadStartedAt as string, replaceFileId: replace },
      );
      return { session: summary(s), added: added.map((f) => f.id) };
    });
    // Release upload buffers promptly.
    for (const f of files) (f as { buffer?: Buffer }).buffer = undefined;
    res.status(201).json(result);
  });

  r.get('/:sessionId/files/:fileId/preview', async (req, res) => {
    const q = z.object({ sheet: z.coerce.number().int().min(0).optional(), headerRow: z.coerce.number().int().min(0).optional() }).parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json(await service.preview(s, String(req.params.fileId), { sheetIndex: q.sheet, headerRow: q.headerRow }));
  });

  r.put('/:sessionId/files/:fileId/config', async (req, res) => {
    const body = FileConfigBody.parse(req.body);
    const out = await service.withSession(sid(req), async (s) => {
      const f = await service.updateFileConfig(s, String(req.params.fileId), body);
      return { file: fileSummary(f, s), session: summary(s) };
    });
    res.json(out);
  });

  r.get('/:sessionId/files/:fileId/issues', (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const s = service.store.get(sid(req));
    const f = service.getFile(s, String(req.params.fileId));
    const { issues } = service.allIssues(s, [f.id]);
    noStore(res);
    res.json({ total: f.validation?.issueCount ?? issues.length, stored: issues.length, truncated: Boolean(f.validation?.issuesTruncated), issues: issues.slice(q.offset, q.offset + q.limit) });
  });

  r.delete('/:sessionId/files/:fileId', async (req, res) => {
    const s = await service.withSession(sid(req), async (s) => {
      await service.removeFile(s, String(req.params.fileId));
      return s;
    });
    res.json(summary(s));
  });

  // Processing -------------------------------------------------------------------------------
  r.post('/:sessionId/process', async (req, res) => {
    const body = ProcessBody.parse(req.body ?? {});
    const s = await service.withSession(sid(req), async (s) => {
      await service.process(s, body.fileIds);
      return s;
    });
    res.json(summary(s));
  });

  r.post('/:sessionId/recalculate', async (req, res) => {
    const s = await service.withSession(sid(req), async (s) => {
      if (!s.reportFileIds.length) throw new AppError(409, 'NO_REPORT', 'Process files before recalculating.');
      await service.recalculate(s, null);
      return s;
    });
    res.json(summary(s));
  });

  r.get('/:sessionId/report', (req, res) => {
    const s = service.store.get(sid(req));
    const report = requireReport(s);
    noStore(res);
    res.json({ report, recommendations: buildRecommendations(report), stale: s.reportStale });
  });

  r.put('/:sessionId/campaign-inputs', async (req, res) => {
    const body = CampaignInputsBody.parse(req.body);
    const s = await service.withSession(sid(req), async (s) => {
      await service.setCampaignInputs(s, body.inputs);
      return s;
    });
    res.json(summary(s));
  });

  r.get('/:sessionId/duplicates', (req, res) => {
    const q = z.object({ kind: z.enum(['confirmed', 'possible']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json(service.duplicateGroups(s, q));
  });

  r.put('/:sessionId/duplicates/decisions', async (req, res) => {
    const body = DecisionsBody.parse(req.body);
    const s = await service.withSession(sid(req), async (s) => {
      await service.setDuplicateDecisions(s, body.decisions);
      return s;
    });
    res.json(summary(s));
  });

  // Exports ----------------------------------------------------------------------------------
  const exportName = (s: Session, suffix: string, ext: string) => {
    const p = s.report?.period;
    const date = p ? (p.isRange ? `${p.from}_to_${p.to}` : p.from) : s.settings.reportingDate;
    return safeFilename(`lead-report_${date}_${suffix}`) + `.${ext}`;
  };
  const attach = (res: Response, filename: string, type: string) => {
    noStore(res);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  };

  r.get('/:sessionId/validation-errors.csv', exportLimiter, (req, res) => {
    const s = service.store.get(sid(req));
    const { issues } = service.allIssues(s);
    const table = buildTable('validation-errors', s.report ?? ({} as never), issues);
    attach(res, exportName(s, 'validation-errors', 'csv'), 'text/csv; charset=utf-8');
    res.send(toCsv(table.columns.map((c) => c.header), table.rows));
  });

  r.get('/:sessionId/export/excel', exportLimiter, async (req, res) => {
    const s = service.store.get(sid(req));
    const report = requireReport(s);
    const buf = await buildWorkbook(report, service.allIssues(s, s.reportFileIds).issues);
    attach(res, exportName(s, 'report', 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  });

  r.get('/:sessionId/export/csv/:table', exportLimiter, (req, res) => {
    const key = z.enum(TABLE_KEYS).parse(req.params.table) as TableKey;
    const s = service.store.get(sid(req));
    const report = requireReport(s);
    const table = buildTable(key, report, key === 'validation-errors' ? service.allIssues(s, s.reportFileIds).issues : []);
    attach(res, exportName(s, key, 'csv'), 'text/csv; charset=utf-8');
    res.send(toCsv(table.columns.map((c) => c.header), table.rows.map((row) => row.map((v) => (v === null ? 'N/A' : v)))));
  });

  r.get('/:sessionId/export/pdf', exportLimiter, async (req, res) => {
    const s = service.store.get(sid(req));
    const buf = await buildPdf(requireReport(s));
    attach(res, exportName(s, 'report', 'pdf'), 'application/pdf');
    res.send(buf);
  });

  // AI ---------------------------------------------------------------------------------------
  r.post('/:sessionId/ai', aiLimiter, async (req, res) => {
    const body = AiBody.parse(req.body);
    const s = service.store.get(sid(req));
    const report = requireReport(s);
    if (!aiClient) {
      throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI insights are not configured. Set OPENAI_API_KEY on the server to enable them. All dashboards and exports work without it.');
    }
    if (s.aiRequests >= config.AI_MAX_REQUESTS_PER_SESSION) {
      throw new AppError(429, 'AI_SESSION_LIMIT', `This session has used its ${config.AI_MAX_REQUESTS_PER_SESSION} AI requests.`);
    }
    s.aiRequests++;
    const insight = await generateInsight(aiClient, config, report, body.task, body.question);
    res.json({ insight, requestsUsed: s.aiRequests, requestsLimit: config.AI_MAX_REQUESTS_PER_SESSION });
  });

  // Lead table ---------------------------------------------------------------------------------
  const toQuery = (q: Omit<z.infer<typeof LeadQueryParams>, 'page' | 'pageSize'>): LeadQuery => ({
    search: q.search,
    fileIds: q.fileIds,
    statuses: q.statuses,
    flags: q.flags,
    sources: q.sources,
    campaigns: q.campaigns,
    leadStatuses: q.leadStatuses,
    dateFrom: q.dateFrom,
    dateTo: q.dateTo,
    presence: q.presence,
    owners: q.owners,
    stages: q.stages,
    dispositions: q.dispositions,
    followUp: q.followUp,
    sort: q.sort,
    dir: q.dir,
  });

  r.get('/:sessionId/leads', (req, res) => {
    const q = LeadQueryParams.parse(req.query);
    const s = service.store.get(sid(req));
    // fileIds selects which files are loaded (combined or file-by-file); the other filters narrow the rows.
    const { files, rows } = service.leadRows(s, q.fileIds);
    const query = toQuery(q);
    const filtered = sortLeads(filterLeads(rows, { ...query, fileIds: undefined }), q.sort, q.dir);
    const start = (q.page - 1) * q.pageSize;
    noStore(res);
    res.json({
      total: filtered.length,
      totalUnfiltered: rows.length,
      page: q.page,
      pageSize: q.pageSize,
      rows: filtered.slice(start, start + q.pageSize).map(({ createdDay: _c, ...row }) => row),
      facets: leadFacets(rows),
      columns: { standard: standardColumns(rows), original: originalColumns(files) },
      files: files.map((f) => ({ id: f.id, name: f.name })),
      labels: { statuses: STATUS_LABELS, flags: FLAG_LABELS },
    });
  });

  r.get('/:sessionId/comparison', (req, res) => {
    const q = z.object({ fileIds: csvList }).parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json(service.comparison(s, q.fileIds));
  });

  // Testing mode: a report for any subset of files, without changing the session's report.
  r.get('/:sessionId/report/preview', (req, res) => {
    const q = z.object({ fileIds: csvList }).parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json({ report: service.previewReport(s, q.fileIds ?? []) });
  });

  r.get('/:sessionId/audit', (req, res) => {
    const s = service.store.get(sid(req));
    noStore(res);
    res.json({ entries: [...s.audit].reverse() });
  });

  const periodOf = (s: Session) => s.settings.dateRange ?? { from: s.settings.reportingDate, to: s.settings.reportingDate };

  r.post('/:sessionId/export/leads', exportLimiter, async (req, res) => {
    const body = LeadExportBody.parse(req.body);
    const s = service.store.get(sid(req));
    const { files, rows } = service.leadRows(s, body.query.fileIds);
    const selection = Boolean(body.uids);
    let picked = selection ? filterLeads(rows, { uids: body.uids }) : filterLeads(rows, { ...body.query, fileIds: undefined });
    picked = sortLeads(picked, body.query.sort, body.query.dir);
    if (!picked.length) throw new AppError(422, 'NOTHING_TO_EXPORT', 'No leads match the current filters or selection.');
    const allStd = standardColumns(rows);
    const allOrig = originalColumns(files);
    const stdColumns = body.stdColumns ? allStd.filter((c) => body.stdColumns!.includes(c.key)) : allStd;
    const origColumns = body.originalColumns ? allOrig.filter((h) => body.originalColumns!.includes(h)) : allOrig;
    const out = await buildLeadExport(picked, {
      format: body.format,
      variant: body.variant,
      stdColumns,
      originalColumns: origColumns,
      period: periodOf(s),
      query: body.query,
      fileNames: Object.fromEntries([...s.files.values()].map((f) => [f.id, f.name])),
      selection,
      generatedAt: new Date(),
      timezoneLabel: body.timezoneLabel ?? 'UTC',
    });
    service.audit(s, 'export', `${out.filename}: ${picked.length} lead row(s), ${body.variant} values`);
    attach(res, out.filename, out.contentType);
    res.send(out.buffer);
  });

  r.get('/:sessionId/export/comparison', exportLimiter, async (req, res) => {
    const q = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx'), fileIds: csvList, tz: z.string().max(80).optional() }).parse(req.query);
    const s = service.store.get(sid(req));
    const cmp = service.comparison(s, q.fileIds);
    if (!cmp.files.length) throw new AppError(422, 'NOTHING_TO_EXPORT', 'Upload at least one ready lead file to compare.');
    const out = await buildComparisonExport(cmp, { format: q.format, period: periodOf(s), generatedAt: new Date(), timezoneLabel: q.tz ?? 'UTC', test: s.mode === 'test' });
    service.audit(s, 'export', out.filename);
    attach(res, out.filename, out.contentType);
    res.send(out.buffer);
  });

  r.get('/:sessionId/export/quality', exportLimiter, async (req, res) => {
    const q = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx'), tz: z.string().max(80).optional() }).parse(req.query);
    const s = service.store.get(sid(req));
    const files = [...s.files.values()].sort((a, b) => a.order - b.order);
    const out = await buildQualityExport({
      format: q.format,
      report: s.report,
      issues: service.allIssues(s).issues,
      rejected: files.flatMap((f) => (f.validation?.rejectedRows ?? []).map((x) => ({ fileName: f.name, rowNumber: x.rowNumber, reason: x.reason }))),
      audit: s.audit,
      period: periodOf(s),
      generatedAt: new Date(),
      timezoneLabel: q.tz ?? 'UTC',
    });
    service.audit(s, 'export', out.filename);
    attach(res, out.filename, out.contentType);
    res.send(out.buffer);
  });

  // Lead Contact Report (SalesMax) ---------------------------------------------------------------
  r.get('/:sessionId/contact-report', (req, res) => {
    const q = z
      .object({
        fileIds: csvList,
        owners: csvList,
        stages: csvList,
        dispositions: csvList,
        followUp: csvList.pipe(z.array(z.enum(['overdue', 'upcoming', 'none'])).optional()),
        reportDate: isoDay.optional(),
      })
      .parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json(reports.view(s, { fileIds: q.fileIds, filters: { owners: q.owners, stages: q.stages, dispositions: q.dispositions, followUp: q.followUp }, reportDate: q.reportDate }));
  });

  r.get('/:sessionId/duplicate-rules', (req, res) => {
    const q = z.object({ fileIds: csvList }).parse(req.query);
    const s = service.store.get(sid(req));
    noStore(res);
    res.json({ rules: reports.compareDuplicateRules(s, q.fileIds) });
  });

  r.post('/:sessionId/reports', exportLimiter, async (req, res) => {
    const body = GenerateBody.parse(req.body);
    const out = await service.withSession(sid(req), (s) => reports.generate(s, body));
    res.status(201).json({ reports: out.map((x) => reports.publicMeta(x)) });
  });

  r.get('/:sessionId/reports', (req, res) => {
    const s = service.store.get(sid(req));
    noStore(res);
    res.json({ reports: s.generatedReports.map((x) => reports.publicMeta(x)) });
  });

  r.get('/:sessionId/reports/zip', exportLimiter, async (req, res) => {
    const q = z.object({ ids: csvList }).parse(req.query);
    const s = service.store.get(sid(req));
    const out = await reports.zip(s, q.ids ?? []);
    attach(res, out.filename, out.contentType);
    res.send(out.buffer);
  });

  r.get('/:sessionId/reports/:reportId/download', exportLimiter, async (req, res) => {
    const s = service.store.get(sid(req));
    const out = await reports.download(s, z.string().uuid().parse(req.params.reportId));
    attach(res, out.filename, out.contentType);
    res.send(out.buffer);
  });

  return r;
}
