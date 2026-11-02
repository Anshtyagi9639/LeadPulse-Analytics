import { KPI_DEFINITIONS } from '../domain/definitions.js';
import type { BreakdownRow, Report } from '../domain/kpi.js';
import type { ValidationIssue } from '../domain/validate.js';

export type CellKind = 'text' | 'int' | 'num' | 'pct' | 'money' | 'minutes';
export interface Column {
  header: string;
  kind: CellKind;
  width?: number;
}
export interface Table {
  key: string;
  title: string;
  columns: Column[];
  rows: (string | number | null)[][];
}

export const TABLE_KEYS = ['executive', 'files', 'campaigns', 'sources', 'counsellors', 'funnel', 'data-quality', 'definitions', 'validation-errors'] as const;
export type TableKey = (typeof TABLE_KEYS)[number];

const c = (header: string, kind: CellKind, width?: number): Column => ({ header, kind, width });

export function executiveRows(r: Report): { metric: string; value: number | null; kind: CellKind; note: string }[] {
  const u = r.unavailable;
  return [
    { metric: 'Total leads (reported)', value: r.overview.totalLeads, kind: 'int', note: `Duplicate option: ${duplicateModeLabel(r.settings.duplicateMode)}` },
    { metric: 'Unique leads', value: r.overview.uniqueLeads, kind: 'int', note: 'Confirmed duplicates collapsed' },
    { metric: 'Total raw rows', value: r.counts.rawRows, kind: 'int', note: `${r.counts.rejectedRows} rejected, ${r.counts.blankRows} blank rows skipped` },
    { metric: 'Qualified leads', value: r.overview.qualifiedLeads, kind: 'int', note: u.qualifiedLeads ?? '' },
    { metric: 'Qualification rate', value: r.sales.qualificationRate, kind: 'pct', note: r.sales.pendingQualification ? `${r.sales.pendingQualification} pending assessment` : '' },
    { metric: 'Total ad spend', value: r.overview.totalSpend, kind: 'money', note: u.totalSpend ?? '' },
    { metric: 'CPL', value: r.overview.cpl, kind: 'money', note: u.cpl ?? (r.marketing.attributableLeads !== null ? `${r.marketing.attributableLeads} attributable leads` : '') },
    { metric: 'Cost per qualified lead', value: r.marketing.costPerQualified, kind: 'money', note: '' },
    { metric: 'Applications', value: r.overview.applications, kind: 'int', note: u.applications ?? '' },
    { metric: 'Application conversion', value: r.conversion.applicationRate, kind: 'pct', note: '' },
    { metric: 'Enrolments', value: r.overview.enrolments, kind: 'int', note: u.enrolments ?? '' },
    { metric: 'Enrolment conversion', value: r.conversion.enrolmentRate, kind: 'pct', note: '' },
    { metric: 'Target achievement', value: r.overview.targetAchievement, kind: 'pct', note: u.targetAchievement ?? (r.marketing.targetLeads !== null ? `Target ${r.marketing.targetLeads} leads` : '') },
    { metric: 'Budget utilisation', value: r.marketing.budgetUtilisation, kind: 'pct', note: u.budgetUtilisation ?? '' },
    { metric: 'Contact rate', value: r.sales.contactRate, kind: 'pct', note: u.contacted ?? '' },
    { metric: 'Median first response (minutes)', value: r.sales.firstResponse?.medianMinutes ?? null, kind: 'minutes', note: u.firstResponse ?? '' },
    { metric: 'Follow-ups overdue', value: r.sales.followUpsOverdue, kind: 'int', note: u.followUpsDue ?? '' },
    { metric: 'Duplicate rate', value: r.dataQuality.duplicateRate, kind: 'pct', note: `${r.counts.duplicateRows} duplicate rows` },
  ];
}

export function duplicateModeLabel(m: string): string {
  return (
    { count_all: 'Count all rows as submitted', exclude_duplicates: 'Exclude confirmed duplicates', keep_latest: 'Keep latest record', manual_review: 'Manual review' } as Record<string, string>
  )[m] ?? m;
}

