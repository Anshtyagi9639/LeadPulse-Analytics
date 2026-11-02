import { createHash } from 'node:crypto';
import type { LeadRecord } from './validate.js';

export type DuplicateMode = 'count_all' | 'exclude_duplicates' | 'keep_latest' | 'manual_review';
export type DuplicateDecision = 'keep_all' | 'keep_first' | 'keep_latest';

export interface DuplicateGroup {
  id: string;
  /** confirmed: same Lead ID, or same phone/email with no conflicting Lead IDs. possible: needs a human decision. */
  kind: 'confirmed' | 'possible';
  matchedOn: ('lead_id' | 'phone' | 'email' | 'name_city')[];
  conflict: boolean;
  conflictReasons: string[];
  memberUids: string[];
  files: string[];
  campaigns: string[];
  firstUid: string;
  latestUid: string;
}

export interface DuplicateAnalysis {
  groups: DuplicateGroup[];
  totalRows: number;
  /** Rows after collapsing confirmed duplicates (possible duplicates are still counted separately). */
  uniqueLeads: number;
  duplicateRows: number;
  possibleDuplicateRows: number;
  missingIdRows: number;
  unidentifiableRows: number;
  conflictingRecords: number;
  byFile: Record<string, { duplicateRows: number; possibleDuplicateRows: number }>;
  byCampaign: Record<string, { duplicateRows: number; possibleDuplicateRows: number }>;
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

const ACTIVITY_FIELDS = ['lastContactDate', 'firstContactAt', 'assignedAt', 'leadCreatedDate', 'enrolmentDate', 'applicationDate'];

/** Most recent activity timestamp on a record (used by "keep latest"). */
export function latestActivity(r: LeadRecord): number {
  let best = -Infinity;
  for (const k of ACTIVITY_FIELDS) {
    const d = r.dates[k];
    if (d && d.ms > best) best = d.ms;
  }
  return best;
}

function pickLatest(rs: LeadRecord[]): LeadRecord {
  return rs.reduce((a, b) => {
    const la = latestActivity(a);
    const lb = latestActivity(b);
    if (lb > la) return b;
    if (lb < la) return a;
    return b.order > a.order ? b : a;
  });
}

function pickFirst(rs: LeadRecord[]): LeadRecord {
  return rs.reduce((a, b) => (b.order < a.order ? b : a));
}

function groupId(uids: string[]): string {
  return createHash('sha1').update([...uids].sort().join('|')).digest('hex').slice(0, 12);
}

const normId = (s: string | undefined) => (s ? s.trim().toLowerCase() : '');
const normName = (s: string | undefined) => (s ? s.toLowerCase().replace(/[^a-z]/g, '') : '');

export interface MatchRules {
  leadId: boolean;
  phone: boolean;
  email: boolean;
}
export const DEFAULT_MATCH_RULES: MatchRules = { leadId: true, phone: true, email: true };

export function analyzeDuplicates(records: LeadRecord[], options: { cautiousMatching?: boolean; rules?: MatchRules } = {}): DuplicateAnalysis {
  const n = records.length;
  const rules = options.rules ?? DEFAULT_MATCH_RULES;
  // Identifiers switched off in the match rules are ignored entirely.
  const idOf = (r: LeadRecord) => (rules.leadId ? normId(r.text.leadId) : '');
  const phoneOf = (r: LeadRecord) => (rules.phone ? r.phone : null);
  const emailOf = (r: LeadRecord) => (rules.email ? r.email : null);
  const byUid = new Map(records.map((r) => [r.uid, r]));

  // 1) Units: rows sharing the same external Lead ID.
  const idUf = new UnionFind(n);
  const idIndex = new Map<string, number>();
  records.forEach((r, i) => {
    const id = idOf(r);
    if (!id) return;
    const prev = idIndex.get(id);
    if (prev === undefined) idIndex.set(id, i);
    else idUf.union(prev, i);
  });

  // 2) Components: units linked by normalised phone or email.
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) uf.union(i, idUf.find(i));
  const phoneIndex = new Map<string, number>();
  const emailIndex = new Map<string, number>();
  records.forEach((r, i) => {
    for (const [key, index] of [
      [phoneOf(r), phoneIndex],
      [emailOf(r), emailIndex],
    ] as const) {
      if (!key) continue;
      const prev = index.get(key);
      if (prev === undefined) index.set(key, i);
      else uf.union(prev, i);
    }
  });

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    const arr = components.get(root) ?? [];
    arr.push(i);
    components.set(root, arr);
  }
  // Which contact fields actually link rows inside a component.
  const componentTags = (idx: number[]): Set<'phone' | 'email'> => {
    const tags = new Set<'phone' | 'email'>();
    const phones = new Map<string, number>();
    const emails = new Map<string, number>();
    for (const i of idx) {
      const r = records[i];
      const p = phoneOf(r);
      const e = emailOf(r);
      if (p) phones.set(p, (phones.get(p) ?? 0) + 1);
      if (e) emails.set(e, (emails.get(e) ?? 0) + 1);
    }
    if ([...phones.values()].some((c) => c > 1)) tags.add('phone');
    if ([...emails.values()].some((c) => c > 1)) tags.add('email');
    return tags;
  };

  const analysis: DuplicateAnalysis = {
    groups: [],
    totalRows: n,
    uniqueLeads: 0,
    duplicateRows: 0,
    possibleDuplicateRows: 0,
    missingIdRows: records.filter((r) => !normId(r.text.leadId)).length,
    unidentifiableRows: records.filter((r) => !normId(r.text.leadId) && !r.phone && !r.email).length,
    conflictingRecords: 0,
    byFile: {},
    byCampaign: {},
  };

  const bump = (rs: LeadRecord[], field: 'duplicateRows' | 'possibleDuplicateRows', keep: LeadRecord | null) => {
    for (const r of rs) {
      if (keep && r.uid === keep.uid) continue;
      const f = (analysis.byFile[r.fileName] ??= { duplicateRows: 0, possibleDuplicateRows: 0 });
      f[field]++;
      const c = (analysis.byCampaign[r.text.campaignName ?? '(No campaign)'] ??= { duplicateRows: 0, possibleDuplicateRows: 0 });
      c[field]++;
    }
  };

  const makeGroup = (rs: LeadRecord[], kind: DuplicateGroup['kind'], matchedOn: DuplicateGroup['matchedOn'], conflictReasons: string[]): DuplicateGroup => ({
    id: groupId(rs.map((r) => r.uid)),
    kind,
    matchedOn,
    conflict: conflictReasons.length > 0,
    conflictReasons,
    memberUids: rs.map((r) => r.uid),
    files: [...new Set(rs.map((r) => r.fileName))],
    campaigns: [...new Set(rs.map((r) => r.text.campaignName ?? '(No campaign)'))],
    firstUid: pickFirst(rs).uid,
    latestUid: pickLatest(rs).uid,
  });

  const singletonsForCautious: LeadRecord[][] = [];

  for (const idx of components.values()) {
    const rs = idx.map((i) => records[i]);
    const ids = new Set(rs.map(idOf).filter(Boolean));
    if (rs.length === 1) {
      analysis.uniqueLeads++;
      singletonsForCautious.push(rs);
      continue;
    }
    const tags = componentTags(idx);
    if (ids.size <= 1) {
      const phones = new Set(rs.map((r) => r.phone).filter(Boolean));
      const emails = new Set(rs.map((r) => r.email).filter(Boolean));
      const reasons: string[] = [];
      if (phones.size > 1) reasons.push('Same lead has different phone numbers across rows');
      if (emails.size > 1) reasons.push('Same lead has different email addresses across rows');
      const matchedOn: DuplicateGroup['matchedOn'] = [];
      if (ids.size === 1 && rs.filter((r) => idOf(r)).length > 1) matchedOn.push('lead_id');
      if (tags.has('phone')) matchedOn.push('phone');
      if (tags.has('email')) matchedOn.push('email');
      const g = makeGroup(rs, 'confirmed', matchedOn, reasons);
      analysis.groups.push(g);
      analysis.uniqueLeads++;
      analysis.duplicateRows += rs.length - 1;
      if (reasons.length) analysis.conflictingRecords += rs.length;
      bump(rs, 'duplicateRows', byUid.get(g.firstUid)!);
      singletonsForCautious.push(rs);
      continue;
    }
    // Different Lead IDs share a phone/email: confirmed only within each Lead ID; the cluster needs review.
    const units = new Map<number, LeadRecord[]>();
    for (const i of idx) {
      const root = idUf.find(i);
      const arr = units.get(root) ?? [];
      arr.push(records[i]);
      units.set(root, arr);
    }
    for (const unit of units.values()) {
      if (unit.length > 1 && idOf(unit[0])) {
        const g = makeGroup(unit, 'confirmed', ['lead_id'], []);
        analysis.groups.push(g);
        analysis.duplicateRows += unit.length - 1;
        bump(unit, 'duplicateRows', byUid.get(g.firstUid)!);
      }
    }
    const reasons = [`${ids.size} different Lead IDs share the same ${[...tags].join(' / ') || 'contact details'}`];
    analysis.groups.push(makeGroup(rs, 'possible', [...tags], reasons));
    analysis.uniqueLeads += units.size;
    analysis.possibleDuplicateRows += units.size - 1;
    analysis.conflictingRecords += rs.length;
    bump(
      [...units.values()].map((u) => pickFirst(u)),
      'possibleDuplicateRows',
      pickFirst([...units.values()].map((u) => pickFirst(u))),
    );
  }

  // 3) Optional cautious matching: identical full name AND city, never auto-confirmed.
  if (options.cautiousMatching) {
    const byNameCity = new Map<string, LeadRecord[][]>();
    for (const comp of singletonsForCautious) {
      const r = comp[0];
      const name = normName(r.text.name);
      const city = normName(r.text.city);
      if (name.length < 4 || !city) continue;
      const k = `${name}|${city}`;
      const arr = byNameCity.get(k) ?? [];
      arr.push(comp);
      byNameCity.set(k, arr);
    }
    for (const comps of byNameCity.values()) {
      if (comps.length < 2) continue;
      const rs = comps.flat();
      analysis.groups.push(makeGroup(rs, 'possible', ['name_city'], ['Matched only on name and city — verify before merging']));
      analysis.possibleDuplicateRows += comps.length - 1;
      bump(comps.map((c) => pickFirst(c)), 'possibleDuplicateRows', pickFirst(comps.map((c) => pickFirst(c))));
    }
  }

  return analysis;
}

