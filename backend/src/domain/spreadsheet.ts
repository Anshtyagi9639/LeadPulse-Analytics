import { Worker } from 'node:worker_threads';
import { AppError } from '../lib/errors.js';
import { matchHeader } from './mapping.js';
import { normalizeHeader, type CellValue } from './normalize.js';
import { parseWorkbookSync, type RawWorkbook } from './parseWorker.mjs';

export type { RawSheet, RawWorkbook } from './parseWorker.mjs';
export type SpreadsheetExt = 'xlsx' | 'xls' | 'csv';

export interface ParseLimits {
  maxRows: number;
  maxCols: number;
  maxUncompressedBytes: number;
  timeoutMs: number;
  memoryMb: number;
  inWorker: boolean;
}

// ---------------------------------------------------------------------------------------------
// File-type sniffing
// ---------------------------------------------------------------------------------------------

export function extensionOf(filename: string): SpreadsheetExt | null {
  const m = filename.toLowerCase().match(/\.(xlsx|xls|csv)$/);
  return m ? (m[1] as SpreadsheetExt) : null;
}

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];
const CFB_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(buf: Buffer, sig: number[]): boolean {
  return buf.length >= sig.length && sig.every((b, i) => buf[i] === b);
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 65536));
  return !sample.includes(0);
}

/**
 * Validates that the file content matches its extension. Throws AppError on mismatch.
 * Note: many CRMs export "Excel" files that are really HTML/XML tables with an .xls extension; those are accepted.
 */
export function assertFileType(buf: Buffer, ext: SpreadsheetExt): void {
  if (buf.length === 0) throw new AppError(422, 'EMPTY_FILE', 'The file is empty.');
  if (ext === 'xlsx') {
    if (startsWith(buf, CFB_SIG)) throw new AppError(422, 'PROTECTED_FILE', 'This workbook appears to be password-protected or encrypted. Remove the password in Excel and upload again.');
    if (!startsWith(buf, ZIP_SIG)) throw new AppError(422, 'INVALID_FILE', 'The file is not a valid .xlsx workbook. It may be corrupted or renamed from another format.');
    return;
  }
  if (ext === 'xls') {
    if (startsWith(buf, CFB_SIG)) return;
    if (startsWith(buf, ZIP_SIG)) return; // .xlsx saved with .xls extension; parser handles it
    const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    if (looksLikeText(buf) && (head.startsWith('<') || head.startsWith('\ufeff<'))) return;
    throw new AppError(422, 'INVALID_FILE', 'The file is not a valid .xls workbook. It may be corrupted or renamed from another format.');
  }
  if (startsWith(buf, ZIP_SIG) || startsWith(buf, CFB_SIG) || !looksLikeText(buf)) {
    throw new AppError(422, 'INVALID_FILE', 'The .csv file contains binary data. If it is an Excel workbook, upload it with its original .xlsx/.xls extension.');
  }
}

// ---------------------------------------------------------------------------------------------
// ZIP (XLSX) expansion guard — rejects archive bombs before the parser decompresses anything.
// ---------------------------------------------------------------------------------------------

