import { analyzeDuplicates, type MatchRules } from './dedupe.js';
import { LEAD_FIELDS } from './fields.js';
import type { LeadRow, LeadSourceFile } from './leads.js';
import { leadFlags, pct } from './kpi.js';

/**
 * Side-by-side comparison of uploaded lead files. Read-only: it never changes the session's report,
 * mappings or duplicate decisions ("testing mode").
 */
export interface FileTiming {
  uploadStartedAt: string | null;
  uploadCompletedAt: string | null;
  processingMs: number | null;
  processedAt: string | null;
}

export interface FileComparisonRow {
  fileId: string;
  fileName: string;
  sheet: string;
  totalRecords: number;
  blankRows: number;
  processedLeads: number;
  validLeads: number;
  duplicateRecords: number;
  withinFileDuplicates: number;
  duplicatePct: number | null;
  invalidRecords: number;
  incompleteRecords: number;
  failures: { reason: string; count: number }[];
  contact: { validPhonePct: number | null; validEmailPct: number | null; anyContactPct: number | null; namePct: number | null };
  attributionPct: number | null;
  qualityScore: number | null;
  uniqueToFile: number;
  sharedWithOtherFiles: number;
  /** Qualified ÷ accepted leads × 100 (same qualification rule as the reports). */
  qualificationRate: number | null;
  owners: { label: string; count: number }[];
  stages: { label: string; count: number }[];
  timing: FileTiming;
}

export interface FileComparison {
  generatedAt: string;
  files: FileComparisonRow[];
  highlights: {
    mostValidLeads: { fileName: string; value: number } | null;
    highestDuplicatePct: { fileName: string; value: number } | null;
    mostCompleteContact: { fileName: string; value: number } | null;
    bestQuality: { fileName: string; value: number } | null;
  };
  /** Standard field -> column name used in each file (null = not present). */
  fieldMatrix: { key: string; label: string; columns: Record<string, string | null>; missingPct: Record<string, number | null> }[];
  /** Columns that exist in only some files. */
  columnDifferences: { header: string; presentIn: string[]; missingFrom: string[] }[];
  overlaps: { a: string; b: string; matchingLeads: number; byLeadId: number; byPhone: number; byEmail: number }[];
  qualityScoreDefinition: string;
}

export const QUALITY_SCORE_DEFINITION =
  'Quality score (0–100) = 40% × accepted-record rate + 30% × rows with a valid phone or email + 20% × (1 − within-file duplicate rate) + 10% × rows with campaign attribution.';

function best<T>(rows: T[], val: (r: T) => number | null, name: (r: T) => string) {
  let out: { fileName: string; value: number } | null = null;
  for (const r of rows) {
    const v = val(r);
    if (v === null) continue;
    if (!out || v > out.value) out = { fileName: name(r), value: v };
  }
  return out;
}

