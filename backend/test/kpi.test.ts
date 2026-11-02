import { describe, expect, it } from 'vitest';
import { analyzeDuplicates, applyDuplicateMode } from '../src/domain/dedupe.js';
import { buildReport, pct, ratio, type CampaignInput, type ReportFileInfo, type ReportOptions } from '../src/domain/kpi.js';
import { parseDate } from '../src/domain/normalize.js';
import type { AdRecord, LeadRecord } from '../src/domain/validate.js';

let n = 0;
type LeadInit = { file?: string; leadId?: string; phone?: string; email?: string; text?: Record<string, string>; dates?: Record<string, string>; revenue?: number };
function lead(init: LeadInit = {}): LeadRecord {
  n++;
  const dates = Object.fromEntries(Object.entries(init.dates ?? {}).map(([k, v]) => [k, parseDate(v)!]));
  return {
    uid: `${init.file ?? 'f1'}:${n}`,
    fileId: init.file ?? 'f1',
    fileName: `${init.file ?? 'f1'}.xlsx`,
    rowNumber: n,
    order: n,
    phone: init.phone ?? null,
    email: init.email ?? null,
    phoneValid: Boolean(init.phone),
    emailValid: Boolean(init.email),
    phoneProvided: Boolean(init.phone),
    emailProvided: Boolean(init.email),
    text: { ...(init.leadId ? { leadId: init.leadId } : {}), name: `Synthetic ${n}`, ...(init.text ?? {}) },
    dates: { leadCreatedDate: parseDate('2026-10-30 10:00')!, ...dates },
    revenue: init.revenue ?? null,
    numbers: {},
  };
}

const ALL_FIELDS = ['leadId', 'name', 'phone', 'email', 'source', 'campaignName', 'leadCreatedDate', 'assignedCounsellor', 'firstContactAt', 'lastContactDate', 'leadStatus', 'qualificationStatus', 'nextFollowUpDate', 'applicationStatus', 'enrolmentStatus', 'offerStatus', 'counsellingStatus', 'revenue'];
function fileInfo(id = 'f1', mapped = ALL_FIELDS, extra: Partial<ReportFileInfo> = {}): ReportFileInfo {
  return { fileId: id, fileName: `${id}.xlsx`, kind: 'leads', sheet: 'S', dataRows: 0, blankRows: 0, accepted: 0, rejected: 0, rowsWithWarnings: 0, issueCount: 0, mappedFields: mapped, unmappedColumns: [], ambiguousDateFields: [], ...extra };
}
const opts = (o: Partial<ReportOptions> = {}): ReportOptions => ({
  reportingDate: '2026-10-30',
  dateRange: null,
  dateFilter: 'include_all',
  duplicateMode: 'exclude_duplicates',
  duplicateDecisions: {},
  cautiousMatching: false,
  filters: { campaigns: [], sources: [] },
  overallTargetLeads: null,
  overallBudget: null,
  currency: 'INR',
  ...o,
});
const ad = (campaignName: string | null, spend: number, extra: Partial<AdRecord> = {}): AdRecord => ({ uid: `ad:${++n}`, fileId: 'ads', fileName: 'ads.xlsx', rowNumber: n, campaignName, source: null, date: parseDate('2026-10-30'), spend, impressions: null, clicks: null, budget: null, targetLeads: null, ...extra });
const input = (c: Partial<CampaignInput>): CampaignInput => ({ id: 'x', campaignName: null, source: null, spend: null, budget: null, targetLeads: null, impressions: null, clicks: null, baselineCpl: null, ...c });

describe('helpers', () => {
  it('pct and ratio return null for zero/missing denominators', () => {
    expect(pct(1, 0)).toBeNull();
    expect(pct(null, 5)).toBeNull();
    expect(pct(1, 3)).toBe(33.33);
    expect(ratio(100, 0)).toBeNull();
    expect(ratio(100, 3)).toBe(33.33);
  });
});

