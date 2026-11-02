import { analyzeDuplicates, applyDuplicateMode, type DuplicateDecision, type DuplicateMode, type MatchRules } from './dedupe.js';
import { LEAD_FIELDS, LEAD_FIELD_MAP } from './fields.js';
import { campaignLabel, sourceLabel } from './kpi.js';
import { cleanString, formatNaive, groupKey, isoDayToMs, type CellValue } from './normalize.js';
import type { FileValidation, LeadRecord } from './validate.js';

/**
 * Row-level view of the uploaded leads for the interactive table and lead exports.
 * Built on demand from the session's in-memory data; nothing here is persisted.
 */
export type LeadStatus = 'valid' | 'duplicate' | 'possible_duplicate' | 'invalid';
export const LEAD_FLAGS = [
  'missing_phone',
  'invalid_phone',
  'missing_email',
  'invalid_email',
  'missing_name',
  'missing_campaign',
  'missing_source',
  'missing_created_date',
  'outside_period',
  'no_identifier',
] as const;
export type LeadFlag = (typeof LEAD_FLAGS)[number];

export const FLAG_LABELS: Record<LeadFlag, string> = {
  missing_phone: 'Missing phone',
  invalid_phone: 'Invalid phone',
  missing_email: 'Missing email',
  invalid_email: 'Invalid email',
  missing_name: 'Missing name',
  missing_campaign: 'Missing campaign',
  missing_source: 'Missing source',
  missing_created_date: 'Missing created date',
  outside_period: 'Outside reporting period',
  no_identifier: 'No identifier (rejected)',
};

export const STATUS_LABELS: Record<LeadStatus, string> = {
  valid: 'Valid',
  duplicate: 'Duplicate',
  possible_duplicate: 'Possible duplicate',
  invalid: 'Invalid',
};

export interface LeadRow {
  uid: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  status: LeadStatus;
  /** True when the current duplicate option leaves this row out of the report totals. */
  excludedFromReport: boolean;
  flags: LeadFlag[];
  rejectReason: string | null;
  duplicateGroupId: string | null;
  matchedOn: string[];
  /** Other files containing a lead with the same Lead ID / phone / email (per the match rules). */
  alsoIn: string[];
  /** Standard schema values, normalised for comparison (phone digits, lower-case email, ISO dates). */
  std: Record<string, string>;
  /** Original cell values exactly as uploaded, keyed by the file's column header. */
  original: Record<string, string>;
  /** Internal: created-date day key for filtering. */
  createdDay: string | null;
  /** NEXT FOLLOWUP relative to the report date (Lead Contact Report rule). */
  followUp: 'overdue' | 'upcoming' | 'none';
}

export interface LeadSourceFile {
  id: string;
  name: string;
  order: number;
  headers: string[];
  mapping: Record<string, string>;
  rows: CellValue[][];
  firstRow: number;
  headerRow: number;
  validation: FileValidation;
}

export interface LeadBuildOptions {
  duplicateMode: DuplicateMode;
  duplicateDecisions: Record<string, DuplicateDecision>;
  cautiousMatching: boolean;
  matchRules: MatchRules;
  period: { from: string; to: string };
  /** Report date for follow-up status (default: end of the period). */
  reportDate?: string;
}

const cellText = (v: CellValue | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
};

function originalValues(f: LeadSourceFile, rowNumber: number): Record<string, string> {
  const row = f.rows[rowNumber - f.firstRow] ?? [];
  const out: Record<string, string> = {};
  f.headers.forEach((h, i) => (out[h] = cellText(row[i])));
  return out;
}

function standardValues(r: LeadRecord): Record<string, string> {
  const std: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.text)) std[k] = v;
  if (r.phone) std.phone = r.phone;
  if (r.email) std.email = r.email;
  for (const [k, d] of Object.entries(r.dates)) std[k] = formatNaive(d) ?? '';
  if (r.revenue !== null) std.revenue = String(r.revenue);
  for (const [k, n] of Object.entries(r.numbers ?? {})) std[k] = String(n);
  std.campaign = campaignLabel(r);
  std.source = sourceLabel(r);
  return std;
}

