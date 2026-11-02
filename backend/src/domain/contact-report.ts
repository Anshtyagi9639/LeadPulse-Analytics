import { leadFlags } from './kpi.js';
import { dayKey, groupKey, isoDayToMs } from './normalize.js';
import type { LeadRecord } from './validate.js';

/**
 * "Lead Contact Report" — reproduces the SalesMax contact-export summary (reference workbook
 * Lead_Contact_Report_24Oct2026.xlsx, sheet "Summary Report"). One implementation feeds the dashboard,
 * the Excel/CSV/PDF exports and the tests, so every channel shows the same numbers.
 *
 * Reference rules (Excel formulas on the "Full Data" sheet):
 *   Total leads            COUNTA(LEAD NAME)                          -> rows in the report
 *   Not worked             COUNTIF(AWAITING FIRST TOUCH, "NOT_WORKED")
 *   Worked at least once   COUNT(ATTEMPTS)                            -> rows whose ATTEMPTS is a number
 *   Qualified              COUNTIF(LEAD STAGE, "Qualified Lead")      -> same rule as the dashboard
 *   Qualification rate     Qualified / Total leads
 *   Attempts / calls       SUM(ATTEMPTS), SUM(TOTAL CALLS), SUM(CALLS TODAY)
 *   Interested             COUNTIF(LEAD DISPOSITION, "INTERESTED")
 *   Overdue follow-ups     NEXT FOLLOWUP <  report date (00:00)
 *   Upcoming follow-ups    NEXT FOLLOWUP >= report date (00:00)
 *   No follow-up date      Total − overdue − upcoming (blank or not a date)
 */

export type FollowUpStatus = 'overdue' | 'upcoming' | 'none';

export const CONTACT_FIELDS = [
  'name',
  'assignedCounsellor',
  'leadStage',
  'awaitingFirstTouch',
  'attempts',
  'totalCalls',
  'callsToday',
  'lastWorked',
  'startedWorkOn',
  'nextFollowUpDate',
  'leadDisposition',
  'lastDispositionOn',
  'phone',
  'email',
  'lastCallOutcome',
  'lastCalledBy',
] as const;

/** Standard SalesMax column headers, in export order. */
export const SALESMAX_HEADERS: Record<(typeof CONTACT_FIELDS)[number], string> = {
  name: 'LEAD NAME',
  assignedCounsellor: 'LEAD OWNER',
  leadStage: 'LEAD STAGE',
  awaitingFirstTouch: 'AWAITING FIRST TOUCH',
  attempts: 'ATTEMPTS',
  totalCalls: 'TOTAL CALLS',
  callsToday: 'CALLS TODAY',
  lastWorked: 'LAST WORKED',
  startedWorkOn: 'STARTED WORK ON',
  nextFollowUpDate: 'NEXT FOLLOWUP',
  leadDisposition: 'LEAD DISPOSITION',
  lastDispositionOn: 'LAST DISPOSITION ON',
  phone: 'MOBILE NUMBER',
  email: 'EMAIL',
  lastCallOutcome: 'LAST CALL OUTCOME',
  lastCalledBy: 'LAST CALLED BY',
};

/** Pipeline order used by SalesMax; unknown stages follow by lead count. */
const STAGE_ORDER = ['new inquiry lead', 'being qualified', 'qualified lead', 'reactivated lead'];
const NO_OWNER = '(No owner)';
const NO_STAGE = '(No stage)';
export const NO_DISPOSITION = '(No disposition recorded)';
const NO_DATE = '(No date)';

const eq = (v: string | undefined, target: string) => (v ?? '').trim().toLowerCase() === target.toLowerCase();

export function followUpStatus(r: LeadRecord, reportDate: string): FollowUpStatus {
  const d = r.dates.nextFollowUpDate;
  if (!d) return 'none';
  return d.ms < isoDayToMs(reportDate) ? 'overdue' : 'upcoming';
}

export interface ContactFilters {
  owners?: string[];
  stages?: string[];
  dispositions?: string[];
  followUp?: FollowUpStatus[];
}

export function ownerOf(r: LeadRecord): string {
  return r.text.assignedCounsellor ?? NO_OWNER;
}
export function stageOf(r: LeadRecord): string {
  return r.text.leadStage ?? NO_STAGE;
}
export function dispositionOf(r: LeadRecord): string {
  return r.text.leadDisposition ?? NO_DISPOSITION;
}

