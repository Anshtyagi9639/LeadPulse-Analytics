/**
 * Test 1 — compares LeadPulse's Lead Contact Report with a reference SalesMax workbook's "Summary Report".
 *
 * Usage: npx tsx scripts/verify-reference.ts "<path to Lead_Contact_Report_*.xlsx>"
 *
 * The reference file holds real lead data, so it is read from where it is (never copied into the repo) and this
 * script prints only aggregates, owner names (staff), stage/disposition labels and PASS/FAIL — no lead names,
 * phone numbers or emails.
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildContactReport } from '../src/domain/contact-report.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npx tsx scripts/verify-reference.ts <reference.xlsx>');
  process.exit(2);
}

type Cached = number | string | null;
const ref = new ExcelJS.Workbook();
await ref.xlsx.readFile(file);
const sum = ref.getWorksheet('Summary Report');
if (!sum) throw new Error('No "Summary Report" sheet in the reference workbook.');
const val = (addr: string): Cached => {
  const v = sum.getCell(addr).value as unknown;
  // Formula cells: use Excel's cached result (a formula Excel never cached evaluates to 0 here: COUNTIFS with no match).
  if (v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object))) return ((v as { result?: Cached }).result ?? 0) as Cached;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return (v as Cached) ?? null;
};
/** Rows of a summary table: label in column A until "Total". */
const table = (headerRow: number, cols: string[]) => {
  const out: { label: string; values: Cached[] }[] = [];
  for (let r = headerRow + 1; r < headerRow + 60; r++) {
    const label = sum.getCell(`A${r}`).value;
    if (label === null || label === undefined || label === 'Total') break;
    out.push({ label: label instanceof Date ? label.toISOString().slice(0, 10) : String(label), values: cols.map((c) => val(`${c}${r}`)) });
  }
  return out;
};
const findRow = (title: string) => {
  for (let r = 1; r <= sum.rowCount; r++) if (String(sum.getCell(`A${r}`).value ?? '').startsWith(title)) return r;
  throw new Error(`Section "${title}" not found`);
};

const reportDate = String(val('B3'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-ref-'));
const { service, store } = await createApp(loadConfig({ NODE_ENV: 'test', TEMP_DIR: tmp, CONFIG_DIR: tmp }), { aiClient: null });
let failures = 0;
try {
  const s = await store.create(reportDate);
  const buf = fs.readFileSync(file);
  const [f] = await service.addFiles(s, [{ originalname: path.basename(file), buffer: buf, size: buf.length }]);
  console.log(`File status: ${f.status}; sheet "${f.workbook?.sheets[f.sheetIndex]?.name}"; ${f.validation?.dataRows} rows; ${f.validation?.accepted} accepted; ${f.validation?.rejected} rejected`);
  console.log(`Auto-mapping: ${Object.entries(f.mapping).map(([c, k]) => `${f.headers[Number(c)]} → ${k}`).join('; ')}`);
  const unmapped = f.headers.filter((_, i) => !f.mapping[String(i)]);
  console.log(`Unmapped columns: ${unmapped.join(', ') || 'none'}`);
  await service.updateSettings(s, { duplicateMode: 'count_all' }); // the reference keeps every row
  await service.process(s);
  const mapped = new Set(Object.values(f.mapping));
  const ours = buildContactReport(f.validation!.leads, reportDate, mapped);

  const check = (label: string, expected: Cached, actual: number | string | null | undefined) => {
    const e = typeof expected === 'number' ? Math.round(expected * 10000) / 10000 : expected;
    const a = typeof actual === 'number' ? Math.round(actual * 10000) / 10000 : actual;
    const ok = e === a || (e === 0 && (a === null || a === undefined)) || (e === null && a === 0);
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(44)} reference=${String(e).padEnd(10)} leadpulse=${a}`);
  };

  console.log(`\nReport date: ${reportDate}\n— Key numbers`);
  const k = ours.kpis;
  check('Total leads', val('B7'), k.totalLeads);
  check('Leads not yet worked (NOT_WORKED)', val('B8'), k.notWorked);
  check('Leads worked at least once', val('B9'), k.workedAtLeastOnce);
  check('Qualified leads', val('B10'), k.qualified);
  check('Qualification rate (fraction)', val('B11'), k.qualificationRate === null ? null : k.qualificationRate / 100);
  check('Total attempts', val('B12'), k.totalAttempts);
  check('Total calls', val('B13'), k.totalCalls);
  check('Calls today', val('B14'), k.callsToday);
  check('Leads marked INTERESTED', val('B15'), k.interested);
  check('Overdue follow-ups', val('B16'), k.overdueFollowUps);
  check('Follow-ups on/after report date', val('B17'), k.upcomingFollowUps);
  check('Leads with no follow-up date', val('B18'), k.noFollowUpDate);

  console.log('— Performance by Lead Owner');
  for (const row of table(findRow('Lead Owner'), ['B', 'C', 'D', 'E', 'F'])) {
    const o = ours.owners.find((x) => x.owner === row.label);
    const names = ['Leads', 'Not Worked', 'Qualified', 'Total Calls', 'Calls Today'];
    const vals = o ? [o.leads, o.notWorked, o.qualified, o.totalCalls, o.callsToday] : [];
    row.values.forEach((v, i) => check(`${row.label} — ${names[i]}`, v, vals[i]));
  }
  console.log('— Leads by Stage');
  for (const row of table(findRow('Lead Stage'), ['B', 'C'])) {
    const st = ours.stages.find((x) => x.stage === row.label);
    check(`${row.label} — leads`, row.values[0], st?.leads);
    check(`${row.label} — % of total (fraction)`, row.values[1], st?.pct === null || st?.pct === undefined ? null : st.pct / 100);
  }
  console.log('— Lead Disposition');
  for (const row of table(findRow('Disposition'), ['B'])) {
    const d = ours.dispositions.find((x) => x.disposition === row.label);
    check(`${row.label}`, row.values[0], d?.leads);
  }
  console.log('— Leads Last Worked by Date');
  for (const row of table(findRow('Date'), ['B'])) {
    const d = ours.lastWorkedByDate.find((x) => x.date === row.label);
    check(`${row.label}`, row.values[0], d?.leads ?? 0);
  }
  console.log(`\nOrder check — stages: ${ours.stages.map((x) => x.stage).join(' | ')}`);
  console.log(`Order check — owners: ${ours.owners.map((x) => x.owner).join(' | ')}`);
  console.log(`Notes generated:\n  - ${ours.notes.join('\n  - ')}`);
  console.log(`\n${failures ? `${failures} MISMATCH(ES)` : 'ALL FIGURES MATCH THE REFERENCE WORKBOOK'}`);
} finally {
  await store.stop(true);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