describe('core formulas', () => {
  const leads = [
    lead({ phone: '9000000001', text: { campaignName: 'A', source: 'facebook', assignedCounsellor: 'C1', qualificationStatus: 'Qualified', applicationStatus: 'Submitted', enrolmentStatus: 'Enrolled' }, dates: { firstContactAt: '2026-10-30 10:30' }, revenue: 1000 }),
    lead({ phone: '9000000002', text: { campaignName: 'A', source: 'facebook', assignedCounsellor: 'C1', qualificationStatus: 'Unqualified' }, dates: { firstContactAt: '2026-10-30 11:00' } }),
    lead({ phone: '9000000003', text: { campaignName: 'A', source: 'facebook', assignedCounsellor: 'C2', qualificationStatus: 'Pending' } }),
    lead({ phone: '9000000004', text: { campaignName: 'B', source: 'google', qualificationStatus: 'Qualified', applicationStatus: 'Not Applied' } }),
  ];
  const r = buildReport({
    files: [fileInfo(), { ...fileInfo('ads'), kind: 'ad_spend', mappedFields: ['campaignName', 'spend'] }],
    leads,
    ads: [ad('A', 300, { budget: 400, targetLeads: 6, impressions: 10000, clicks: 200 }), ad('Z', 50)],
    campaignInputs: [],
    options: opts({ overallTargetLeads: 8 }),
  });

  it('counts leads', () => {
    expect(r.overview.totalLeads).toBe(4);
    expect(r.overview.uniqueLeads).toBe(4);
  });
  it('qualification rate = qualified / assessed', () => {
    expect(r.sales.qualified).toBe(2);
    expect(r.sales.unqualified).toBe(1);
    expect(r.sales.pendingQualification).toBe(1);
    expect(r.sales.qualificationRate).toBe(66.67);
  });
  it('contact rate = contacted assigned / assigned', () => {
    expect(r.sales.assigned).toBe(3);
    expect(r.sales.contacted).toBe(2);
    expect(r.sales.contactRate).toBe(66.67);
  });
  it('first response time from timestamps', () => {
    expect(r.sales.firstResponse).toEqual({ count: 2, medianMinutes: 45, averageMinutes: 45, within1hPct: 100 }); // 30 and 60 min
  });
  it('CPL uses only attributable spend and leads', () => {
    expect(r.marketing.totalSpend).toBe(350);
    expect(r.marketing.attributableSpend).toBe(300);
    expect(r.marketing.unattributedSpend).toBe(50);
    expect(r.marketing.attributableLeads).toBe(3);
    expect(r.overview.cpl).toBe(100);
    expect(r.marketing.costPerQualified).toBe(300); // 1 qualified lead in campaign A
    expect(r.conversion.costPerApplication).toBe(300);
    expect(r.conversion.costPerEnrolment).toBe(300);
  });
  it('ad metrics', () => {
    const a = r.campaigns.find((c) => c.label === 'A')!;
    expect(a.cpl).toBe(100);
    expect(a.ctr).toBe(2);
    expect(a.cpc).toBe(1.5);
    expect(a.cpm).toBe(30);
    expect(a.budgetUtilisation).toBe(75);
    expect(a.targetAchievement).toBe(50);
  });
  it('target achievement uses the overall target when given', () => {
    expect(r.overview.targetAchievement).toBe(50); // 4 / 8
  });
  it('conversion rates use reported leads as the cohort', () => {
    expect(r.conversion.applications).toBe(1);
    expect(r.conversion.applicationRate).toBe(25);
    expect(r.conversion.enrolments).toBe(1);
    expect(r.conversion.enrolmentRate).toBe(25);
    expect(r.conversion.revenue).toBe(1000);
  });
  it('spend-only campaigns still appear', () => {
    expect(r.campaigns.find((c) => c.label === 'Z')).toMatchObject({ leads: 0, spend: 50, cpl: null });
  });
  it('sources are canonical and carry campaign spend', () => {
    const meta = r.sources.find((s) => s.label === 'Meta Ads')!;
    expect(meta.leads).toBe(3);
    expect(meta.spend).toBe(300);
  });
});

describe('missing data -> N/A, never invented', () => {
  it('marks metrics unavailable when columns are not mapped', () => {
    const r = buildReport({ files: [fileInfo('f1', ['phone', 'name'])], leads: [lead({ phone: '9000000001' })], ads: [], campaignInputs: [], options: opts() });
    expect(r.overview.totalSpend).toBeNull();
    expect(r.overview.cpl).toBeNull();
    expect(r.overview.qualifiedLeads).toBeNull();
    expect(r.overview.applications).toBeNull();
    expect(r.overview.targetAchievement).toBeNull();
    expect(r.sales.contactRate).toBeNull();
    expect(r.unavailable.cpl).toBeTruthy();
    expect(r.unavailable.qualifiedLeads).toMatch(/not mapped/);
    expect(r.funnel.filter((s) => s.available).map((s) => s.key)).toEqual(['received']);
    expect(r.counsellors).toEqual([]);
  });
  it('zero denominators give null rates', () => {
    const r = buildReport({ files: [fileInfo()], leads: [lead({ phone: '9000000001', text: { qualificationStatus: 'Pending' } })], ads: [], campaignInputs: [], options: opts() });
    expect(r.sales.qualificationRate).toBeNull();
    expect(r.sales.contactRate).toBeNull();
  });
});

