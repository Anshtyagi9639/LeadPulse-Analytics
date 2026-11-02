import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { evaluate, toSerial, type Grid } from '../src/export/formula-eval.js';
import { sample } from './helpers.js';

const CLIENT = '22222222-3333-4444-8555-666666666666';
const RD = '2026-10-30';

const binary = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Expected Lead Contact Report figures computed directly from a SalesMax workbook with the reference rules. */
async function expectedFromWorkbook(file: string, reportDate: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const H = (ws.getRow(1).values as string[]).slice(1);
  const col = (h: string) => H.indexOf(h) + 1;
  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const o: Record<string, unknown> = {};
    for (const h of H) o[h] = ws.getRow(r).getCell(col(h)).value;
    if (o['LEAD NAME']) rows.push(o);
  }
  const rd = Date.UTC(Number(reportDate.slice(0, 4)), Number(reportDate.slice(5, 7)) - 1, Number(reportDate.slice(8, 10)));
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const fu = (r: Record<string, unknown>) => r['NEXT FOLLOWUP'] as Date | null;
  const owners = new Map<string, { leads: number; notWorked: number; qualified: number; totalCalls: number; callsToday: number }>();
  for (const r of rows) {
    const o = owners.get(String(r['LEAD OWNER'])) ?? { leads: 0, notWorked: 0, qualified: 0, totalCalls: 0, callsToday: 0 };
    o.leads++;
    if (r['AWAITING FIRST TOUCH'] === 'NOT_WORKED') o.notWorked++;
    if (r['LEAD STAGE'] === 'Qualified Lead') o.qualified++;
    o.totalCalls += num(r['TOTAL CALLS']);
    o.callsToday += num(r['CALLS TODAY']);
    owners.set(String(r['LEAD OWNER']), o);
  }
  return {
    kpis: {
      totalLeads: rows.length,
      notWorked: rows.filter((r) => r['AWAITING FIRST TOUCH'] === 'NOT_WORKED').length,
      workedAtLeastOnce: rows.filter((r) => typeof r.ATTEMPTS === 'number').length,
      qualified: rows.filter((r) => r['LEAD STAGE'] === 'Qualified Lead').length,
      totalAttempts: rows.reduce((s, r) => s + num(r.ATTEMPTS), 0),
      totalCalls: rows.reduce((s, r) => s + num(r['TOTAL CALLS']), 0),
      callsToday: rows.reduce((s, r) => s + num(r['CALLS TODAY']), 0),
      interested: rows.filter((r) => r['LEAD DISPOSITION'] === 'INTERESTED').length,
      overdueFollowUps: rows.filter((r) => fu(r) && fu(r)!.getTime() < rd).length,
      upcomingFollowUps: rows.filter((r) => fu(r) && fu(r)!.getTime() >= rd).length,
      noFollowUpDate: rows.filter((r) => !fu(r)).length,
    },
    owners,
  };
}

/** Recalculates every Summary Report formula of an exported workbook from its own Full Data sheet. */
async function recalc(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const grid: Grid = {
    get(sheet, row, col) {
      const v = wb.getWorksheet(sheet)!.getRow(row).getCell(col).value as unknown;
      if (v instanceof Date) return toSerial(v.getTime());
      // ExcelJS's reader drops a cached result of exactly 0 (the file itself stores <v>0</v>; checked below).
      if (v && typeof v === 'object') return ((v as { result?: number }).result ?? 0) as number | null;
      return (v ?? null) as string | number | null;
    },
  };
  let formulas = 0;
  const mismatches: string[] = [];
  wb.getWorksheet('Summary Report')!.eachRow((row) =>
    row.eachCell((c) => {
      const v = c.value as { formula?: string; result?: number } | null;
      if (!v || typeof v !== 'object' || !('formula' in v)) return;
      formulas++;
      const got = evaluate(v.formula!, grid, 'Summary Report');
      if (typeof got !== 'number' || Math.abs(got - (v.result ?? 0)) > 1e-9) mismatches.push(`${c.address} =${v.formula} cached ${v.result} got ${got}`);
    }),
  );
  // Every formula cell must carry a cached value (<f>…</f><v>…</v>) so tools that do not recalculate still see the figure.
  const xml = await (await JSZip.loadAsync(buf)).file('xl/worksheets/sheet1.xml')!.async('string');
  const uncached = (xml.match(/<\/f>(?!<v>)/g) ?? []).length;
  if (uncached) mismatches.push(`${uncached} formula cell(s) without a cached value`);
  return { wb, formulas, mismatches };
}

