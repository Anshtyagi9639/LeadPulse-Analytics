import fs from 'node:fs/promises';
import path from 'node:path';
import type { Report } from '../domain/kpi.js';
import { AppError } from '../lib/errors.js';

/**
 * Report history. Persisted as JSON in CONFIG_DIR so it survives restarts.
 *
 * Stores ONLY metadata and the aggregated report snapshot (counts, rates, campaign/source/counsellor summaries).
 * Lead-level rows, names, phone numbers and emails are never written here — the project has no lead database.
 * Lead-level downloads are therefore available only while the original session is alive.
 */
export interface HistoryEntry {
  id: string; // session id
  ownerHash: string;
  createdAt: string;
  updatedAt: string;
  reportingPeriod: { from: string; to: string };
  fileNames: string[];
  recordsProcessed: number;
  uniqueLeads: number;
  status: 'completed';
  generations: number;
  lastGeneratedAt: string;
  processingMs: number | null;
  sessionExpiresAt: string;
  /** Aggregate report snapshot from the last "Process"; null when only report files were generated. */
  snapshot: Report | null;
  mode: 'production' | 'test';
  /** Generated report files (metadata and timings only; the files live in the session and expire with it). */
  reports: HistoryReport[];
}

export interface HistoryReport {
  id: string;
  type: string;
  format: string;
  filename: string;
  status: string;
  test: boolean;
  fileNames: string[];
  totalLeads: number | null;
  reportDate: string;
  processingMs: number | null;
  generationMs: number;
  generationStartedAt: string;
  generationCompletedAt: string;
  downloads: string[];
}

export class HistoryStore {
  private cache: HistoryEntry[] | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(
    dir: string,
    private readonly retentionDays: number,
    private readonly maxPerOwner = 100,
  ) {
    this.file = path.join(dir, 'report-history.json');
  }

  private async load(): Promise<HistoryEntry[]> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      // Entries written by earlier versions have no mode/reports.
      this.cache = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === 'string').map((e) => ({ mode: 'production', reports: [], snapshot: null, ...e })) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private prune(list: HistoryEntry[]): HistoryEntry[] {
    const cutoff = Date.now() - this.retentionDays * 86400_000;
    const kept = list.filter((e) => Date.parse(e.updatedAt) >= cutoff);
    const byOwner = new Map<string, HistoryEntry[]>();
    for (const e of kept) (byOwner.get(e.ownerHash) ?? byOwner.set(e.ownerHash, []).get(e.ownerHash)!).push(e);
    return [...byOwner.values()].flatMap((es) => es.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, this.maxPerOwner));
  }

  async record(entry: Omit<HistoryEntry, 'createdAt' | 'updatedAt' | 'generations' | 'status' | 'reports'>): Promise<HistoryEntry> {
    const list = await this.load();
    const now = new Date().toISOString();
    const prev = list.find((e) => e.id === entry.id && e.ownerHash === entry.ownerHash);
    const next: HistoryEntry = {
      ...entry,
      snapshot: entry.snapshot ?? prev?.snapshot ?? null,
      reports: prev?.reports ?? [],
      status: 'completed',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      generations: (prev?.generations ?? 0) + (entry.snapshot ? 1 : 0),
    };
    await this.persist(this.prune([next, ...list.filter((e) => e !== prev)]));
    return next;
  }

  /** Adds or updates a generated report on the session's history entry (creating the entry if needed). */
  async recordReport(base: Omit<HistoryEntry, 'createdAt' | 'updatedAt' | 'generations' | 'status' | 'reports' | 'snapshot'>, report: HistoryReport): Promise<void> {
    const list = await this.load();
    const now = new Date().toISOString();
    const prev = list.find((e) => e.id === base.id && e.ownerHash === base.ownerHash);
    const reports = [report, ...(prev?.reports ?? []).filter((r) => r.id !== report.id)].slice(0, 200);
    const next: HistoryEntry = prev
      ? { ...prev, ...base, snapshot: prev.snapshot, reports, updatedAt: now }
      : { ...base, snapshot: null, reports, status: 'completed', createdAt: now, updatedAt: now, generations: 0 };
    await this.persist(this.prune([next, ...list.filter((e) => e !== prev)]));
  }

  async list(ownerHash: string): Promise<HistoryEntry[]> {
    const list = await this.load();
    return list.filter((e) => e.ownerHash === ownerHash).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(ownerHash: string, id: string): Promise<HistoryEntry> {
    const e = (await this.load()).find((x) => x.id === id && x.ownerHash === ownerHash);
    if (!e) throw new AppError(404, 'HISTORY_NOT_FOUND', 'Report history entry not found.');
    return e;
  }

  async remove(ownerHash: string, id: string): Promise<void> {
    const list = await this.load();
    if (!list.some((x) => x.id === id && x.ownerHash === ownerHash)) throw new AppError(404, 'HISTORY_NOT_FOUND', 'Report history entry not found.');
    await this.persist(list.filter((x) => !(x.id === id && x.ownerHash === ownerHash)));
  }

  private async persist(list: HistoryEntry[]): Promise<void> {
    this.cache = list;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(list), 'utf8');
      await fs.rename(tmp, this.file);
    });
    await this.writing;
  }
}
