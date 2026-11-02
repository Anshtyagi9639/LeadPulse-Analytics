import { describe, expect, it } from 'vitest';
import { classifyApplied, classifyContactedFromStatus, classifyEnrolled, classifyOffer, classifyQualified } from '../src/domain/classify.js';
import { detectFileKind, suggestMapping } from '../src/domain/mapping.js';
import { detectDateOrder, formatNaive, maskValue, normalizeEmail, normalizePhone, parseDate, parseNumber } from '../src/domain/normalize.js';
import { canonicalSource } from '../src/domain/sources.js';
import { csvEscape, sanitizeCell } from '../src/lib/sanitize.js';

describe('phone normalisation', () => {
  it.each([
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['98765-43210', '9876543210'],
    ['00971501234567', '971501234567'],
  ])('%s -> %s', (raw, expected) => {
    const r = normalizePhone(raw);
    expect(r.normalized).toBe(expected);
    expect(r.valid).toBe(true);
  });
  it('handles numeric cells from Excel', () => expect(normalizePhone(919876543210).normalized).toBe('9876543210'));
  it('rejects bad lengths, placeholders and scientific notation', () => {
    expect(normalizePhone('12345').valid).toBe(false);
    expect(normalizePhone('0000000000').valid).toBe(false);
    expect(normalizePhone('9.19877E+11').valid).toBe(false);
  });
  it('warns (but accepts) non-mobile Indian patterns', () => {
    const r = normalizePhone('1234567890');
    expect(r.valid).toBe(true);
    expect(r.warning).toMatch(/Indian mobile/);
  });
});

describe('email normalisation', () => {
  it('lower-cases and validates', () => {
    expect(normalizeEmail('  Student.One@Example.COM ').normalized).toBe('student.one@example.com');
    expect(normalizeEmail('not-an-email').valid).toBe(false);
    expect(normalizeEmail('a at example.com').valid).toBe(false);
    expect(normalizeEmail('a@b').valid).toBe(false);
  });
});

describe('number parsing', () => {
  it.each([
    ['₹1,23,456.50', 123456.5],
    ['INR 2,000', 2000],
    ['(500)', -500],
    ['12%', 12],
    [42, 42],
    ['abc', null],
    ['', null],
  ])('%s', (raw, expected) => expect(parseNumber(raw as string)).toBe(expected));
});

describe('date parsing', () => {
  const f = (v: string | number, o: 'auto' | 'DMY' | 'MDY' = 'auto') => formatNaive(parseDate(v, o));
  it('parses ISO dates and times', () => {
    expect(f('2026-10-30')).toBe('2026-10-30');
    expect(f('2026-10-30 14:05')).toBe('2026-10-30 14:05');
    expect(f('2026-10-30T14:05:09')).toBe('2026-10-30 14:05');
    expect(f('2026-10-30T14:05:09Z')).toBe('2026-10-30 14:05');
  });
  it('parses day-first and month-first numeric dates', () => {
    expect(f('30/10/2026')).toBe('2026-10-30');
    expect(f('10/30/2026')).toBe('2026-10-30');
    expect(f('05/10/2026', 'DMY')).toBe('2026-10-05');
    expect(f('05/10/2026', 'MDY')).toBe('2026-05-10');
    expect(f('30-10-26 2:15 PM')).toBe('2026-10-30 14:15');
    expect(f('30.10.2026 12:00 am')).toBe('2026-10-30 00:00');
  });
  it('parses month names', () => {
    expect(f('30 Oct 2026')).toBe('2026-10-30');
    expect(f('30-October-2026 10:30')).toBe('2026-10-30 10:30');
    expect(f('Oct 30, 2026')).toBe('2026-10-30');
    expect(f('Fri, 30 Oct 2026 09:00')).toBe('2026-10-30 09:00');
  });
  it('parses Excel serial numbers (with time fraction)', () => {
    expect(f(46325)).toBe('2026-10-30');
    expect(f(46325.5)).toBe('2026-10-30 12:00');
  });
  it('rejects impossible or garbage values', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
    expect(parseDate('13/13/2026')).toBeNull();
    expect(parseDate(12)).toBeNull();
  });
  it('detects column date order', () => {
    expect(detectDateOrder(['01/02/2026', '25/02/2026'])).toEqual({ order: 'DMY', ambiguous: false });
    expect(detectDateOrder(['01/02/2026', '02/25/2026'])).toEqual({ order: 'MDY', ambiguous: false });
    expect(detectDateOrder(['01/02/2026', '03/04/2026'])).toEqual({ order: 'DMY', ambiguous: true });
  });
});