describe('reporting period', () => {
  const leads = [lead({ phone: '9000000001' }), lead({ phone: '9000000002', dates: { leadCreatedDate: '2026-10-29 23:59' } }), lead({ phone: '9000000003', dates: { leadCreatedDate: '2026-10-31 00:00' } })];
  it('flags but includes out-of-period rows by default', () => {
    const r = buildReport({ files: [fileInfo()], leads, ads: [], campaignInputs: [], options: opts() });
    expect(r.counts.leadsOutsidePeriod).toBe(2);
    expect(r.overview.totalLeads).toBe(3);
    expect(r.notes[0].level).toBe('warning');
  });
  it('excludes out-of-period rows when restricted', () => {
    const r = buildReport({ files: [fileInfo()], leads, ads: [], campaignInputs: [], options: opts({ dateFilter: 'restrict' }) });
    expect(r.overview.totalLeads).toBe(1);
    expect(r.counts.excludedOutsidePeriod).toBe(2);
  });
  it('custom date range includes the whole range', () => {
    const r = buildReport({ files: [fileInfo()], leads, ads: [], campaignInputs: [], options: opts({ dateFilter: 'restrict', dateRange: { from: '2026-10-29', to: '2026-10-31' } }) });
    expect(r.overview.totalLeads).toBe(3);
    expect(r.period.isRange).toBe(true);
  });
  it('does not mix spend from other dates', () => {
    const r = buildReport({ files: [fileInfo()], leads: [lead({ phone: '9000000001', text: { campaignName: 'A' } })], ads: [ad('A', 100), ad('A', 999, { date: parseDate('2026-10-29') })], campaignInputs: [], options: opts() });
    expect(r.marketing.totalSpend).toBe(100);
    expect(r.marketing.spendOutsidePeriod).toBe(1);
  });
});

describe('follow-ups', () => {
  it('due, completed, overdue', () => {
    const leads = [
      lead({ phone: '9000000001', dates: { nextFollowUpDate: '2026-10-30', lastContactDate: '2026-10-30' } }), // due, completed
      lead({ phone: '9000000002', dates: { nextFollowUpDate: '2026-10-28' } }), // overdue
      lead({ phone: '9000000003', text: { leadStatus: 'Lost' }, dates: { nextFollowUpDate: '2026-10-28' } }), // due, closed -> not overdue
      lead({ phone: '9000000004', dates: { nextFollowUpDate: '2026-11-02' } }), // not yet due
    ];
    const r = buildReport({ files: [fileInfo()], leads, ads: [], campaignInputs: [], options: opts() });
    expect(r.sales.followUpsDue).toBe(3);
    expect(r.sales.followUpsDueInPeriod).toBe(1);
    expect(r.sales.followUpsCompleted).toBe(1);
    expect(r.sales.followUpsOverdue).toBe(1);
    expect(r.sales.followUpCompletion).toBe(33.33);
  });
  it('excludes negative response times and reports them', () => {
    const r = buildReport({ files: [fileInfo()], leads: [lead({ phone: '9000000001', dates: { firstContactAt: '2026-10-30 09:00' } })], ads: [], campaignInputs: [], options: opts() });
    expect(r.sales.firstResponse?.count).toBe(0);
    expect(r.dataQuality.negativeResponseTimes).toBe(1);
  });
});