const breakdownColumns = (first: string, withSpend: boolean): Column[] => [
  c(first, 'text', 32),
  c('Leads', 'int'),
  c('Unique leads', 'int'),
  c('Share %', 'pct'),
  c('Qualified', 'int'),
  c('Unqualified', 'int'),
  c('Qualification rate %', 'pct'),
  c('Contacted', 'int'),
  c('Contact rate %', 'pct'),
  c('Applications', 'int'),
  c('Application conv. %', 'pct'),
  c('Offers', 'int'),
  c('Enrolments', 'int'),
  c('Enrolment conv. %', 'pct'),
  ...(withSpend
    ? [c('Spend', 'money'), c('CPL', 'money'), c('Cost / qualified', 'money'), c('Cost / application', 'money'), c('Cost / enrolment', 'money'), c('Target leads', 'int'), c('Target achievement %', 'pct'), c('Budget', 'money'), c('Budget utilisation %', 'pct'), c('Impressions', 'int'), c('Clicks', 'int'), c('CTR %', 'pct'), c('CPC', 'money'), c('CPM', 'money'), c('Baseline CPL', 'money'), c('CPL change %', 'pct')]
    : []),
  c('Duplicate rows excluded', 'int'),
];

const breakdownRow = (b: BreakdownRow, withSpend: boolean) => [
  b.label,
  b.leads,
  b.uniqueLeads,
  b.share,
  b.qualified,
  b.unqualified,
  b.qualificationRate,
  b.contacted,
  b.contactRate,
  b.applications,
  b.applicationRate,
  b.offers,
  b.enrolments,
  b.enrolmentRate,
  ...(withSpend
    ? [b.spend, b.cpl, b.costPerQualified, b.costPerApplication, b.costPerEnrolment, b.targetLeads, b.targetAchievement, b.budget, b.budgetUtilisation, b.impressions, b.clicks, b.ctr, b.cpc, b.cpm, b.baselineCpl, b.cplChange]
    : []),
  b.duplicateRows,
];