export function buildLeadRows(files: LeadSourceFile[], opts: LeadBuildOptions): LeadRow[] {
  const accepted = files.flatMap((f) => f.validation.leads);
  const analysis = analyzeDuplicates(accepted, { cautiousMatching: opts.cautiousMatching, rules: opts.matchRules });
  const working = applyDuplicateMode(accepted, analysis, opts.duplicateMode, opts.duplicateDecisions);

  // Row -> group membership. A row is a "duplicate" unless it is the kept/first member of its group.
  const groupOf = new Map<string, { id: string; kind: 'confirmed' | 'possible'; keep: string; matchedOn: string[] }>();
  for (const g of analysis.groups) {
    const keep = g.memberUids.find((u) => !working.excludedUids.has(u) && (g.kind === 'possible' ? u === g.firstUid : true)) ?? g.firstUid;
    for (const u of g.memberUids) {
      const prev = groupOf.get(u);
      // Confirmed membership takes precedence over a possible-duplicate cluster.
      if (!prev || (prev.kind === 'possible' && g.kind === 'confirmed')) groupOf.set(u, { id: g.id, kind: g.kind, keep, matchedOn: g.matchedOn });
    }
  }

  // Cross-file presence by identifier.
  const keysOf = (r: LeadRecord): string[] => {
    const k: string[] = [];
    if (opts.matchRules.leadId && r.text.leadId) k.push(`i:${r.text.leadId.trim().toLowerCase()}`);
    if (opts.matchRules.phone && r.phone) k.push(`p:${r.phone}`);
    if (opts.matchRules.email && r.email) k.push(`e:${r.email}`);
    return k;
  };
  const filesByKey = new Map<string, Set<string>>();
  for (const r of accepted) for (const k of keysOf(r)) (filesByKey.get(k) ?? filesByKey.set(k, new Set()).get(k)!).add(r.fileName);

  const reportDayMs = isoDayToMs(opts.reportDate ?? opts.period.to);
  const followUpOf = (r: LeadRecord): LeadRow['followUp'] => (!r.dates.nextFollowUpDate ? 'none' : r.dates.nextFollowUpDate.ms < reportDayMs ? 'overdue' : 'upcoming');
  const fromMs = isoDayToMs(opts.period.from);
  const toMs = isoDayToMs(opts.period.to) + 86400000;
  const out: LeadRow[] = [];
  const sorted = [...files].sort((a, b) => a.order - b.order);
  for (const f of sorted) {
    for (const r of f.validation.leads) {
      const flags: LeadFlag[] = [];
      if (!r.phoneProvided) flags.push('missing_phone');
      else if (!r.phoneValid) flags.push('invalid_phone');
      if (!r.emailProvided) flags.push('missing_email');
      else if (!r.emailValid) flags.push('invalid_email');
      if (!r.text.name) flags.push('missing_name');
      if (!r.text.campaignName && !r.text.utmCampaign) flags.push('missing_campaign');
      if (!r.text.source) flags.push('missing_source');
      const c = r.dates.leadCreatedDate;
      if (!c) flags.push('missing_created_date');
      else if (c.ms < fromMs || c.ms >= toMs) flags.push('outside_period');
      const g = groupOf.get(r.uid);
      let status: LeadStatus = 'valid';
      if (g && g.keep !== r.uid) status = g.kind === 'confirmed' ? 'duplicate' : 'possible_duplicate';
      const alsoIn = new Set<string>();
      for (const k of keysOf(r)) for (const fn of filesByKey.get(k) ?? []) if (fn !== f.name) alsoIn.add(fn);
      out.push({
        uid: r.uid,
        fileId: f.id,
        fileName: f.name,
        rowNumber: r.rowNumber,
        status,
        excludedFromReport: working.excludedUids.has(r.uid),
        flags,
        rejectReason: null,
        duplicateGroupId: g?.id ?? null,
        matchedOn: g?.matchedOn ?? [],
        alsoIn: [...alsoIn],
        std: standardValues(r),
        original: originalValues(f, r.rowNumber),
        createdDay: c ? new Date(c.ms).toISOString().slice(0, 10) : null,
        followUp: followUpOf(r),
      });
    }
    for (const rej of f.validation.rejectedRows) {
      const original = originalValues(f, rej.rowNumber);
      const std: Record<string, string> = {};
      for (const [col, key] of Object.entries(f.mapping)) {
        const v = cleanString(f.rows[rej.rowNumber - f.firstRow]?.[Number(col)] ?? null);
        if (v && LEAD_FIELD_MAP.has(key)) std[key] = v;
      }
      out.push({
        uid: `${f.id}:${rej.rowNumber}`,
        fileId: f.id,
        fileName: f.name,
        rowNumber: rej.rowNumber,
        status: 'invalid',
        excludedFromReport: true,
        flags: ['no_identifier'],
        rejectReason: rej.reason,
        duplicateGroupId: null,
        matchedOn: [],
        alsoIn: [],
        std,
        original,
        createdDay: null,
        followUp: 'none',
      });
    }
  }
  return out.sort((a, b) => (a.fileId === b.fileId ? a.rowNumber - b.rowNumber : 0));
}

// ---------------------------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------------------------

export interface LeadQuery {
  search?: string;
  fileIds?: string[];
  statuses?: LeadStatus[];
  flags?: LeadFlag[];
  sources?: string[];
  campaigns?: string[];
  leadStatuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  presence?: 'all' | 'unique_to_file' | 'in_multiple_files';
  owners?: string[];
  stages?: string[];
  dispositions?: string[];
  followUp?: ('overdue' | 'upcoming' | 'none')[];
  uids?: string[];
  sort?: string;
  dir?: 'asc' | 'desc';
}