export function inspectZip(buf: Buffer, maxUncompressed: number): { entries: number; uncompressed: number } {
  const EOCD = 0x06054b50;
  const CDH = 0x02014b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new AppError(422, 'INVALID_FILE', 'The workbook is corrupted (archive directory not found).');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new AppError(422, 'INVALID_FILE', 'ZIP64 workbooks are not supported.');
  if (total > 10000) throw new AppError(422, 'UNSAFE_FILE', 'The workbook contains too many internal parts.');
  if (cdOffset + cdSize > buf.length) throw new AppError(422, 'INVALID_FILE', 'The workbook is corrupted (truncated archive).');
  let p = cdOffset;
  let uncompressed = 0;
  let hasContentTypes = false;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH) throw new AppError(422, 'INVALID_FILE', 'The workbook is corrupted (bad archive entry).');
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === '[Content_Types].xml') hasContentTypes = true;
    if (size === 0xffffffff || compSize === 0xffffffff) throw new AppError(422, 'INVALID_FILE', 'ZIP64 workbooks are not supported.');
    if (size > 20 * 1024 * 1024 && compSize > 0 && size / compSize > 200) {
      throw new AppError(422, 'UNSAFE_FILE', 'The workbook has a suspicious compression ratio and was rejected for safety.');
    }
    uncompressed += size;
    if (uncompressed > maxUncompressed) {
      throw new AppError(422, 'UNSAFE_FILE', `The workbook expands to more than ${Math.round(maxUncompressed / 1048576)} MB and was rejected for safety. Split it into smaller files.`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!hasContentTypes) throw new AppError(422, 'INVALID_FILE', 'The file is a ZIP archive but not an Excel workbook.');
  return { entries: total, uncompressed };
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

function friendlyParseError(message: string): AppError {
  const m = message.toLowerCase();
  if (m.includes('password') || m.includes('encrypt')) return new AppError(422, 'PROTECTED_FILE', 'This workbook is password-protected. Remove the password in Excel and upload again.');
  if (m.includes('memory') || m.includes('heap')) return new AppError(422, 'FILE_TOO_COMPLEX', 'The workbook is too large to process safely. Split it into smaller files.');
  return new AppError(422, 'CORRUPT_FILE', 'The spreadsheet could not be read. It may be corrupted or in an unsupported format. Try re-saving it as .xlsx or .csv.');
}

function runInWorker(data: Uint8Array, ext: SpreadsheetExt, limits: ParseLimits): Promise<RawWorkbook> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parseWorker.mjs', import.meta.url), {
      workerData: { __leadpulseParse: true, data, ext, maxRows: limits.maxRows, maxCols: limits.maxCols },
      resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb, maxYoungGenerationSizeMb: 64 },
      // Workers inherit loaders from the parent; plain JS needs none.
      execArgv: [],
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };
    const timer = setTimeout(
      () => finish(() => reject(new AppError(422, 'PARSE_TIMEOUT', 'The spreadsheet took too long to read and was stopped. Split it into smaller files.'))),
      limits.timeoutMs,
    );
    worker.once('message', (msg: { ok: boolean; result?: RawWorkbook; message?: string }) => {
      finish(() => (msg.ok && msg.result ? resolve(msg.result) : reject(friendlyParseError(msg.message ?? ''))));
    });
    worker.once('error', (err) => finish(() => reject(friendlyParseError(err.message))));
    worker.once('exit', (code) => finish(() => reject(friendlyParseError(code === 0 ? 'no result' : 'out of memory'))));
  });
}

export async function parseSpreadsheet(buf: Buffer, ext: SpreadsheetExt, limits: ParseLimits): Promise<RawWorkbook> {
  assertFileType(buf, ext);
  if (startsWith(buf, ZIP_SIG)) inspectZip(buf, limits.maxUncompressedBytes);
  let wb: RawWorkbook;
  if (limits.inWorker) {
    wb = await runInWorker(new Uint8Array(buf), ext, limits);
  } else {
    try {
      wb = parseWorkbookSync({ data: new Uint8Array(buf), ext, maxRows: limits.maxRows, maxCols: limits.maxCols });
    } catch (e) {
      throw friendlyParseError((e as Error).message);
    }
  }
  if (!wb.sheets.length) throw new AppError(422, 'EMPTY_FILE', 'The workbook contains no worksheets.');
  return wb;
}

// ---------------------------------------------------------------------------------------------
// Header-row detection
// ---------------------------------------------------------------------------------------------

function isBlank(v: CellValue): boolean {
  return v === null || v === '' || (typeof v === 'string' && !v.trim());
}

export function isBlankRow(row: CellValue[]): boolean {
  return row.every(isBlank);
}

/**
 * Scores the first rows of a sheet and returns the index (0-based within `rows`) most likely to be the header row.
 * Rows with many text cells that match known column names score highest; title rows above the table score low.
 */
export function detectHeaderRow(rows: CellValue[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    const texts = row.filter((v) => typeof v === 'string' && v.trim() && !/^\d+([.,]\d+)?$/.test(v.trim())) as string[];
    if (texts.length < 2) continue;
    const known = texts.filter((t) => matchHeader(t, 'leads') || matchHeader(t, 'ad_spend')).length;
    const unique = new Set(texts.map(normalizeHeader)).size;
    const nonBlank = row.filter((v) => !isBlank(v)).length;
    const score = known * 5 + unique + (texts.length === nonBlank ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Builds display headers for a chosen header row; blank/duplicate headers get positional names. */
export function headersFor(rows: CellValue[][], headerRow: number): string[] {
  const row = rows[headerRow] ?? [];
  const width = Math.max(row.length, ...rows.slice(headerRow, headerRow + 50).map((r) => r.length), 0);
  const seen = new Map<string, number>();
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const raw = row[c];
    let h = raw === null || raw === undefined ? '' : String(raw).replace(/\s+/g, ' ').trim();
    if (!h) h = `Column ${columnLetter(c)}`;
    const k = h.toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    headers.push(n > 1 ? `${h} (${n})` : h);
  }
  return headers;
}

export function columnLetter(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