describe('Lead Contact Report (SalesMax)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leadpulse-contact-'));
  let ctx: Awaited<ReturnType<typeof createApp>>;
  let sid: string;
  const api = {
    get: (p: string) => request(ctx.app).get(p).set('X-Client-Id', CLIENT),
    post: (p: string) => request(ctx.app).post(p).set('X-Client-Id', CLIENT),
    patch: (p: string) => request(ctx.app).patch(p).set('X-Client-Id', CLIENT),
  };
  const fileId = async (prefix: string) => (await api.get(`/api/sessions/${sid}`)).body.files.find((f: { name: string }) => f.name.startsWith(prefix)).id as string;
  const download = async (rid: string) => (await api.get(`/api/sessions/${sid}/reports/${rid}/download`).buffer(true).parse(binary as never)).body as Buffer;

  beforeAll(async () => {
    ctx = await createApp(loadConfig({ NODE_ENV: 'test', TEMP_DIR: path.join(root, 's'), CONFIG_DIR: path.join(root, 'c') }), { aiClient: null });
    sid = (await api.post('/api/sessions').send({ reportingDate: RD })).body.id;
  });
  afterAll(async () => {
    await ctx.store.stop(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Test 2: one file — every SalesMax column auto-maps and the KPIs equal an independent calculation', async () => {
    const up = await api.post(`/api/sessions/${sid}/files`).attach('files', sample('08_salesmax_contact_export.xlsx'));
    const f = up.body.session.files[0];
    expect(f.status).toBe('ready');
    expect(Object.keys(f.mapping)).toHaveLength(16);
    const res = await api.get(`/api/sessions/${sid}/contact-report`);
    expect(res.status).toBe(200);
    const exp = await expectedFromWorkbook(sample('08_salesmax_contact_export.xlsx'), RD);
    const k = res.body.report.kpis;
    for (const [key, v] of Object.entries(exp.kpis)) expect(k[key], key).toBe(v);
    expect(k.qualificationRate).toBeCloseTo((exp.kpis.qualified / exp.kpis.totalLeads) * 100, 2);
    for (const o of res.body.report.owners) {
      const e = exp.owners.get(o.owner)!;
      expect({ leads: o.leads, notWorked: o.notWorked, qualified: o.qualified, totalCalls: o.totalCalls, callsToday: o.callsToday }).toEqual(e);
    }
    expect(res.body.report.stages.map((s: { stage: string }) => s.stage)[0]).toBe('New Inquiry Lead'); // pipeline order
    expect(res.body.report.missingFields).toEqual([]);
    expect(res.body.files[0].missingSalesmax).toEqual([]);
    // Dashboard qualified count uses the same rule ("Being Qualified" is not qualified).
    await api.post(`/api/sessions/${sid}/process`).send({});
    const dash = (await api.get(`/api/sessions/${sid}/report`)).body.report;
    expect(dash.overview.qualifiedLeads).toBe(exp.kpis.qualified);
  });

  it('Test 2/8: generated Excel has the reference layout, live formulas that recalculate, charts and correct formats', async () => {
    const gen = await api.post(`/api/sessions/${sid}/reports`).send({ type: 'contact', format: 'xlsx', timezoneLabel: 'IST, Asia/Kolkata' });
    expect(gen.status).toBe(201);
    const rep = gen.body.reports[0];
    expect(rep.status).toBe('completed');
    expect(rep.filename).toBe(`Lead_Contact_Report_${RD}.xlsx`);
    expect(rep.generationMs).toBeGreaterThanOrEqual(0);
    expect(rep.processingMs).toBeGreaterThan(0);
    expect(Date.parse(rep.generationCompletedAt)).toBeGreaterThanOrEqual(Date.parse(rep.generationStartedAt));
    expect(Date.parse(rep.uploadCompletedAt)).toBeGreaterThanOrEqual(Date.parse(rep.uploadStartedAt));
    const buf = await download(rep.id);
    const { wb, formulas, mismatches } = await recalc(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary Report', 'Full Data', 'Processing Details']);
    expect(formulas).toBeGreaterThan(60);
    expect(mismatches).toEqual([]);
    const sum = wb.getWorksheet('Summary Report')!;
    expect(sum.getCell('A7').value).toBe('Total leads');
    expect((sum.getCell('B7').value as { formula: string }).formula).toMatch(/^COUNTA\('Full Data'!\$A\$2:\$A\$61\)$/);
    expect((sum.getCell('B16').value as { formula: string }).formula).toBe("COUNTIFS('Full Data'!$J$2:$J$61,\"<\"&$B$3)");
    expect(sum.getCell('B3').value).toEqual(new Date(`${RD}T00:00:00Z`));
    const fd = wb.getWorksheet('Full Data')!;
    expect((fd.getRow(1).values as string[]).slice(1, 17)).toEqual(['LEAD NAME', 'LEAD OWNER', 'LEAD STAGE', 'AWAITING FIRST TOUCH', 'ATTEMPTS', 'TOTAL CALLS', 'CALLS TODAY', 'LAST WORKED', 'STARTED WORK ON', 'NEXT FOLLOWUP', 'LEAD DISPOSITION', 'LAST DISPOSITION ON', 'MOBILE NUMBER', 'EMAIL', 'LAST CALL OUTCOME', 'LAST CALLED BY']);
    expect(fd.rowCount).toBe(61);
    expect(fd.getCell('H2').value).toBeInstanceOf(Date);
    expect(fd.getCell('H2').numFmt).toBe('dd-mmm-yyyy hh:mm');
    expect(typeof fd.getCell('M2').value).toBe('number');
    expect(fd.getCell('M2').numFmt).toBe('0');
    // Native charts are present and referenced from the Summary sheet.
    const zip = await JSZip.loadAsync(buf);
    const charts = Object.keys(zip.files).filter((p) => /^xl\/charts\/chart\d+\.xml$/.test(p));
    expect(charts.length).toBe(5);
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<drawing r:id=');
    expect(await zip.file(charts[0])!.async('string')).toContain("'Summary Report'!$B$23:$B$");
  });

  it('Test 4: a file with different column names is mapped; missing columns are reported as N/A, not invented', async () => {
    const up = await api.post(`/api/sessions/${sid}/files`).attach('files', sample('09_salesmax_team_b.csv')).attach('files', sample('10_salesmax_partial.xlsx'));
    const b = up.body.session.files.find((f: { name: string }) => f.name.startsWith('09_'));
    const byHeader = Object.fromEntries(Object.entries(b.mapping as Record<string, string>).map(([c, k]) => [b.headers[Number(c)], k]));
    expect(byHeader).toMatchObject({ Name: 'name', Owner: 'assignedCounsellor', Stage: 'leadStage', 'First Touch': 'awaitingFirstTouch', Calls: 'totalCalls', 'Follow Up Date': 'nextFollowUpDate', Phone: 'phone', Disposition: 'leadDisposition', 'Call Outcome': 'lastCallOutcome', 'Called By': 'lastCalledBy' });
    const view = (await api.get(`/api/sessions/${sid}/contact-report?fileIds=${b.id}`)).body;
    expect(view.report.kpis.callsToday).toBeNull(); // no CALLS TODAY column in this file
    expect(view.report.missingFields).toEqual(['CALLS TODAY']);
    const partial = (await api.get(`/api/sessions/${sid}/contact-report?fileIds=${await fileId('10_')}`)).body;
    expect(partial.files[0].missingSalesmax).toEqual(expect.arrayContaining(['ATTEMPTS', 'TOTAL CALLS', 'LEAD DISPOSITION']));
    expect(partial.files[0].additionalColumns).toEqual(['Notes']);
    expect(partial.report.kpis.totalCalls).toBeNull();
    expect(partial.columns.find((c: { key: string }) => c.key === 'city').presentIn).toEqual(['10_salesmax_partial.xlsx']);
  });

  it('Test 5: invalid dates, empty rows, repeated phones and duplicate emails are flagged, not dropped', async () => {
    const b = await fileId('09_');
    const issues = (await api.get(`/api/sessions/${sid}/files/${b}/issues?limit=500`)).body.issues;
    expect(issues.filter((i: { code: string }) => i.code === 'INVALID_DATE').length).toBeGreaterThanOrEqual(2);
    const f = (await api.get(`/api/sessions/${sid}`)).body.files.find((x: { id: string }) => x.id === b);
    expect(f.validation.blankRows).toBeGreaterThan(0);
    const leads = (await api.get(`/api/sessions/${sid}/leads?pageSize=500&fileIds=${b}`)).body;
    expect(leads.total).toBe(f.validation.dataRows); // every row present
    const dup = leads.rows.filter((r: { status: string }) => r.status !== 'valid' && r.status !== 'invalid');
    expect(dup.length).toBeGreaterThanOrEqual(2); // repeated phone + duplicate email inside the file
  });

  it('Test 3: combined report across three files de-duplicates, and the comparison and duplicate-rule views agree', async () => {
    const ids = [await fileId('08_'), await fileId('09_'), await fileId('10_')];
    await api.post(`/api/sessions/${sid}/process`).send({ fileIds: ids });
    const view = (await api.get(`/api/sessions/${sid}/contact-report`)).body;
    expect(view.files).toHaveLength(3);
    expect(view.counts.duplicateRowsExcluded).toBeGreaterThan(0); // file 09 reuses contacts from file 08
    expect(view.counts.reportedLeads).toBe(view.counts.accepted - view.counts.duplicateRowsExcluded);
    expect(view.report.kpis.totalLeads).toBe(view.counts.reportedLeads);
    const rules = (await api.get(`/api/sessions/${sid}/duplicate-rules`)).body.rules;
    const countAll = rules.find((r: { mode: string }) => r.mode === 'count_all');
    const current = rules.find((r: { current: boolean }) => r.current);
    expect(countAll.leadsInReport).toBe(view.counts.accepted);
    expect(current.leadsInReport).toBe(view.counts.reportedLeads);
    // Rule comparison never changes the session
    expect((await api.get(`/api/sessions/${sid}/contact-report`)).body.counts.reportedLeads).toBe(view.counts.reportedLeads);

    const gen = (await api.post(`/api/sessions/${sid}/reports`).send({ type: 'contact', format: 'xlsx' })).body.reports[0];
    expect(gen.filename).toBe(`Combined_Lead_Report_${RD}.xlsx`);
    expect(gen.totalLeads).toBe(view.counts.reportedLeads);
    const { wb, mismatches } = await recalc(await download(gen.id));
    expect(mismatches).toEqual([]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary Report', 'Full Data', 'Duplicate Leads', 'Invalid or Incomplete Leads', 'File Comparison', 'Processing Details']);
    expect(wb.getWorksheet('Full Data')!.rowCount - 1).toBe(view.counts.reportedLeads);
    const proc = wb.getWorksheet('Processing Details')!;
    const procText = JSON.stringify(proc.getSheetValues());
    expect(procText).toContain('Records excluded as duplicates');
    expect(procText).toContain('Column mapping');

    const cmp = (await api.post(`/api/sessions/${sid}/reports`).send({ type: 'comparison', format: 'xlsx' })).body.reports[0];
    expect(cmp.filename).toBe(`Lead_File_Comparison_${RD}.xlsx`);
    const ind = (await api.post(`/api/sessions/${sid}/reports`).send({ type: 'individual', format: 'xlsx' })).body.reports;
    expect(ind.map((r: { filename: string }) => r.filename)).toEqual([`Lead_Contact_Report_08_salesmax_contact_export_${RD}.xlsx`, `Lead_Contact_Report_09_salesmax_team_b_${RD}.xlsx`, `Lead_Contact_Report_10_salesmax_partial_${RD}.xlsx`]);
    const zip = await api.get(`/api/sessions/${sid}/reports/zip?ids=${ind.map((r: { id: string }) => r.id).join(',')}`).buffer(true).parse(binary as never);
    expect(Object.keys((await JSZip.loadAsync(zip.body as Buffer)).files)).toHaveLength(3);
  });

  it('Test 6: filters — KPIs, lead table and the downloaded report agree; column selection and renaming apply', async () => {
    const owner = 'Owner Alpha';
    const view = (await api.get(`/api/sessions/${sid}/contact-report?owners=${encodeURIComponent(owner)}&followUp=overdue`)).body;
    const table = (await api.get(`/api/sessions/${sid}/leads?pageSize=500&owners=${encodeURIComponent(owner)}&followUp=overdue&statuses=valid,possible_duplicate`)).body;
    expect(view.report.kpis.totalLeads).toBe(view.counts.filteredLeads);
    expect(view.report.kpis.overdueFollowUps).toBe(view.counts.filteredLeads);
    expect(table.total).toBe(view.counts.filteredLeads);
    const gen = (
      await api.post(`/api/sessions/${sid}/reports`).send({
        type: 'contact',
        format: 'xlsx',
        filters: { owners: [owner], followUp: ['overdue'] },
        columns: [
          { key: 'name', header: 'Student' },
          { key: 'assignedCounsellor', header: 'LEAD OWNER' },
          { key: 'nextFollowUpDate', header: 'NEXT FOLLOWUP' },
          { key: 'phone', header: 'MOBILE NUMBER' },
        ],
      })
    ).body.reports[0];
    const { wb, mismatches } = await recalc(await download(gen.id));
    expect(mismatches).toEqual([]);
    const fd = wb.getWorksheet('Full Data')!;
    expect((fd.getRow(1).values as string[]).slice(1, 5)).toEqual(['Student', 'LEAD OWNER', 'NEXT FOLLOWUP', 'MOBILE NUMBER']);
    expect(fd.rowCount - 1).toBe(view.counts.filteredLeads);
    const sum = wb.getWorksheet('Summary Report')!;
    const b7 = sum.getCell('B7').value as { result: number };
    expect(b7.result).toBe(view.counts.filteredLeads);
    // TOTAL CALLS was not selected, so that figure is written as a verified value and listed as such.
    expect(sum.getCell('B13').value).toBe(view.report.kpis.totalCalls);
    expect(JSON.stringify(wb.getWorksheet('Processing Details')!.getSheetValues())).toContain('Total calls');
  });

  it('CSV and PDF downloads contain the report', async () => {
    const view = (await api.get(`/api/sessions/${sid}/contact-report`)).body;
    const csv = (await api.post(`/api/sessions/${sid}/reports`).send({ type: 'contact', format: 'csv' })).body.reports[0];
    const text = (await api.get(`/api/sessions/${sid}/reports/${csv.id}/download`)).text;
    expect(text.replace(/^\ufeff/, '').split('\r\n')[0]).toMatch(/^LEAD NAME,LEAD OWNER,LEAD STAGE/);
    expect(text.trim().split('\r\n').length - 1).toBe(view.counts.reportedLeads);
    const pdf = (await api.post(`/api/sessions/${sid}/reports`).send({ type: 'contact', format: 'pdf' })).body.reports[0];
    expect((await download(pdf.id)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('Test 7: report history records each report with timings, status and download times', async () => {
    const list = (await api.get(`/api/sessions/${sid}/reports`)).body.reports;
    expect(list.length).toBeGreaterThanOrEqual(9);
    for (const r of list) {
      expect(r.status).toBe('completed');
      expect(r.path).toBeUndefined(); // server paths are never exposed
      expect(r.generationMs).toBeGreaterThanOrEqual(0);
    }
    const hist = (await api.get('/api/history')).body.entries[0];
    expect(hist.reports.length).toBe(list.length);
    const downloaded = hist.reports.find((r: { downloads: string[] }) => r.downloads.length > 0);
    expect(downloaded).toBeTruthy();
    expect(hist.reports.every((r: { fileAvailable: boolean }) => r.fileAvailable)).toBe(true);
    const raw = fs.readFileSync(path.join(root, 'c', 'report-history.json'), 'utf8');
    expect(raw).not.toMatch(/lead\.sample\.\d+@example\.com|Lead Sample \d+|9000200\d{3}/); // no lead data persisted
  });

  it('testing mode labels reports TEST and keeps them separate', async () => {
    const t = (await api.post('/api/sessions').send({ reportingDate: RD, mode: 'test' })).body;
    expect(t.mode).toBe('test');
    await api.post(`/api/sessions/${t.id}/files`).attach('files', sample('08_salesmax_contact_export.xlsx'));
    const rep = (await api.post(`/api/sessions/${t.id}/reports`).send({ type: 'contact', format: 'xlsx' })).body.reports[0];
    expect(rep.test).toBe(true);
    expect(rep.filename).toBe(`TEST_Lead_Contact_Report_${RD}.xlsx`);
    const buf = (await api.get(`/api/sessions/${t.id}/reports/${rep.id}/download`).buffer(true).parse(binary as never)).body as Buffer;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(String(wb.getWorksheet('Summary Report')!.getCell('A1').value)).toMatch(/^TEST REPORT/);
    const hist = (await api.get('/api/history')).body.entries.find((e: { id: string }) => e.id === t.id);
    expect(hist.mode).toBe('test');
    expect((await api.post(`/api/sessions/${t.id}/reports`).send({ type: 'contact', format: 'xlsx', columns: [{ key: 'nope', header: 'X' }] })).status).toBe(400);
  });
});