export function filterContacts(records: LeadRecord[], f: ContactFilters, reportDate: string): LeadRecord[] {
  const set = (xs?: string[]) => (xs?.length ? new Set(xs.map(groupKey)) : null);
  const owners = set(f.owners);
  const stages = set(f.stages);
  const disps = set(f.dispositions);
  const fu = f.followUp?.length ? new Set(f.followUp) : null;
  return records.filter(
    (r) =>
      (!owners || owners.has(groupKey(ownerOf(r)))) &&
      (!stages || stages.has(groupKey(stageOf(r)))) &&
      (!disps || disps.has(groupKey(dispositionOf(r)))) &&
      (!fu || fu.has(followUpStatus(r, reportDate))),
  );
}

export interface ContactReport {
  reportDate: string;
  kpis: {
    totalLeads: number;
    notWorked: number | null;
    workedAtLeastOnce: number | null;
    qualified: number | null;
    qualificationRate: number | null; // 0–100
    totalAttempts: number | null;
    totalCalls: number | null;
    callsToday: number | null;
    interested: number | null;
    overdueFollowUps: number | null;
    upcomingFollowUps: number | null;
    noFollowUpDate: number | null;
  };
  owners: { owner: string; leads: number; notWorked: number; qualified: number; notQualified: number; totalCalls: number; callsToday: number }[];
  stages: { stage: string; leads: number; pct: number | null }[];
  dispositions: { disposition: string; leads: number; pct: number | null }[];
  lastWorkedByDate: { date: string; leads: number }[];
  /** Fields of the SalesMax schema that are not mapped in any processed file. */
  missingFields: string[];
  notes: string[];
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);