export function filterLeads(rows: LeadRow[], q: LeadQuery): LeadRow[] {
  const inSet = (vals: string[] | undefined) => (vals?.length ? new Set(vals.map(groupKey)) : null);
  const files = q.fileIds?.length ? new Set(q.fileIds) : null;
  const statuses = q.statuses?.length ? new Set(q.statuses) : null;
  const sources = inSet(q.sources);
  const campaigns = inSet(q.campaigns);
  const leadStatuses = inSet(q.leadStatuses);
  const uids = q.uids?.length ? new Set(q.uids) : null;
  const owners = inSet(q.owners);
  const stages = inSet(q.stages);
  const dispositions = inSet(q.dispositions);
  const followUp = q.followUp?.length ? new Set(q.followUp) : null;
  const needle = q.search?.trim().toLowerCase();
  return rows.filter((r) => {
    if (uids && !uids.has(r.uid)) return false;
    if (files && !files.has(r.fileId)) return false;
    if (statuses && !statuses.has(r.status)) return false;
    if (q.flags?.length && !q.flags.some((f) => r.flags.includes(f))) return false;
    if (sources && !sources.has(groupKey(r.std.source ?? ''))) return false;
    if (campaigns && !campaigns.has(groupKey(r.std.campaign ?? ''))) return false;
    if (leadStatuses && !leadStatuses.has(groupKey(r.std.leadStatus ?? '(No status)'))) return false;
    if (owners && !owners.has(groupKey(r.std.assignedCounsellor ?? '(No owner)'))) return false;
    if (stages && !stages.has(groupKey(r.std.leadStage ?? '(No stage)'))) return false;
    if (dispositions && !dispositions.has(groupKey(r.std.leadDisposition ?? '(No disposition recorded)'))) return false;
    if (followUp && !followUp.has(r.followUp)) return false;
    if (q.dateFrom && (!r.createdDay || r.createdDay < q.dateFrom)) return false;
    if (q.dateTo && (!r.createdDay || r.createdDay > q.dateTo)) return false;
    if (q.presence === 'unique_to_file' && (r.alsoIn.length || r.status === 'invalid')) return false;
    if (q.presence === 'in_multiple_files' && !r.alsoIn.length) return false;
    if (needle) {
      const hay = `${r.fileName} ${Object.values(r.std).join(' ')} ${Object.values(r.original).join(' ')}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

const STATUS_ORDER: Record<LeadStatus, number> = { valid: 0, possible_duplicate: 1, duplicate: 2, invalid: 3 };

export function sortLeads(rows: LeadRow[], sort = 'file', dir: 'asc' | 'desc' = 'asc'): LeadRow[] {
  const m = dir === 'asc' ? 1 : -1;
  const val = (r: LeadRow): string | number => {
    if (sort === 'file') return `${String(r.fileName)}\u0000${String(r.rowNumber).padStart(9, '0')}`;
    if (sort === 'rowNumber') return r.rowNumber;
    if (sort === 'status') return STATUS_ORDER[r.status];
    if (sort === 'flags') return r.flags.length;
    if (sort.startsWith('orig:')) return r.original[sort.slice(5)] ?? '';
    return r.std[sort] ?? '';
  };
  return [...rows].sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    if (va === vb) return 0;
    if (va === '') return 1; // blanks last
    if (vb === '') return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
    return String(va).localeCompare(String(vb), undefined, { numeric: true }) * m;
  });
}

export function leadFacets(rows: LeadRow[]) {
  const count = (fn: (r: LeadRow) => string | string[]) => {
    const m = new Map<string, number>();
    for (const r of rows) for (const v of ([] as string[]).concat(fn(r))) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return {
    statuses: count((r) => r.status),
    flags: count((r) => r.flags),
    files: count((r) => r.fileName),
    sources: count((r) => r.std.source ?? ''),
    campaigns: count((r) => r.std.campaign ?? ''),
    leadStatuses: count((r) => r.std.leadStatus ?? '(No status)'),
    owners: count((r) => r.std.assignedCounsellor ?? '(No owner)'),
    stages: count((r) => r.std.leadStage ?? '(No stage)'),
    dispositions: count((r) => r.std.leadDisposition ?? '(No disposition recorded)'),
    followUp: count((r) => r.followUp),
  };
}

/** Standard-schema columns in field order, limited to those present in the rows. */
export function standardColumns(rows: LeadRow[]): { key: string; label: string }[] {
  const present = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.std)) present.add(k);
  const cols = LEAD_FIELDS.filter((f) => present.has(f.key)).map((f) => ({ key: f.key, label: f.label }));
  if (present.has('campaign')) cols.push({ key: 'campaign', label: 'Campaign (reported)' });
  if (present.has('source')) cols.push({ key: 'source', label: 'Source (reported)' });
  return cols;
}

/** Union of original column headers across the files, in first-seen order. */
export function originalColumns(files: LeadSourceFile[]): string[] {
  const seen: string[] = [];
  for (const f of [...files].sort((a, b) => a.order - b.order)) for (const h of f.headers) if (!seen.includes(h)) seen.push(h);
  return seen;
}
