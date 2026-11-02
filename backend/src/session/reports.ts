import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { analyzeDuplicates, applyDuplicateMode, type DuplicateMode, type MatchRules } from '../domain/dedupe.js';
import {
  buildContactReport,
  CONTACT_FIELDS,
  dispositionOf,
  filterContacts,
  followUpStatus,
  ownerOf,
  SALESMAX_HEADERS,
  stageOf,
  type ContactFilters,
  type ContactReport,
} from '../domain/contact-report.js';
import { LEAD_FIELD_MAP, LEAD_FIELDS } from '../domain/fields.js';
import { leadFlags } from '../domain/kpi.js';
import { FLAG_LABELS, STATUS_LABELS } from '../domain/leads.js';
import { groupKey, type CellValue } from '../domain/normalize.js';
import type { LeadRecord } from '../domain/validate.js';
import { buildContactPdf } from '../export/contact-pdf.js';
import { buildContactWorkbook, type CellOut, type ExportColumn } from '../export/contact-report.js';
import { buildComparisonExport, buildQualityExport } from '../export/leads.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { safeFilename, toCsv } from '../lib/sanitize.js';
import type { HistoryStore } from './history.js';
import type { SessionService } from './service.js';
import type { GeneratedReport, Session, SessionFile } from './store.js';

export interface ColumnChoice {
  key: string;
  header: string;
}

export interface GenerateOptions {
  type: 'contact' | 'individual' | 'comparison' | 'quality';
  fileIds?: string[];
  format: 'xlsx' | 'csv' | 'pdf';
  columns?: ColumnChoice[];
  filters?: ContactFilters;
  reportDate?: string;
  includeStatus?: boolean;
  timezoneLabel?: string;
}

const ISO_DT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const CONTACT_SET = new Set<string>(CONTACT_FIELDS);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TYPES: Record<string, string> = { xlsx: XLSX, csv: 'text/csv; charset=utf-8', pdf: 'application/pdf', zip: 'application/zip' };

function kindOf(key: string): ExportColumn['kind'] {
  const t = LEAD_FIELD_MAP.get(key)?.type;
  if (t === 'date' || t === 'datetime') return 'date';
  if (t === 'number' || t === 'currency') return 'number';
  if (t === 'phone') return 'phone';
  return 'text';
}

