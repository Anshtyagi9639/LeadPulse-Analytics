import {
  classifyApplied,
  classifyClosed,
  classifyContactedFromStatus,
  classifyCounsellingAttended,
  classifyCounsellingBooked,
  classifyEnrolled,
  classifyFollowUpDone,
  classifyOffer,
  classifyQualified,
  classifyQualifiedFromStatus,
} from './classify.js';
import { analyzeDuplicates, applyDuplicateMode, DEFAULT_MATCH_RULES, type DuplicateDecision, type DuplicateMode, type MatchRules } from './dedupe.js';
import { dayKey, groupKey, isoDayToMs } from './normalize.js';
import { canonicalSource } from './sources.js';
import type { AdRecord, LeadRecord } from './validate.js';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface CampaignInput {
  id: string;
  campaignName: string | null;
  source: string | null;
  spend: number | null;
  budget: number | null;
  targetLeads: number | null;
  impressions: number | null;
  clicks: number | null;
  /** Optional previous CPL for change detection (no history is stored by the portal). */
  baselineCpl: number | null;
}

export interface ReportFileInfo {
  fileId: string;
  fileName: string;
  kind: 'leads' | 'ad_spend';
  sheet: string;
  dataRows: number;
  blankRows: number;
  accepted: number;
  rejected: number;
  rowsWithWarnings: number;
  issueCount: number;
  mappedFields: string[];
  unmappedColumns: string[];
  ambiguousDateFields: string[];
}

export interface ReportOptions {
  reportingDate: string;
  dateRange: { from: string; to: string } | null;
  dateFilter: 'include_all' | 'restrict';
  duplicateMode: DuplicateMode;
  duplicateDecisions: Record<string, DuplicateDecision>;
  cautiousMatching: boolean;
  /** Which identifiers link duplicate rows (default: all). */
  matchRules?: MatchRules;
  filters: { campaigns: string[]; sources: string[] };
  overallTargetLeads: number | null;
  overallBudget: number | null;
  currency: string;
}

export interface ReportInput {
  files: ReportFileInfo[];
  leads: LeadRecord[];
  ads: AdRecord[];
  campaignInputs: CampaignInput[];
  options: ReportOptions;
}

export interface BreakdownRow {
  key: string;
  label: string;
  leads: number;
  uniqueLeads: number;
  share: number | null;
  assigned: number;
  contacted: number;
  contactRate: number | null;
  qualified: number;
  unqualified: number;
  qualificationRate: number | null;
  applications: number;
  applicationRate: number | null;
  offers: number;
  enrolments: number;
  enrolmentRate: number | null;
  revenue: number | null;
  spend: number | null;
  cpl: number | null;
  costPerQualified: number | null;
  costPerApplication: number | null;
  costPerEnrolment: number | null;
  targetLeads: number | null;
  targetAchievement: number | null;
  budget: number | null;
  budgetUtilisation: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  baselineCpl: number | null;
  cplChange: number | null;
  duplicateRows: number;
}

export interface CounsellorRow {
  counsellor: string;
  leads: number;
  contacted: number;
  contactRate: number | null;
  qualified: number;
  qualificationRate: number | null;
  medianFirstResponseMinutes: number | null;
  followUpsDue: number;
  followUpsCompleted: number;
  followUpsOverdue: number;
  followUpCompletion: number | null;
  counsellingBooked: number;
  counsellingAttended: number;
  applications: number;
  enrolments: number;
}

export interface FileSummaryRow extends ReportFileInfo {
  inReport: number;
  uniqueLeads: number;
  duplicateRows: number;
  qualified: number;
  applications: number;
  enrolments: number;
  outOfPeriod: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number | null;
  available: boolean;
  /** Share of report rows whose source file maps the fields this stage needs (0–100). */
  coverage: number;
  pctOfReceived: number | null;
  pctOfPrevious: number | null;
  note?: string;
}

export interface Note {
  level: 'info' | 'warning';
  message: string;
}

