import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, REPORT_DATE, sample } from './helpers.js';

const LEAD_FILES = ['01_study-abroad-dubai_leads.xlsx', '02_australia-nz_leads.xlsx', '03_ielts_leads.csv', '04_bba-mba_leads.xls', '05_cwitp_leads.xlsx'];

type Ctx = Awaited<ReturnType<typeof makeTestApp>>;

function binaryParser(res: NodeJS.ReadableStream & { setEncoding(e: string): void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('API: full multi-file reporting workflow', () => {
  let ctx: Ctx;
  let sid: string;
  let files: { id: string; name: string; status: string; kind: string; inReport: boolean }[];

  beforeAll(async () => {
    ctx = await makeTestApp();
  });
  afterAll(async () => ctx.cleanup());

  it('reports health', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.aiConfigured).toBe(false);
  });

  it('serves metadata without an OpenAI key', async () => {
    const res = await request(ctx.app).get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(false);
    expect(res.body.fields.leads.length).toBeGreaterThan(40);
    expect(res.body.definitions.length).toBeGreaterThan(20);
  });

  it('validates session creation input', async () => {
    const bad = await request(ctx.app).post('/api/sessions').send({ reportingDate: '30/10/2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a session with a 12h expiry', async () => {
    const res = await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE });
    expect(res.status).toBe(201);
    sid = res.body.id;
    const ttl = Date.parse(res.body.expiresAt) - Date.parse(res.body.createdAt);
    expect(ttl).toBe(12 * 3600_000);
    expect(res.body.settings.reportingDate).toBe(REPORT_DATE);
  });

  it('uploads several files at once and auto-maps them', async () => {
    let req = request(ctx.app).post(`/api/sessions/${sid}/files`);
    for (const f of LEAD_FILES.slice(0, 4)) req = req.attach('files', sample(f));
    const res = await req;
    expect(res.status).toBe(201);
    files = res.body.session.files;
    expect(files).toHaveLength(4);
    for (const f of files) expect(f.status, `${f.name}`).toBe('ready');
    const dubai = res.body.session.files.find((f: { name: string }) => f.name.startsWith('01_'));
    // Title rows above the header were skipped and the lead sheet (not "Summary") was chosen.
    expect(dubai.sheetName).toBe('Leads Export');
    expect(dubai.headerRowNumber).toBe(4);
    expect(Object.values(dubai.mapping)).toEqual(expect.arrayContaining(['leadId', 'phone', 'email', 'campaignName', 'leadCreatedDate', 'assignedCounsellor', 'qualificationStatus']));
    expect(dubai.validation.unmappedColumns).toContain('Internal Notes');
    const anz = res.body.session.files.find((f: { name: string }) => f.name.startsWith('02_'));
    expect(Object.values(anz.mapping)).toEqual(expect.arrayContaining(['leadId', 'name', 'phone', 'email', 'preferredCountry', 'assignedCounsellor', 'nextFollowUpDate']));
  });

  it('previews a file with worksheet list and first rows', async () => {
    const dubai = files.find((f) => f.name.startsWith('01_'))!;
    const res = await request(ctx.app).get(`/api/sessions/${sid}/files/${dubai.id}/preview`);
    expect(res.status).toBe(200);
    expect(res.body.sheets.map((s: { name: string }) => s.name)).toEqual(['Leads Export', 'Summary']);
    expect(res.body.rows.length).toBe(20);
    expect(res.body.headers[0]).toBe('Lead ID');
  });

  it('accounts for every row (accepted, rejected, blank)', async () => {
    const res = await request(ctx.app).get(`/api/sessions/${sid}`);
    const ielts = res.body.files.find((f: { name: string }) => f.name.startsWith('03_'));
    const v = ielts.validation;
    expect(v.rejected).toBe(1); // the row with no identifier
    expect(v.blankRows).toBeGreaterThan(0);
    expect(v.accepted + v.rejected).toBe(v.dataRows);
    const issues = await request(ctx.app).get(`/api/sessions/${sid}/files/${ielts.id}/issues`);
    const codes = issues.body.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['NO_IDENTIFIER', 'INVALID_EMAIL', 'INVALID_PHONE']));
    // PII values are masked in issue reports.
    const emailIssue = issues.body.issues.find((i: { code: string }) => i.code === 'INVALID_EMAIL');
    expect(emailIssue.value).toMatch(/\*\*\*/);
  });

  it('processes a single file individually', async () => {
    const dubai = files.find((f) => f.name.startsWith('01_'))!;
    const res = await request(ctx.app).post(`/api/sessions/${sid}/process`).send({ fileIds: [dubai.id] });
    expect(res.status).toBe(200);
    expect(res.body.report.fileIds).toEqual([dubai.id]);
    expect(res.body.report.stale).toMatch(/not included/);
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(rep.scope.fileNames).toEqual([dubai.name]);
    // 91 data rows; 2 are re-exported duplicates (same Lead ID); 4 were created the previous day.
    expect(rep.counts.rawRows).toBe(91);
    expect(rep.counts.duplicateRows).toBe(2);
    expect(rep.counts.uniqueLeads).toBe(89);
    expect(rep.counts.reportedLeads).toBe(89); // default: exclude confirmed duplicates
    expect(rep.counts.leadsOutsidePeriod).toBe(4);
    expect(rep.notes.some((n: { message: string }) => /outside 2026-10-30/.test(n.message))).toBe(true);
    expect(rep.overview.totalSpend).toBeNull();
    expect(rep.unavailable.cpl).toMatch(/No advertising spend/);
  });

  it('processes all files together and adds files later into the same session', async () => {
    let req = request(ctx.app).post(`/api/sessions/${sid}/files`);
    req = req.attach('files', sample(LEAD_FILES[4])).attach('files', sample('06_ad-spend.xlsx'));
    const up = await req;
    expect(up.status).toBe(201);
    const ad = up.body.session.files.find((f: { name: string }) => f.name === '06_ad-spend.xlsx');
    expect(ad.kind).toBe('ad_spend');
    expect(ad.status).toBe('ready');
    const res = await request(ctx.app).post(`/api/sessions/${sid}/process`).send({});
    expect(res.status).toBe(200);
    expect(res.body.report.fileIds).toHaveLength(6);
    expect(res.body.report.stale).toBeNull();
    files = res.body.files;
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(rep.scope.leadFiles).toBe(5);
    expect(rep.scope.adFiles).toBe(1);
    // Spend: today's rows only (previous-day row excluded).
    expect(rep.marketing.spendOutsidePeriod).toBe(1);
    expect(rep.overview.totalSpend).toBe(18500 + 14200 + 16800 + 6400 + 9100 + 11200 + 7300 + 5000);
    // Brand-awareness spend has no leads: excluded from CPL, reported as unattributed.
    expect(rep.marketing.unattributedSpend).toBe(5000);
    expect(rep.overview.cpl).toBeCloseTo(rep.marketing.attributableSpend / rep.marketing.attributableLeads, 2);
    const dubaiCamp = rep.campaigns.find((c: { label: string }) => c.label === 'SA Dubai Oct Lead Gen');
    expect(dubaiCamp.spend).toBe(18500);
    expect(dubaiCamp.cpl).toBeCloseTo(18500 / dubaiCamp.leads, 2);
    expect(dubaiCamp.targetLeads).toBe(55);
    // Sources are canonicalised (Facebook/Meta/Instagram -> Meta Ads) and never invented.
    const labels = rep.sources.map((s: { label: string }) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['Meta Ads', 'Google Ads', 'Collegedunia', 'Organic', 'Referral']));
    expect(labels).not.toContain('Facebook');
    // Cross-file duplicates found (CWITP rows that match Dubai rows by phone).
    expect(rep.counts.duplicateRows).toBeGreaterThan(2);
    expect(rep.counts.possibleDuplicateRows).toBeGreaterThan(0);
    expect(rep.dataQuality.conflictingRecords).toBeGreaterThan(0);
    // Row counts and unique counts are distinct and consistent.
    expect(rep.counts.uniqueLeads).toBeLessThan(rep.counts.inScopeRows);
    expect(rep.funnel[0].count).toBe(rep.overview.totalLeads);
  });

  it('switching duplicate handling changes the reported total but not unique leads', async () => {
    const before = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    const res = await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ duplicateMode: 'count_all' });
    expect(res.status).toBe(200);
    const after = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(after.overview.totalLeads).toBe(after.counts.inScopeRows);
    expect(after.overview.uniqueLeads).toBe(before.overview.uniqueLeads);
    expect(after.overview.totalLeads - before.overview.totalLeads).toBe(before.counts.duplicateRowsExcluded);
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ duplicateMode: 'exclude_duplicates' });
  });

  it('restricting to the reporting date excludes out-of-period rows with a note', async () => {
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ dateFilter: 'restrict' });
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(rep.counts.excludedOutsidePeriod).toBe(rep.counts.leadsOutsidePeriod);
    expect(rep.counts.excludedOutsidePeriod).toBeGreaterThanOrEqual(4);
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ dateFilter: 'include_all' });
  });

  it('lists duplicate groups with masked contact details and applies manual decisions', async () => {
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ duplicateMode: 'manual_review' });
    const res = await request(ctx.app).get(`/api/sessions/${sid}/duplicates?kind=possible`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    const g = res.body.groups[0];
    expect(g.members.length).toBeGreaterThan(1);
    for (const m of g.members) if (m.phone) expect(m.phone).toMatch(/^\*+\d{4}$/);
    const before = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(before.counts.pendingReviewGroups).toBeGreaterThan(0);
    const dec = await request(ctx.app).put(`/api/sessions/${sid}/duplicates/decisions`).send({ decisions: { [g.id]: 'keep_latest' } });
    expect(dec.status).toBe(200);
    const after = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(after.overview.totalLeads).toBe(before.overview.totalLeads - (g.members.length - 1));
    expect(after.counts.pendingReviewGroups).toBe(before.counts.pendingReviewGroups - 1);
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ duplicateMode: 'exclude_duplicates' });
  });

  it('applies campaign filters to the report and spend', async () => {
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ filters: { campaigns: ['SA Dubai Search'], sources: [] } });
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(rep.campaigns.map((c: { label: string }) => c.label)).toEqual(['SA Dubai Search']);
    expect(rep.overview.totalSpend).toBe(14200);
    await request(ctx.app).patch(`/api/sessions/${sid}/settings`).send({ filters: { campaigns: [], sources: [] } });
  });

  it('accepts manual campaign inputs (target, baseline CPL)', async () => {
    const res = await request(ctx.app)
      .put(`/api/sessions/${sid}/campaign-inputs`)
      .send({ inputs: [{ campaignName: 'ANZ Referral Drive', source: 'Referral', spend: 1500, budget: 2000, targetLeads: 10, impressions: null, clicks: null, baselineCpl: 200 }] });
    expect(res.status).toBe(200);
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    const c = rep.campaigns.find((x: { label: string }) => x.label === 'ANZ Referral Drive');
    expect(c.spend).toBe(1500);
    expect(c.budgetUtilisation).toBe(75);
    expect(c.targetAchievement).toBeCloseTo((c.leads / 10) * 100, 2);
    expect(c.cplChange).toBeCloseTo(((1500 / c.leads - 200) / 200) * 100, 1);
  });

  it('exports an Excel workbook with all required worksheets and no live formulas', async () => {
    const res = await request(ctx.app).get(`/api/sessions/${sid}/export/excel`).buffer(true).parse(binaryParser as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(`lead-report_${REPORT_DATE}_report.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as never);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['Executive Summary', 'File-wise Summary', 'Campaign-wise Performance', 'Source-wise Performance', 'Counsellor Performance', 'Lead Funnel', 'Data Quality', 'KPI Definitions', 'Validation Errors']);
    let formulas = 0;
    let dangerous = 0;
    wb.eachSheet((ws) =>
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.type === ExcelJS.ValueType.Formula) formulas++;
          if (typeof cell.value === 'string' && /^[=+\-@]/.test(cell.value)) dangerous++;
        }),
      ),
    );
    expect(formulas).toBe(0);
    expect(dangerous).toBe(0);
  });

  it('exports each summary table as CSV with formula-injection protection', async () => {
    for (const t of ['executive', 'files', 'campaigns', 'sources', 'counsellors', 'funnel', 'data-quality', 'definitions', 'validation-errors']) {
      const res = await request(ctx.app).get(`/api/sessions/${sid}/export/csv/${t}`);
      expect(res.status, t).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      for (const line of res.text.slice(1).split('\r\n')) {
        for (const cell of line.split(',')) expect(cell.replace(/^"/, '')).not.toMatch(/^[=+@]/);
      }
    }
    const bad = await request(ctx.app).get(`/api/sessions/${sid}/export/csv/not-a-table`);
    expect(bad.status).toBe(400);
  });

  it('protects against injected campaign names from uploaded data', async () => {
    const res = await request(ctx.app).get(`/api/sessions/${sid}/export/csv/campaigns`);
    expect(res.text).toContain("'+SUM(1,2)");
  });

  it('exports a PDF management report', async () => {
    const res = await request(ctx.app).get(`/api/sessions/${sid}/export/pdf`).buffer(true).parse(binaryParser as never);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(5000);
  });

  it('downloads the validation-error report', async () => {
    const res = await request(ctx.app).get(`/api/sessions/${sid}/validation-errors.csv`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('NO_IDENTIFIER');
    expect(res.text).not.toMatch(/@example\.com/); // emails are masked
  });

  it('removes a file and recalculates totals', async () => {
    const before = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    const cw = files.find((f) => f.name.startsWith('05_'))!;
    const res = await request(ctx.app).delete(`/api/sessions/${sid}/files/${cw.id}`);
    expect(res.status).toBe(200);
    expect(res.body.files.find((f: { id: string }) => f.id === cw.id)).toBeUndefined();
    const after = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    expect(after.scope.fileNames).not.toContain(cw.name);
    expect(after.counts.rawRows).toBe(before.counts.rawRows - 32);
    expect(after.campaigns.find((c: { label: string }) => c.label === 'CWITP Webinar Oct')?.leads ?? 0).toBe(0);
  });

  it('re-maps a column and the report follows', async () => {
    const bba = (await request(ctx.app).get(`/api/sessions/${sid}`)).body.files.find((f: { name: string }) => f.name.startsWith('04_'));
    const mapping = { ...bba.mapping };
    const col = Object.keys(mapping).find((k) => mapping[k] === 'qualificationStatus')!;
    delete mapping[col];
    const res = await request(ctx.app).put(`/api/sessions/${sid}/files/${bba.id}/config`).send({ mapping });
    expect(res.status).toBe(200);
    expect(res.body.file.validation.mappedFields).not.toContain('qualificationStatus');
    const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
    const bbaRow = rep.files.find((f: { fileName: string }) => f.fileName === bba.name);
    expect(bbaRow.qualified).toBe(0);
  });

  it('returns AI_NOT_CONFIGURED when no OpenAI key is set, while reports still work', async () => {
    const res = await request(ctx.app).post(`/api/sessions/${sid}/ai`).send({ task: 'summary' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('clears the session and deletes temporary files', async () => {
    const dir = path.join(ctx.store.instanceDir, sid);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readdirSync(dir).length).toBeGreaterThan(0);
    const res = await request(ctx.app).delete(`/api/sessions/${sid}`);
    expect(res.status).toBe(200);
    expect(fs.existsSync(dir)).toBe(false);
    const gone = await request(ctx.app).get(`/api/sessions/${sid}`);
    expect(gone.status).toBe(404);
  });
});

describe('API: upload safety and error handling', () => {
  let ctx: Ctx;
  let sid: string;
  beforeAll(async () => {
    ctx = await makeTestApp({ MAX_FILE_SIZE_MB: 1, MAX_FILES_PER_SESSION: 6 });
    sid = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
  });
  afterAll(async () => ctx.cleanup());

  it('rejects unsupported, corrupted, renamed and empty files without failing the batch', async () => {
    const res = await request(ctx.app)
      .post(`/api/sessions/${sid}/files`)
      .attach('files', Buffer.from('hello'), 'notes.txt')
      .attach('files', Buffer.from('PK\u0003\u0004 this is not really a zip'), 'broken.xlsx')
      .attach('files', fs.readFileSync(sample('01_study-abroad-dubai_leads.xlsx')), 'renamed.csv')
      .attach('files', Buffer.alloc(0), 'empty.csv')
      .attach('files', sample('03_ielts_leads.csv'));
    expect(res.status).toBe(201);
    const byName = Object.fromEntries(res.body.session.files.map((f: { name: string }) => [f.name, f]));
    expect(byName['notes.txt'].error.code).toBe('UNSUPPORTED_TYPE');
    expect(byName['broken.xlsx'].status).toBe('error');
    expect(byName['renamed.csv'].error.code).toBe('INVALID_FILE');
    expect(byName['empty.csv'].error.code).toBe('EMPTY_FILE');
    expect(byName['03_ielts_leads.csv'].status).toBe('ready');
  });

  it('refuses to process files that are in error', async () => {
    const s = (await request(ctx.app).get(`/api/sessions/${sid}`)).body;
    const broken = s.files.find((f: { name: string }) => f.name === 'broken.xlsx');
    const res = await request(ctx.app).post(`/api/sessions/${sid}/process`).send({ fileIds: [broken.id] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILES_NOT_READY');
  });

  it('enforces the per-session file limit', async () => {
    const res = await request(ctx.app).post(`/api/sessions/${sid}/files`).attach('files', sample('03_ielts_leads.csv')).attach('files', sample('03_ielts_leads.csv'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOO_MANY_FILES');
  });

  it('rejects oversized uploads with 413', async () => {
    const s2 = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
    const res = await request(ctx.app).post(`/api/sessions/${s2}/files`).attach('files', Buffer.alloc(1.5 * 1024 * 1024, 'a'), 'big.csv');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('LIMIT_FILE_SIZE');
  });

  it('returns 404 for unknown sessions and malformed ids', async () => {
    expect((await request(ctx.app).get('/api/sessions/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(ctx.app).get('/api/sessions/../../etc/passwd')).status).toBe(404);
    expect((await request(ctx.app).post('/api/sessions/not-a-session/files').attach('files', sample('03_ielts_leads.csv'))).status).toBe(404);
  });

  it('report endpoints return 409 before processing', async () => {
    const s3 = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
    expect((await request(ctx.app).get(`/api/sessions/${s3}/report`)).status).toBe(409);
    expect((await request(ctx.app).get(`/api/sessions/${s3}/export/pdf`)).status).toBe(409);
  });

  it('does not reflect CORS headers for unknown origins', async () => {
    const ok = await request(ctx.app).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await request(ctx.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('Session expiry and cleanup', () => {
  it('expires sessions, deletes their temp files, and answers 410', async () => {
    const ctx = await makeTestApp();
    try {
      const sid = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
      await request(ctx.app).post(`/api/sessions/${sid}/files`).attach('files', sample('03_ielts_leads.csv'));
      const dir = path.join(ctx.store.instanceDir, sid);
      expect(fs.readdirSync(dir).length).toBe(1);
      // Simulate the clock passing the expiry.
      const removed = await ctx.store.sweep(Date.now() + 12 * 3600_000 + 1);
      expect(removed).toBe(1);
      expect(fs.existsSync(dir)).toBe(false);
      expect((await request(ctx.app).get(`/api/sessions/${sid}`)).status).toBe(404);

      const sid2 = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
      ctx.store.get(sid2).expiresAt = Date.now() - 1;
      const res = await request(ctx.app).get(`/api/sessions/${sid2}`);
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    } finally {
      await ctx.cleanup();
    }
  });

  it('removes abandoned temp directories from previous processes', async () => {
    const ctx = await makeTestApp();
    try {
      const orphan = path.join(ctx.config.TEMP_DIR, 'inst-99999-deadbeef');
      fs.mkdirSync(path.join(orphan, 'some-session'), { recursive: true });
      fs.writeFileSync(path.join(orphan, 'some-session', 'x.csv'), 'a,b');
      const old = new Date(Date.now() - 13 * 3600_000);
      fs.utimesSync(orphan, old, old);
      expect(await ctx.store.removeAbandonedInstanceDirs()).toBe(1);
      expect(fs.existsSync(orphan)).toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it('serialises concurrent uploads in one session', async () => {
    const ctx = await makeTestApp();
    try {
      const sid = (await request(ctx.app).post('/api/sessions').send({ reportingDate: REPORT_DATE })).body.id;
      await Promise.all([
        request(ctx.app).post(`/api/sessions/${sid}/files`).attach('files', sample('03_ielts_leads.csv')),
        request(ctx.app).post(`/api/sessions/${sid}/files`).attach('files', sample('02_australia-nz_leads.xlsx')),
        request(ctx.app).post(`/api/sessions/${sid}/process`).send({}),
      ]);
      await request(ctx.app).post(`/api/sessions/${sid}/process`).send({});
      const s = (await request(ctx.app).get(`/api/sessions/${sid}`)).body;
      expect(s.files).toHaveLength(2);
      const rep = (await request(ctx.app).get(`/api/sessions/${sid}/report`)).body.report;
      expect(rep.counts.rawRows).toBe(s.totals.rawRows);
    } finally {
      await ctx.cleanup();
    }
  });
});
