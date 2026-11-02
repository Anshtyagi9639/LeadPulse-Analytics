import ExcelJS from 'exceljs';
import type { FileComparison } from '../domain/comparison.js';
import type { Report } from '../domain/kpi.js';
import { FLAG_LABELS, STATUS_LABELS, type LeadFlag, type LeadQuery, type LeadRow, type LeadStatus } from '../domain/leads.js';
import type { ValidationIssue } from '../domain/validate.js';
import { csvEscape, safeFilename, sanitizeCell } from '../lib/sanitize.js';
import { buildTable } from './tables.js';

export type ExportFormat = 'csv' | 'xlsx';
export interface ExportFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_TYPE = 'text/csv; charset=utf-8';
const BRAND = 'FF1E3A8A';
const HEADER_FILL = 'FFE8EEF9';

type Meta = [string, string][];
type Cell = string | number | null;

function periodLabel(p: { from: string; to: string }): string {
  return p.from === p.to ? p.from : `${p.from} to ${p.to}`;
}
function dateSlug(p: { from: string; to: string }): string {
  return p.from === p.to ? p.from : `${p.from}_to_${p.to}`;
}

/** Workbook helper: title block + one table per sheet. Every cell is written as text or number, never a formula. */
function addSheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: Cell[][], opts: { title?: string; meta?: Meta; textColumns?: Set<number> } = {}) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  let r = 1;
  if (opts.title) {
    ws.getCell(r, 1).value = opts.title;
    ws.getCell(r, 1).font = { bold: true, size: 14, color: { argb: BRAND } };
    r += 1;
  }
  for (const [k, v] of opts.meta ?? []) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = sanitizeCell(v) as string;
    r += 1;
  }
  if (opts.title || opts.meta?.length) r += 1;
  const headerRow = r;
  headers.forEach((h, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = h;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    ws.getColumn(i + 1).width = Math.min(40, Math.max(12, h.length + 4));
  });
  for (const row of rows) {
    r += 1;
    row.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      if (v === null || v === undefined || v === '') return;
      if (typeof v === 'number' && !opts.textColumns?.has(i)) c.value = v;
      else {
        c.value = sanitizeCell(String(v)) as string;
        c.numFmt = '@'; // keep as text: preserves leading zeros and long numbers
      }
    });
  }
  if (rows.length) {
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: headers.length } };
  }
  return ws;
}

