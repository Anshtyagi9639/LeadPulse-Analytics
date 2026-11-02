import ExcelJS from 'exceljs';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertFileType, detectHeaderRow, headersFor, inspectZip, parseSpreadsheet, type ParseLimits } from '../src/domain/spreadsheet.js';
import { validateRows } from '../src/domain/validate.js';
import { AppError } from '../src/lib/errors.js';
import { sample } from './helpers.js';

const limits = (o: Partial<ParseLimits> = {}): ParseLimits => ({ maxRows: 50000, maxCols: 200, maxUncompressedBytes: 250 * 1048576, timeoutMs: 30000, memoryMb: 512, inWorker: true, ...o });

/** Builds a minimal stored (uncompressed) ZIP whose central directory claims the given sizes. */
function fakeZip(entries: { name: string; size: number; comp: number }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt32LE(e.comp, 20);
    cd.writeUInt32LE(e.size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return null;
};

describe('file-type checks', () => {
  it('rejects mismatched content', () => {
    expect(code(() => assertFileType(Buffer.from('a,b\n1,2'), 'xlsx'))).toBe('INVALID_FILE');
    expect(code(() => assertFileType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'xlsx'))).toBe('PROTECTED_FILE');
    expect(code(() => assertFileType(Buffer.from([0x00, 0x01, 0x02]), 'csv'))).toBe('INVALID_FILE');
    expect(code(() => assertFileType(Buffer.alloc(0), 'csv'))).toBe('EMPTY_FILE');
    expect(code(() => assertFileType(Buffer.from('<table><tr><td>x</td></tr></table>'), 'xls'))).toBeNull();
  });
});

describe('archive-bomb guard', () => {
  it('rejects archives that expand beyond the limit', () => {
    const z = fakeZip([
      { name: '[Content_Types].xml', size: 100, comp: 100 },
      { name: 'xl/worksheets/sheet1.xml', size: 300 * 1048576, comp: 300 * 1048576 },
    ]);
    expect(code(() => inspectZip(z, 250 * 1048576))).toBe('UNSAFE_FILE');
  });
  it('rejects suspicious compression ratios', () => {
    const z = fakeZip([
      { name: '[Content_Types].xml', size: 100, comp: 100 },
      { name: 'xl/worksheets/sheet1.xml', size: 100 * 1048576, comp: 10000 },
    ]);
    expect(code(() => inspectZip(z, 250 * 1048576))).toBe('UNSAFE_FILE');
  });
  it('rejects ZIPs that are not workbooks', () => {
    expect(code(() => inspectZip(fakeZip([{ name: 'a.txt', size: 1, comp: 1 }]), 1e9))).toBe('INVALID_FILE');
  });
  it('accepts a real workbook', () => {
    const r = inspectZip(fs.readFileSync(sample('01_study-abroad-dubai_leads.xlsx')), 250 * 1048576);
    expect(r.entries).toBeGreaterThan(3);
  });
});