export interface Report {
  generatedAt: string;
  reportingDate: string;
  period: { from: string; to: string; isRange: boolean };
  currency: string;
  settings: Pick<ReportOptions, 'dateFilter' | 'duplicateMode' | 'cautiousMatching' | 'filters'>;
  scope: { fileIds: string[]; fileNames: string[]; leadFiles: number; adFiles: number };
  /** All campaign/source labels in the period before campaign/source filters, for filter pickers. */
  filterOptions: { campaigns: string[]; sources: string[] };
  counts: {
    rawRows: number;
    blankRows: number;
    acceptedRows: number;
    rejectedRows: number;
    rowsWithWarnings: number;
    leadsOutsidePeriod: number;
    excludedOutsidePeriod: number;
    missingCreatedDate: number;
    filteredOut: number;
    inScopeRows: number;
    uniqueLeads: number;
    reportedLeads: number;
    duplicateRows: number;
    duplicateRowsExcluded: number;
    possibleDuplicateRows: number;
    pendingReviewGroups: number;
  };
  overview: {
    totalLeads: number;
    uniqueLeads: number;
    qualifiedLeads: number | null;
    totalSpend: number | null;
    cpl: number | null;
    applications: number | null;
    enrolments: number | null;
    targetAchievement: number | null;
  };
  marketing: {
    totalSpend: number | null;
    attributableSpend: number | null;
    unattributedSpend: number | null;
    attributableLeads: number | null;
    cpl: number | null;
    costPerQualified: number | null;
    targetLeads: number | null;
    targetAchievement: number | null;
    budget: number | null;
    budgetUtilisation: number | null;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    cpc: number | null;
    cpm: number | null;
    undatedSpendRows: number;
    spendOutsidePeriod: number;
  };
  sales: {
    assigned: number | null;
    contacted: number | null;
    contactRate: number | null;
    qualified: number | null;
    unqualified: number | null;
    pendingQualification: number | null;
    qualificationRate: number | null;
    firstResponse: { count: number; medianMinutes: number | null; averageMinutes: number | null; within1hPct: number | null } | null;
    followUpsDue: number | null;
    followUpsDueInPeriod: number | null;
    followUpsCompleted: number | null;
    followUpsOverdue: number | null;
    followUpCompletion: number | null;
    counsellingBooked: number | null;
    counsellingAttended: number | null;
  };
  conversion: {
    applications: number | null;
    applicationRate: number | null;
    offers: number | null;
    enrolments: number | null;
    enrolmentRate: number | null;
    revenue: number | null;
    costPerApplication: number | null;
    costPerEnrolment: number | null;
  };
  dataQuality: {
    duplicateRate: number | null;
    invalidRecords: number;
    rejectedRows: number;
    rowsWithWarnings: number;
    missingPhone: number;
    invalidPhone: number;
    missingEmail: number;
    invalidEmail: number;
    missingCampaign: number;
    missingSource: number;
    missingCounsellor: number;
    missingFollowUpDate: number;
    missingLeadStatus: number;
    missingConversionStatus: number;
    missingCreatedDate: number;
    negativeResponseTimes: number;
    conflictingRecords: number;
    missingIdRows: number;
    unidentifiableRows: number;
    unmappedColumns: { fileName: string; columns: string[] }[];
  };
  files: FileSummaryRow[];
  campaigns: BreakdownRow[];
  sources: BreakdownRow[];
  dimensions: {
    medium: BreakdownRow[];
    country: BreakdownRow[];
    course: BreakdownRow[];
    studyLevel: BreakdownRow[];
  };
  counsellors: CounsellorRow[];
  funnel: FunnelStage[];
  /** Record-level quality: total / valid / duplicate / invalid, for KPI cards and charts. */
  quality: {
    totalRecords: number;
    validLeads: number;
    duplicateLeads: number;
    possibleDuplicates: number;
    invalidLeads: number;
    leadsWithWarnings: number;
    validationSuccessRate: number | null;
  };
  /** Leads over time by Lead Created Date: per hour for a single day, per day for a range. */
  trend: { granularity: 'hour' | 'day'; points: { bucket: string; leads: number; qualified: number }[]; undated: number };
  /** Lead Status values (top 7, the rest folded into "Other"). */
  statusDistribution: { status: string; leads: number }[];
  duplicates: {
    byFile: { fileName: string; duplicateRows: number; possibleDuplicateRows: number }[];
    byCampaign: { campaign: string; duplicateRows: number; possibleDuplicateRows: number }[];
    confirmedGroups: number;
    possibleGroups: number;
  };
  /** metric key -> reason it is unavailable */
  unavailable: Record<string, string>;
  notes: Note[];
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Percentage, or null when the denominator is zero/unknown. */
export function pct(num: number | null, den: number | null): number | null {
  if (num === null || den === null || !Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return round((num / den) * 100);
}

/** Ratio (e.g. cost per X), or null when the denominator is zero/unknown. */
export function ratio(num: number | null, den: number | null): number | null {
  if (num === null || den === null || !Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return round(num / den);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const NO_CAMPAIGN = '(No campaign)';
const NO_SOURCE = '(No source)';
const UNASSIGNED = '(Unassigned)';

export function campaignLabel(r: LeadRecord): string {
  return r.text.campaignName ?? r.text.utmCampaign ?? NO_CAMPAIGN;
}
export function sourceLabel(r: LeadRecord): string {
  return canonicalSource(r.text.source) ?? NO_SOURCE;
}

interface LeadFlags {
  assigned: boolean;
  contacted: boolean;
  qualified: boolean | null;
  counsellingBooked: boolean;
  counsellingAttended: boolean;
  applied: boolean;
  offer: boolean;
  enrolled: boolean;
  closed: boolean;
  responseMinutes: number | null;
  negativeResponse: boolean;
  followUpDue: boolean;
  followUpDueInPeriod: boolean;
  followUpCompleted: boolean;
  followUpOverdue: boolean;
}

export function leadFlags(r: LeadRecord, period: { fromMs: number; toMs: number }): LeadFlags {
  const t = r.text;
  const d = r.dates;
  const qualified =
    classifyQualified(t.qualificationStatus ?? null) ??
    classifyQualified(t.leadQuality ?? null) ??
    classifyQualifiedFromStatus(t.leadStage ?? null) ??
    classifyQualifiedFromStatus(t.leadStatus ?? null) ??
    (t.unqualifiedReason ? false : null);
  const notWorked = /^not[_\s-]?worked$/i.test(t.awaitingFirstTouch ?? '');
  const contacted =
    !notWorked &&
    Boolean(d.firstContactAt || d.lastContactDate || d.startedWorkOn || (r.numbers.attempts ?? 0) > 0 || classifyContactedFromStatus(t.leadStatus ?? null) === true);
  const closed = classifyClosed(t.leadStatus ?? null) || Boolean(t.lostReason);

  let responseMinutes: number | null = null;
  let negativeResponse = false;
  if (d.firstContactAt?.hasTime && d.leadCreatedDate?.hasTime) {
    const m = (d.firstContactAt.ms - d.leadCreatedDate.ms) / 60000;
    if (m < 0) negativeResponse = true;
    else responseMinutes = m;
  }

  const endOfPeriod = period.toMs + 86400000 - 1;
  const fu = d.nextFollowUpDate;
  const fuDay = fu ? isoDayToMs(dayKey(fu)!) : null;
  const followUpDue = fuDay !== null && fuDay <= period.toMs;
  const followUpDueInPeriod = fuDay !== null && fuDay >= period.fromMs && fuDay <= period.toMs;
  let followUpCompleted = false;
  if (followUpDue) {
    const last = d.lastContactDate ? isoDayToMs(dayKey(d.lastContactDate)!) : null;
    if (last !== null) followUpCompleted = last >= fuDay! && last <= endOfPeriod;
    else if (t.followUpOutcome) followUpCompleted = classifyFollowUpDone(t.followUpOutcome) === true;
  }
  const followUpOverdue = followUpDue && !followUpCompleted && fuDay! < period.toMs && !closed;

  return {
    assigned: Boolean(t.assignedCounsellor || d.assignedAt),
    contacted,
    qualified,
    counsellingBooked: classifyCounsellingBooked(t.counsellingStatus ?? null) === true,
    counsellingAttended: classifyCounsellingAttended(t.counsellingStatus ?? null) === true,
    applied: Boolean(d.applicationDate) || classifyApplied(t.applicationStatus ?? null) === true,
    offer: classifyOffer(t.offerStatus ?? null) === true,
    enrolled: Boolean(d.enrolmentDate) || classifyEnrolled(t.enrolmentStatus ?? null) === true,
    closed,
    responseMinutes,
    negativeResponse,
    followUpDue,
    followUpDueInPeriod,
    followUpCompleted,
    followUpOverdue,
  };
}

interface SpendBucket {
  label: string;
  spend: number;
  budget: number | null;
  targetLeads: number | null;
  impressions: number | null;
  clicks: number | null;
  baselineCpl: number | null;
  source: string | null;
}

const addNullable = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export function buildReport(input: ReportInput): Report {
  const { options } = input;
  const from = options.dateRange?.from ?? options.reportingDate;
  const to = options.dateRange?.to ?? options.reportingDate;
  const period = { fromMs: isoDayToMs(from), toMs: isoDayToMs(to) };
  const inPeriod = (ms: number) => ms >= period.fromMs && ms < period.toMs + 86400000;
  const notes: Note[] = [];
  const unavailable: Record<string, string> = {};

  const leadFiles = input.files.filter((f) => f.kind === 'leads');
  const adFiles = input.files.filter((f) => f.kind === 'ad_spend');
  const mappedByFile = new Map(input.files.map((f) => [f.fileId, new Set(f.mappedFields)]));
  const fileMaps = (r: LeadRecord, keys: string[]) => keys.some((k) => mappedByFile.get(r.fileId)?.has(k));

  // 1) Reporting-period handling
  let leadsOutsidePeriod = 0;
  let missingCreatedDate = 0;
  const outOfPeriodByFile = new Map<string, number>();
  const dated = input.leads.filter((r) => {
    const c = r.dates.leadCreatedDate;
    if (!c) {
      missingCreatedDate++;
      return true;
    }
    if (inPeriod(c.ms)) return true;
    leadsOutsidePeriod++;
    outOfPeriodByFile.set(r.fileId, (outOfPeriodByFile.get(r.fileId) ?? 0) + 1);
    return options.dateFilter === 'include_all';
  });
  const excludedOutsidePeriod = input.leads.length - dated.length;
  const periodLabel = from === to ? from : `${from} to ${to}`;
  if (leadsOutsidePeriod > 0) {
    notes.push({
      level: 'warning',
      message:
        options.dateFilter === 'restrict'
          ? `${leadsOutsidePeriod} lead row(s) were created outside ${periodLabel} and were excluded from this report.`
          : `${leadsOutsidePeriod} lead row(s) were created outside ${periodLabel} but are included. Switch the date filter to "Reporting period only" to exclude them.`,
    });
  }
  if (missingCreatedDate > 0) {
    notes.push({ level: 'info', message: `${missingCreatedDate} lead row(s) have no Lead Created Date; they are included but cannot be checked against the reporting period.` });
  }

  // 2) Campaign / source filters
  const campaignFilter = new Set(options.filters.campaigns.map(groupKey));
  const sourceFilter = new Set(options.filters.sources.map(groupKey));
  const scoped = dated.filter(
    (r) => (!campaignFilter.size || campaignFilter.has(groupKey(campaignLabel(r)))) && (!sourceFilter.size || sourceFilter.has(groupKey(sourceLabel(r)))),
  );
  const filteredOut = dated.length - scoped.length;

  // 3) Duplicates
  const rules = options.matchRules ?? DEFAULT_MATCH_RULES;
  const dup = analyzeDuplicates(scoped, { cautiousMatching: options.cautiousMatching, rules });
  const working = applyDuplicateMode(scoped, dup, options.duplicateMode, options.duplicateDecisions);
  const W = working.records;
  if (options.duplicateMode === 'manual_review' && working.pendingReviewGroups > 0) {
    notes.push({ level: 'warning', message: `${working.pendingReviewGroups} duplicate group(s) are awaiting manual review; their rows are currently all counted.` });
  }
  const flags = new Map(W.map((r) => [r.uid, leadFlags(r, period)]));
  const F = (r: LeadRecord) => flags.get(r.uid)!;

  // Field availability across the working set.
  const coverage = (keys: string[]) => (W.length ? (W.filter((r) => fileMaps(r, keys)).length / W.length) * 100 : 0);
  const avail = {
    assigned: coverage(['assignedCounsellor', 'assignedAt']),
    contacted: coverage(['firstContactAt', 'lastContactDate', 'leadStatus', 'attempts', 'startedWorkOn', 'awaitingFirstTouch']),
    qualified: coverage(['qualificationStatus', 'leadQuality', 'leadStage', 'leadStatus', 'unqualifiedReason']),
    counselling: coverage(['counsellingStatus']),
    applied: coverage(['applicationStatus', 'applicationDate']),
    offer: coverage(['offerStatus']),
    enrolled: coverage(['enrolmentStatus', 'enrolmentDate']),
    response: coverage(['firstContactAt']) && coverage(['leadCreatedDate']) ? Math.min(coverage(['firstContactAt']), coverage(['leadCreatedDate'])) : 0,
    followUp: coverage(['nextFollowUpDate']),
    revenue: coverage(['revenue']),
  };
  const ifAvail = <T>(key: keyof typeof avail, metric: string, value: T, label: string): T | null => {
    if (avail[key] > 0) {
      if (avail[key] < 100) {
        const msg = `${label} is mapped for only ${round(avail[key], 0)}% of report rows; ${label.toLowerCase()} figures cover those rows only.`;
        if (!notes.some((n) => n.message === msg)) notes.push({ level: 'warning', message: msg });
      }
      return value;
    }
    unavailable[metric] = `${label} columns are not mapped in the processed files.`;
    return null;
  };

  const count = (rs: LeadRecord[], pred: (f: LeadFlags) => boolean) => rs.reduce((n, r) => n + (pred(F(r)) ? 1 : 0), 0);

  // 4) Spend
  let undatedSpendRows = 0;
  let spendOutsidePeriod = 0;
  const campaignSpend = new Map<string, SpendBucket>();
  const sourceSpend = new Map<string, SpendBucket>();
  const addSpend = (e: { campaignName: string | null; source: string | null; spend: number | null; budget: number | null; targetLeads: number | null; impressions: number | null; clicks: number | null; baselineCpl?: number | null }) => {
    const src = canonicalSource(e.source);
    const target = e.campaignName ? campaignSpend : sourceSpend;
    const label = e.campaignName ?? src ?? NO_SOURCE;
    const k = groupKey(label);
    const b = target.get(k) ?? { label, spend: 0, budget: null, targetLeads: null, impressions: null, clicks: null, baselineCpl: null, source: src };
    b.spend += e.spend ?? 0;
    b.budget = addNullable(b.budget, e.budget);
    b.targetLeads = addNullable(b.targetLeads, e.targetLeads);
    b.impressions = addNullable(b.impressions, e.impressions);
    b.clicks = addNullable(b.clicks, e.clicks);
    if (e.baselineCpl !== undefined && e.baselineCpl !== null) b.baselineCpl = e.baselineCpl;
    if (!b.source && src) b.source = src;
    target.set(k, b);
  };
  for (const a of input.ads) {
    if (a.date && !inPeriod(a.date.ms)) {
      spendOutsidePeriod++;
      continue;
    }
    if (!a.date) undatedSpendRows++;
    addSpend(a);
  }
  for (const c of input.campaignInputs) addSpend(c);
  if (spendOutsidePeriod) notes.push({ level: 'warning', message: `${spendOutsidePeriod} advertising row(s) are dated outside ${periodLabel} and were not counted, so spend and leads are not mixed across periods.` });
  if (undatedSpendRows) notes.push({ level: 'info', message: `${undatedSpendRows} advertising row(s) have no date and were assumed to belong to ${periodLabel}.` });

  // Apply campaign/source filters to spend as well.
  for (const [k, b] of [...campaignSpend]) if ((campaignFilter.size && !campaignFilter.has(k)) || (sourceFilter.size && b.source && !sourceFilter.has(groupKey(b.source)))) campaignSpend.delete(k);
  for (const [k] of [...sourceSpend]) if ((sourceFilter.size && !sourceFilter.has(k)) || campaignFilter.size) sourceSpend.delete(k);

  const hasSpend = campaignSpend.size + sourceSpend.size > 0;
  const totalSpend = hasSpend ? [...campaignSpend.values(), ...sourceSpend.values()].reduce((s, b) => s + b.spend, 0) : null;

  // Attribution: a lead is attributable if its campaign has campaign-level spend, or its source has source-level spend.
  const attributedTo = (r: LeadRecord): 'campaign' | 'source' | null => {
    if (campaignSpend.has(groupKey(campaignLabel(r)))) return 'campaign';
    if (sourceSpend.has(groupKey(sourceLabel(r)))) return 'source';
    return null;
  };
  const attributable = W.filter((r) => attributedTo(r) !== null);
  const leadCampaignKeys = new Set(W.map((r) => groupKey(campaignLabel(r))));
  const leadSourceKeys = new Set(W.map((r) => groupKey(sourceLabel(r))));
  let attributableSpend = 0;
  const unmatchedSpend: string[] = [];
  for (const [k, b] of campaignSpend) {
    if (leadCampaignKeys.has(k)) attributableSpend += b.spend;
    else if (b.spend > 0) unmatchedSpend.push(b.label);
  }
  for (const [k, b] of sourceSpend) {
    if (leadSourceKeys.has(k)) attributableSpend += b.spend;
    else if (b.spend > 0) unmatchedSpend.push(b.label);
  }
  if (unmatchedSpend.length) {
    notes.push({ level: 'warning', message: `Spend for ${unmatchedSpend.length} campaign/source(s) has no matching leads in this report (${unmatchedSpend.slice(0, 5).join(', ')}${unmatchedSpend.length > 5 ? ', …' : ''}). It is included in total spend but excluded from CPL.` });
  }
  for (const [k, b] of sourceSpend) {
    const overlapping = [...campaignSpend.values()].filter((c) => c.source && groupKey(c.source) === k);
    if (overlapping.length) notes.push({ level: 'warning', message: `${b.label} has both a source-level spend total and campaign-level spend. Check that the same spend is not entered twice.` });
  }
  if (!hasSpend) unavailable.cpl = unavailable.totalSpend = unavailable.costPerQualified = 'No advertising spend was provided (upload an ad-spend file or enter campaign spend).';

  const qualifiedAttr = count(attributable, (f) => f.qualified === true);
  const appsAttr = count(attributable, (f) => f.applied);
  const enrolAttr = count(attributable, (f) => f.enrolled);

  // 5) Breakdown builder
  const reportedLeads = W.length;
  const scopedByUid = new Map(scoped.map((r) => [r.uid, r]));
  const dupByLabel = (labelFn: (r: LeadRecord) => string) => {
    const m = new Map<string, number>();
    for (const uid of working.excludedUids) {
      const r = scopedByUid.get(uid);
      if (r) m.set(groupKey(labelFn(r)), (m.get(groupKey(labelFn(r))) ?? 0) + 1);
    }
    return m;
  };

  const breakdown = (labelFn: (r: LeadRecord) => string, spendMap: Map<string, SpendBucket> | null, spendForGroup?: (key: string, rs: LeadRecord[]) => SpendBucket | null): BreakdownRow[] => {
    const groups = new Map<string, { label: string; rs: LeadRecord[] }>();
    for (const r of W) {
      const label = labelFn(r);
      const k = groupKey(label);
      const g = groups.get(k) ?? { label, rs: [] };
      g.rs.push(r);
      groups.set(k, g);
    }
    // Campaigns that have spend but no leads still appear (with zero leads) so spend is never hidden.
    if (spendMap) for (const [k, b] of spendMap) if (!groups.has(k)) groups.set(k, { label: b.label, rs: [] });
    const scopedGroups = new Map<string, LeadRecord[]>();
    for (const r of scoped) {
      const k = groupKey(labelFn(r));
      const arr = scopedGroups.get(k) ?? [];
      arr.push(r);
      scopedGroups.set(k, arr);
    }
    const scopedUnique = (k: string) => {
      const keyed = scopedGroups.get(k);
      return keyed?.length ? analyzeDuplicates(keyed, { rules }).uniqueLeads : 0;
    };
    const dupMap = dupByLabel(labelFn);
    const rows: BreakdownRow[] = [...groups.entries()].map(([k, { label, rs }]) => {
      const b = spendForGroup ? spendForGroup(k, rs) : (spendMap?.get(k) ?? null);
      const leads = rs.length;
      const qualified = count(rs, (f) => f.qualified === true);
      const unqualified = count(rs, (f) => f.qualified === false);
      const assigned = count(rs, (f) => f.assigned);
      const contacted = count(rs, (f) => f.contacted);
      const applications = count(rs, (f) => f.applied);
      const enrolments = count(rs, (f) => f.enrolled);
      const revenue = avail.revenue > 0 ? rs.reduce((s, r) => s + (r.revenue ?? 0), 0) : null;
      const spend = b ? b.spend : null;
      const cpl = ratio(spend, leads);
      return {
        key: k,
        label,
        leads,
        uniqueLeads: scopedUnique(k),
        share: pct(leads, reportedLeads),
        assigned,
        contacted,
        contactRate: pct(contacted, assigned),
        qualified,
        unqualified,
        qualificationRate: pct(qualified, qualified + unqualified),
        applications,
        applicationRate: pct(applications, leads),
        offers: count(rs, (f) => f.offer),
        enrolments,
        enrolmentRate: pct(enrolments, leads),
        revenue,
        spend,
        cpl,
        costPerQualified: ratio(spend, qualified),
        costPerApplication: ratio(spend, applications),
        costPerEnrolment: ratio(spend, enrolments),
        targetLeads: b?.targetLeads ?? null,
        targetAchievement: pct(leads, b?.targetLeads ?? null),
        budget: b?.budget ?? null,
        budgetUtilisation: pct(spend, b?.budget ?? null),
        impressions: b?.impressions ?? null,
        clicks: b?.clicks ?? null,
        ctr: pct(b?.clicks ?? null, b?.impressions ?? null),
        cpc: ratio(spend, b?.clicks ?? null),
        cpm: b?.impressions ? round((b.spend / b.impressions) * 1000) : null,
        baselineCpl: b?.baselineCpl ?? null,
        cplChange: cpl !== null && b?.baselineCpl ? pct(cpl - b.baselineCpl, b.baselineCpl) : null,
        duplicateRows: dupMap.get(k) ?? 0,
      };
    });
    return rows.sort((a, b) => b.leads - a.leads || (b.spend ?? 0) - (a.spend ?? 0) || a.label.localeCompare(b.label));
  };

  const campaigns = breakdown(campaignLabel, campaignSpend);
  // Source spend = source-level entries + campaign-level spend whose declared source (or the majority source of its leads) is that source.
  const sourceTallyByCampaign = new Map<string, Map<string, number>>();
  for (const r of W) {
    const ck = groupKey(campaignLabel(r));
    const tally = sourceTallyByCampaign.get(ck) ?? new Map<string, number>();
    const sk = groupKey(sourceLabel(r));
    tally.set(sk, (tally.get(sk) ?? 0) + 1);
    sourceTallyByCampaign.set(ck, tally);
  }
  const campaignSourceKey = new Map<string, string>();
  for (const [ck, cb] of campaignSpend) {
    if (cb.source) campaignSourceKey.set(ck, groupKey(cb.source));
    else {
      const tally = sourceTallyByCampaign.get(ck);
      if (tally) campaignSourceKey.set(ck, [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
  }
  const sourceSpendFor = (k: string, rs: LeadRecord[]): SpendBucket | null => {
    let bucket: SpendBucket | null = sourceSpend.get(k) ? { ...sourceSpend.get(k)! } : null;
    for (const [ck, cb] of campaignSpend) {
      if (campaignSourceKey.get(ck) !== k) continue;
      bucket ??= { label: rs[0] ? sourceLabel(rs[0]) : cb.label, spend: 0, budget: null, targetLeads: null, impressions: null, clicks: null, baselineCpl: null, source: null };
      bucket.spend += cb.spend;
      bucket.budget = addNullable(bucket.budget, cb.budget);
      bucket.targetLeads = addNullable(bucket.targetLeads, cb.targetLeads);
      bucket.impressions = addNullable(bucket.impressions, cb.impressions);
      bucket.clicks = addNullable(bucket.clicks, cb.clicks);
    }
    return bucket;
  };
  const sources = breakdown(sourceLabel, sourceSpend, sourceSpendFor);

  // 6) Counsellors
  const counsellorGroups = new Map<string, LeadRecord[]>();
  for (const r of W) {
    const c = r.text.assignedCounsellor ?? UNASSIGNED;
    const k = groupKey(c);
    const arr = counsellorGroups.get(k) ?? [];
    arr.push(r);
    counsellorGroups.set(k, arr);
  }
  const counsellors: CounsellorRow[] =
    avail.assigned > 0
      ? [...counsellorGroups.values()]
          .map((rs) => {
            const qualified = count(rs, (f) => f.qualified === true);
            const unq = count(rs, (f) => f.qualified === false);
            const contacted = count(rs, (f) => f.contacted);
            const due = count(rs, (f) => f.followUpDue);
            const done = count(rs, (f) => f.followUpDue && f.followUpCompleted);
            const resp = rs.map((r) => F(r).responseMinutes).filter((x): x is number => x !== null);
            const med = median(resp);
            return {
              counsellor: rs[0].text.assignedCounsellor ?? UNASSIGNED,
              leads: rs.length,
              contacted,
              contactRate: pct(contacted, rs.length),
              qualified,
              qualificationRate: pct(qualified, qualified + unq),
              medianFirstResponseMinutes: med === null ? null : round(med, 1),
              followUpsDue: due,
              followUpsCompleted: done,
              followUpsOverdue: count(rs, (f) => f.followUpOverdue),
              followUpCompletion: pct(done, due),
              counsellingBooked: count(rs, (f) => f.counsellingBooked),
              counsellingAttended: count(rs, (f) => f.counsellingAttended),
              applications: count(rs, (f) => f.applied),
              enrolments: count(rs, (f) => f.enrolled),
            };
          })
          .sort((a, b) => b.leads - a.leads || a.counsellor.localeCompare(b.counsellor))
      : [];

  // 7) Headline metrics
  const assigned = count(W, (f) => f.assigned);
  const contacted = count(W, (f) => f.contacted);
  const contactedAssigned = count(W, (f) => f.assigned && f.contacted);
  const qualified = count(W, (f) => f.qualified === true);
  const unqualified = count(W, (f) => f.qualified === false);
  const pendingQ = count(W, (f) => f.qualified === null);
  const apps = count(W, (f) => f.applied);
  const offers = count(W, (f) => f.offer);
  const enrol = count(W, (f) => f.enrolled);
  const fuDue = count(W, (f) => f.followUpDue);
  const fuDone = count(W, (f) => f.followUpDue && f.followUpCompleted);
  const responses = W.map((r) => F(r).responseMinutes).filter((x): x is number => x !== null);
  const negativeResponseTimes = W.filter((r) => F(r).negativeResponse).length;
  if (negativeResponseTimes) notes.push({ level: 'warning', message: `${negativeResponseTimes} lead(s) have a first-contact time earlier than the lead-created time and were excluded from response-time figures.` });
  if (avail.response === 0 && coverage(['firstContactAt']) > 0) unavailable.firstResponse = 'First-response time needs both Lead Created and First Contact timestamps with a time of day.';

  const qualifiedVal = ifAvail('qualified', 'qualifiedLeads', qualified, 'Qualification');
  const appsVal = ifAvail('applied', 'applications', apps, 'Application');
  const enrolVal = ifAvail('enrolled', 'enrolments', enrol, 'Enrolment');

  const adTotals = [...campaignSpend.values(), ...sourceSpend.values()];
  const sumField = (f: 'budget' | 'targetLeads' | 'impressions' | 'clicks') => adTotals.reduce<number | null>((s, b) => addNullable(s, b[f]), null);
  const impressions = sumField('impressions');
  const clicks = sumField('clicks');
  const campaignTargets = sumField('targetLeads');
  const targetLeads = options.overallTargetLeads ?? campaignTargets;
  let targetActual = reportedLeads;
  if (options.overallTargetLeads === null && campaignTargets !== null) {
    // Only leads from campaigns/sources that have a target count against campaign targets.
    const targeted = new Set([...campaignSpend.entries()].filter(([, b]) => b.targetLeads !== null).map(([k]) => k));
    const targetedSources = new Set([...sourceSpend.entries()].filter(([, b]) => b.targetLeads !== null).map(([k]) => k));
    targetActual = W.filter((r) => targeted.has(groupKey(campaignLabel(r))) || targetedSources.has(groupKey(sourceLabel(r)))).length;
  }
  const targetAchievement = pct(targetLeads === null ? null : targetActual, targetLeads);
  if (targetLeads === null) unavailable.targetAchievement = 'No lead target was entered.';
  const budgetEntries = adTotals.filter((b) => b.budget !== null);
  const budget = options.overallBudget ?? (budgetEntries.length ? budgetEntries.reduce((s, b) => s + (b.budget ?? 0), 0) : null);
  const budgetSpend = options.overallBudget !== null ? totalSpend : budgetEntries.reduce((s, b) => s + b.spend, 0);
  if (budget === null) unavailable.budgetUtilisation = 'No budget was entered.';
  if (impressions === null) unavailable.ctr = unavailable.cpm = 'Impressions were not provided.';
  if (clicks === null) unavailable.cpc = unavailable.ctr ??= 'Clicks were not provided.';

  const cpl = hasSpend ? ratio(attributableSpend, attributable.length) : null;
  const filesSummary: FileSummaryRow[] = input.files.map((f) => {
    const rs = W.filter((r) => r.fileId === f.fileId);
    const fdup = dup.byFile[f.fileName];
    return {
      ...f,
      inReport: rs.length,
      uniqueLeads: f.kind === 'leads' ? analyzeDuplicates(scoped.filter((r) => r.fileId === f.fileId), { rules }).uniqueLeads : 0,
      duplicateRows: fdup?.duplicateRows ?? 0,
      qualified: count(rs, (x) => x.qualified === true),
      applications: count(rs, (x) => x.applied),
      enrolments: count(rs, (x) => x.enrolled),
      outOfPeriod: outOfPeriodByFile.get(f.fileId) ?? 0,
    };
  });
  for (const f of input.files) {
    if (f.ambiguousDateFields.length) notes.push({ level: 'info', message: `${f.fileName}: dates in ${f.ambiguousDateFields.join(', ')} could be day-first or month-first and were read as day/month/year.` });
  }

  // 8) Funnel
  const stageDefs: { key: string; label: string; availKey: keyof typeof avail | null; pred: (f: LeadFlags) => boolean }[] = [
    { key: 'received', label: 'Received', availKey: null, pred: () => true },
    { key: 'assigned', label: 'Assigned', availKey: 'assigned', pred: (f) => f.assigned },
    { key: 'contacted', label: 'Contacted', availKey: 'contacted', pred: (f) => f.contacted },
    { key: 'qualified', label: 'Qualified', availKey: 'qualified', pred: (f) => f.qualified === true },
    { key: 'counselling', label: 'Counselling', availKey: 'counselling', pred: (f) => f.counsellingBooked },
    { key: 'applied', label: 'Applied', availKey: 'applied', pred: (f) => f.applied },
    { key: 'offer', label: 'Offer Received', availKey: 'offer', pred: (f) => f.offer },
    { key: 'enrolled', label: 'Enrolled', availKey: 'enrolled', pred: (f) => f.enrolled },
  ];
  let prev: number | null = null;
  const funnel: FunnelStage[] = stageDefs.map((s) => {
    const cov = s.availKey ? avail[s.availKey] : 100;
    const available = cov > 0;
    const c = available ? count(W, s.pred) : null;
    const stage: FunnelStage = {
      key: s.key,
      label: s.label,
      count: c,
      available,
      coverage: round(cov, 1),
      pctOfReceived: c === null ? null : pct(c, reportedLeads),
      pctOfPrevious: c === null || prev === null ? null : pct(c, prev),
      note: !available ? 'Not available: required columns are not mapped.' : cov < 100 ? `Mapped for ${round(cov, 0)}% of rows.` : undefined,
    };
    if (c !== null) {
      if (prev !== null && c > prev) stage.note = `${stage.note ? `${stage.note} ` : ''}Higher than the previous stage — stages are recorded independently in the source data.`;
      prev = c;
    }
    return stage;
  });

  // 9) Data quality
  const scopedFlags = (r: LeadRecord) => flags.get(r.uid) ?? leadFlags(r, period);
  const rejectedRows = leadFiles.reduce((s, f) => s + f.rejected, 0) + adFiles.reduce((s, f) => s + f.rejected, 0);
  const rowsWithWarnings = input.files.reduce((s, f) => s + f.rowsWithWarnings, 0);
  const dataQuality: Report['dataQuality'] = {
    duplicateRate: pct(dup.duplicateRows, dup.totalRows),
    invalidRecords: rejectedRows,
    rejectedRows,
    rowsWithWarnings,
    missingPhone: scoped.filter((r) => !r.phoneProvided).length,
    invalidPhone: scoped.filter((r) => r.phoneProvided && !r.phoneValid).length,
    missingEmail: scoped.filter((r) => !r.emailProvided).length,
    invalidEmail: scoped.filter((r) => r.emailProvided && !r.emailValid).length,
    missingCampaign: scoped.filter((r) => campaignLabel(r) === NO_CAMPAIGN).length,
    missingSource: scoped.filter((r) => sourceLabel(r) === NO_SOURCE).length,
    missingCounsellor: scoped.filter((r) => !r.text.assignedCounsellor).length,
    missingFollowUpDate: scoped.filter((r) => !r.dates.nextFollowUpDate && !scopedFlags(r).closed && !scopedFlags(r).enrolled).length,
    missingLeadStatus: scoped.filter((r) => !r.text.leadStatus).length,
    missingConversionStatus: scoped.filter((r) => !r.text.applicationStatus && !r.text.enrolmentStatus && !r.dates.applicationDate && !r.dates.enrolmentDate).length,
    missingCreatedDate,
    negativeResponseTimes,
    conflictingRecords: dup.conflictingRecords,
    missingIdRows: dup.missingIdRows,
    unidentifiableRows: dup.unidentifiableRows,
    unmappedColumns: input.files.filter((f) => f.unmappedColumns.length).map((f) => ({ fileName: f.fileName, columns: f.unmappedColumns })),
  };

  const dimension = (field: string) => (W.some((r) => fileMaps(r, [field])) ? breakdown((r) => r.text[field] ?? '(Not specified)', null) : []);

  if (!leadFiles.length) notes.push({ level: 'warning', message: 'No lead files are included in this report.' });

  // Record-level quality
  const rawLeadRows = leadFiles.reduce((s, f) => s + f.dataRows, 0);
  const leadRejected = leadFiles.reduce((s, f) => s + f.rejected, 0);
  const quality: Report['quality'] = {
    totalRecords: rawLeadRows,
    validLeads: dup.uniqueLeads,
    duplicateLeads: dup.duplicateRows,
    possibleDuplicates: dup.possibleDuplicateRows,
    invalidLeads: leadRejected,
    leadsWithWarnings: leadFiles.reduce((s, f) => s + f.rowsWithWarnings, 0),
    validationSuccessRate: pct(rawLeadRows - leadRejected, rawLeadRows),
  };

  // Trend by created date
  const granularity: 'hour' | 'day' = from === to ? 'hour' : 'day';
  const buckets = new Map<string, { leads: number; qualified: number }>();
  let undated = 0;
  for (const r of W) {
    const c = r.dates.leadCreatedDate;
    if (!c || (granularity === 'hour' && !c.hasTime)) {
      undated++;
      continue;
    }
    const iso = new Date(c.ms).toISOString();
    const key = granularity === 'hour' ? `${iso.slice(0, 13)}:00` : iso.slice(0, 10);
    const b = buckets.get(key) ?? { leads: 0, qualified: 0 };
    b.leads++;
    if (F(r).qualified === true) b.qualified++;
    buckets.set(key, b);
  }
  if (granularity === 'day') {
    // Fill empty days inside the period so gaps are visible.
    for (let ms = period.fromMs; ms <= period.toMs && buckets.size < 400; ms += 86400000) {
      const k = new Date(ms).toISOString().slice(0, 10);
      if (!buckets.has(k)) buckets.set(k, { leads: 0, qualified: 0 });
    }
  }
  const trend: Report['trend'] = {
    granularity,
    points: [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, v]) => ({ bucket, ...v })),
    undated,
  };

  // Lead status distribution
  const statusCounts = new Map<string, { label: string; n: number }>();
  for (const r of W) {
    const label = r.text.leadStatus ?? '(No status)';
    const k = groupKey(label);
    const e = statusCounts.get(k) ?? { label, n: 0 };
    e.n++;
    statusCounts.set(k, e);
  }
  const sortedStatus = [...statusCounts.values()].sort((a, b) => b.n - a.n);
  const statusDistribution = sortedStatus.slice(0, 7).map((e) => ({ status: e.label, leads: e.n }));
  const rest = sortedStatus.slice(7).reduce((s, e) => s + e.n, 0);
  if (rest) statusDistribution.push({ status: 'Other', leads: rest });

  return {
    generatedAt: new Date().toISOString(),
    reportingDate: options.reportingDate,
    period: { from, to, isRange: from !== to },
    currency: options.currency,
    settings: { dateFilter: options.dateFilter, duplicateMode: options.duplicateMode, cautiousMatching: options.cautiousMatching, filters: options.filters },
    scope: { fileIds: input.files.map((f) => f.fileId), fileNames: input.files.map((f) => f.fileName), leadFiles: leadFiles.length, adFiles: adFiles.length },
    filterOptions: {
      campaigns: [...new Map(dated.map((r) => [groupKey(campaignLabel(r)), campaignLabel(r)])).values()].sort((a, b) => a.localeCompare(b)),
      sources: [...new Map(dated.map((r) => [groupKey(sourceLabel(r)), sourceLabel(r)])).values()].sort((a, b) => a.localeCompare(b)),
    },
    counts: {
      rawRows: input.files.filter((f) => f.kind === 'leads').reduce((s, f) => s + f.dataRows, 0),
      blankRows: input.files.reduce((s, f) => s + f.blankRows, 0),
      acceptedRows: input.leads.length,
      rejectedRows: leadFiles.reduce((s, f) => s + f.rejected, 0),
      rowsWithWarnings: leadFiles.reduce((s, f) => s + f.rowsWithWarnings, 0),
      leadsOutsidePeriod,
      excludedOutsidePeriod,
      missingCreatedDate,
      filteredOut,
      inScopeRows: scoped.length,
      uniqueLeads: dup.uniqueLeads,
      reportedLeads,
      duplicateRows: dup.duplicateRows,
      duplicateRowsExcluded: working.excludedUids.size,
      possibleDuplicateRows: dup.possibleDuplicateRows,
      pendingReviewGroups: working.pendingReviewGroups,
    },
    overview: {
      totalLeads: reportedLeads,
      uniqueLeads: dup.uniqueLeads,
      qualifiedLeads: qualifiedVal,
      totalSpend,
      cpl,
      applications: appsVal,
      enrolments: enrolVal,
      targetAchievement,
    },
    marketing: {
      totalSpend,
      attributableSpend: hasSpend ? attributableSpend : null,
      unattributedSpend: hasSpend ? round((totalSpend ?? 0) - attributableSpend) : null,
      attributableLeads: hasSpend ? attributable.length : null,
      cpl,
      costPerQualified: hasSpend && avail.qualified > 0 ? ratio(attributableSpend, qualifiedAttr) : null,
      targetLeads,
      targetAchievement,
      budget,
      budgetUtilisation: pct(budgetSpend, budget),
      impressions,
      clicks,
      ctr: pct(clicks, impressions),
      cpc: ratio(adTotals.filter((b) => b.clicks !== null).reduce((s, b) => s + b.spend, 0), clicks),
      cpm: impressions ? round((adTotals.filter((b) => b.impressions !== null).reduce((s, b) => s + b.spend, 0) / impressions) * 1000) : null,
      undatedSpendRows,
      spendOutsidePeriod,
    },
    sales: {
      assigned: ifAvail('assigned', 'assigned', assigned, 'Counsellor assignment'),
      contacted: ifAvail('contacted', 'contacted', contacted, 'Contact'),
      contactRate: avail.assigned > 0 && avail.contacted > 0 ? pct(contactedAssigned, assigned) : null,
      qualified: qualifiedVal,
      unqualified: avail.qualified > 0 ? unqualified : null,
      pendingQualification: avail.qualified > 0 ? pendingQ : null,
      qualificationRate: avail.qualified > 0 ? pct(qualified, qualified + unqualified) : null,
      firstResponse:
        avail.response > 0
          ? {
              count: responses.length,
              medianMinutes: median(responses) === null ? null : round(median(responses)!, 1),
              averageMinutes: responses.length ? round(responses.reduce((a, b) => a + b, 0) / responses.length, 1) : null,
              within1hPct: pct(responses.filter((m) => m <= 60).length, responses.length),
            }
          : null,
      followUpsDue: ifAvail('followUp', 'followUpsDue', fuDue, 'Next follow-up date'),
      followUpsDueInPeriod: avail.followUp > 0 ? count(W, (f) => f.followUpDueInPeriod) : null,
      followUpsCompleted: avail.followUp > 0 ? fuDone : null,
      followUpsOverdue: avail.followUp > 0 ? count(W, (f) => f.followUpOverdue) : null,
      followUpCompletion: avail.followUp > 0 ? pct(fuDone, fuDue) : null,
      counsellingBooked: ifAvail('counselling', 'counsellingBooked', count(W, (f) => f.counsellingBooked), 'Counselling status'),
      counsellingAttended: avail.counselling > 0 ? count(W, (f) => f.counsellingAttended) : null,
    },
    conversion: {
      applications: appsVal,
      applicationRate: appsVal === null ? null : pct(apps, reportedLeads),
      offers: ifAvail('offer', 'offers', offers, 'Offer status'),
      enrolments: enrolVal,
      enrolmentRate: enrolVal === null ? null : pct(enrol, reportedLeads),
      revenue: avail.revenue > 0 ? round(W.reduce((s, r) => s + (r.revenue ?? 0), 0)) : null,
      costPerApplication: hasSpend && appsVal !== null ? ratio(attributableSpend, appsAttr) : null,
      costPerEnrolment: hasSpend && enrolVal !== null ? ratio(attributableSpend, enrolAttr) : null,
    },
    dataQuality,
    files: filesSummary,
    campaigns,
    sources,
    dimensions: {
      medium: dimension('medium'),
      country: dimension('preferredCountry'),
      course: dimension('preferredCourse'),
      studyLevel: dimension('studyLevel'),
    },
    counsellors,
    funnel,
    quality,
    trend,
    statusDistribution: avail.contacted > 0 || W.some((r) => fileMaps(r, ['leadStatus'])) ? statusDistribution : [],
    duplicates: {
      byFile: Object.entries(dup.byFile).map(([fileName, v]) => ({ fileName, ...v })),
      byCampaign: Object.entries(dup.byCampaign).map(([campaign, v]) => ({ campaign, ...v })),
      confirmedGroups: dup.groups.filter((g) => g.kind === 'confirmed').length,
      possibleGroups: dup.groups.filter((g) => g.kind === 'possible').length,
    },
    unavailable,
    notes,
  };
}