describe('duplicate detection', () => {
  it('confirms by Lead ID, phone or email; flags conflicting Lead IDs as possible', () => {
    const rs = [
      lead({ file: 'a', leadId: 'L1', phone: '9000000001' }),
      lead({ file: 'b', leadId: 'L1', phone: '9000000001' }), // same ID -> confirmed
      lead({ file: 'a', phone: '9000000002', email: 'x@example.com' }),
      lead({ file: 'b', email: 'x@example.com' }), // same email, no IDs -> confirmed
      lead({ file: 'a', leadId: 'L5', phone: '9000000005' }),
      lead({ file: 'b', leadId: 'L6', phone: '9000000005' }), // different IDs share phone -> possible
      lead({ file: 'a', leadId: 'L7', phone: '9000000007', text: { name: 'Same Name' } }),
      lead({ file: 'b', leadId: 'L8', phone: '9000000008', text: { name: 'Same Name' } }), // name only -> never merged
    ];
    const d = analyzeDuplicates(rs);
    expect(d.totalRows).toBe(8);
    expect(d.duplicateRows).toBe(2);
    expect(d.possibleDuplicateRows).toBe(1);
    expect(d.uniqueLeads).toBe(6);
    expect(d.groups.filter((g) => g.kind === 'confirmed')).toHaveLength(2);
    expect(d.groups.filter((g) => g.kind === 'possible')).toHaveLength(1);
    expect(d.byFile['b.xlsx'].duplicateRows).toBe(2);

    expect(applyDuplicateMode(rs, d, 'count_all').records).toHaveLength(8);
    expect(applyDuplicateMode(rs, d, 'exclude_duplicates').records).toHaveLength(6);
    const manual = applyDuplicateMode(rs, d, 'manual_review');
    expect(manual.records).toHaveLength(8);
    expect(manual.pendingReviewGroups).toBe(3);
  });
  it('flags the same Lead ID with different phones as conflicting', () => {
    const d = analyzeDuplicates([lead({ leadId: 'L1', phone: '9000000001' }), lead({ leadId: 'L1', phone: '9000000002' })]);
    expect(d.groups[0].kind).toBe('confirmed');
    expect(d.groups[0].conflict).toBe(true);
    expect(d.conflictingRecords).toBe(2);
  });
  it('keep_latest keeps the most recent activity', () => {
    const older = lead({ leadId: 'L1', dates: { lastContactDate: '2026-10-29' } });
    const newer = lead({ leadId: 'L1', dates: { lastContactDate: '2026-10-30' } });
    const rs = [newer, older];
    const d = analyzeDuplicates(rs);
    expect(applyDuplicateMode(rs, d, 'keep_latest').records.map((r) => r.uid)).toEqual([newer.uid]);
    // "Exclude duplicates" keeps the first occurrence (upload/row order), which here is the older record.
    expect(applyDuplicateMode(rs, d, 'exclude_duplicates').records.map((r) => r.uid)).toEqual([older.uid]);
    const reversed = [lead({ leadId: 'L2', dates: { lastContactDate: '2026-10-28' } }), lead({ leadId: 'L2', dates: { lastContactDate: '2026-10-30' } })];
    const d2 = analyzeDuplicates(reversed);
    expect(applyDuplicateMode(reversed, d2, 'exclude_duplicates').records[0].uid).toBe(reversed[0].uid);
    expect(applyDuplicateMode(reversed, d2, 'keep_latest').records[0].uid).toBe(reversed[1].uid);
  });
  it('cautious name+city matching is opt-in and never confirmed', () => {
    const rs = [lead({ leadId: 'A', text: { name: 'Riya Testwala', city: 'Pune' } }), lead({ leadId: 'B', text: { name: 'riya  testwala', city: 'pune' } })];
    expect(analyzeDuplicates(rs).groups).toHaveLength(0);
    const d = analyzeDuplicates(rs, { cautiousMatching: true });
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0].kind).toBe('possible');
    expect(d.uniqueLeads).toBe(2);
  });
  it('duplicate rate = duplicate rows / raw rows', () => {
    const r = buildReport({ files: [fileInfo()], leads: [lead({ leadId: 'L1' }), lead({ leadId: 'L1' }), lead({ leadId: 'L2' }), lead({ leadId: 'L3' })], ads: [], campaignInputs: [], options: opts() });
    expect(r.dataQuality.duplicateRate).toBe(25);
    expect(r.overview.totalLeads).toBe(3);
  });
});

describe('campaign inputs', () => {
  it('manual spend, budget and baseline CPL', () => {
    const leads = [lead({ phone: '9000000001', text: { campaignName: 'Camp' } }), lead({ phone: '9000000002', text: { campaignName: 'camp ' } })];
    const r = buildReport({ files: [fileInfo()], leads, ads: [], campaignInputs: [input({ campaignName: 'CAMP', spend: 500, budget: 1000, baselineCpl: 200 })], options: opts() });
    const c = r.campaigns[0];
    expect(r.campaigns).toHaveLength(1); // case/whitespace-insensitive grouping
    expect(c.cpl).toBe(250);
    expect(c.cplChange).toBe(25);
    expect(r.marketing.budgetUtilisation).toBe(50);
  });
});
