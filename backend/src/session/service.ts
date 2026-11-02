import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { analyzeDuplicates, type DuplicateDecision } from '../domain/dedupe.js';
import { fieldsFor, type FileKind } from '../domain/fields.js';
import { compareFiles, type FileTiming } from '../domain/comparison.js';
import { buildReport, campaignLabel, sourceLabel, type CampaignInput, type Report, type ReportFileInfo } from '../domain/kpi.js';
import { buildLeadRows, type LeadRow, type LeadSourceFile } from '../domain/leads.js';
import { applyTemplate, detectFileKind, suggestMapping, type ColumnMapping } from '../domain/mapping.js';
import { formatNaive, maskValue, type DateOrder } from '../domain/normalize.js';
import {
  detectHeaderRow,
  extensionOf,
  headersFor,
  parseSpreadsheet,
  type ParseLimits,
  type RawWorkbook,
} from '../domain/spreadsheet.js';
import { mappingProblems, validateRows, type LeadRecord } from '../domain/validate.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { KeyedMutex } from '../lib/mutex.js';
import type { Session, SessionFile, SessionSettings, SessionStore } from './store.js';
import type { TemplateStore } from './templates.js';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface FileConfigUpdate {
  sheetIndex?: number;
  headerRow?: number;
  kind?: FileKind;
  mapping?: ColumnMapping;
  dateOrder?: DateOrder;
  templateId?: string;
}

const PREVIEW_ROWS = 20;

/** Removes path components and control characters from a user-supplied filename. */
export function displayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f<>"]/g, '').slice(0, 120) || 'file';
}

export class SessionService {
  readonly mutex = new KeyedMutex();

  /** Cached lead rows per session (invalidated by session.version). */
  private leadCache = new Map<string, { key: string; rows: LeadRow[] }>();

  constructor(
    readonly store: SessionStore,
    private readonly templates: TemplateStore,
    private readonly config: AppConfig,
    /** Called after a report is generated (used to record report history). */
    private readonly onReport: ((session: Session) => Promise<void>) | null = null,
  ) {}

  /** Appends to the session's audit trail. Details never contain lead values. */
  audit(session: Session, action: string, detail: string): void {
    session.audit.push({ at: new Date().toISOString(), action, detail });
    if (session.audit.length > 1000) session.audit.splice(0, session.audit.length - 1000);
    session.version++;
  }

  private get parseLimits(): ParseLimits {
    return {
      maxRows: this.config.MAX_ROWS_PER_SHEET,
      maxCols: this.config.MAX_COLUMNS,
      maxUncompressedBytes: this.config.MAX_UNCOMPRESSED_MB * 1024 * 1024,
      timeoutMs: this.config.PARSE_TIMEOUT_MS,
      memoryMb: this.config.PARSE_MEMORY_MB,
      inWorker: this.config.PARSE_IN_WORKER,
    };
  }

  /** Runs a mutating operation with the session locked, so uploads/recalculations never interleave. */
  async withSession<T>(id: string, fn: (s: Session) => Promise<T> | T): Promise<T> {
    this.store.get(id); // fail fast with 404/410
    return this.mutex.run(id, () => fn(this.store.get(id)));
  }

  // -------------------------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------------------------