function csvWithMeta(title: string, meta: Meta, headers: string[], rows: Cell[][]): Buffer {
  // A short information block, a blank line, then the table. Values are escaped and formula-protected.
  const line = (cells: Cell[]) => cells.map(csvEscape).join(',');
  const lines = [line([title]), ...meta.map(([k, v]) => line([k, v])), '', line(headers), ...rows.map(line)];
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Lead export
// ---------------------------------------------------------------------------------------------

export interface LeadExportOptions {
  format: ExportFormat;
  variant: 'cleaned' | 'original' | 'both';
  stdColumns: { key: string; label: string }[];
  originalColumns: string[];
  period: { from: string; to: string };
  query: LeadQuery;
  fileNames: Record<string, string>;
  selection: boolean;
  generatedAt: Date;
  timezoneLabel: string;
}

function describeFilters(q: LeadQuery, fileNames: Record<string, string>): string {
  const parts: string[] = [];
  if (q.fileIds?.length) parts.push(`Files: ${q.fileIds.map((id) => fileNames[id] ?? id).join(', ')}`);
  if (q.statuses?.length) parts.push(`Status: ${q.statuses.map((s) => STATUS_LABELS[s]).join(', ')}`);
  if (q.flags?.length) parts.push(`Data quality: ${q.flags.map((f) => FLAG_LABELS[f]).join(', ')}`);
  if (q.sources?.length) parts.push(`Sources: ${q.sources.join(', ')}`);
  if (q.campaigns?.length) parts.push(`Campaigns: ${q.campaigns.join(', ')}`);
  if (q.leadStatuses?.length) parts.push(`Lead status: ${q.leadStatuses.join(', ')}`);
  if (q.dateFrom || q.dateTo) parts.push(`Created: ${q.dateFrom ?? '…'} to ${q.dateTo ?? '…'}`);
  if (q.presence && q.presence !== 'all') parts.push(q.presence === 'unique_to_file' ? 'Only leads unique to one file' : 'Only leads found in several files');
  if (q.search) parts.push(`Search: "${q.search}"`);
  return parts.join('; ') || 'None';
}

export function leadExportFilename(o: Pick<LeadExportOptions, 'format' | 'period' | 'query' | 'fileNames' | 'selection'>): string {
  const date = dateSlug(o.period);
  const q = o.query;
  let base = 'combined_lead_report';
  if (o.selection) base = 'selected_leads';
  else if (q.statuses?.length === 1 && q.statuses[0] === 'valid') base = 'valid_leads';
  else if (q.statuses?.length === 1 && q.statuses[0] === 'invalid') base = 'invalid_records';
  else if (q.statuses?.length && q.statuses.every((s) => s === 'duplicate' || s === 'possible_duplicate')) base = 'duplicate_leads';
  else if (q.fileIds?.length === 1) base = `file_${(o.fileNames[q.fileIds[0]] ?? 'file').replace(/\.[^.]+$/, '')}_lead_report`;
  else if (q.search || q.flags?.length || q.sources?.length || q.campaigns?.length || q.leadStatuses?.length || q.dateFrom || q.dateTo || (q.presence && q.presence !== 'all') || q.statuses?.length)
    base = 'filtered_lead_report';
  return `${safeFilename(`${base}_${date}`)}.${o.format}`;
}

export async function buildLeadExport(rows: LeadRow[], o: LeadExportOptions): Promise<ExportFile> {
  const statusCounts = (s: LeadStatus) => rows.filter((r) => r.status === s).length;
  const flagCounts = new Map<LeadFlag, number>();
  for (const r of rows) for (const f of r.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  const files = [...new Set(rows.map((r) => r.fileName))];
  const meta: Meta = [
    ['Generated', `${o.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC (${o.timezoneLabel})`],
    ['Reporting period', periodLabel(o.period)],
    ['Applied filters', o.selection ? `Selected leads only (${rows.length})` : describeFilters(o.query, o.fileNames)],
    ['Source files', files.join(', ') || '—'],
    ['Records exported', String(rows.length)],
    ['Valid', String(statusCounts('valid'))],
    ['Duplicates (confirmed)', String(statusCounts('duplicate'))],
    ['Possible duplicates', String(statusCounts('possible_duplicate'))],
    ['Invalid (rejected) records', String(statusCounts('invalid'))],
    ['Columns', o.variant === 'cleaned' ? 'Cleaned standard values' : o.variant === 'original' ? 'Original values as uploaded' : 'Cleaned and original values'],
  ];

  const fixed = ['File', 'Row', 'Status', 'Excluded from report totals', 'Data-quality flags', 'Rejection reason', 'Also found in files', 'Duplicate group'];
  const stdCols = o.variant === 'original' ? [] : o.stdColumns;
  const origCols = o.variant === 'cleaned' ? [] : o.originalColumns;
  const both = o.variant === 'both';
  const headers = [...fixed, ...stdCols.map((c) => c.label), ...origCols.map((h) => (both ? `${h} (original)` : h))];
  const data: Cell[][] = rows.map((r) => [
    r.fileName,
    r.rowNumber,
    STATUS_LABELS[r.status],
    r.excludedFromReport ? 'Yes' : 'No',
    r.flags.map((f) => FLAG_LABELS[f]).join('; '),
    r.rejectReason ?? '',
    r.alsoIn.join('; '),
    r.duplicateGroupId ?? '',
    ...stdCols.map((c) => r.std[c.key] ?? ''),
    ...origCols.map((h) => r.original[h] ?? ''),
  ]);
  const filename = leadExportFilename(o);
  const title = 'Lead report';
  if (o.format === 'csv') return { buffer: csvWithMeta(title, meta, headers, data), filename, contentType: CSV_TYPE };

  const wb = new ExcelJS.Workbook();
  wb.creator = 'LeadPulse Analytics';
  addSheet(
    wb,
    'Summary',
    ['Data-quality flag', 'Records'],
    [...flagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => [FLAG_LABELS[f], n]),
    { title, meta },
  );
  // Every value column is text, so phone numbers / IDs keep leading zeros.
  const textCols = new Set(headers.map((_, i) => i).filter((i) => i !== 1));
  addSheet(wb, 'Leads', headers, data, { textColumns: textCols });
  return { buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), filename, contentType: XLSX_TYPE };
}

// ---------------------------------------------------------------------------------------------
// File comparison export
// ---------------------------------------------------------------------------------------------

export async function buildComparisonExport(cmp: FileComparison, o: { format: ExportFormat; period: { from: string; to: string }; generatedAt: Date; timezoneLabel: string; test?: boolean }): Promise<ExportFile> {
  const h = cmp.highlights;
  const meta: Meta = [
    ['Generated', `${o.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC (${o.timezoneLabel})`],
    ['Reporting period', periodLabel(o.period)],
    ['Files compared', cmp.files.map((f) => f.fileName).join(', ')],
    ['Most valid leads', h.mostValidLeads ? `${h.mostValidLeads.fileName} (${h.mostValidLeads.value})` : 'N/A'],
    ['Highest duplicate %', h.highestDuplicatePct ? `${h.highestDuplicatePct.fileName} (${h.highestDuplicatePct.value}%)` : 'N/A'],
    ['Most complete contact info', h.mostCompleteContact ? `${h.mostCompleteContact.fileName} (${h.mostCompleteContact.value}%)` : 'N/A'],
    ['Best data quality', h.bestQuality ? `${h.bestQuality.fileName} (score ${h.bestQuality.value})` : 'N/A'],
    ['Quality score', cmp.qualityScoreDefinition],
  ];
  const headers = ['File', 'Worksheet', 'Total records', 'Processed (accepted)', 'Valid leads', 'Duplicate records', 'Within-file duplicates', 'Duplicate %', 'Invalid records', 'Incomplete records', 'Valid phone %', 'Valid email %', 'Phone or email %', 'Name %', 'Campaign %', 'Quality score', 'Unique to file', 'Shared with other files', 'Failure reasons', 'Processing (ms)', 'Upload completed (UTC)', 'Last processed (UTC)'];
  const rows: Cell[][] = cmp.files.map((f) => [
    f.fileName, f.sheet, f.totalRecords, f.processedLeads, f.validLeads, f.duplicateRecords, f.withinFileDuplicates, f.duplicatePct, f.invalidRecords, f.incompleteRecords,
    f.contact.validPhonePct, f.contact.validEmailPct, f.contact.anyContactPct, f.contact.namePct, f.attributionPct, f.qualityScore, f.uniqueToFile, f.sharedWithOtherFiles,
    f.failures.map((x) => `${x.reason}: ${x.count}`).join('; '), f.timing.processingMs, f.timing.uploadCompletedAt, f.timing.processedAt,
  ]);
  const filename = `${safeFilename(`${o.test ? 'TEST_' : ''}Lead_File_Comparison_${dateSlug(o.period)}`)}.${o.format}`;
  const title = 'File comparison report';
  if (o.format === 'csv') return { buffer: csvWithMeta(title, meta, headers, rows), filename, contentType: CSV_TYPE };
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LeadPulse Analytics';
  addSheet(wb, 'File Comparison', headers, rows, { title, meta });
  const names = cmp.files.map((f) => f.fileName);
  addSheet(wb, 'Field Mapping', ['Standard field', ...names.flatMap((n) => [`${n}: column`, `${n}: missing %`])], cmp.fieldMatrix.map((r) => [r.label, ...names.flatMap((n) => [r.columns[n] ?? '— not present —', r.missingPct[n] ?? null])]));
  addSheet(wb, 'Column Differences', ['Column header', 'Present in', 'Missing from'], cmp.columnDifferences.map((d) => [d.header, d.presentIn.join('; '), d.missingFrom.join('; ')]));
  addSheet(wb, 'Overlaps', ['File A', 'File B', 'Matching leads', 'By Lead ID', 'By phone', 'By email'], cmp.overlaps.map((x) => [x.a, x.b, x.matchingLeads, x.byLeadId, x.byPhone, x.byEmail]));
  addSheet(
    wb,
    'Owners & Stages',
    ['File', 'Qualification rate %', 'Lead owners (leads)', 'Lead stages (leads)'],
    cmp.files.map((f) => [f.fileName, f.qualificationRate, f.owners.map((x) => `${x.label}: ${x.count}`).join('; '), f.stages.map((x) => `${x.label}: ${x.count}`).join('; ')]),
  );
  return { buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), filename, contentType: XLSX_TYPE };
}

