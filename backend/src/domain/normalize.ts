/** Value normalisation helpers. All functions are pure and never log their inputs (they may contain PII). */

export type CellValue = string | number | boolean | null;
export type DateOrder = 'auto' | 'DMY' | 'MDY' | 'YMD';

/** A timezone-naive timestamp. `ms` is the naive wall-clock time encoded as if it were UTC. */
export interface NaiveDate {
  ms: number;
  hasTime: boolean;
}

export function normalizeHeader(h: unknown): string {
  return String(h ?? '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function cleanString(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return Number.isInteger(v) ? String(v) : String(v);
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
}

/** Case-insensitive key for grouping categorical values (campaign, source, ...). */
export function groupKey(s: string | null): string {
  return s ? s.toLowerCase().replace(/\s+/g, ' ').trim() : '';
}

export interface PhoneResult {
  normalized: string | null;
  valid: boolean;
  warning?: string;
}

export function normalizePhone(v: CellValue | undefined): PhoneResult {
  if (v === null || v === undefined || v === '') return { normalized: null, valid: false };
  let raw: string;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v)) return { normalized: null, valid: false, warning: 'Phone number is not a whole number' };
    raw = v.toFixed(0);
  } else {
    raw = String(v).trim();
  }
  if (!raw) return { normalized: null, valid: false };
  if (/\d\.\d+e\+\d+/i.test(raw)) {
    return { normalized: null, valid: false, warning: 'Phone number was stored in scientific notation and has lost digits' };
  }
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 15) {
    return { normalized: null, valid: false, warning: 'Phone number has an invalid length' };
  }
  if (/^(\d)\1+$/.test(digits)) return { normalized: null, valid: false, warning: 'Phone number is a placeholder (repeated digit)' };
  if (digits.length === 10 && !/^[6-9]/.test(digits)) {
    return { normalized: digits, valid: true, warning: 'Phone number does not match the Indian mobile pattern' };
  }
  return { normalized: digits, valid: true };
}

const EMAIL_RE = /^[^\s@"(),:;<>[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

export function normalizeEmail(v: CellValue | undefined): { normalized: string | null; valid: boolean } {
  const s = cleanString(v);
  if (!s) return { normalized: null, valid: false };
  const e = s.toLowerCase().replace(/^mailto:/, '');
  return EMAIL_RE.test(e) ? { normalized: e, valid: true } : { normalized: null, valid: false };
}

export function parseNumber(v: CellValue | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  let s = String(v).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/(inr|rs\.?|usd|aud|aed|nzd|₹|\$|€|£)/gi, '').replace(/[,\s]/g, '');
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthFromName(s: string): number | null {
  const k = s.toLowerCase();
  if (MONTHS[k]) return MONTHS[k];
  const k3 = k.slice(0, 3);
  return k.length >= 3 && MONTHS[k3] && 'january february march april may june july august september october november december'.includes(k)
    ? MONTHS[k3]
    : null;
}

function fullYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function build(y: number, m: number, d: number, hh = 0, mi = 0, ss = 0, hasTime = false): NaiveDate | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const ms = Date.UTC(y, m - 1, d, hh, mi, ss);
  const check = new Date(ms);
  if (check.getUTCDate() !== d || check.getUTCMonth() !== m - 1) return null; // e.g. 31/02
  return { ms, hasTime };
}

/** Converts an Excel serial number (1900 date system) to a naive date. */
export function excelSerialToNaive(serial: number, date1904 = false): NaiveDate | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const offsetDays = date1904 ? 24107 : 25569;
  const totalMs = Math.round((serial - offsetDays) * 86400000 / 1000) * 1000;
  const frac = serial - Math.floor(serial);
  const d = new Date(totalMs);
  if (Number.isNaN(d.getTime())) return null;
  return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), frac > 1e-9);
}

const TIME_RE = /(?:[T\s,]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?:\.\d+)?\s*(am|pm|a\.m\.|p\.m\.)?)?\s*(?:z|utc|gmt|ist|[+-]\d{2}:?\d{2})?$/i;