  async addFiles(session: Session, uploads: UploadedFile[], opts: { startedAt?: string; replaceFileId?: string } = {}): Promise<SessionFile[]> {
    if (!uploads.length) throw new AppError(400, 'NO_FILES', 'No files were uploaded.');
    const replacing = opts.replaceFileId ? this.getFile(session, opts.replaceFileId) : null;
    if (replacing && uploads.length !== 1) throw new AppError(400, 'REPLACE_ONE_FILE', 'Choose exactly one file to replace an uploaded file.');
    if (session.files.size - (replacing ? 1 : 0) + uploads.length > this.config.MAX_FILES_PER_SESSION) {
      throw new AppError(422, 'TOO_MANY_FILES', `A session can hold at most ${this.config.MAX_FILES_PER_SESSION} files. Remove some files first.`);
    }
    const added: SessionFile[] = [];
    for (const up of uploads) {
      const name = displayName(up.originalname);
      const ext = extensionOf(name);
      const file: SessionFile = {
        id: randomUUID(),
        name,
        ext: ext ?? 'csv',
        size: up.size,
        uploadedAt: new Date().toISOString(),
        order: session.nextOrder++,
        tempPath: null,
        status: 'error',
        error: null,
        workbook: null,
        sheetIndex: 0,
        headerRow: 0,
        headers: [],
        kind: 'leads',
        mapping: {},
        mappingConfidence: {},
        mappingProblems: [],
        templateApplied: null,
        dateOrder: 'auto',
        validation: null,
        validatedAt: null,
        contentHash: createHash('sha256').update(up.buffer).digest('hex'),
        uploadStartedAt: opts.startedAt ?? new Date().toISOString(),
        uploadCompletedAt: null,
        processingMs: null,
        processedAt: null,
      };
      session.files.set(file.id, file);
      added.push(file);
      const t0 = Date.now();
      try {
        if (!ext) throw new AppError(415, 'UNSUPPORTED_TYPE', 'Unsupported file type. Upload .xlsx, .xls or .csv files.');
        const same = [...session.files.values()].find((o) => o.id !== file.id && o.id !== replacing?.id && o.status !== 'error' && o.contentHash === file.contentHash);
        if (same) throw new AppError(409, 'DUPLICATE_FILE', `This file has already been uploaded as “${same.name}”. Remove that file first if you want to upload it again.`);
        const wb = await parseSpreadsheet(up.buffer, ext, this.parseLimits);
        file.workbook = wb;
        file.tempPath = path.join(session.dir, `${file.id}.${ext}`);
        await fs.writeFile(file.tempPath, up.buffer, { mode: 0o600 });
        file.sheetIndex = this.pickSheet(wb);
        await this.configureSheet(file, true);
        this.enforceSessionRowLimit(session);
      } catch (e) {
        file.workbook = null;
        file.status = 'error';
        file.error = e instanceof AppError ? { code: e.code, message: e.message } : { code: 'PROCESSING_FAILED', message: 'The file could not be processed.' };
        if (!(e instanceof AppError)) logger.error('file_processing_failed', { error: (e as Error).stack });
        if (file.tempPath) await fs.rm(file.tempPath, { force: true });
        file.tempPath = null;
      }
      file.processingMs = Date.now() - t0;
      file.uploadCompletedAt = new Date().toISOString();
      this.audit(
        session,
        file.status === 'error' ? 'file_failed' : 'file_uploaded',
        file.status === 'error'
          ? `${file.name}: ${file.error?.code}`
          : `${file.name}: sheet "${file.workbook?.sheets[file.sheetIndex]?.name}", ${file.validation?.dataRows ?? 0} rows, ${file.validation?.accepted ?? 0} accepted, ${file.validation?.rejected ?? 0} rejected, ${Object.keys(file.mapping).length} columns mapped${file.templateApplied ? ` (template "${file.templateApplied}")` : ''}`,
      );
    }
    if (replacing && added[0].status !== 'error') {
      const wasInReport = session.reportFileIds.includes(replacing.id);
      await this.removeFile(session, replacing.id, false);
      if (wasInReport) session.reportFileIds.push(added[0].id);
      this.audit(session, 'file_replaced', `${replacing.name} replaced by ${added[0].name}`);
      if (wasInReport) await this.recalculate(session, null);
    }
    if (session.report) session.reportStale = `${added.length} file(s) added since the report was generated. Process the files to include them.`;
    logger.info('files_uploaded', { sessionId: session.id.slice(0, 8), count: added.length, errors: added.filter((f) => f.status === 'error').length });
    return added;
  }