describe('parsing', () => {
  it('parses xlsx/xls/csv in a worker and converts date cells', async () => {
    const xlsx = await parseSpreadsheet(fs.readFileSync(sample('01_study-abroad-dubai_leads.xlsx')), 'xlsx', limits());
    const sh = xlsx.sheets[0];
    const hr = detectHeaderRow(sh.rows);
    expect(hr).toBe(3);
    const headers = headersFor(sh.rows, hr);
    const created = headers.indexOf('Lead Created Date');
    expect(String(sh.rows[hr + 1][created])).toMatch(/^2026-10-30T\d{2}:\d{2}:\d{2}$/);
    // Formula-looking text stays inert text; it is neutralised on export (see api tests).
    const notes = headers.indexOf('Internal Notes');
    expect(sh.rows.some((r) => typeof r[notes] === 'string' && String(r[notes]).startsWith('=HYPERLINK'))).toBe(true);

    const xls = await parseSpreadsheet(fs.readFileSync(sample('04_bba-mba_leads.xls')), 'xls', limits());
    expect(xls.sheets[0].rows.length).toBe(51);
    const csv = await parseSpreadsheet(fs.readFileSync(sample('03_ielts_leads.csv')), 'csv', limits({ inWorker: false }));
    expect(csv.sheets[0].rows[0][0]).toBe('Lead ID'); // BOM stripped
    // Leading zeros are preserved in CSV (no type coercion).
    expect(String(csv.sheets[0].rows[1][2]).startsWith('0')).toBe(true);
  });

  it('reads only cached values of real formula cells (formulas are never evaluated or kept)', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('F');
    ws.addRow(['Lead ID', 'Score']);
    ws.addRow(['L1', { formula: 'WEBSERVICE("http://example.com")', result: 7 }]);
    ws.addRow(['L2', { formula: '1+1' }]);
    const parsed = await parseSpreadsheet(Buffer.from(await wb.xlsx.writeBuffer()), 'xlsx', limits());
    expect(parsed.sheets[0].rows[1]).toEqual(['L1', 7]);
    expect(parsed.sheets[0].rows[2][1]).not.toBe(2);
    expect(JSON.stringify(parsed)).not.toContain('WEBSERVICE');
  });

  it('reports corrupted workbooks with a friendly error', async () => {
    const buf = fs.readFileSync(sample('02_australia-nz_leads.xlsx'));
    const corrupt = Buffer.concat([buf.subarray(0, 400), Buffer.alloc(800, 7), buf.subarray(1200)]);
    await expect(parseSpreadsheet(corrupt, 'xlsx', limits())).rejects.toMatchObject({ status: 422 });
  });

  it('enforces the row limit and records truncation', async () => {
    const wb = await parseSpreadsheet(fs.readFileSync(sample('04_bba-mba_leads.xls')), 'xls', limits({ maxRows: 10 }));
    expect(wb.sheets[0].truncated).toBe(true);
    expect(wb.sheets[0].totalRows).toBe(51);
  });

  it('times out runaway parses', async () => {
    await expect(parseSpreadsheet(fs.readFileSync(sample('01_study-abroad-dubai_leads.xlsx')), 'xlsx', limits({ timeoutMs: 1 }))).rejects.toMatchObject({ code: 'PARSE_TIMEOUT' });
  });

  it('handles an empty worksheet and a large generated file', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Empty');
    const big = wb.addWorksheet('Big');
    big.addRow(['Lead ID', 'Phone', 'Email', 'Campaign Name', 'Lead Created Date']);
    for (let i = 0; i < 20000; i++) big.addRow([`L${i}`, String(9000100000 + i), `s${i}@example.com`, `C${i % 7}`, '2026-10-30 10:00']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const t0 = Date.now();
    const parsed = await parseSpreadsheet(buf, 'xlsx', limits());
    expect(parsed.sheets[0].rows).toEqual([]);
    const sh = parsed.sheets[1];
    const v = validateRows({ fileId: 'f', fileName: 'big.xlsx', fileOrder: 1, sheet: 'Big', rows: sh.rows, firstRow: sh.firstRow, headerRow: 0, headers: headersFor(sh.rows, 0), mapping: { '0': 'leadId', '1': 'phone', '2': 'email', '3': 'campaignName', '4': 'leadCreatedDate' }, kind: 'leads', dateOrder: 'auto', date1904: false });
    expect(v.accepted).toBe(20000);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});

describe('row validation', () => {
  const rows = [
    ['Lead ID', 'Phone', 'Email', 'Created', 'Fee'],
    ['L1', '9876543210', 'a@example.com', '30/10/2026', '1,000'],
    [null, null, null, null, null],
    [null, null, null, '30/10/2026', null],
    ['L3', '12', 'bad', 'not a date', 'abc'],
  ];
  const v = validateRows({ fileId: 'f', fileName: 'f.csv', fileOrder: 1, sheet: 'S', rows, firstRow: 1, headerRow: 0, headers: rows[0] as string[], mapping: { '0': 'leadId', '1': 'phone', '2': 'email', '3': 'leadCreatedDate', '4': 'revenue' }, kind: 'leads', dateOrder: 'auto', date1904: false });
  it('accounts for every row', () => {
    expect(v.dataRows).toBe(3);
    expect(v.blankRows).toBe(1);
    expect(v.accepted).toBe(2);
    expect(v.rejected).toBe(1);
    expect(v.rowsWithWarnings).toBe(1);
  });
  it('records issues with spreadsheet row numbers', () => {
    const rejected = v.issues.find((i) => i.code === 'NO_IDENTIFIER')!;
    expect(rejected.rowNumber).toBe(4);
    const codes = v.issues.filter((i) => i.rowNumber === 5).map((i) => i.code);
    expect(codes).toEqual(['INVALID_PHONE', 'INVALID_EMAIL', 'INVALID_DATE', 'INVALID_NUMBER']);
  });
  it('normalises values', () => {
    expect(v.leads[0].revenue).toBe(1000);
    expect(v.leads[0].dates.leadCreatedDate.hasTime).toBe(false);
  });
});
