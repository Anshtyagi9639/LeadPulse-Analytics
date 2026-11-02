import ExcelJS from 'exceljs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { REPORT_DATE, sample } from './helpers.js';

const CLIENT = '11111111-2222-4333-8444-555555555555';
const OTHER_CLIENT = '99999999-2222-4333-8444-555555555555';

/** Minimal RFC 4180 CSV parser (quotes, doubled quotes, commas and newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const t = text.replace(/^\ufeff/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || (ch === '\r' && t[i + 1] === '\n')) {
      if (ch === '\r') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Splits a lead CSV export into its information block and its table. */
function csvTable(text: string) {
  const rows = parseCsv(text);
  const blank = rows.findIndex((r) => r.length === 1 && r[0] === '');
  const meta = Object.fromEntries(rows.slice(1, blank).map((r) => [r[0], r[1]]));
  const headers = rows[blank + 1];
  const data = rows.slice(blank + 2).filter((r) => r.length > 1);
  return { title: rows[0][0], meta, headers, data, col: (name: string) => headers.indexOf(name) };
}

const binary = (res: NodeJS.ReadableStream, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function makeApp(dirs: { temp: string; config: string }) {
  const config = loadConfig({ NODE_ENV: 'test', TEMP_DIR: dirs.temp, CONFIG_DIR: dirs.config });
  return createApp(config, { aiClient: null });
}

describe('Multi-file testing, lead table, comparison, exports and history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leadpulse-upgrade-'));
  const dirs = { temp: path.join(root, 'sessions'), config: path.join(root, 'config') };
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  let sid: string;
  const api = () => ({
    get: (p: string) => request(ctx.app).get(p).set('X-Client-Id', CLIENT),
    post: (p: string) => request(ctx.app).post(p).set('X-Client-Id', CLIENT),
    put: (p: string) => request(ctx.app).put(p).set('X-Client-Id', CLIENT),
    patch: (p: string) => request(ctx.app).patch(p).set('X-Client-Id', CLIENT),
    del: (p: string) => request(ctx.app).delete(p).set('X-Client-Id', CLIENT),
  });
  const fileId = async (prefix: string) => (await api().get(`/api/sessions/${sid}`)).body.files.find((f: { name: string }) => f.name.startsWith(prefix)).id as string;

  beforeAll(async () => {
    ctx = await makeApp(dirs);
    sid = (await api().post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
  });
  afterAll(async () => {
    await ctx.store.stop(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('Test A: one file — every data row appears in the lead table with a status, nothing is dropped', async () => {
    const up = await api().post(`/api/sessions/${sid}/files`).attach('files', sample('03_ielts_leads.csv'));
    const f = up.body.session.files[0];
    expect(f.uploadStartedAt).toBeTruthy();
    expect(f.uploadCompletedAt).toBeTruthy();
    expect(f.processingMs).toBeGreaterThanOrEqual(0);
    const res = await api().get(`/api/sessions/${sid}/leads?pageSize=500`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(f.validation.dataRows); // accepted + rejected; blanks are not records
    const invalid = res.body.rows.filter((r: { status: string }) => r.status === 'invalid');
    expect(invalid).toHaveLength(f.validation.rejected);
    expect(invalid[0].rejectReason).toMatch(/No Lead ID/);
    // Original values are preserved exactly (leading zero kept), cleaned values are normalised.
    const row = res.body.rows.find((r: { status: string }) => r.status === 'valid');
    expect(row.original['Phone']).toMatch(/^0\d{10}$/);
    expect(row.std.phone).toMatch(/^\d{10}$/);
    expect(res.body.columns.original).toContain('UTM Campaign');
    const proc = await api().post(`/api/sessions/${sid}/process`).send({});
    expect(proc.body.report.lastProcessingMs).toBeGreaterThanOrEqual(0);
    expect(proc.body.report.generatedAt).toBeTruthy();
  });

  it('Test G: the same file uploaded twice is rejected; a file can be replaced', async () => {
    const dup = await api().post(`/api/sessions/${sid}/files`).attach('files', sample('03_ielts_leads.csv'));
    const again = dup.body.session.files.at(-1);
    expect(again.status).toBe('error');
    expect(again.error.code).toBe('DUPLICATE_FILE');
    await api().del(`/api/sessions/${sid}/files/${again.id}`);
    // Replace the IELTS file with the partner file; the report follows the replacement.
    const ielts = await fileId('03_');
    const rep = await api().post(`/api/sessions/${sid}/files?replace=${ielts}`).attach('files', sample('07_partner-referrals_leads.csv'));
    expect(rep.status).toBe(201);
    const names = rep.body.session.files.map((x: { name: string }) => x.name);
    expect(names).toEqual(['07_partner-referrals_leads.csv']);
    expect(rep.body.session.report.fileIds).toHaveLength(1);
  });

  it('Test B/C: comparison across three files with different columns and overlapping contacts', async () => {
    await api().post(`/api/sessions/${sid}/files`).attach('files', sample('01_study-abroad-dubai_leads.xlsx')).attach('files', sample('02_australia-nz_leads.xlsx'));
    const res = await api().get(`/api/sessions/${sid}/comparison`);
    expect(res.status).toBe(200);
    const c = res.body;
    expect(c.files).toHaveLength(3);
    for (const f of c.files) {
      expect(f.totalRecords).toBe(f.processedLeads + f.invalidRecords);
      expect(f.qualityScore).toBeGreaterThan(0);
      expect(f.timing.uploadCompletedAt).toBeTruthy();
    }
    const partner = c.files.find((f: { fileName: string }) => f.fileName.startsWith('07_'));
    expect(partner.withinFileDuplicates).toBeGreaterThanOrEqual(1); // exact duplicate row inside the file
    expect(partner.failures[0].reason).toMatch(/No Lead ID/);
    expect(partner.contact.validPhonePct).toBeLessThan(100); // some phones are blank
    // Partner file re-uses contacts from the Dubai/ANZ files.
    const overlapTotal = c.overlaps.reduce((s: number, o: { matchingLeads: number }) => s + o.matchingLeads, 0);
    expect(overlapTotal).toBeGreaterThan(0);
    expect(c.highlights.mostValidLeads.fileName).toMatch(/^01_/);
    expect(c.highlights.bestQuality).toBeTruthy();
    // Column differences: 'Telecaller' only exists in the partner file; field matrix shows each file's column name.
    expect(c.columnDifferences.find((d: { header: string }) => d.header === 'Telecaller').presentIn).toEqual(['07_partner-referrals_leads.csv']);
    const phone = c.fieldMatrix.find((m: { key: string }) => m.key === 'phone');
    expect(phone.columns['07_partner-referrals_leads.csv']).toBe('Mobile');
    expect(phone.columns['02_australia-nz_leads.xlsx']).toBe('Contact No');
    expect(phone.missingPct['07_partner-referrals_leads.csv']).toBeGreaterThan(0);
  });

  it('Test B: cross-file presence filters and nothing is merged or deleted automatically', async () => {
    const all = await api().get(`/api/sessions/${sid}/leads?pageSize=5&fileIds=${await fileId('01_')},${await fileId('02_')},${await fileId('07_')}`);
    const multi = await api().get(`/api/sessions/${sid}/leads?pageSize=500&presence=in_multiple_files&fileIds=${await fileId('01_')},${await fileId('02_')},${await fileId('07_')}`);
    const unique = await api().get(`/api/sessions/${sid}/leads?pageSize=5&presence=unique_to_file&fileIds=${await fileId('01_')},${await fileId('02_')},${await fileId('07_')}`);
    expect(multi.body.total).toBeGreaterThan(0);
    for (const r of multi.body.rows) expect(r.alsoIn.length).toBeGreaterThan(0);
    const invalid = all.body.facets.statuses.find((s: { value: string }) => s.value === 'invalid')?.count ?? 0;
    expect(multi.body.total + unique.body.total + invalid).toBe(all.body.total);
    // Every source row is still present (duplicates are flagged, not removed).
    const s = (await api().get(`/api/sessions/${sid}`)).body;
    const dataRows = s.files.reduce((n: number, f: { validation: { dataRows: number } }) => n + f.validation.dataRows, 0);
    expect(all.body.total).toBe(dataRows);
  });

  it('Test D: testing mode previews do not change the session report; combined and per-file results agree', async () => {
    const before = (await api().get(`/api/sessions/${sid}/report`)).body.report;
    const ids = [await fileId('01_'), await fileId('02_'), await fileId('07_')];
    const perFile = [];
    for (const id of ids) perFile.push((await api().get(`/api/sessions/${sid}/report/preview?fileIds=${id}`)).body.report);
    const combined = (await api().get(`/api/sessions/${sid}/report/preview?fileIds=${ids.join(',')}`)).body.report;
    const after = (await api().get(`/api/sessions/${sid}/report`)).body.report;
    expect(after.generatedAt).toBe(before.generatedAt); // unchanged
    expect(after.scope.fileNames).toEqual(['07_partner-referrals_leads.csv']);
    expect(combined.counts.rawRows).toBe(perFile.reduce((s, r) => s + r.counts.rawRows, 0));
    expect(combined.quality.invalidLeads).toBe(perFile.reduce((s, r) => s + r.quality.invalidLeads, 0));
    // Cross-file duplicates make the combined unique count smaller than the sum of per-file unique counts.
    expect(combined.counts.uniqueLeads).toBeLessThanOrEqual(perFile.reduce((s, r) => s + r.counts.uniqueLeads, 0));
    expect(combined.quality.totalRecords).toBe(combined.counts.rawRows);
    expect(combined.trend.granularity).toBe('hour');
    expect(combined.trend.points.reduce((s: number, p: { leads: number }) => s + p.leads, 0) + combined.trend.undated).toBe(combined.counts.reportedLeads);
    expect(combined.statusDistribution.length).toBeGreaterThan(1);
    // Process all three for the remaining tests.
    const proc = await api().post(`/api/sessions/${sid}/process`).send({ fileIds: ids });
    expect(proc.status).toBe(200);
  });

  it('Test E: a filtered CSV export contains exactly the rows of the filtered table', async () => {
    const query = { statuses: ['valid'], campaigns: ['SA Dubai Oct Lead Gen'], flags: [] as string[], search: '' };
    const table = await api().get(`/api/sessions/${sid}/leads?pageSize=500&statuses=valid&campaigns=${encodeURIComponent('SA Dubai Oct Lead Gen')}`);
    expect(table.body.total).toBeGreaterThan(10);
    const res = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'csv', variant: 'cleaned', query: { statuses: query.statuses, campaigns: query.campaigns } });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`valid_leads_${REPORT_DATE}.csv`);
    const t = csvTable(res.text);
    expect(t.title).toBe('Lead report');
    expect(t.data).toHaveLength(table.body.total);
    expect(t.meta['Applied filters']).toContain('SA Dubai Oct Lead Gen');
    expect(new Set(t.data.map((r) => r[t.col('Status')]))).toEqual(new Set(['Valid']));
    // Selected rows only
    const uids = table.body.rows.slice(0, 3).map((r: { uid: string }) => r.uid);
    const sel = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'csv', variant: 'cleaned', uids });
    expect(sel.headers['content-disposition']).toContain('selected_leads_');
    expect(csvTable(sel.text).data).toHaveLength(3);
    // Nothing matches -> clear error, no file
    const none = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'csv', query: { search: 'no-such-lead-zzz' } });
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('NOTHING_TO_EXPORT');
  });

  it('Test F: CSV and XLSX keep headers, counts, leading zeros, phone numbers, dates, Unicode, commas and quotes', async () => {
    const partner = await fileId('07_');
    const csv = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'csv', variant: 'both', query: { fileIds: [partner] } });
    expect(csv.headers['content-disposition']).toContain(`file_07_partner-referrals_leads_lead_report_${REPORT_DATE}.csv`);
    const t = csvTable(csv.text);
    const source = parseCsv(fs.readFileSync(sample('07_partner-referrals_leads.csv'), 'utf8')).filter((r) => r.length > 1);
    expect(t.data).toHaveLength(source.length - 1); // every data row, including duplicate and invalid ones
    expect(t.headers).toEqual(expect.arrayContaining(['Status', 'Data-quality flags', 'Ref No (original)', 'Applicant (original)', 'Mobile (original)', 'Lead ID', 'Phone Number']));
    const refs = t.data.map((r) => r[t.col('Ref No (original)')]);
    expect(refs).toContain('007100'); // leading zeros preserved
    const names = t.data.map((r) => r[t.col('Applicant (original)')]);
    expect(names).toEqual(expect.arrayContaining(['आरव Testwala', 'Zoë O’Brien-Sample']));
    const camps = t.data.map((r) => r[t.col('Campaign (original)')]);
    expect(camps).toContain('Spring "Fast-Track", UK');
    expect(t.data.map((r) => r[t.col('Mobile (original)')]).some((m) => /^0\d{10}$/.test(m))).toBe(true);
    expect(t.data.map((r) => r[t.col('Lead Created Date')]).filter(Boolean)[0]).toMatch(/^2026-10-30 \d{2}:\d{2}$/);
    expect(t.data.map((r) => r[t.col('Status')])).toEqual(expect.arrayContaining(['Invalid', 'Duplicate']));

    const xres = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'xlsx', variant: 'both', query: { fileIds: [partner] } }).buffer(true).parse(binary as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xres.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Leads']);
    const ws = wb.getWorksheet('Leads')!;
    const hdr = (ws.getRow(1).values as string[]).slice(1);
    expect(ws.rowCount - 1).toBe(source.length - 1);
    const refCol = hdr.indexOf('Ref No (original)') + 1;
    const values: unknown[] = [];
    ws.eachRow((row, i) => i > 1 && values.push(row.getCell(refCol).value));
    expect(values).toContain('007100');
    expect(ws.getRow(2).getCell(refCol).numFmt).toBe('@');

    // Phone numbers like "+91 90000 10001" are not mangled by formula protection.
    const anz = await api().post(`/api/sessions/${sid}/export/leads`).send({ format: 'csv', variant: 'original', query: { fileIds: [await fileId('02_')] } });
    const at = csvTable(anz.text);
    expect(at.data[0][at.col('Contact No')]).toMatch(/^\+91 \d{5} \d{5}$/);
  });

  it('exports the file comparison and data-quality reports with meaningful names', async () => {
    const cmp = await api().get(`/api/sessions/${sid}/export/comparison?format=xlsx`).buffer(true).parse(binary as never);
    expect(cmp.status).toBe(200);
    expect(cmp.headers['content-disposition']).toContain(`Lead_File_Comparison_${REPORT_DATE}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(cmp.body as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['File Comparison', 'Field Mapping', 'Column Differences', 'Overlaps', 'Owners & Stages']);
    const q = await api().get(`/api/sessions/${sid}/export/quality?format=xlsx`).buffer(true).parse(binary as never);
    expect(q.headers['content-disposition']).toContain(`lead_data_quality_report_${REPORT_DATE}.xlsx`);
    const wq = new ExcelJS.Workbook();
    await wq.xlsx.load(q.body as never);
    expect(wq.worksheets.map((w) => w.name)).toEqual(['Summary', 'Data Quality KPMs', 'Rejected Records', 'Validation Errors', 'Audit Trail']);
    const qcsv = await api().get(`/api/sessions/${sid}/export/quality?format=csv`);
    expect(csvTable(qcsv.text).headers).toEqual(['Issue code', 'Severity', 'Description', 'Rows']);
  });

  it('configurable match rules change duplicate detection; the audit trail records decisions without lead data', async () => {
    const before = (await api().get(`/api/sessions/${sid}/report`)).body.report.counts;
    await api().patch(`/api/sessions/${sid}/settings`).send({ matchRules: { leadId: true, phone: false, email: false } });
    const after = (await api().get(`/api/sessions/${sid}/report`)).body.report.counts;
    expect(after.possibleDuplicateRows + after.duplicateRows).toBeLessThan(before.possibleDuplicateRows + before.duplicateRows);
    await api().patch(`/api/sessions/${sid}/settings`).send({ matchRules: { leadId: true, phone: true, email: true } });
    const audit = (await api().get(`/api/sessions/${sid}/audit`)).body.entries;
    const actions = audit.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['file_uploaded', 'file_failed', 'file_replaced', 'report_generated', 'settings_changed', 'export']));
    const text = JSON.stringify(audit);
    expect(text).not.toMatch(/@example\.com|9000\d{6}|Testwala/);
  });

  it('isolates sessions per browser client', async () => {
    const other = await request(ctx.app).get(`/api/sessions/${sid}`).set('X-Client-Id', OTHER_CLIENT);
    expect(other.status).toBe(404);
    const none = await request(ctx.app).get(`/api/sessions/${sid}/leads`);
    expect(none.status).toBe(404);
    expect((await request(ctx.app).get('/api/history').set('X-Client-Id', OTHER_CLIENT)).body.entries).toEqual([]);
    expect((await request(ctx.app).get('/api/history')).status).toBe(400);
  });

  it('Test H: report history survives a backend restart; lead data does not', async () => {
    const hist = (await api().get('/api/history')).body.entries;
    expect(hist).toHaveLength(1);
    expect(hist[0].id).toBe(sid);
    expect(hist[0].generations).toBeGreaterThanOrEqual(2);
    expect(hist[0].sessionAvailable).toBe(true);
    // The persisted history file holds aggregates only.
    const raw = fs.readFileSync(path.join(dirs.config, 'report-history.json'), 'utf8');
    expect(raw).not.toMatch(/@example\.com|9000\d{6}|Testwala|Fictiona/);

    // Restart: new process state, same CONFIG_DIR.
    await ctx.store.stop(true);
    ctx = await makeApp(dirs);
    const after = (await api().get('/api/history')).body.entries;
    expect(after).toHaveLength(1);
    expect(after[0].sessionAvailable).toBe(false);
    expect((await api().get(`/api/sessions/${sid}`)).status).toBe(404);
    const pdf = await api().get(`/api/history/${sid}/export/pdf`).buffer(true).parse(binary as never);
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const xlsx = await api().get(`/api/history/${sid}/export/excel`);
    expect(xlsx.status).toBe(200);
    expect((await request(ctx.app).get(`/api/history/${sid}/export/pdf`).set('X-Client-Id', OTHER_CLIENT)).status).toBe(404);
    expect((await api().del(`/api/history/${sid}`)).status).toBe(200);
    expect((await api().get('/api/history')).body.entries).toEqual([]);
  });
});