  private enforceSessionRowLimit(session: Session): void {
    const total = [...session.files.values()].reduce((s, f) => s + (f.validation?.dataRows ?? 0), 0);
    if (total > this.config.MAX_ROWS_PER_SESSION) {
      throw new AppError(422, 'SESSION_ROW_LIMIT', `The session would exceed ${this.config.MAX_ROWS_PER_SESSION.toLocaleString('en-IN')} rows. Remove files or split the report.`);
    }
  }

  /** Picks the visible sheet whose header row matches the most known column names. */
  private pickSheet(wb: RawWorkbook): number {
    let best = 0;
    let bestScore = -1;
    wb.sheets.forEach((sh, i) => {
      if (!sh.rows.length) return;
      const hr = detectHeaderRow(sh.rows);
      const headers = headersFor(sh.rows, hr);
      const score = Object.keys(suggestMapping(headers, detectFileKind(headers)).mapping).length * 10 + Math.min(sh.rows.length, 9) - (sh.hidden ? 100 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  private async ensureWorkbook(file: SessionFile): Promise<RawWorkbook> {
    if (file.workbook) return file.workbook;
    if (!file.tempPath) throw new AppError(409, 'FILE_UNAVAILABLE', 'This file could not be read. Remove it and upload it again.');
    const buf = await fs.readFile(file.tempPath);
    file.workbook = await parseSpreadsheet(buf, file.ext, this.parseLimits);
    return file.workbook;
  }

  /** (Re)derives headers + mapping for the current sheet, then validates. */
  private async configureSheet(file: SessionFile, autoHeader: boolean, explicitKind?: FileKind): Promise<void> {
    const wb = await this.ensureWorkbook(file);
    const sheet = wb.sheets[file.sheetIndex];
    if (!sheet) throw new AppError(400, 'INVALID_SHEET', 'Worksheet not found.');
    if (!sheet.rows.length) {
      file.headers = [];
      file.mapping = {};
      file.validation = null;
      file.status = 'needs_mapping';
      file.mappingProblems = ['The selected worksheet is empty. Choose another worksheet.'];
      file.error = null;
      return;
    }
    if (autoHeader) file.headerRow = detectHeaderRow(sheet.rows);
    file.headers = headersFor(sheet.rows, file.headerRow);
    file.kind = explicitKind ?? detectFileKind(file.headers);
    const tpl = await this.templates.bestFor(file.headers, file.kind);
    const suggestion = suggestMapping(file.headers, file.kind);
    if (tpl) {
      file.mapping = applyTemplate(file.headers, tpl.columns, file.kind);
      file.mappingConfidence = Object.fromEntries(Object.keys(file.mapping).map((k) => [k, 1]));
      file.templateApplied = tpl.name;
    } else {
      file.mapping = suggestion.mapping;
      file.mappingConfidence = suggestion.confidence;
      file.templateApplied = null;
    }
    this.validateFile(file);
  }

  private validateFile(file: SessionFile): void {
    const wb = file.workbook!;
    const sheet = wb.sheets[file.sheetIndex];
    file.mappingProblems = mappingProblems(file.kind, file.mapping);
    file.error = null;
    if (file.mappingProblems.length) {
      file.status = 'needs_mapping';
      file.validation = null;
      file.validatedAt = null;
      return;
    }
    file.validation = validateRows({
      fileId: file.id,
      fileName: file.name,
      fileOrder: file.order,
      sheet: sheet.name,
      rows: sheet.rows,
      firstRow: sheet.firstRow,
      headerRow: file.headerRow,
      headers: file.headers,
      mapping: file.mapping,
      kind: file.kind,
      dateOrder: file.dateOrder,
      date1904: wb.date1904,
    });
    if (sheet.truncated) {
      file.validation.issues.unshift({
        fileId: file.id,
        fileName: file.name,
        sheet: sheet.name,
        rowNumber: null,
        field: '',
        severity: 'error',
        code: 'ROW_LIMIT',
        message: `The worksheet has ${sheet.totalRows.toLocaleString('en-IN')} rows; only the first ${this.config.MAX_ROWS_PER_SHEET.toLocaleString('en-IN')} were read. Split the file to include the rest.`,
        value: '',
      });
      file.validation.issueCount++;
    }
    if (sheet.columnsTruncated) {
      file.validation.issues.unshift({
        fileId: file.id, fileName: file.name, sheet: sheet.name, rowNumber: null, field: '', severity: 'warning', code: 'COLUMN_LIMIT',
        message: `Only the first ${this.config.MAX_COLUMNS} columns were read.`, value: '',
      });
      file.validation.issueCount++;
    }
    if (file.validation.dataRows === 0) {
      file.status = 'needs_mapping';
      file.mappingProblems = ['No data rows were found below the header row. Check the worksheet and header row.'];
    } else {
      file.status = 'ready';
    }
    file.validatedAt = new Date().toISOString();
  }

  async preview(session: Session, fileId: string, opts: { sheetIndex?: number; headerRow?: number }) {
    const file = this.getFile(session, fileId);
    if (file.status === 'error') throw new AppError(409, 'FILE_ERROR', file.error?.message ?? 'File could not be read.');
    const wb = await this.ensureWorkbook(file);
    const sheetIndex = opts.sheetIndex ?? file.sheetIndex;
    const sheet = wb.sheets[sheetIndex];
    if (!sheet) throw new AppError(400, 'INVALID_SHEET', 'Worksheet not found.');
    const headerRow = opts.headerRow ?? (sheetIndex === file.sheetIndex ? file.headerRow : detectHeaderRow(sheet.rows));
    const headers = sheet.rows.length ? headersFor(sheet.rows, headerRow) : [];
    const isCurrent = sheetIndex === file.sheetIndex && headerRow === file.headerRow;
    const suggestion = suggestMapping(headers, file.kind);
    return {
      fileId: file.id,
      sheets: wb.sheets.map((s, i) => ({ index: i, name: s.name, hidden: s.hidden, rows: s.totalRows })),
      sheetIndex,
      headerRow,
      headerRowNumber: sheet.firstRow + headerRow,
      /** First rows of the sheet (above + below the header) so users can pick the header row. */
      topRows: sheet.rows.slice(0, Math.min(sheet.rows.length, 8)).map((r) => r.slice(0, headers.length || r.length)),
      headers,
      rows: sheet.rows.slice(headerRow + 1, headerRow + 1 + PREVIEW_ROWS),
      totalRows: Math.max(0, sheet.rows.length - headerRow - 1),
      mapping: isCurrent ? file.mapping : suggestion.mapping,
      confidence: isCurrent ? file.mappingConfidence : suggestion.confidence,
      kind: file.kind,
    };
  }

  async updateFileConfig(session: Session, fileId: string, update: FileConfigUpdate): Promise<SessionFile> {
    const file = this.getFile(session, fileId);
    if (file.status === 'error') throw new AppError(409, 'FILE_ERROR', file.error?.message ?? 'File could not be read.');
    const wb = await this.ensureWorkbook(file);
    if (update.dateOrder) file.dateOrder = update.dateOrder;
    const sheetChanged = update.sheetIndex !== undefined && update.sheetIndex !== file.sheetIndex;
    if (update.sheetIndex !== undefined) {
      if (!wb.sheets[update.sheetIndex]) throw new AppError(400, 'INVALID_SHEET', 'Worksheet not found.');
      file.sheetIndex = update.sheetIndex;
    }
    const headerChanged = update.headerRow !== undefined && update.headerRow !== file.headerRow;
    if (update.headerRow !== undefined) {
      const rows = wb.sheets[file.sheetIndex].rows.length;
      if (update.headerRow < 0 || update.headerRow >= Math.max(rows, 1)) throw new AppError(400, 'INVALID_HEADER_ROW', 'Header row is outside the worksheet.');
      file.headerRow = update.headerRow;
    }
    const kindChanged = update.kind !== undefined && update.kind !== file.kind;
    if (sheetChanged || headerChanged || kindChanged) {
      await this.configureSheet(file, sheetChanged && update.headerRow === undefined, update.kind ?? (sheetChanged ? undefined : file.kind));
    }
    if (update.templateId) {
      const tpl = await this.templates.get(update.templateId);
      if (tpl.kind !== file.kind) throw new AppError(400, 'TEMPLATE_KIND', 'This template is for a different file type.');
      file.mapping = applyTemplate(file.headers, tpl.columns, file.kind);
      file.templateApplied = tpl.name;
    }
    if (update.mapping) {
      const valid = new Set(fieldsFor(file.kind).map((f) => f.key));
      const clean: ColumnMapping = {};
      for (const [col, key] of Object.entries(update.mapping)) {
        const i = Number(col);
        if (!Number.isInteger(i) || i < 0 || i >= file.headers.length) continue;
        if (key && valid.has(key)) clean[String(i)] = key;
      }
      file.mapping = clean;
      file.mappingConfidence = Object.fromEntries(Object.keys(clean).map((k) => [k, 1]));
    }
    if (file.headers.length) this.validateFile(file);
    this.enforceSessionRowLimit(session);
    const changes = Object.entries(update).filter(([, v]) => v !== undefined).map(([k]) => k).join(', ');
    this.audit(session, 'file_configured', `${file.name}: changed ${changes}; ${Object.keys(file.mapping).length} columns mapped, ${file.validation?.accepted ?? 0} accepted, ${file.validation?.rejected ?? 0} rejected`);
    if (session.reportFileIds.includes(file.id)) await this.recalculate(session, `Settings for ${file.name} changed.`);
    return file;
  }

  async removeFile(session: Session, fileId: string, recalc = true): Promise<void> {
    const file = this.getFile(session, fileId);
    session.files.delete(fileId);
    file.workbook = null;
    file.validation = null;
    if (file.tempPath) await fs.rm(file.tempPath, { force: true });
    this.audit(session, 'file_removed', file.name);
    if (!recalc) {
      session.reportFileIds = session.reportFileIds.filter((id) => id !== fileId);
      return;
    }
    if (session.reportFileIds.includes(fileId)) {
      session.reportFileIds = session.reportFileIds.filter((id) => id !== fileId);
      await this.recalculate(session, null);
    }
  }

  getFile(session: Session, fileId: string): SessionFile {
    const f = session.files.get(fileId);
    if (!f) throw new AppError(404, 'FILE_NOT_FOUND', 'File not found in this session.');
    return f;
  }

  // -------------------------------------------------------------------------------------------
  // Processing & reports
  // -------------------------------------------------------------------------------------------

  async process(session: Session, fileIds?: string[]): Promise<void> {
    const ids = fileIds?.length ? fileIds : [...session.files.values()].filter((f) => f.status !== 'error').map((f) => f.id);
    if (!ids.length) throw new AppError(422, 'NOTHING_TO_PROCESS', 'Upload at least one readable file first.');
    const problems: { fileId: string; fileName: string; problems: string[] }[] = [];
    for (const id of ids) {
      const f = this.getFile(session, id);
      if (f.status === 'error') problems.push({ fileId: f.id, fileName: f.name, problems: [f.error?.message ?? 'File could not be read.'] });
      else if (f.status !== 'ready') problems.push({ fileId: f.id, fileName: f.name, problems: f.mappingProblems });
    }
    if (problems.length) {
      throw new AppError(422, 'FILES_NOT_READY', 'Some selected files need attention before they can be processed.', problems);
    }
    session.reportFileIds = [...new Set(ids)];
    const started = Date.now();
    session.lastProcessingStartedAt = started;
    await this.recalculate(session, null);
    session.lastProcessingMs = Date.now() - started;
    const at = new Date().toISOString();
    for (const id of session.reportFileIds) session.files.get(id)!.processedAt = at;
    this.audit(session, 'report_generated', `${session.reportFileIds.length} file(s): ${session.reportFileIds.map((id) => session.files.get(id)!.name).join(', ')}`);
    if (this.onReport) await this.onReport(session).catch((e) => logger.error('history_write_failed', { error: (e as Error).message }));
  }

  async recalculate(session: Session, _reason: string | null): Promise<void> {
    session.reportFileIds = session.reportFileIds.filter((id) => session.files.get(id)?.status === 'ready');
    if (!session.reportFileIds.length) {
      session.report = null;
      session.reportStale = null;
      return;
    }
    session.report = this.computeReport(session, session.reportFileIds);
    session.lastProcessedAt = Date.now();
    session.version++;
    const unprocessed = [...session.files.values()].filter((f) => f.status === 'ready' && !session.reportFileIds.includes(f.id));
    session.reportStale = unprocessed.length ? `${unprocessed.length} uploaded file(s) are not included in this report.` : null;
  }

  /** Builds a report for the given files without storing it (also used for read-only previews). */
  computeReport(session: Session, fileIds: string[]): Report {
    const files = fileIds.map((id) => session.files.get(id)!).sort((a, b) => a.order - b.order);
    const infos: ReportFileInfo[] = files.map((f) => ({
      fileId: f.id,
      fileName: f.name,
      kind: f.kind,
      sheet: f.workbook?.sheets[f.sheetIndex]?.name ?? '',
      dataRows: f.validation!.dataRows,
      blankRows: f.validation!.blankRows,
      accepted: f.validation!.accepted,
      rejected: f.validation!.rejected,
      rowsWithWarnings: f.validation!.rowsWithWarnings,
      issueCount: f.validation!.issueCount,
      mappedFields: f.validation!.mappedFields,
      unmappedColumns: f.validation!.unmappedColumns,
      ambiguousDateFields: Object.entries(f.validation!.dateOrders).filter(([, v]) => v.ambiguous).map(([k]) => fieldsFor(f.kind).find((d) => d.key === k)?.label ?? k),
    }));
    return buildReport({
      files: infos,
      leads: files.flatMap((f) => f.validation!.leads),
      ads: files.flatMap((f) => f.validation!.ads),
      campaignInputs: session.campaignInputs,
      options: {
        reportingDate: session.settings.reportingDate,
        dateRange: session.settings.dateRange,
        dateFilter: session.settings.dateFilter,
        duplicateMode: session.settings.duplicateMode,
        duplicateDecisions: session.duplicateDecisions,
        cautiousMatching: session.settings.cautiousMatching,
        matchRules: session.settings.matchRules,
        filters: session.settings.filters,
        overallTargetLeads: session.settings.overallTargetLeads,
        overallBudget: session.settings.overallBudget,
        currency: this.config.CURRENCY,
      },
    });
  }

  /** Read-only report for any set of ready files ("testing mode"); never changes the session. */
  previewReport(session: Session, fileIds: string[]): Report {
    const ids = [...new Set(fileIds)];
    if (!ids.length) throw new AppError(400, 'NO_FILES', 'Choose at least one file.');
    for (const id of ids) {
      const f = this.getFile(session, id);
      if (f.status !== 'ready') throw new AppError(422, 'FILES_NOT_READY', `${f.name} is not ready (${f.status === 'error' ? 'could not be read' : 'needs column mapping'}).`);
    }
    return this.computeReport(session, ids);
  }

  // -------------------------------------------------------------------------------------------
  // Lead rows & comparison
  // -------------------------------------------------------------------------------------------

  private sourceFiles(session: Session, fileIds?: string[]): LeadSourceFile[] {
    const ids = fileIds?.length ? fileIds : this.reportFiles(session).map((f) => f.id);
    return ids
      .map((id) => this.getFile(session, id))
      .filter((f) => f.status === 'ready' && f.kind === 'leads' && f.validation && f.workbook)
      .map((f) => {
        const sheet = f.workbook!.sheets[f.sheetIndex];
        return { id: f.id, name: f.name, order: f.order, headers: f.headers, mapping: f.mapping, rows: sheet.rows, firstRow: sheet.firstRow, headerRow: f.headerRow, validation: f.validation! };
      });
  }

  /** Lead rows for the given files (default: report scope, or all ready files before the first report). */
  leadRows(session: Session, fileIds?: string[]): { files: LeadSourceFile[]; rows: LeadRow[] } {
    const files = this.sourceFiles(session, fileIds);
    const key = `${session.version}|${files.map((f) => f.id).join(',')}`;
    const cached = this.leadCache.get(session.id);
    if (cached?.key === key) return { files, rows: cached.rows };
    const st = session.settings;
    const rows = buildLeadRows(files, {
      duplicateMode: st.duplicateMode,
      duplicateDecisions: session.duplicateDecisions,
      cautiousMatching: st.cautiousMatching,
      matchRules: st.matchRules,
      period: st.dateRange ?? { from: st.reportingDate, to: st.reportingDate },
      reportDate: st.dateRange?.to ?? st.reportingDate,
    });
    this.leadCache.set(session.id, { key, rows });
    return { files, rows };
  }

  dropCache(sessionId: string): void {
    this.leadCache.delete(sessionId);
  }

  comparison(session: Session, fileIds?: string[]) {
    const ids = fileIds?.length ? fileIds : [...session.files.values()].filter((f) => f.status === 'ready' && f.kind === 'leads').map((f) => f.id);
    const { files, rows } = this.leadRows(session, ids);
    const timings: Record<string, FileTiming> = {};
    for (const f of files) {
      const sf = session.files.get(f.id)!;
      timings[f.id] = { uploadStartedAt: sf.uploadStartedAt, uploadCompletedAt: sf.uploadCompletedAt, processingMs: sf.processingMs, processedAt: sf.processedAt };
    }
    const cmp = compareFiles(files, rows, timings, session.settings.matchRules);
    for (const r of cmp.files) {
      const sf = session.files.get(r.fileId);
      r.sheet = sf?.workbook?.sheets[sf.sheetIndex]?.name ?? '';
    }
    return cmp;
  }

  async updateSettings(session: Session, patch: Partial<SessionSettings>): Promise<void> {
    const s = session.settings;
    if (patch.dateRange !== undefined && patch.dateRange) {
      if (patch.dateRange.from > patch.dateRange.to) throw new AppError(400, 'INVALID_RANGE', 'The start date must be on or before the end date.');
    }
    Object.assign(s, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    this.audit(session, 'settings_changed', Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('; ').slice(0, 500));
    if (session.report) await this.recalculate(session, null);
  }

  async setCampaignInputs(session: Session, inputs: Omit<CampaignInput, 'id'>[]): Promise<void> {
    session.campaignInputs = inputs.map((i) => ({ ...i, id: randomUUID() }));
    this.audit(session, 'campaign_inputs_saved', `${inputs.length} campaign spend/target row(s)`);
    if (session.report) await this.recalculate(session, null);
  }

  async setDuplicateDecisions(session: Session, decisions: Record<string, DuplicateDecision | null>): Promise<void> {
    for (const [k, v] of Object.entries(decisions)) {
      if (v === null) delete session.duplicateDecisions[k];
      else session.duplicateDecisions[k] = v;
    }
    this.audit(session, 'duplicate_decision', Object.entries(decisions).map(([k, v]) => `group ${k}: ${v ?? 'cleared'}`).join('; '));
    if (session.report) await this.recalculate(session, null);
  }

  /** Duplicate groups with the minimum detail a person needs to review them. Phone/email are masked. */
  duplicateGroups(session: Session, opts: { kind?: 'confirmed' | 'possible'; limit: number; offset: number }) {
    const files = this.reportFiles(session);
    const leads = files.flatMap((f) => f.validation?.leads ?? []);
    const analysis = analyzeDuplicates(leads, { cautiousMatching: session.settings.cautiousMatching, rules: session.settings.matchRules });
    const byUid = new Map(leads.map((r) => [r.uid, r]));
    const groups = analysis.groups.filter((g) => !opts.kind || g.kind === opts.kind);
    const member = (r: LeadRecord) => ({
      uid: r.uid,
      fileName: r.fileName,
      rowNumber: r.rowNumber,
      leadId: r.text.leadId ?? null,
      name: r.text.name ?? null,
      phone: r.phone ? maskValue('phone', r.phone) : null,
      email: r.email ? maskValue('email', r.email) : null,
      campaign: campaignLabel(r),
      source: sourceLabel(r),
      leadStatus: r.text.leadStatus ?? null,
      createdAt: formatNaive(r.dates.leadCreatedDate ?? null),
      counsellor: r.text.assignedCounsellor ?? null,
    });
    return {
      summary: {
        totalRows: analysis.totalRows,
        uniqueLeads: analysis.uniqueLeads,
        duplicateRows: analysis.duplicateRows,
        possibleDuplicateRows: analysis.possibleDuplicateRows,
        missingIdRows: analysis.missingIdRows,
        unidentifiableRows: analysis.unidentifiableRows,
        conflictingRecords: analysis.conflictingRecords,
        confirmedGroups: analysis.groups.filter((g) => g.kind === 'confirmed').length,
        possibleGroups: analysis.groups.filter((g) => g.kind === 'possible').length,
        byFile: Object.entries(analysis.byFile).map(([fileName, v]) => ({ fileName, ...v })),
        byCampaign: Object.entries(analysis.byCampaign).map(([campaign, v]) => ({ campaign, ...v })),
      },
      total: groups.length,
      groups: groups.slice(opts.offset, opts.offset + opts.limit).map((g) => ({
        id: g.id,
        kind: g.kind,
        matchedOn: g.matchedOn,
        conflict: g.conflict,
        conflictReasons: g.conflictReasons,
        firstUid: g.firstUid,
        latestUid: g.latestUid,
        decision: session.duplicateDecisions[g.id] ?? null,
        members: g.memberUids.map((u) => member(byUid.get(u)!)),
      })),
    };
  }

  /** Files whose data feeds duplicate review: the report scope, or every ready file before the first report. */
  reportFiles(session: Session): SessionFile[] {
    const ids = session.reportFileIds.length ? session.reportFileIds : [...session.files.values()].filter((f) => f.status === 'ready').map((f) => f.id);
    return ids.map((id) => session.files.get(id)).filter((f): f is SessionFile => Boolean(f?.validation)).sort((a, b) => a.order - b.order);
  }

  allIssues(session: Session, fileIds?: string[]) {
    const files = [...session.files.values()].filter((f) => !fileIds || fileIds.includes(f.id)).sort((a, b) => a.order - b.order);
    const issues = files.flatMap((f) =>
      f.status === 'error'
        ? [{ fileId: f.id, fileName: f.name, sheet: '', rowNumber: null, field: '', severity: 'error' as const, code: f.error?.code ?? 'FILE_ERROR', message: f.error?.message ?? '', value: '' }]
        : f.status === 'needs_mapping'
          ? f.mappingProblems.map((m) => ({ fileId: f.id, fileName: f.name, sheet: '', rowNumber: null, field: '', severity: 'error' as const, code: 'MAPPING_REQUIRED', message: m, value: '' }))
          : (f.validation?.issues ?? []),
    );
    const truncated = files.some((f) => f.validation?.issuesTruncated);
    return { issues, truncated };
  }
}