const fmtStamp = (iso: string | null, tz: string) => (iso ? `${new Date(iso).toISOString().replace('T', ' ').slice(0, 19)} UTC${tz && tz !== 'UTC' ? ` (viewer timezone: ${tz})` : ''}` : '—');
const describeFilters = (f?: ContactFilters) =>
  [
    f?.owners?.length ? `Owner: ${f.owners.join(', ')}` : '',
    f?.stages?.length ? `Stage: ${f.stages.join(', ')}` : '',
    f?.dispositions?.length ? `Disposition: ${f.dispositions.join(', ')}` : '',
    f?.followUp?.length ? `Follow-up: ${f.followUp.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ') || 'None';

/** Lead Contact Report: scope resolution, previews, generation, stored report files and their timings. */
export class ReportService {
  constructor(
    private readonly service: SessionService,
    private readonly history: HistoryStore,
  ) {}

  defaultReportDate(s: Session): string {
    return s.settings.dateRange?.to ?? s.settings.reportingDate;
  }

  /** Ready lead files in scope (default: the report's files, or every ready lead file before the first report). */
  files(s: Session, fileIds?: string[]): SessionFile[] {
    const all = [...s.files.values()].filter((f) => f.status === 'ready' && f.kind === 'leads' && f.validation && f.workbook).sort((a, b) => a.order - b.order);
    if (fileIds?.length) {
      for (const id of fileIds) this.service.getFile(s, id);
      return all.filter((f) => fileIds.includes(f.id));
    }
    const reportIds = s.reportFileIds.filter((id) => all.some((f) => f.id === id));
    return reportIds.length ? all.filter((f) => reportIds.includes(f.id)) : all;
  }

  private working(s: Session, files: SessionFile[], mode: DuplicateMode = s.settings.duplicateMode, rules: MatchRules = s.settings.matchRules) {
    const accepted = files.flatMap((f) => f.validation!.leads);
    const analysis = analyzeDuplicates(accepted, { cautiousMatching: s.settings.cautiousMatching, rules });
    const working = applyDuplicateMode(accepted, analysis, mode, s.duplicateDecisions);
    return { accepted, analysis, working };
  }

  private mapped(files: SessionFile[]): Set<string> {
    return new Set(files.flatMap((f) => Object.values(f.mapping)));
  }

  /** Columns that can go into Full Data: the 16 SalesMax columns, other mapped fields, and unmapped source columns. */
  columns(files: SessionFile[]) {
    const presence = (key: string) => files.filter((f) => Object.values(f.mapping).includes(key)).map((f) => f.name);
    const standard = CONTACT_FIELDS.map((k) => ({ key: k, header: SALESMAX_HEADERS[k], kind: kindOf(k), salesmax: true, presentIn: presence(k), missingIn: files.filter((f) => !Object.values(f.mapping).includes(k)).map((f) => f.name) }));
    const otherMapped = LEAD_FIELDS.filter((d) => !CONTACT_SET.has(d.key) && files.some((f) => Object.values(f.mapping).includes(d.key))).map((d) => ({ key: d.key, header: d.label.toUpperCase(), kind: kindOf(d.key), salesmax: false, presentIn: presence(d.key), missingIn: [] as string[] }));
    const extras: { key: string; header: string; kind: ExportColumn['kind']; salesmax: boolean; presentIn: string[]; missingIn: string[] }[] = [];
    for (const f of files) {
      f.headers.forEach((h, i) => {
        if (f.mapping[String(i)] || /^Column [A-Z]+$/.test(h)) return;
        const e = extras.find((x) => x.key === `orig:${h}`);
        if (e) e.presentIn.push(f.name);
        else extras.push({ key: `orig:${h}`, header: h, kind: 'text', salesmax: false, presentIn: [f.name], missingIn: [] });
      });
    }
    return [...standard, ...otherMapped, ...extras];
  }

  /** Default output columns: the SalesMax columns present in at least one file, in SalesMax order. */
  private defaultColumns(files: SessionFile[]): ExportColumn[] {
    return this.columns(files)
      .filter((c) => c.salesmax && c.presentIn.length)
      .map((c) => ({ key: c.key, header: c.header, kind: c.kind }));
  }

  private resolveColumns(files: SessionFile[], choice?: ColumnChoice[]): ExportColumn[] {
    if (!choice?.length) return this.defaultColumns(files);
    const avail = new Map(this.columns(files).map((c) => [c.key, c]));
    const out: ExportColumn[] = [];
    for (const c of choice) {
      const a = avail.get(c.key);
      if (!a) throw new AppError(400, 'UNKNOWN_COLUMN', `Column "${c.key}" is not available in the selected files.`);
      out.push({ key: c.key, header: c.header.trim().slice(0, 100) || a.header, kind: a.kind });
    }
    if (new Set(out.map((c) => c.header.toLowerCase())).size !== out.length) throw new AppError(400, 'DUPLICATE_HEADER', 'Two output columns have the same name. Rename one of them.');
    return out;
  }

  /** Original value of a cell for a record, typed for Excel (dates as Date, numbers as numbers). */
  private value(f: SessionFile, r: LeadRecord | null, rowNumber: number, c: ExportColumn): CellOut {
    const sheet = f.workbook!.sheets[f.sheetIndex];
    const row = sheet.rows[rowNumber - sheet.firstRow] ?? [];
    let colIdx: number;
    if (c.key.startsWith('orig:')) colIdx = f.headers.indexOf(c.key.slice(5));
    else colIdx = Number(Object.entries(f.mapping).find(([, k]) => k === c.key)?.[0] ?? -1);
    if (colIdx < 0) return null;
    const raw: CellValue = row[colIdx] ?? null;
    if (raw === null || raw === '') return null;
    if (c.kind === 'date') {
      const d = r?.dates[c.key];
      if (d) return new Date(d.ms);
      if (typeof raw === 'string' && ISO_DT.test(raw)) return new Date(`${raw.length === 10 ? `${raw}T00:00:00` : raw}Z`);
      return String(raw); // unparseable date: kept exactly as uploaded
    }
    if (c.kind === 'number') return r?.numbers[c.key] ?? (typeof raw === 'number' ? raw : String(raw));
    if (typeof raw === 'string' && ISO_DT.test(raw) && raw.includes('T')) return new Date(`${raw}Z`);
    if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
    return raw;
  }

  /** Data for the Contact Report page and the preview: report, counts, facets, schema per file. */
  view(s: Session, q: { fileIds?: string[]; filters?: ContactFilters; reportDate?: string }) {
    const files = this.files(s, q.fileIds);
    const reportDate = q.reportDate ?? this.defaultReportDate(s);
    const mapped = this.mapped(files);
    const { accepted, analysis, working } = this.working(s, files);
    const filtered = filterContacts(working.records, q.filters ?? {}, reportDate);
    const report = buildContactReport(filtered, reportDate, mapped);
    const facet = (fn: (r: LeadRecord) => string) => {
      const m = new Map<string, { value: string; count: number }>();
      for (const r of working.records) {
        const v = fn(r);
        const e = m.get(groupKey(v)) ?? { value: v, count: 0 };
        e.count++;
        m.set(groupKey(v), e);
      }
      return [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    };
    const { rows: leadRows } = this.service.leadRows(s, files.map((f) => f.id));
    const perFile = files.map((f) => {
      const fr = leadRows.filter((r) => r.fileId === f.id);
      const kept = working.records.filter((r) => r.fileId === f.id);
      const incomplete = fr.filter((r) => r.status !== 'invalid' && r.flags.some((x) => ['missing_phone', 'invalid_phone', 'missing_email', 'invalid_email', 'missing_name'].includes(x))).length;
      return {
        fileId: f.id,
        fileName: f.name,
        ext: f.ext,
        size: f.size,
        sheetName: f.workbook!.sheets[f.sheetIndex]?.name ?? '',
        sheetNames: f.workbook!.sheets.map((x) => x.name),
        rows: f.validation!.dataRows,
        detectedColumns: f.headers.length,
        leadsInReport: kept.length,
        qualified: kept.filter((r) => leadFlags(r, { fromMs: 0, toMs: 0 }).qualified === true).length,
        valid: fr.filter((r) => r.status === 'valid').length,
        duplicate: fr.filter((r) => r.status === 'duplicate' || r.status === 'possible_duplicate').length,
        invalid: f.validation!.rejected,
        incomplete,
        mappedSalesmax: CONTACT_FIELDS.filter((k) => Object.values(f.mapping).includes(k)).map((k) => ({ header: SALESMAX_HEADERS[k], source: f.headers[Number(Object.entries(f.mapping).find(([, v]) => v === k)![0])] })),
        missingSalesmax: CONTACT_FIELDS.filter((k) => !Object.values(f.mapping).includes(k)).map((k) => SALESMAX_HEADERS[k]),
        additionalColumns: f.headers.filter((h, i) => !f.mapping[String(i)] && !/^Column [A-Z]+$/.test(h)),
        uploadStartedAt: f.uploadStartedAt,
        uploadCompletedAt: f.uploadCompletedAt,
        processingMs: f.processingMs,
      };
    });
    return {
      reportDate,
      mode: s.mode,
      report,
      counts: {
        rawRows: files.reduce((n, f) => n + f.validation!.dataRows, 0),
        accepted: accepted.length,
        rejected: files.reduce((n, f) => n + f.validation!.rejected, 0),
        uniqueLeads: analysis.uniqueLeads,
        duplicateRowsExcluded: working.excludedUids.size,
        possibleDuplicates: analysis.possibleDuplicateRows,
        reportedLeads: working.records.length,
        filteredLeads: filtered.length,
      },
      facets: {
        owners: facet(ownerOf),
        stages: facet(stageOf),
        dispositions: facet(dispositionOf),
        followUp: facet((r) => followUpStatus(r, reportDate)),
      },
      files: perFile,
      columns: this.columns(files),
      defaultColumns: this.defaultColumns(files).map((c) => c.key),
      duplicateMode: s.settings.duplicateMode,
      matchRules: s.settings.matchRules,
    };
  }

  /** Totals for alternative duplicate rules, side by side, without changing the session. */
  compareDuplicateRules(s: Session, fileIds?: string[]) {
    const files = this.files(s, fileIds);
    const all: MatchRules = { leadId: true, phone: true, email: true };
    const presets: { label: string; mode: DuplicateMode; rules: MatchRules }[] = [
      { label: 'Count all rows as submitted', mode: 'count_all', rules: all },
      { label: 'Exclude duplicates — Lead ID, phone or email', mode: 'exclude_duplicates', rules: all },
      { label: 'Exclude duplicates — phone only', mode: 'exclude_duplicates', rules: { leadId: false, phone: true, email: false } },
      { label: 'Exclude duplicates — email only', mode: 'exclude_duplicates', rules: { leadId: false, phone: false, email: true } },
      { label: 'Exclude duplicates — phone or email', mode: 'exclude_duplicates', rules: { leadId: false, phone: true, email: true } },
      { label: 'Keep latest record — Lead ID, phone or email', mode: 'keep_latest', rules: all },
    ];
    return presets.map((p) => {
      const { accepted, analysis, working } = this.working(s, files, p.mode, p.rules);
      const current = p.mode === s.settings.duplicateMode && JSON.stringify(p.rules) === JSON.stringify(s.settings.matchRules);
      return {
        ...p,
        current,
        acceptedRows: accepted.length,
        leadsInReport: working.records.length,
        uniqueLeads: analysis.uniqueLeads,
        duplicateRows: analysis.duplicateRows,
        excludedRows: working.excludedUids.size,
        possibleDuplicates: analysis.possibleDuplicateRows,
      };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------------------------

  private prefix(s: Session) {
    return s.mode === 'test' ? 'TEST_' : '';
  }

  private timings(s: Session, files: SessionFile[]) {
    const starts = files.map((f) => f.uploadStartedAt).filter(Boolean).sort();
    const ends = files.map((f) => f.uploadCompletedAt).filter((x): x is string => Boolean(x)).sort();
    const fileMs = files.reduce((n, f) => n + (f.processingMs ?? 0), 0);
    const processedIncluded = s.lastProcessedAt && files.every((f) => s.reportFileIds.includes(f.id));
    const procStart = files
      .map((f) => (f.uploadCompletedAt && f.processingMs !== null ? Date.parse(f.uploadCompletedAt) - f.processingMs : null))
      .filter((x): x is number => x !== null)
      .sort((a, b) => a - b)[0];
    const procEnd = Math.max(...ends.map((e) => Date.parse(e)), processedIncluded ? (s.lastProcessedAt ?? 0) : 0);
    return {
      uploadStartedAt: starts[0] ?? null,
      uploadCompletedAt: ends.at(-1) ?? null,
      processingStartedAt: procStart ? new Date(procStart).toISOString() : null,
      processingCompletedAt: Number.isFinite(procEnd) && procEnd > 0 ? new Date(procEnd).toISOString() : null,
      processingMs: fileMs + (processedIncluded ? (s.lastProcessingMs ?? 0) : 0),
    };
  }

  private async store(s: Session, meta: Omit<GeneratedReport, 'id' | 'path' | 'size' | 'downloads' | 'status' | 'error'>, id: string, buffer: Buffer | null, error: string | null): Promise<GeneratedReport> {
    let filePath: string | null = null;
    if (buffer) {
      const dir = path.join(s.dir, 'reports');
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      filePath = path.join(dir, `${id}.${meta.format}`);
      await fs.writeFile(filePath, buffer, { mode: 0o600 });
    }
    const rep: GeneratedReport = { ...meta, id, path: filePath, size: buffer?.length ?? 0, downloads: [], status: buffer ? 'completed' : 'failed', error };
    s.generatedReports.unshift(rep);
    this.service.audit(s, buffer ? 'report_file_generated' : 'report_file_failed', `${rep.filename}${error ? `: ${error}` : ''} (${rep.generationMs} ms)`);
    await this.recordHistory(s, rep);
    return rep;
  }

  async recordHistory(s: Session, rep: GeneratedReport): Promise<void> {
    if (!s.ownerHash) return;
    const files = this.files(s, rep.fileIds.length ? rep.fileIds.filter((id) => s.files.has(id)) : undefined);
    await this.history
      .recordReport(
        {
          id: s.id,
          ownerHash: s.ownerHash,
          reportingPeriod: s.settings.dateRange ?? { from: s.settings.reportingDate, to: s.settings.reportingDate },
          fileNames: [...new Set([...files.map((f) => f.name), ...rep.fileNames])],
          recordsProcessed: files.reduce((n, f) => n + (f.validation?.dataRows ?? 0), 0),
          uniqueLeads: s.report?.counts.uniqueLeads ?? rep.totalLeads ?? 0,
          lastGeneratedAt: rep.generationCompletedAt,
          processingMs: rep.processingMs,
          sessionExpiresAt: new Date(s.expiresAt).toISOString(),
          mode: s.mode,
        },
        {
          id: rep.id,
          type: rep.type,
          format: rep.format,
          filename: rep.filename,
          status: rep.status,
          test: rep.test,
          fileNames: rep.fileNames,
          totalLeads: rep.totalLeads,
          reportDate: rep.reportDate,
          processingMs: rep.processingMs,
          generationMs: rep.generationMs,
          generationStartedAt: rep.generationStartedAt,
          generationCompletedAt: rep.generationCompletedAt,
          downloads: rep.downloads,
        },
      )
      .catch((e) => logger.error('history_write_failed', { error: (e as Error).message }));
  }

  async generate(s: Session, o: GenerateOptions): Promise<GeneratedReport[]> {
    if (o.type === 'individual') {
      const files = this.files(s, o.fileIds);
      if (!files.length) throw new AppError(422, 'NOTHING_TO_REPORT', 'Upload and map at least one lead file first.');
      const out: GeneratedReport[] = [];
      for (const f of files) out.push(await this.generateOne(s, { ...o, fileIds: [f.id] }, 'individual'));
      return out;
    }
    return [await this.generateOne(s, o, o.type === 'contact' ? null : o.type)];
  }

  private async generateOne(s: Session, o: GenerateOptions, forcedType: GeneratedReport['type'] | null): Promise<GeneratedReport> {
    const t0 = Date.now();
    const generationStartedAt = new Date(t0).toISOString();
    const id = randomUUID();
    const files = this.files(s, o.fileIds);
    if (!files.length) throw new AppError(422, 'NOTHING_TO_REPORT', 'Upload and map at least one lead file first.');
    const reportDate = o.reportDate ?? this.defaultReportDate(s);
    const tz = o.timezoneLabel ?? 'UTC';
    const date = reportDate;
    const type: GeneratedReport['type'] = forcedType ?? (files.length > 1 ? 'combined' : 'contact');
    const pre = this.prefix(s);
    const timing = this.timings(s, files);
    let filename = '';
    let totalLeads: number | null = null;
    try {
      let buffer: Buffer;
      if (type === 'comparison') {
        const out = await buildComparisonExport(this.service.comparison(s, files.map((f) => f.id)), { format: o.format === 'pdf' ? 'xlsx' : o.format, period: { from: reportDate, to: reportDate }, generatedAt: new Date(t0), timezoneLabel: tz, test: s.mode === 'test' });
        buffer = out.buffer;
        filename = out.filename;
      } else if (type === 'quality') {
        const out = await buildQualityExport({
          format: o.format === 'pdf' ? 'xlsx' : o.format,
          report: s.report,
          issues: this.service.allIssues(s, files.map((f) => f.id)).issues,
          rejected: files.flatMap((f) => f.validation!.rejectedRows.map((x) => ({ fileName: f.name, rowNumber: x.rowNumber, reason: x.reason }))),
          audit: s.audit,
          period: { from: reportDate, to: reportDate },
          generatedAt: new Date(t0),
          timezoneLabel: tz,
        });
        buffer = out.buffer;
        filename = `${pre}Lead_Data_Quality_Report_${date}.${o.format === 'pdf' ? 'xlsx' : o.format}`;
      } else {
        const built = await this.buildContact(s, files, o, reportDate, type, id, generationStartedAt, timing, tz);
        buffer = built.buffer;
        totalLeads = built.totalLeads;
        const base = type === 'combined' ? 'Combined_Lead_Report' : type === 'individual' ? `Lead_Contact_Report_${files[0].name.replace(/\.[^.]+$/, '')}` : 'Lead_Contact_Report';
        filename = `${safeFilename(`${pre}${base}_${date}`)}.${o.format}`;
      }
      const done = Date.now();
      return await this.store(
        s,
        { type, format: type === 'comparison' || type === 'quality' ? (o.format === 'pdf' ? 'xlsx' : o.format) : o.format, test: s.mode === 'test', filename, fileIds: files.map((f) => f.id), fileNames: files.map((f) => f.name), totalLeads, reportDate, filters: describeFilters(o.filters), ...timing, generationStartedAt, generationCompletedAt: new Date(done).toISOString(), generationMs: done - t0 },
        id,
        buffer,
        null,
      );
    } catch (e) {
      const done = Date.now();
      const message = e instanceof AppError ? e.message : 'The report could not be generated.';
      if (!(e instanceof AppError)) logger.error('report_generation_failed', { error: (e as Error).stack });
      await this.store(
        s,
        { type, format: o.format, test: s.mode === 'test', filename: filename || `${type}_report`, fileIds: files.map((f) => f.id), fileNames: files.map((f) => f.name), totalLeads, reportDate, filters: describeFilters(o.filters), ...timing, generationStartedAt, generationCompletedAt: new Date(done).toISOString(), generationMs: done - t0 },
        id,
        null,
        message,
      );
      throw e instanceof AppError ? e : new AppError(500, 'REPORT_FAILED', message);
    }
  }

  private async buildContact(
    s: Session,
    files: SessionFile[],
    o: GenerateOptions,
    reportDate: string,
    type: GeneratedReport['type'],
    reportId: string,
    startedAt: string,
    timing: ReturnType<ReportService['timings']>,
    tz: string,
  ): Promise<{ buffer: Buffer; totalLeads: number }> {
    const columns = this.resolveColumns(files, o.columns);
    if (!columns.length) throw new AppError(400, 'NO_COLUMNS', 'Select at least one column for the Full Data sheet.');
    const mapped = this.mapped(files);
    const { accepted, analysis, working } = this.working(s, files);
    const filtered = filterContacts(working.records, o.filters ?? {}, reportDate);
    const report: ContactReport = buildContactReport(filtered, reportDate, mapped);
    const byId = new Map(files.map((f) => [f.id, f]));
    const { rows: leadRows } = this.service.leadRows(s, files.map((f) => f.id));
    const statusOf = new Map(leadRows.map((r) => [r.uid, r]));
    const includeStatus = o.includeStatus !== false;
    const rowsFor = (rs: LeadRecord[]) => rs.map((r) => columns.map((c) => this.value(byId.get(r.fileId)!, r, r.rowNumber, c)));
    const multi = files.length > 1;
    const qualifiedStageLabels = [...new Set(filtered.filter((r) => r.text.leadStage && leadFlags(r, { fromMs: 0, toMs: 0 }).qualified === true).map((r) => r.text.leadStage!))];
    const test = s.mode === 'test';
    const title = `${test ? 'TEST REPORT — ' : ''}Lead Contact Report — Salesmax Export`;
    const filterText = describeFilters(o.filters);
    const sourceLine = `Source: ${files.map((f) => f.name).join(', ')} (${files.reduce((n, f) => n + f.validation!.dataRows, 0)} rows uploaded; ${filtered.length} leads in this report${working.excludedUids.size ? `; ${working.excludedUids.size} duplicate rows excluded` : ''}${filterText !== 'None' ? `; filtered: ${filterText}` : ''}; ${columns.length} columns). Figures below are live formulas on the Full Data sheet.`;

    // Extra sheets
    const excludedRecs = accepted.filter((r) => working.excludedUids.has(r.uid));
    const dupRecs = filterContacts(excludedRecs, o.filters ?? {}, reportDate);
    const extraSheets: { name: string; headers: string[]; rows: CellOut[][]; note?: string }[] = [];
    if (dupRecs.length || analysis.possibleDuplicateRows) {
      const possibles = filtered.filter((r) => statusOf.get(r.uid)?.status === 'possible_duplicate');
      extraSheets.push({
        name: 'Duplicate Leads',
        note: 'Duplicate rows excluded from Full Data (confirmed by Lead ID / phone / email), plus possible duplicates that are still counted until reviewed. Source files are unchanged.',
        headers: ['SOURCE FILE', 'SOURCE ROW', 'DUPLICATE STATUS', 'DUPLICATE GROUP', 'MATCHED ON', ...columns.map((c) => c.header)],
        rows: [...dupRecs.map((r) => ({ r, st: 'Excluded duplicate' })), ...possibles.map((r) => ({ r, st: 'Possible duplicate (kept)' }))].map(({ r, st }) => {
          const lr = statusOf.get(r.uid);
          return [r.fileName, r.rowNumber, st, lr?.duplicateGroupId ?? '', (lr?.matchedOn ?? []).join(', '), ...columns.map((c) => this.value(byId.get(r.fileId)!, r, r.rowNumber, c))];
        }),
      });
    }
    const invalidRows: CellOut[][] = [];
    for (const f of files)
      for (const rj of f.validation!.rejectedRows) invalidRows.push([f.name, rj.rowNumber, 'Invalid (not counted)', rj.reason, ...columns.map((c) => this.value(f, null, rj.rowNumber, c))]);
    for (const r of filtered) {
      const lr = statusOf.get(r.uid);
      const issues = (lr?.flags ?? []).filter((x) => ['missing_phone', 'invalid_phone', 'missing_email', 'invalid_email', 'missing_name'].includes(x));
      if (issues.length) invalidRows.push([r.fileName, r.rowNumber, 'Incomplete (counted)', issues.map((x) => FLAG_LABELS[x]).join('; '), ...columns.map((c) => this.value(byId.get(r.fileId)!, r, r.rowNumber, c))]);
    }
    if (invalidRows.length)
      extraSheets.push({
        name: 'Invalid or Incomplete Leads',
        note: 'Invalid rows were not counted (no lead identifier). Incomplete rows are counted in the report but have missing or invalid contact details.',
        headers: ['SOURCE FILE', 'SOURCE ROW', 'RECORD STATUS', 'ISSUE', ...columns.map((c) => c.header)],
        rows: invalidRows,
      });

    const allCols = this.columns(files);
    const chosen = new Set(columns.map((c) => c.key));
    const renamed = columns.filter((c) => {
      const a = allCols.find((x) => x.key === c.key);
      return a && a.header !== c.header;
    });
    const processing = [
      { label: 'Report ID', value: reportId },
      { label: 'Report type', value: `${type === 'combined' ? 'Combined lead report' : type === 'individual' ? 'Individual file report' : 'Lead contact report'}${test ? ' (TEST — not for operational use)' : ''}` },
      { label: 'Report date', value: `${reportDate} (follow-ups before this date are overdue)` },
      { label: 'Report generation started', value: fmtStamp(startedAt, tz) },
      { label: 'Upload started / completed', value: `${fmtStamp(timing.uploadStartedAt, tz)} / ${fmtStamp(timing.uploadCompletedAt, tz)}` },
      { label: 'Processing started / completed', value: `${fmtStamp(timing.processingStartedAt, tz)} / ${fmtStamp(timing.processingCompletedAt, tz)}` },
      { label: 'Processing duration', value: `${((timing.processingMs ?? 0) / 1000).toFixed(2)} s (reading, validating and processing the files)` },
      { label: 'Source files', value: files.map((f) => f.name).join(', ') },
      { label: 'Filters', value: filterText },
      { label: 'Duplicate handling', value: `${s.settings.duplicateMode} · match on ${Object.entries(s.settings.matchRules).filter(([, v]) => v).map(([k]) => k).join(', ')}` },
      { label: 'Rows uploaded', value: String(files.reduce((n, f) => n + f.validation!.dataRows, 0)) },
      { label: 'Records retained (Full Data)', value: String(filtered.length) },
      { label: 'Records excluded as duplicates', value: String(dupRecs.length) },
      { label: 'Records flagged (possible duplicates / incomplete)', value: `${filtered.filter((r) => statusOf.get(r.uid)?.status === 'possible_duplicate').length} / ${invalidRows.filter((r) => r[2] === 'Incomplete (counted)').length}` },
      { label: 'Invalid rows (not counted)', value: String(files.reduce((n, f) => n + f.validation!.rejected, 0)) },
      { label: 'Columns included', value: columns.map((c) => c.header).join(', ') },
      { label: 'Columns excluded', value: allCols.filter((c) => !chosen.has(c.key) && c.presentIn.length).map((c) => c.header).join(', ') || 'None' },
      { label: 'Columns renamed', value: renamed.map((c) => `${allCols.find((x) => x.key === c.key)!.header} → ${c.header}`).join(', ') || 'None' },
      { label: 'SalesMax columns missing from the data', value: report.missingFields.join(', ') || 'None' },
    ];
    const processingTables = [
      {
        title: 'Files',
        headers: ['File', 'Worksheet', 'Rows', 'Accepted', 'Invalid', 'Upload started (UTC)', 'Upload completed (UTC)', 'Read & validate (ms)', 'Missing SalesMax columns', 'Additional columns'],
        rows: files.map((f) => [
          f.name,
          f.workbook!.sheets[f.sheetIndex]?.name ?? '',
          f.validation!.dataRows,
          f.validation!.accepted,
          f.validation!.rejected,
          f.uploadStartedAt.replace('T', ' ').slice(0, 19),
          f.uploadCompletedAt?.replace('T', ' ').slice(0, 19) ?? '',
          f.processingMs,
          CONTACT_FIELDS.filter((k) => !Object.values(f.mapping).includes(k)).map((k) => SALESMAX_HEADERS[k]).join(', '),
          f.headers.filter((h, i) => !f.mapping[String(i)] && !/^Column [A-Z]+$/.test(h)).join(', '),
        ]),
      },
      {
        title: 'Column mapping (source column → report column)',
        headers: ['File', 'Source column', 'Report column', 'Included'],
        rows: files.flatMap((f) =>
          Object.entries(f.mapping).map(([col, key]) => {
            const out = columns.find((c) => c.key === key);
            return [f.name, f.headers[Number(col)], out?.header ?? (CONTACT_SET.has(key) ? SALESMAX_HEADERS[key as (typeof CONTACT_FIELDS)[number]] : (LEAD_FIELD_MAP.get(key)?.label ?? key)), out ? 'Yes' : 'No'];
          }),
        ),
      },
    ];

    if (o.format === 'csv') {
      const statusHeaders = includeStatus ? ['SOURCE FILE', 'SOURCE ROW', 'RECORD STATUS', 'DATA QUALITY FLAGS'] : [];
      const csvRows = filtered.map((r) => {
        const vals = rowsFor([r])[0].map((v) => (v instanceof Date ? v.toISOString().replace('T', ' ').slice(0, 16) : v));
        const lr = statusOf.get(r.uid);
        return includeStatus ? [...vals, r.fileName, r.rowNumber, lr ? STATUS_LABELS[lr.status] : '', (lr?.flags ?? []).map((x) => FLAG_LABELS[x]).join('; ')] : vals;
      });
      return { buffer: Buffer.from(toCsv([...columns.map((c) => c.header), ...statusHeaders], csvRows), 'utf8'), totalLeads: filtered.length };
    }
    if (o.format === 'pdf') {
      const buffer = await buildContactPdf(report, {
        title: test ? 'TEST REPORT - Lead Contact Report' : 'Lead Contact Report',
        subtitle: `Report date ${reportDate} · ${files.length} file(s) · ${filtered.length} leads · generated ${fmtStamp(startedAt, '')}`,
        processing: processing.filter((p) => !['Columns included', 'Columns excluded', 'Columns renamed'].includes(p.label)),
      });
      return { buffer, totalLeads: filtered.length };
    }
    const { buffer } = await buildContactWorkbook({
      title,
      sourceLine,
      reportDate,
      generatedAtLabel: fmtStamp(startedAt, tz),
      report,
      columns,
      rows: rowsFor(filtered),
      statusColumns: includeStatus ? ['SOURCE FILE', 'SOURCE ROW', 'RECORD STATUS', 'DATA QUALITY FLAGS'] : [],
      statusRows: includeStatus ? filtered.map((r) => [r.fileName, String(r.rowNumber), STATUS_LABELS[statusOf.get(r.uid)?.status ?? 'valid'], (statusOf.get(r.uid)?.flags ?? []).map((x) => FLAG_LABELS[x]).join('; ')]) : [],
      qualifiedStageLabels,
      extraSheets,
      comparison: multi ? this.service.comparison(s, files.map((f) => f.id)) : null,
      processing,
      processingTables,
    });
    return { buffer, totalLeads: filtered.length };
  }

  getReport(s: Session, id: string): GeneratedReport {
    const r = s.generatedReports.find((x) => x.id === id);
    if (!r) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found in this session.');
    return r;
  }

  /** Reads a stored report file and records the download time. */
  async download(s: Session, id: string): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const r = this.getReport(s, id);
    if (!r.path) throw new AppError(409, 'REPORT_UNAVAILABLE', r.error ?? 'This report has no file.');
    const buffer = await fs.readFile(r.path);
    r.downloads.push(new Date().toISOString());
    await this.recordHistory(s, r);
    return { buffer, filename: r.filename, contentType: TYPES[r.format] };
  }

  async zip(s: Session, ids: string[]): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const zip = new JSZip();
    const reps = ids.map((id) => this.getReport(s, id)).filter((r) => r.path);
    if (!reps.length) throw new AppError(422, 'NOTHING_TO_ZIP', 'None of the selected reports has a file.');
    for (const r of reps) {
      zip.file(r.filename, await fs.readFile(r.path!));
      r.downloads.push(new Date().toISOString());
    }
    const date = reps[0].reportDate;
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), filename: `${this.prefix(s)}Individual_File_Reports_${date}.zip`, contentType: TYPES.zip };
  }

  publicMeta(r: GeneratedReport) {
    const { path: p, ...rest } = r;
    return { ...rest, fileAvailable: Boolean(p) };
  }

}