function applyTime(m: RegExpMatchArray, start: number): { hh: number; mi: number; ss: number; hasTime: boolean } | null {
  const [hhS, miS, ssS, ampmS] = [m[start], m[start + 1], m[start + 2], m[start + 3]];
  if (!hhS) return { hh: 0, mi: 0, ss: 0, hasTime: false };
  let hh = Number(hhS);
  const ampm = ampmS?.toLowerCase().replace(/\./g, '');
  if (ampm) {
    if (hh < 1 || hh > 12) return null;
    if (ampm === 'pm' && hh !== 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
  }
  return { hh, mi: Number(miS), ss: ssS ? Number(ssS) : 0, hasTime: true };
}

const ISO_RE = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME_RE.source.slice(0, -1)}$`, 'i');
const NUMERIC_RE = new RegExp(`^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{2,4})${TIME_RE.source.slice(0, -1)}$`, 'i');
const DMONY_RE = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-/]+([a-z]{3,9})\\.?[\\s\\-/,]+(\\d{2,4})${TIME_RE.source.slice(0, -1)}$`, 'i');
const MONDY_RE = new RegExp(`^([a-z]{3,9})\\.?[\\s\\-/]+(\\d{1,2})(?:st|nd|rd|th)?,?[\\s\\-/]+(\\d{4})${TIME_RE.source.slice(0, -1)}$`, 'i');
const WEEKDAY_RE = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+/i;

/** Returns the first two numeric parts of a dd/mm/yyyy-like string, for date-order detection. */
export function numericDateParts(s: string): [number, number] | null {
  const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Detects whether ambiguous numeric dates in a column are day-first or month-first.
 * Defaults to DMY (Indian/UK convention) when the column gives no evidence.
 */
export function detectDateOrder(values: CellValue[]): { order: 'DMY' | 'MDY'; ambiguous: boolean } {
  let dmy = false;
  let mdy = false;
  let seen = false;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const p = numericDateParts(v);
    if (!p) continue;
    seen = true;
    if (p[0] > 12) dmy = true;
    if (p[1] > 12) mdy = true;
  }
  if (dmy && !mdy) return { order: 'DMY', ambiguous: false };
  if (mdy && !dmy) return { order: 'MDY', ambiguous: false };
  return { order: 'DMY', ambiguous: seen && !(dmy && mdy) };
}

export function parseDate(v: CellValue | undefined, order: DateOrder = 'auto', date1904 = false): NaiveDate | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') {
    // Excel serial numbers between 1990 and 2100.
    if (v > 32874 && v < 73051) return excelSerialToNaive(v, date1904);
    return null;
  }
  let s = String(v).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  s = s.replace(WEEKDAY_RE, '');

  let m = s.match(ISO_RE);
  if (m) {
    const t = applyTime(m, 4);
    return t ? build(Number(m[1]), Number(m[2]), Number(m[3]), t.hh, t.mi, t.ss, t.hasTime) : null;
  }
  m = s.match(NUMERIC_RE);
  if (m) {
    const t = applyTime(m, 4);
    if (!t) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fullYear(Number(m[3]));
    let resolved: 'DMY' | 'MDY' = order === 'MDY' ? 'MDY' : 'DMY';
    if (order === 'auto' || order === 'YMD') {
      if (a > 12) resolved = 'DMY';
      else if (b > 12) resolved = 'MDY';
    }
    return resolved === 'DMY' ? build(y, b, a, t.hh, t.mi, t.ss, t.hasTime) : build(y, a, b, t.hh, t.mi, t.ss, t.hasTime);
  }
  m = s.match(DMONY_RE);
  if (m) {
    const mon = monthFromName(m[2]);
    const t = applyTime(m, 4);
    return mon && t ? build(fullYear(Number(m[3])), mon, Number(m[1]), t.hh, t.mi, t.ss, t.hasTime) : null;
  }
  m = s.match(MONDY_RE);
  if (m) {
    const mon = monthFromName(m[1]);
    const t = applyTime(m, 4);
    return mon && t ? build(Number(m[3]), mon, Number(m[2]), t.hh, t.mi, t.ss, t.hasTime) : null;
  }
  // Plain serial number stored as text.
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s), order, date1904);
  return null;
}

export function dayKey(d: NaiveDate | null): string | null {
  if (!d) return null;
  return new Date(d.ms).toISOString().slice(0, 10);
}

export function formatNaive(d: NaiveDate | null): string | null {
  if (!d) return null;
  const iso = new Date(d.ms).toISOString();
  return d.hasTime ? iso.slice(0, 16).replace('T', ' ') : iso.slice(0, 10);
}

/** Parses a YYYY-MM-DD string to the naive ms at midnight. */
export function isoDayToMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function maskValue(fieldType: string, v: string | null): string {
  if (!v) return '';
  if (fieldType === 'email') {
    const [user, domain] = v.split('@');
    if (!domain) return `${v.slice(0, 1)}***`;
    return `${user.slice(0, 1)}***@${domain}`;
  }
  if (fieldType === 'phone') {
    const digits = v.replace(/\D/g, '');
    return digits.length > 4 ? `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : '****';
  }
  return v.length > 2 ? `${v.slice(0, 1)}***` : '***';
}
