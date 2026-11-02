// Spreadsheet parser. Runs inside a worker thread with memory/time limits (see spreadsheet.ts),
// or inline when PARSE_IN_WORKER=false. Plain JS so it runs unchanged in dev (tsx) and production.
// Never logs cell contents.
import { parentPort, workerData, isMainThread } from 'node:worker_threads';
import * as XLSX from 'xlsx';

function pad(n) {
  return String(n).padStart(2, '0');
}

function serialToIso(serial, date1904) {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const offset = date1904 ? 24107 : 25569;
  const ms = Math.round(((serial - offset) * 86400000) / 1000) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hasTime = serial - Math.floor(serial) > 1e-9;
  return hasTime ? `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : day;
}

function cellValue(cell, date1904) {
  if (!cell) return null;
  switch (cell.t) {
    case 's':
      return typeof cell.v === 'string' ? cell.v : String(cell.v ?? '');
    case 'n':
      if (cell.z && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) return serialToIso(cell.v, date1904) ?? cell.v;
      return Number.isFinite(cell.v) ? cell.v : null;
    case 'b':
      return Boolean(cell.v);
    case 'd': {
      const d = cell.v instanceof Date ? cell.v : new Date(cell.v);
      if (Number.isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    default:
      return null; // errors ('e') and stubs ('z')
  }
}

/**
 * @param {{ data: Uint8Array, ext: string, maxRows: number, maxCols: number }} input
 */
export function parseWorkbookSync(input) {
  const { ext, maxRows, maxCols } = input;
  const data = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength);
  const common = {
    cellFormula: false,
    cellHTML: false,
    cellText: false,
    cellDates: false,
    cellStyles: false,
    cellNF: true, // number formats are needed to recognise date cells
    bookVBA: false,
    WTF: false,
    dense: true,
    sheetRows: maxRows + 25, // allow for title rows above the header
  };
  let wb;
  if (ext === 'csv') {
    let text = new TextDecoder('utf-8', { fatal: false }).decode(data);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    wb = XLSX.read(text, { ...common, type: 'string', raw: true });
  } else {
    wb = XLSX.read(data, { ...common, type: 'buffer' });
  }
  const date1904 = Boolean(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const sheets = wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name];
    const meta = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i];
    const hidden = Boolean(meta && meta.Hidden);
    if (!ws || !ws['!ref']) return { name, hidden, rows: [], firstRow: 1, totalRows: 0, truncated: false, columnsTruncated: false };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const full = ws['!fullref'] ? XLSX.utils.decode_range(ws['!fullref']) : range;
    const dense = ws['!data'] || [];
    const lastCol = Math.min(range.e.c, maxCols - 1);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const src = dense[r] || [];
      const row = [];
      for (let c = 0; c <= lastCol; c++) row.push(cellValue(src[c], date1904));
      rows.push(row);
    }
    // Trim trailing empty rows.
    while (rows.length && rows[rows.length - 1].every((v) => v === null || v === '')) rows.pop();
    return {
      name,
      hidden,
      rows,
      firstRow: range.s.r + 1,
      totalRows: full.e.r - full.s.r + 1,
      truncated: full.e.r > range.e.r,
      columnsTruncated: range.e.c > lastCol,
    };
  });
  return { sheets, date1904 };
}

if (!isMainThread && parentPort && workerData && workerData.__leadpulseParse) {
  try {
    const result = parseWorkbookSync(workerData);
    parentPort.postMessage({ ok: true, result });
  } catch (err) {
    parentPort.postMessage({ ok: false, message: err && err.message ? String(err.message) : 'Parse failed' });
  }
}