// ---------------------------------------------------------------------------------------------
// Data-quality summary export
// ---------------------------------------------------------------------------------------------

export async function buildQualityExport(o: {
  format: ExportFormat;
  report: Report | null;
  issues: ValidationIssue[];
  rejected: { fileName: string; rowNumber: number; reason: string }[];
  audit: { at: string; action: string; detail: string }[];
  period: { from: string; to: string };
  generatedAt: Date;
  timezoneLabel: string;
}): Promise<ExportFile> {
  const r = o.report;
  const meta: Meta = [
    ['Generated', `${o.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC (${o.timezoneLabel})`],
    ['Reporting period', periodLabel(o.period)],
    ['Source files', r ? r.scope.fileNames.join(', ') : '—'],
    ['Total records', r ? String(r.quality.totalRecords) : 'N/A'],
    ['Valid leads', r ? String(r.quality.validLeads) : 'N/A'],
    ['Duplicate leads', r ? String(r.quality.duplicateLeads) : 'N/A'],
    ['Invalid records', r ? String(r.quality.invalidLeads) : 'N/A'],
    ['Validation success rate', r?.quality.validationSuccessRate !== null && r ? `${r.quality.validationSuccessRate}%` : 'N/A'],
  ];
  const filename = `${safeFilename(`lead_data_quality_report_${dateSlug(o.period)}`)}.${o.format}`;
  const title = 'Lead data-quality report';
  const byCode = new Map<string, { severity: string; message: string; n: number }>();
  for (const i of o.issues) {
    const k = `${i.code}|${i.field}`;
    const e = byCode.get(k) ?? { severity: i.severity, message: i.field ? `${i.field}: ${i.message}` : i.message, n: 0 };
    e.n++;
    byCode.set(k, e);
  }
  const issueSummary: Cell[][] = [...byCode.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => [k.split('|')[0], e.severity, e.message, e.n]);
  if (o.format === 'csv') return { buffer: csvWithMeta(title, meta, ['Issue code', 'Severity', 'Description', 'Rows'], issueSummary), filename, contentType: CSV_TYPE };
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LeadPulse Analytics';
  addSheet(wb, 'Summary', ['Issue code', 'Severity', 'Description', 'Rows'], issueSummary, { title, meta });
  if (r) {
    const t = buildTable('data-quality', r, []);
    addSheet(wb, 'Data Quality KPMs', t.columns.map((c) => c.header), t.rows);
  }
  addSheet(wb, 'Rejected Records', ['File', 'Row', 'Reason'], o.rejected.map((x) => [x.fileName, x.rowNumber, x.reason]));
  const ve = buildTable('validation-errors', r ?? ({} as Report), o.issues);
  addSheet(wb, 'Validation Errors', ve.columns.map((c) => c.header), ve.rows);
  addSheet(wb, 'Audit Trail', ['Time (UTC)', 'Action', 'Detail'], o.audit.map((a) => [a.at.replace('T', ' ').slice(0, 19), a.action, a.detail]));
  return { buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer), filename, contentType: XLSX_TYPE };
}