export function buildContactReport(records: LeadRecord[], reportDate: string, mappedFields: Set<string>): ContactReport {
  const has = (k: string) => mappedFields.has(k);
  const total = records.length;
  const sum = (k: string) => records.reduce((s, r) => s + (r.numbers[k] ?? 0), 0);
  const qualified = (r: LeadRecord) => leadFlags(r, { fromMs: 0, toMs: 0 }).qualified === true;
  const notWorked = (r: LeadRecord) => eq(r.text.awaitingFirstTouch, 'NOT_WORKED');

  const fu = { overdue: 0, upcoming: 0, none: 0 };
  for (const r of records) fu[followUpStatus(r, reportDate)]++;
  const qualifiedCount = records.filter(qualified).length;
  const qualAvailable = has('leadStage') || has('qualificationStatus') || has('leadQuality') || has('leadStatus');

  // Owners, in descending lead count (reference order)
  const ownerMap = new Map<string, { owner: string; rs: LeadRecord[] }>();
  for (const r of records) {
    const k = groupKey(ownerOf(r));
    (ownerMap.get(k) ?? ownerMap.set(k, { owner: ownerOf(r), rs: [] }).get(k)!).rs.push(r);
  }
  const owners = has('assignedCounsellor')
    ? [...ownerMap.values()]
        .map(({ owner, rs }) => {
          const q = rs.filter(qualified).length;
          return {
            owner,
            leads: rs.length,
            notWorked: rs.filter(notWorked).length,
            qualified: q,
            notQualified: rs.length - q,
            totalCalls: rs.reduce((s, r) => s + (r.numbers.totalCalls ?? 0), 0),
            callsToday: rs.reduce((s, r) => s + (r.numbers.callsToday ?? 0), 0),
          };
        })
        .sort((a, b) => b.leads - a.leads || a.owner.localeCompare(b.owner))
    : [];

  // Stages in pipeline order, then by count
  const stageCounts = new Map<string, { stage: string; n: number; first: number }>();
  records.forEach((r, i) => {
    const k = groupKey(stageOf(r));
    const e = stageCounts.get(k) ?? { stage: stageOf(r), n: 0, first: i };
    e.n++;
    stageCounts.set(k, e);
  });
  const rank = (s: string) => {
    const i = STAGE_ORDER.indexOf(s.toLowerCase());
    return i < 0 ? 100 : i;
  };
  const stages = has('leadStage')
    ? [...stageCounts.values()]
        .sort((a, b) => rank(a.stage) - rank(b.stage) || b.n - a.n || a.first - b.first)
        .map((e) => ({ stage: e.stage, leads: e.n, pct: pct(e.n, total) }))
    : [];

  // Dispositions by count (ties: first appearance), blanks last
  const dispCounts = new Map<string, { d: string; n: number; first: number }>();
  let blankDisp = 0;
  records.forEach((r, i) => {
    if (!r.text.leadDisposition) {
      blankDisp++;
      return;
    }
    const k = groupKey(r.text.leadDisposition);
    const e = dispCounts.get(k) ?? { d: r.text.leadDisposition, n: 0, first: i };
    e.n++;
    dispCounts.set(k, e);
  });
  const dispositions = has('leadDisposition')
    ? [
        ...[...dispCounts.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((e) => ({ disposition: e.d, leads: e.n, pct: pct(e.n, total) })),
        ...(blankDisp ? [{ disposition: NO_DISPOSITION, leads: blankDisp, pct: pct(blankDisp, total) }] : []),
      ]
    : [];

  // Leads last worked per day
  const days = new Map<string, number>();
  let noDay = 0;
  for (const r of records) {
    const k = dayKey(r.dates.lastWorked ?? null);
    if (!k) noDay++;
    else days.set(k, (days.get(k) ?? 0) + 1);
  }
  const lastWorkedByDate = has('lastWorked')
    ? [...[...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, leads]) => ({ date, leads })), ...(noDay ? [{ date: NO_DATE, leads: noDay }] : [])]
    : [];

  // Data-driven notes (no lead names, phones or emails)
  const notes: string[] = [];
  const byName = new Map<string, LeadRecord[]>();
  for (const r of records) if (r.text.name) (byName.get(groupKey(r.text.name)) ?? byName.set(groupKey(r.text.name), []).get(groupKey(r.text.name))!).push(r);
  const repeated = [...byName.values()].filter((rs) => rs.length > 1);
  const repeatedDistinct = repeated.filter((rs) => new Set(rs.map((r) => r.phone ?? r.email ?? r.uid)).size === rs.length);
  if (repeatedDistinct.length) notes.push(`${repeatedDistinct.length} lead name(s) appear more than once but with different mobile numbers/emails, so they are kept as separate leads.`);
  if (has('leadDisposition') && has('lastCallOutcome')) {
    const withDisp = records.filter((r) => r.text.leadDisposition);
    const same = withDisp.filter((r) => eq(r.text.lastCallOutcome, r.text.leadDisposition!)).length;
    if (withDisp.length) notes.push(same === withDisp.length ? `Lead Disposition and Last Call Outcome are identical for all ${withDisp.length} leads that have one.` : `Lead Disposition and Last Call Outcome differ for ${withDisp.length - same} of ${withDisp.length} leads that have a disposition.`);
  }
  if (has('leadDisposition') && has('totalCalls')) {
    for (const o of owners) {
      const rs = ownerMap.get(groupKey(o.owner))!.rs;
      if (o.totalCalls > 0 && rs.every((r) => !r.text.leadDisposition)) notes.push(`${o.owner} logged ${o.totalCalls} calls on ${o.leads} leads but none have a disposition recorded — worth checking in Salesmax.`);
    }
  }

  const n = (field: string, v: number) => (has(field) ? v : null);
  return {
    reportDate,
    kpis: {
      totalLeads: total,
      notWorked: n('awaitingFirstTouch', records.filter(notWorked).length),
      workedAtLeastOnce: n('attempts', records.filter((r) => r.numbers.attempts !== undefined).length),
      qualified: qualAvailable ? qualifiedCount : null,
      qualificationRate: qualAvailable ? pct(qualifiedCount, total) : null,
      totalAttempts: n('attempts', sum('attempts')),
      totalCalls: n('totalCalls', sum('totalCalls')),
      callsToday: n('callsToday', sum('callsToday')),
      interested: n('leadDisposition', records.filter((r) => eq(r.text.leadDisposition, 'INTERESTED')).length),
      overdueFollowUps: n('nextFollowUpDate', fu.overdue),
      upcomingFollowUps: n('nextFollowUpDate', fu.upcoming),
      noFollowUpDate: n('nextFollowUpDate', fu.none),
    },
    owners,
    stages,
    dispositions,
    lastWorkedByDate,
    missingFields: CONTACT_FIELDS.filter((k) => !has(k)).map((k) => SALESMAX_HEADERS[k]),
    notes,
  };
}