export interface WorkingSet {
  records: LeadRecord[];
  excludedUids: Set<string>;
  pendingReviewGroups: number;
}

/** Applies the selected duplicate-handling option to the temporary working dataset. Source data is never modified. */
export function applyDuplicateMode(
  records: LeadRecord[],
  analysis: DuplicateAnalysis,
  mode: DuplicateMode,
  decisions: Record<string, DuplicateDecision> = {},
): WorkingSet {
  const byUid = new Map(records.map((r) => [r.uid, r]));
  const excluded = new Set<string>();
  let pending = 0;

  const collapse = (g: DuplicateGroup, keep: 'first' | 'latest') => {
    const members = g.memberUids.map((u) => byUid.get(u)!).filter((r) => r && !excluded.has(r.uid));
    if (members.length < 2) return;
    const keeper = keep === 'first' ? pickFirst(members) : pickLatest(members);
    for (const m of members) if (m.uid !== keeper.uid) excluded.add(m.uid);
  };

  // Confirmed groups first, so a possible-group merge always keeps a surviving record.
  const ordered = [...analysis.groups].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'confirmed' ? -1 : 1));
  for (const g of ordered) {
    if (mode === 'count_all') break;
    if (mode === 'manual_review') {
      const d = decisions[g.id];
      if (!d) pending++;
      else if (d === 'keep_first') collapse(g, 'first');
      else if (d === 'keep_latest') collapse(g, 'latest');
      continue;
    }
    if (g.kind !== 'confirmed') continue;
    collapse(g, mode === 'keep_latest' ? 'latest' : 'first');
  }
  return { records: records.filter((r) => !excluded.has(r.uid)), excludedUids: excluded, pendingReviewGroups: pending };
}
