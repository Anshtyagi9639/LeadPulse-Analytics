/**
 * Test 8 helper — generates a Lead Contact Report from one or more input files, saves it to an output folder,
 * then re-opens the saved workbook and recalculates every Summary formula from its Full Data sheet.
 *
 * Usage: npx tsx scripts/verify-export.ts <outDir> <reportDate> <file1> [file2 …]
 * Prints sheet names, row counts, formula checks and KPI values only (no lead names, phones or emails).
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { evaluate, toSerial, type Grid } from '../src/export/formula-eval.js';

const [outDir, reportDate, ...inputs] = process.argv.slice(2);
if (!outDir || !reportDate || !inputs.length) {
  console.error('Usage: npx tsx scripts/verify-export.ts <outDir> <reportDate> <file> [file …]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-export-'));
const { service, store, reports } = await createApp(loadConfig({ NODE_ENV: 'test', TEMP_DIR: tmp, CONFIG_DIR: tmp }), { aiClient: null });
let problems = 0;
try {
  const s = await store.create(reportDate);
  await service.addFiles(s, inputs.map((p) => ({ originalname: path.basename(p), buffer: fs.readFileSync(p), size: fs.statSync(p).size })));
  await service.process(s);
  const view = reports.view(s, {});
  const generated = [];
  for (const format of ['xlsx', 'csv', 'pdf'] as const) generated.push(...(await reports.generate(s, { type: 'contact', format, timezoneLabel: 'IST, Asia/Kolkata' })));
  if (inputs.length > 1) generated.push(...(await reports.generate(s, { type: 'individual', format: 'xlsx' })), ...(await reports.generate(s, { type: 'comparison', format: 'xlsx' })));
  for (const g of generated) {
    const file = await reports.download(s, g.id);
    fs.writeFileSync(path.join(outDir, file.filename), file.buffer);
    console.log(`${g.status.toUpperCase()}  ${file.filename}  ${file.buffer.length} bytes  generation ${g.generationMs} ms  processing ${g.processingMs} ms  leads ${g.totalLeads ?? '-'}`);
  }
  const main = generated.find((g) => g.format === 'xlsx' && (g.type === 'contact' || g.type === 'combined'))!;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(outDir, main.filename));
  console.log(`\nSheets: ${wb.worksheets.map((w) => `${w.name} (${w.rowCount} rows)`).join(', ')}`);
  const fd = wb.getWorksheet('Full Data')!;
  console.log(`Full Data: ${fd.rowCount - 1} lead rows; headers: ${(fd.getRow(1).values as string[]).slice(1).join(' | ')}`);
  const grid: Grid = {
    get(sheet, row, col) {
      const v = wb.getWorksheet(sheet)!.getRow(row).getCell(col).value as unknown;
      if (v instanceof Date) return toSerial(v.getTime());
      // ExcelJS's reader drops a cached result of exactly 0; the file stores <v>0</v>.
      if (v && typeof v === 'object') return ((v as { result?: number }).result ?? 0) as number | null;
      return (v ?? null) as string | number | null;
    },
  };
  let formulas = 0;
  const sum = wb.getWorksheet('Summary Report')!;
  sum.eachRow((row) =>
    row.eachCell((c) => {
      const v = c.value as { formula?: string; result?: number } | null;
      if (!v || typeof v !== 'object' || !('formula' in v)) return;
      formulas++;
      const got = evaluate(v.formula!, grid, 'Summary Report');
      if (typeof got !== 'number' || Math.abs(got - (v.result ?? 0)) > 1e-9) {
        problems++;
        console.log(`FORMULA MISMATCH ${c.address}: =${v.formula} cached ${v.result} recalculated ${got}`);
      }
    }),
  );
  console.log(`Summary formulas: ${formulas}, all recalculate to their cached values: ${problems === 0 ? 'yes' : 'NO'}`);
  const val = (a: string) => {
    const v = sum.getCell(a).value as { result?: number } | number;
    return typeof v === 'object' && v ? (v.result ?? 0) : v; // ExcelJS reads a cached 0 as undefined
  };
  const k = view.report.kpis;
  const pairs: [string, unknown, unknown][] = [
    ['Total leads', val('B7'), k.totalLeads],
    ['Not worked', val('B8'), k.notWorked],
    ['Worked at least once', val('B9'), k.workedAtLeastOnce],
    ['Qualified', val('B10'), k.qualified],
    ['Total attempts', val('B12'), k.totalAttempts],
    ['Total calls', val('B13'), k.totalCalls],
    ['Calls today', val('B14'), k.callsToday],
    ['INTERESTED', val('B15'), k.interested],
    ['Overdue follow-ups', val('B16'), k.overdueFollowUps],
    ['Follow-ups on/after report date', val('B17'), k.upcomingFollowUps],
    ['No follow-up date', val('B18'), k.noFollowUpDate],
  ];
  for (const [label, file, dash] of pairs) {
    const ok = file === dash || (file === 'N/A' && dash === null);
    if (!ok) problems++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)} excel=${String(file).padEnd(6)} dashboard=${dash}`);
  }
  const csv = fs.readFileSync(path.join(outDir, generated.find((g) => g.format === 'csv')!.filename), 'utf8');
  const csvRows = csv.replace(/^\ufeff/, '').trim().split(/\r\n/).length - 1;
  console.log(`CSV data rows: ${csvRows} (expected ${k.totalLeads})`);
  if (csvRows !== k.totalLeads) problems++;
} finally {
  await store.stop(true);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(problems ? `\n${problems} PROBLEM(S)` : '\nEXPORT VERIFIED');
process.exit(problems ? 1 : 0);