export function compareFiles(files: LeadSourceFile[], rows: LeadRow[], timings: Record<string, FileTiming>, rules: MatchRules): FileComparison {
  const sorted = [...files].sort((a, b) => a.order - b.order);
  const byFile = new Map<string, LeadRow[]>();
  for (const r of rows) (byFile.get(r.fileId) ?? byFile.set(r.fileId, []).get(r.fileId)!).push(r);

  const out: FileComparisonRow[] = sorted.map((f) => {
    const rs = byFile.get(f.id) ?? [];
    const acc = rs.filter((r) => r.status !== 'invalid');
    const v = f.validation;
    const within = analyzeDuplicates(v.leads, { rules }).duplicateRows;
    const has = (r: LeadRow, flag: string) => r.flags.includes(flag as never);
    const validPhone = acc.filter((r) => !has(r, 'missing_phone') && !has(r, 'invalid_phone')).length;
    const validEmail = acc.filter((r) => !has(r, 'missing_email') && !has(r, 'invalid_email')).length;
    const anyContact = acc.filter((r) => (!has(r, 'missing_phone') && !has(r, 'invalid_phone')) || (!has(r, 'missing_email') && !has(r, 'invalid_email'))).length;
    const named = acc.filter((r) => !has(r, 'missing_name')).length;
    const attributed = acc.filter((r) => !has(r, 'missing_campaign')).length;
    const incomplete = acc.filter((r) => r.flags.some((x) => ['missing_phone', 'invalid_phone', 'missing_email', 'invalid_email', 'missing_name'].includes(x))).length;
    const failures = new Map<string, number>();
    for (const rj of v.rejectedRows) failures.set(rj.reason, (failures.get(rj.reason) ?? 0) + 1);
    const total = v.dataRows;
    const dupPct = pct(within, acc.length);
    const score =
      total > 0
        ? Math.round(
            (0.4 * (acc.length / total) +
              0.3 * (acc.length ? anyContact / acc.length : 0) +
              0.2 * (1 - (acc.length ? within / acc.length : 0)) +
              0.1 * (acc.length ? attributed / acc.length : 0)) *
              1000,
          ) / 10
        : null;
    const qualified = v.leads.filter((r) => leadFlags(r, { fromMs: 0, toMs: 0 }).qualified === true).length;
    const dist = (key: string, blank: string) => {
      const m = new Map<string, number>();
      for (const r of acc) m.set(r.std[key] || blank, (m.get(r.std[key] || blank) ?? 0) + 1);
      return f.mapping && Object.values(f.mapping).includes(key) ? [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count) : [];
    };
    return {
      fileId: f.id,
      fileName: f.name,
      sheet: '',
      qualificationRate: pct(qualified, v.leads.length),
      owners: dist('assignedCounsellor', '(No owner)'),
      stages: dist('leadStage', '(No stage)'),
      totalRecords: total,
      blankRows: v.blankRows,
      processedLeads: v.accepted,
      validLeads: rs.filter((r) => r.status === 'valid').length,
      duplicateRecords: rs.filter((r) => r.status === 'duplicate' || r.status === 'possible_duplicate').length,
      withinFileDuplicates: within,
      duplicatePct: dupPct,
      invalidRecords: v.rejected,
      incompleteRecords: incomplete,
      failures: [...failures.entries()].map(([reason, count]) => ({ reason, count })),
      contact: { validPhonePct: pct(validPhone, acc.length), validEmailPct: pct(validEmail, acc.length), anyContactPct: pct(anyContact, acc.length), namePct: pct(named, acc.length) },
      attributionPct: pct(attributed, acc.length),
      qualityScore: score,
      uniqueToFile: acc.filter((r) => r.alsoIn.length === 0).length,
      sharedWithOtherFiles: acc.filter((r) => r.alsoIn.length > 0).length,
      timing: timings[f.id] ?? { uploadStartedAt: null, uploadCompletedAt: null, processingMs: null, processedAt: null },
    };
  });

  // Field matrix and missing values per mapped field.
  const fieldMatrix = LEAD_FIELDS.map((fd) => {
    const columns: Record<string, string | null> = {};
    const missingPct: Record<string, number | null> = {};
    for (const f of sorted) {
      const col = Object.entries(f.mapping).find(([, k]) => k === fd.key)?.[0];
      columns[f.name] = col !== undefined ? f.headers[Number(col)] : null;
      if (col === undefined) missingPct[f.name] = null;
      else {
        const acc = (byFile.get(f.id) ?? []).filter((r) => r.status !== 'invalid');
        const header = f.headers[Number(col)];
        missingPct[f.name] = pct(acc.filter((r) => !(r.original[header] ?? '').trim()).length, acc.length);
      }
    }
    return { key: fd.key, label: fd.label, columns, missingPct };
  }).filter((r) => Object.values(r.columns).some(Boolean));

  const allHeaders = new Map<string, Set<string>>();
  for (const f of sorted) for (const h of f.headers) (allHeaders.get(h) ?? allHeaders.set(h, new Set()).get(h)!).add(f.name);
  const names = sorted.map((f) => f.name);
  const columnDifferences = [...allHeaders.entries()]
    .filter(([, s]) => s.size < sorted.length)
    .map(([header, s]) => ({ header, presentIn: [...s], missingFrom: names.filter((n) => !s.has(n)) }));

  // Pairwise overlaps by identifier.
  const keySets = new Map<string, { id: Set<string>; phone: Set<string>; email: Set<string> }>();
  for (const f of sorted) {
    const ks = { id: new Set<string>(), phone: new Set<string>(), email: new Set<string>() };
    for (const r of f.validation.leads) {
      if (rules.leadId && r.text.leadId) ks.id.add(r.text.leadId.trim().toLowerCase());
      if (rules.phone && r.phone) ks.phone.add(r.phone);
      if (rules.email && r.email) ks.email.add(r.email);
    }
    keySets.set(f.id, ks);
  }
  const overlaps: FileComparison['overlaps'] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const A = sorted[i];
      const B = keySets.get(sorted[j].id)!;
      let byLeadId = 0;
      let byPhone = 0;
      let byEmail = 0;
      let any = 0;
      for (const r of A.validation.leads) {
        const id = rules.leadId && r.text.leadId ? B.id.has(r.text.leadId.trim().toLowerCase()) : false;
        const ph = rules.phone && r.phone ? B.phone.has(r.phone) : false;
        const em = rules.email && r.email ? B.email.has(r.email) : false;
        if (id) byLeadId++;
        if (ph) byPhone++;
        if (em) byEmail++;
        if (id || ph || em) any++;
      }
      overlaps.push({ a: A.name, b: sorted[j].name, matchingLeads: any, byLeadId, byPhone, byEmail });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    files: out,
    highlights: {
      mostValidLeads: best(out, (r) => r.validLeads, (r) => r.fileName),
      highestDuplicatePct: best(out, (r) => r.duplicatePct, (r) => r.fileName),
      mostCompleteContact: best(out, (r) => r.contact.anyContactPct, (r) => r.fileName),
      bestQuality: best(out, (r) => r.qualityScore, (r) => r.fileName),
    },
    fieldMatrix,
    columnDifferences,
    overlaps,
    qualityScoreDefinition: QUALITY_SCORE_DEFINITION,
  };
}
