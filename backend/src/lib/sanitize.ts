/**
 * Spreadsheet formula-injection protection (OWASP CSV injection).
 * Text that a spreadsheet application could interpret as a formula is prefixed with a single quote.
 */
const DANGEROUS = /^[=+\-@\t\r|%]/;
const SAFE_NUMERIC = /^[+-]?\d[\d\s().-]*$/;

export function sanitizeCell(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  // Pure numbers / phone numbers such as +91 98765 43210 or -250 cannot run code; keep them intact.
  if (SAFE_NUMERIC.test(v)) return v;
  return DANGEROUS.test(v) ? `'${v}` : v;
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(sanitizeCell(typeof v === 'number' && !Number.isFinite(v) ? '' : v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // UTF-8 BOM so Excel opens non-ASCII text correctly.
  return `\ufeff${[headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n')}\r\n`;
}

/** Safe for Content-Disposition filenames. */
export function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'report';
}