export function buildTable(key: TableKey, r: Report, issues: ValidationIssue[]): Table {
  switch (key) {
    case 'executive':
      return {
        key,
        title: 'Executive Summary',
        columns: [c('Metric', 'text', 34), c('Value', 'num', 16), c('Notes', 'text', 60)],
        rows: executiveRows(r).map((x) => [x.metric, x.value, x.note]),
      };
    case 'files':
      return {
        key,
        title: 'File-wise Summary',
        columns: [c('File', 'text', 36), c('Type', 'text'), c('Worksheet', 'text', 18), c('Data rows', 'int'), c('Accepted', 'int'), c('Rejected', 'int'), c('Blank rows skipped', 'int'), c('Rows with warnings', 'int'), c('In report', 'int'), c('Unique leads', 'int'), c('Duplicate rows', 'int'), c('Outside period', 'int'), c('Qualified', 'int'), c('Applications', 'int'), c('Enrolments', 'int'), c('Unmapped columns', 'text', 40)],
        rows: r.files.map((f) => [f.fileName, f.kind === 'leads' ? 'Leads' : 'Ad spend', f.sheet, f.dataRows, f.accepted, f.rejected, f.blankRows, f.rowsWithWarnings, f.inReport, f.uniqueLeads, f.duplicateRows, f.outOfPeriod, f.qualified, f.applications, f.enrolments, f.unmappedColumns.join(', ')]),
      };
    case 'campaigns':
      return { key, title: 'Campaign-wise Performance', columns: breakdownColumns('Campaign', true), rows: r.campaigns.map((b) => breakdownRow(b, true)) };
    case 'sources':
      return { key, title: 'Source-wise Performance', columns: breakdownColumns('Source', true), rows: r.sources.map((b) => breakdownRow(b, true)) };
    case 'counsellors':
      return {
        key,
        title: 'Counsellor Performance',
        columns: [c('Counsellor', 'text', 26), c('Leads', 'int'), c('Contacted', 'int'), c('Contact rate %', 'pct'), c('Qualified', 'int'), c('Qualification rate %', 'pct'), c('Median first response (min)', 'minutes'), c('Follow-ups due', 'int'), c('Completed', 'int'), c('Overdue', 'int'), c('Follow-up completion %', 'pct'), c('Counselling booked', 'int'), c('Counselling attended', 'int'), c('Applications', 'int'), c('Enrolments', 'int')],
        rows: r.counsellors.map((x) => [x.counsellor, x.leads, x.contacted, x.contactRate, x.qualified, x.qualificationRate, x.medianFirstResponseMinutes, x.followUpsDue, x.followUpsCompleted, x.followUpsOverdue, x.followUpCompletion, x.counsellingBooked, x.counsellingAttended, x.applications, x.enrolments]),
      };
    case 'funnel':
      return {
        key,
        title: 'Lead Funnel',
        columns: [c('Stage', 'text', 20), c('Leads', 'int'), c('% of received', 'pct'), c('% of previous stage', 'pct'), c('Data coverage %', 'pct'), c('Note', 'text', 60)],
        rows: r.funnel.map((s) => [s.label, s.available ? s.count : 'N/A', s.pctOfReceived, s.pctOfPrevious, s.coverage, s.note ?? '']),
      };
    case 'data-quality': {
      const d = r.dataQuality;
      const rows: (string | number | null)[][] = [
        ['Total raw rows', r.counts.rawRows, ''],
        ['Accepted rows', r.counts.acceptedRows, ''],
        ['Rejected (invalid) rows', d.rejectedRows, 'See Validation Errors'],
        ['Blank rows skipped', r.counts.blankRows, ''],
        ['Rows with warnings', d.rowsWithWarnings, ''],
        ['Rows outside reporting period', r.counts.leadsOutsidePeriod, r.settings.dateFilter === 'restrict' ? 'Excluded' : 'Included'],
        ['Rows removed by filters', r.counts.filteredOut, ''],
        ['Unique leads', r.counts.uniqueLeads, ''],
        ['Duplicate rows (confirmed)', r.counts.duplicateRows, ''],
        ['Duplicate rows excluded from report', r.counts.duplicateRowsExcluded, duplicateModeLabel(r.settings.duplicateMode)],
        ['Possible duplicate rows (need review)', r.counts.possibleDuplicateRows, ''],
        ['Duplicate rate %', d.duplicateRate, ''],
        ['Conflicting records', d.conflictingRecords, ''],
        ['Rows without Lead ID', d.missingIdRows, ''],
        ['Rows without Lead ID, phone or email', d.unidentifiableRows, 'Cannot be de-duplicated'],
        ['Missing phone numbers', d.missingPhone, ''],
        ['Invalid phone numbers', d.invalidPhone, ''],
        ['Missing email addresses', d.missingEmail, ''],
        ['Invalid email addresses', d.invalidEmail, ''],
        ['Missing campaign attribution', d.missingCampaign, ''],
        ['Missing source', d.missingSource, ''],
        ['Missing counsellor assignment', d.missingCounsellor, ''],
        ['Missing follow-up dates (open leads)', d.missingFollowUpDate, ''],
        ['Missing lead status', d.missingLeadStatus, ''],
        ['Missing conversion status', d.missingConversionStatus, ''],
        ['Missing lead created date', d.missingCreatedDate, ''],
        ['Negative response times', d.negativeResponseTimes, 'First contact before lead creation'],
        ...d.unmappedColumns.map((u) => [`Unmapped columns — ${u.fileName}`, u.columns.length, u.columns.join(', ')]),
        ...r.duplicates.byFile.map((x) => [`Duplicates — ${x.fileName}`, x.duplicateRows, `${x.possibleDuplicateRows} possible`]),
        ...r.notes.map((n) => [`Note (${n.level})`, null, n.message]),
      ];
      return { key, title: 'Data Quality', columns: [c('Check', 'text', 42), c('Count / value', 'num', 14), c('Details', 'text', 70)], rows };
    }
    case 'definitions':
      return {
        key,
        title: 'KPI Definitions',
        columns: [c('KPI / KPM', 'text', 30), c('Category', 'text', 14), c('Formula', 'text', 60), c('Notes', 'text', 70)],
        rows: KPI_DEFINITIONS.map((d) => [d.name, d.category, d.formula, d.notes]),
      };
    case 'validation-errors':
      return {
        key,
        title: 'Validation Errors',
        columns: [c('File', 'text', 30), c('Worksheet', 'text', 16), c('Row', 'int'), c('Field', 'text', 20), c('Severity', 'text'), c('Code', 'text', 18), c('Message', 'text', 60), c('Value (masked for personal data)', 'text', 26)],
        rows: issues.map((i) => [i.fileName, i.sheet, i.rowNumber, i.field, i.severity, i.code, i.message, i.value]),
      };
  }
}