describe('masking', () => {
  it('masks personal data', () => {
    expect(maskValue('phone', '9876543210')).toBe('******3210');
    expect(maskValue('email', 'student@example.com')).toBe('s***@example.com');
  });
});

describe('status classification', () => {
  it('qualification is explicit only', () => {
    expect(classifyQualified('Qualified')).toBe(true);
    expect(classifyQualified('Yes')).toBe(true);
    expect(classifyQualified('Unqualified')).toBe(false);
    expect(classifyQualified('Not Qualified')).toBe(false);
    expect(classifyQualified('Junk')).toBe(false);
    expect(classifyQualified('Pending')).toBeNull();
    expect(classifyQualified('')).toBeNull();
  });
  it('contact statuses', () => {
    expect(classifyContactedFromStatus('Contacted')).toBe(true);
    expect(classifyContactedFromStatus('Not Contacted')).toBe(false);
    expect(classifyContactedFromStatus('DNP')).toBe(false);
    expect(classifyContactedFromStatus('Follow Up')).toBe(true);
  });
  it('conversion statuses ignore negations', () => {
    expect(classifyApplied('Submitted')).toBe(true);
    expect(classifyApplied('Not Applied')).toBe(false);
    expect(classifyApplied('In Progress')).toBe(false);
    expect(classifyOffer('Conditional Offer')).toBe(true);
    expect(classifyOffer('Offer Pending')).toBe(false);
    expect(classifyEnrolled('Enrolled')).toBe(true);
    expect(classifyEnrolled('Enrolment Pending')).toBe(false);
  });
});

describe('column mapping', () => {
  it('recognises SalesMax and provider header variants', () => {
    const headers = ['Enquiry No', 'Student Name', 'Contact No', 'Email ID', 'Destination', 'Counselor', 'Created On', 'UTM Campaign', 'Next Follow Up', 'Random Column'];
    const m = suggestMapping(headers, 'leads');
    expect(Object.values(m.mapping)).toEqual(['leadId', 'name', 'phone', 'email', 'preferredCountry', 'assignedCounsellor', 'leadCreatedDate', 'utmCampaign', 'nextFollowUpDate']);
    expect(m.unmapped).toEqual([9]);
  });
  it('never maps a field twice', () => {
    const m = suggestMapping(['Phone', 'Mobile', 'Phone Number'], 'leads');
    expect(Object.values(m.mapping)).toEqual(['phone']);
  });
  it('detects ad-spend files', () => {
    expect(detectFileKind(['Date', 'Campaign Name', 'Amount Spent (INR)', 'Impressions', 'Clicks'])).toBe('ad_spend');
    expect(detectFileKind(['Lead ID', 'Phone', 'Campaign Name', 'Spend'])).toBe('leads');
  });
  it('canonicalises sources without inventing new ones', () => {
    expect(canonicalSource('facebook')).toBe('Meta Ads');
    expect(canonicalSource('Instagram')).toBe('Meta Ads');
    expect(canonicalSource('google ads')).toBe('Google Ads');
    expect(canonicalSource('College Dunia')).toBe('Collegedunia');
    expect(canonicalSource('Shiksha')).toBe('Shiksha');
    expect(canonicalSource(null)).toBeNull();
  });
});

describe('formula-injection protection', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '|calc'])('neutralises %j', (v) => {
    expect(String(sanitizeCell(v)).startsWith("'")).toBe(true);
  });
  it('leaves normal text and numbers alone', () => {
    expect(sanitizeCell('Meta Ads')).toBe('Meta Ads');
    expect(sanitizeCell(-5)).toBe(-5);
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
  });
});
