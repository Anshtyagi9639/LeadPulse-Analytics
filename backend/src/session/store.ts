import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { DEFAULT_MATCH_RULES, type DuplicateDecision, type DuplicateMode, type MatchRules } from '../domain/dedupe.js';
import type { FileKind } from '../domain/fields.js';
import type { CampaignInput, Report } from '../domain/kpi.js';
import type { ColumnMapping } from '../domain/mapping.js';
import type { DateOrder } from '../domain/normalize.js';
import type { RawWorkbook, SpreadsheetExt } from '../domain/spreadsheet.js';
import type { FileValidation } from '../domain/validate.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export type FileStatus = 'ready' | 'needs_mapping' | 'error';

export interface SessionFile {
  id: string;
  name: string;
  ext: SpreadsheetExt;
  size: number;
  uploadedAt: string;
  order: number;
  /** Restricted temp file holding the original upload (never served over HTTP). */
  tempPath: string | null;
  status: FileStatus;
  error: { code: string; message: string } | null;
  workbook: RawWorkbook | null;
  sheetIndex: number;
  headerRow: number;
  headers: string[];
  kind: FileKind;
  mapping: ColumnMapping;
  mappingConfidence: Record<string, number>;
  mappingProblems: string[];
  templateApplied: string | null;
  dateOrder: DateOrder;
  validation: FileValidation | null;
  validatedAt: string | null;
  /** SHA-256 of the uploaded bytes, used to reject the same file being uploaded twice. */
  contentHash: string | null;
  uploadStartedAt: string;
  uploadCompletedAt: string | null;
  /** Time spent reading + validating the file. */
  processingMs: number | null;
  /** When the file was last included in a generated report. */
  processedAt: string | null;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
}

export interface SessionSettings {
  reportingDate: string;
  dateRange: { from: string; to: string } | null;
  dateFilter: 'include_all' | 'restrict';
  duplicateMode: DuplicateMode;
  cautiousMatching: boolean;
  overallTargetLeads: number | null;
  overallBudget: number | null;
  filters: { campaigns: string[]; sources: string[] };
  matchRules: MatchRules;
}

/** A generated report file (kept in the session's temp folder until the session ends) and its timings. */
export interface GeneratedReport {
  id: string;
  type: 'contact' | 'combined' | 'individual' | 'comparison' | 'quality';
  format: 'xlsx' | 'csv' | 'pdf';
  test: boolean;
  status: 'completed' | 'failed';
  error: string | null;
  filename: string;
  size: number;
  fileIds: string[];
  fileNames: string[];
  totalLeads: number | null;
  reportDate: string;
  filters: string;
  uploadStartedAt: string | null;
  uploadCompletedAt: string | null;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  processingMs: number | null;
  generationStartedAt: string;
  generationCompletedAt: string;
  generationMs: number;
  downloads: string[];
  /** Server path of the stored file (never sent to the browser). */
  path: string | null;
}

export interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
  dir: string;
  settings: SessionSettings;
  duplicateDecisions: Record<string, DuplicateDecision>;
  campaignInputs: CampaignInput[];
  files: Map<string, SessionFile>;
  nextOrder: number;
  report: Report | null;
  reportFileIds: string[];
  reportStale: string | null;
  lastProcessedAt: number | null;
  lastProcessingStartedAt: number | null;
  lastProcessingMs: number | null;
  aiRequests: number;
  /** sha256 of the browser client id that created the session (null = no owner, e.g. API clients). */
  ownerHash: string | null;
  /** Transformation and decision log (no lead values). */
  audit: AuditEntry[];
  /** Bumped on every change; used to cache derived lead rows. */
  version: number;
  /** 'test' sessions are for trying files, mappings and rules; their reports are labelled TEST. */
  mode: 'production' | 'test';
  generatedReports: GeneratedReport[];
}

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class SessionStore {
  private sessions = new Map<string, Session>();
  private timer: NodeJS.Timeout | null = null;
  /** Called when a session is deleted (cleared, expired or shut down) so derived caches are dropped too. */
  onDelete: ((id: string) => void) | null = null;
  readonly instanceDir: string;

  constructor(private readonly config: AppConfig) {
    this.instanceDir = path.join(config.TEMP_DIR, `inst-${process.pid}-${randomBytes(4).toString('hex')}`);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.config.TEMP_DIR, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.instanceDir, { recursive: true, mode: 0o700 });
    await this.removeAbandonedInstanceDirs();
  }

  /** Deletes temp directories left behind by previous processes (crash/restart) once they are older than the TTL. */
  async removeAbandonedInstanceDirs(): Promise<number> {
    const ttlMs = this.config.SESSION_TTL_HOURS * 3600_000;
    let removed = 0;
    let entries: string[];
    try {
      entries = await fs.readdir(this.config.TEMP_DIR);
    } catch {
      return 0;
    }
    for (const e of entries) {
      const full = path.join(this.config.TEMP_DIR, e);
      if (full === this.instanceDir || !e.startsWith('inst-')) continue;
      try {
        const st = await fs.stat(full);
        if (Date.now() - st.mtimeMs > ttlMs) {
          await fs.rm(full, { recursive: true, force: true });
          removed++;
        }
      } catch {
        /* already gone */
      }
    }
    if (removed) logger.info('abandoned_temp_dirs_removed', { count: removed });
    return removed;
  }

  startSweeper(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
      void this.removeAbandonedInstanceDirs();
    }, this.config.CLEANUP_INTERVAL_MINUTES * 60_000);
    this.timer.unref();
  }

  async stop(deleteAll = false): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (deleteAll) {
      for (const id of [...this.sessions.keys()]) await this.delete(id);
      await fs.rm(this.instanceDir, { recursive: true, force: true });
    }
  }

  async create(reportingDate: string, ownerHash: string | null = null, mode: 'production' | 'test' = 'production'): Promise<Session> {
    await this.sweep();
    if (this.sessions.size >= this.config.MAX_SESSIONS) {
      throw new AppError(503, 'TOO_MANY_SESSIONS', 'The server is handling too many reporting sessions. Try again later.');
    }
    const id = randomUUID();
    const dir = path.join(this.instanceDir, id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const now = Date.now();
    const session: Session = {
      id,
      createdAt: now,
      expiresAt: now + this.config.SESSION_TTL_HOURS * 3600_000,
      dir,
      settings: {
        reportingDate,
        dateRange: null,
        dateFilter: 'include_all',
        duplicateMode: 'exclude_duplicates',
        cautiousMatching: false,
        overallTargetLeads: null,
        overallBudget: null,
        filters: { campaigns: [], sources: [] },
        matchRules: { ...DEFAULT_MATCH_RULES },
      },
      duplicateDecisions: {},
      campaignInputs: [],
      files: new Map(),
      nextOrder: 1,
      report: null,
      reportFileIds: [],
      reportStale: null,
      lastProcessedAt: null,
      lastProcessingStartedAt: null,
      lastProcessingMs: null,
      aiRequests: 0,
      ownerHash,
      audit: [{ at: new Date(now).toISOString(), action: 'session_created', detail: `Reporting date ${reportingDate}` }],
      version: 0,
      mode,
      generatedReports: [],
    };
    this.sessions.set(id, session);
    logger.info('session_created', { sessionId: id.slice(0, 8) });
    return session;
  }

  get(id: string): Session {
    if (!SESSION_ID_RE.test(id)) throw new AppError(404, 'SESSION_NOT_FOUND', 'Reporting session not found.');
    const s = this.sessions.get(id);
    if (!s) throw new AppError(404, 'SESSION_NOT_FOUND', 'Reporting session not found. It may have expired, been cleared, or the server restarted.');
    if (Date.now() >= s.expiresAt) {
      void this.delete(id);
      throw new AppError(410, 'SESSION_EXPIRED', 'This reporting session has expired and its temporary data was deleted.');
    }
    return s;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get size(): number {
    return this.sessions.size;
  }

  async delete(id: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return false;
    this.sessions.delete(id);
    this.onDelete?.(id);
    // Drop in-memory references to parsed data, then remove temp files.
    for (const f of s.files.values()) {
      f.workbook = null;
      f.validation = null;
    }
    s.files.clear();
    s.report = null;
    await fs.rm(s.dir, { recursive: true, force: true });
    logger.info('session_deleted', { sessionId: id.slice(0, 8) });
    return true;
  }

  async sweep(now = Date.now()): Promise<number> {
    // Heartbeat so other processes sharing TEMP_DIR never treat this instance's directory as abandoned.
    await fs.utimes(this.instanceDir, new Date(), new Date()).catch(() => undefined);
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (now >= s.expiresAt) {
        await this.delete(id);
        n++;
      }
    }
    if (n) logger.info('expired_sessions_removed', { count: n });
    return n;
  }
}
