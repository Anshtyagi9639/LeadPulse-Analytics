import {
  AD_ATTRIBUTION_FIELDS,
  AD_FIELD_MAP,
  LEAD_FIELD_MAP,
  LEAD_IDENTITY_FIELDS,
  fieldsFor,
  type FieldDef,
  type FileKind,
} from './fields.js';
import type { ColumnMapping } from './mapping.js';
import {
  cleanString,
  detectDateOrder,
  maskValue,
  normalizeEmail,
  normalizePhone,
  parseDate,
  parseNumber,
  type CellValue,
  type DateOrder,
  type NaiveDate,
} from './normalize.js';
import { isBlankRow } from './spreadsheet.js';

export interface LeadRecord {
  uid: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  /** Upload order of the source file, then row order — used for "first occurrence" tie-breaks. */
  order: number;
  phone: string | null;
  email: string | null;
  phoneValid: boolean;
  emailValid: boolean;
  /** A value was present in the phone/email column (even if invalid). */
  phoneProvided: boolean;
  emailProvided: boolean;
  /** Cleaned text values keyed by field key. */
  text: Record<string, string>;
  dates: Record<string, NaiveDate>;
  revenue: number | null;
  /** Numeric fields other than revenue (attempts, total calls, calls today …). */
  numbers: Record<string, number>;
}

export interface AdRecord {
  uid: string;
  fileId: string;
  fileName: string;
  rowNumber: number;
  campaignName: string | null;
  source: string | null;
  date: NaiveDate | null;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  budget: number | null;
  targetLeads: number | null;
}

export interface ValidationIssue {
  fileId: string;
  fileName: string;
  sheet: string;
  rowNumber: number | null;
  field: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Masked for personal-data fields. */
  value: string;
}

export interface FileValidation {
  kind: FileKind;
  dataRows: number;
  blankRows: number;
  accepted: number;
  rejected: number;
  rowsWithWarnings: number;
  issueCount: number;
  issues: ValidationIssue[];
  issuesTruncated: boolean;
  mappedFields: string[];
  missingFields: string[];
  unmappedColumns: string[];
  dateOrders: Record<string, { order: 'DMY' | 'MDY' | 'YMD'; ambiguous: boolean }>;
  leads: LeadRecord[];
  ads: AdRecord[];
  /** Rows that were not accepted, kept so they can be reviewed and exported (never silently dropped). */
  rejectedRows: { rowNumber: number; code: string; reason: string }[];
}

export interface ValidateInput {
  fileId: string;
  fileName: string;
  fileOrder: number;
  sheet: string;
  rows: CellValue[][];
  firstRow: number;
  headerRow: number;
  headers: string[];
  mapping: ColumnMapping;
  kind: FileKind;
  dateOrder: DateOrder;
  date1904: boolean;
  maxIssues?: number;
}

/** Throws a descriptive message if the mapping cannot produce a usable report. */
export function mappingProblems(kind: FileKind, mapping: ColumnMapping): string[] {
  const keys = new Set(Object.values(mapping));
  const problems: string[] = [];
  if (kind === 'leads') {
    if (!LEAD_IDENTITY_FIELDS.some((k) => keys.has(k))) {
      problems.push('Map at least one identifying column: Lead ID, Phone Number, Email or Name.');
    }
  } else {
    if (!keys.has('spend')) problems.push('Map the Spend column.');
    if (!AD_ATTRIBUTION_FIELDS.some((k) => keys.has(k))) problems.push('Map Campaign Name or Source so spend can be attributed.');
  }
  const counts = new Map<string, number>();
  for (const k of Object.values(mapping)) counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const [k, n] of counts) {
    if (n > 1) {
      const label = (kind === 'leads' ? LEAD_FIELD_MAP : AD_FIELD_MAP).get(k)?.label ?? k;
      problems.push(`"${label}" is mapped to ${n} columns. Map each field to one column only.`);
    }
  }
  return problems;
}

export function validateRows(input: ValidateInput): FileValidation {
  const { fileId, fileName, sheet, rows, headerRow, headers, mapping, kind, firstRow } = input;
  const maxIssues = input.maxIssues ?? 5000;
  const defs = new Map(fieldsFor(kind).map((f) => [f.key, f]));
  const columns = Object.entries(mapping)
    .map(([col, key]) => ({ col: Number(col), def: defs.get(key) }))
    .filter((c): c is { col: number; def: FieldDef } => Boolean(c.def));

  const result: FileValidation = {
    kind,
    dataRows: 0,
    blankRows: 0,
    accepted: 0,
    rejected: 0,
    rowsWithWarnings: 0,
    issueCount: 0,
    issues: [],
    issuesTruncated: false,
    mappedFields: columns.map((c) => c.def.key),
    missingFields: fieldsFor(kind).filter((f) => !columns.some((c) => c.def.key === f.key)).map((f) => f.key),
    unmappedColumns: headers.filter((_, i) => !mapping[String(i)] && !/^Column [A-Z]+$/.test(headers[i])),
    dateOrders: {},
    leads: [],
    ads: [],
    rejectedRows: [],
  };

  const body = rows.slice(headerRow + 1);

  // Detect day/month order per date column.
  const dateOrderFor = new Map<number, DateOrder>();
  for (const { col, def } of columns) {
    if (def.type !== 'date' && def.type !== 'datetime') continue;
    if (input.dateOrder !== 'auto') {
      dateOrderFor.set(col, input.dateOrder);
      result.dateOrders[def.key] = { order: input.dateOrder, ambiguous: false };
    } else {
      const det = detectDateOrder(body.map((r) => r[col] ?? null));
      dateOrderFor.set(col, det.order);
      result.dateOrders[def.key] = det;
    }
  }

  const addIssue = (rowNumber: number | null, def: FieldDef | null, severity: 'error' | 'warning', code: string, message: string, raw?: CellValue) => {
    result.issueCount++;
    if (result.issues.length >= maxIssues) {
      result.issuesTruncated = true;
      return;
    }
    const str = raw === undefined || raw === null ? '' : String(raw);
    result.issues.push({
      fileId,
      fileName,
      sheet,
      rowNumber,
      field: def?.label ?? '',
      severity,
      code,
      message,
      value: def?.pii ? maskValue(def.type, str) : str.slice(0, 120),
    });
  };

  for (const [k, info] of Object.entries(result.dateOrders)) {
    if (info.ambiguous) {
      const def = defs.get(k)!;
      addIssue(null, def, 'warning', 'AMBIGUOUS_DATE_ORDER', `All dates in "${def.label}" could be day-first or month-first. Interpreted as day/month/year; change the date format setting if this is wrong.`);
    }
  }

  body.forEach((row, i) => {
    const rowNumber = firstRow + headerRow + 1 + i;
    if (isBlankRow(row)) {
      result.blankRows++;
      return;
    }
    result.dataRows++;
    let warned = false;
    const warn = (def: FieldDef, code: string, message: string, raw: CellValue) => {
      warned = true;
      addIssue(rowNumber, def, 'warning', code, message, raw);
    };

    if (kind === 'leads') {
      const rec: LeadRecord = {
        uid: `${fileId}:${rowNumber}`,
        fileId,
        fileName,
        rowNumber,
        order: input.fileOrder * 1_000_000 + rowNumber,
        phone: null,
        email: null,
        phoneValid: false,
        emailValid: false,
        phoneProvided: false,
        emailProvided: false,
        text: {},
        dates: {},
        revenue: null,
        numbers: {},
      };
      for (const { col, def } of columns) {
        const raw = row[col] ?? null;
        const present = cleanString(raw) !== null;
        switch (def.type) {
          case 'phone': {
            if (!present) break;
            const p = normalizePhone(raw);
            rec.phoneProvided = true;
            rec.phone = p.normalized;
            rec.phoneValid = p.valid;
            if (!p.valid) warn(def, 'INVALID_PHONE', p.warning ?? 'Invalid phone number', raw);
            else if (p.warning) warn(def, 'PHONE_PATTERN', p.warning, raw);
            break;
          }
          case 'email': {
            if (!present) break;
            const e = normalizeEmail(raw);
            rec.emailProvided = true;
            rec.email = e.normalized;
            rec.emailValid = e.valid;
            if (!e.valid) warn(def, 'INVALID_EMAIL', 'Invalid email address format', raw);
            break;
          }
          case 'date':
          case 'datetime': {
            if (!present) break;
            const d = parseDate(raw, dateOrderFor.get(col) ?? 'auto', input.date1904);
            if (d) rec.dates[def.key] = d;
            else warn(def, 'INVALID_DATE', 'Unrecognised date format; value ignored', raw);
            break;
          }
          case 'currency':
          case 'number': {
            if (!present) break;
            const n = parseNumber(raw);
            if (n === null) warn(def, 'INVALID_NUMBER', 'Not a number; value ignored', raw);
            else if (n < 0) warn(def, 'NEGATIVE_NUMBER', 'Negative value ignored', raw);
            else if (def.key === 'revenue') rec.revenue = n;
            else rec.numbers[def.key] = n;
            break;
          }
          default: {
            const s = cleanString(raw);
            if (s) rec.text[def.key] = s;
          }
        }
      }
      const hasIdentity = Boolean(rec.text.leadId || rec.phone || rec.email || rec.text.name);
      if (!hasIdentity) {
        result.rejected++;
        result.rejectedRows.push({ rowNumber, code: 'NO_IDENTIFIER', reason: 'No Lead ID, valid phone, valid email or name' });
        addIssue(rowNumber, null, 'error', 'NO_IDENTIFIER', 'Row rejected: no Lead ID, valid phone, valid email or name.');
        return;
      }
      result.accepted++;
      if (warned) result.rowsWithWarnings++;
      result.leads.push(rec);
    } else {
      const get = (key: string) => {
        const c = columns.find((x) => x.def.key === key);
        return c ? (row[c.col] ?? null) : null;
      };
      const num = (key: string): number | null => {
        const raw = get(key);
        if (cleanString(raw) === null) return null;
        const n = parseNumber(raw);
        if (n === null || n < 0) {
          warn(AD_FIELD_MAP.get(key)!, 'INVALID_NUMBER', 'Not a valid non-negative number; value ignored', raw);
          return null;
        }
        return n;
      };
      const spend = num('spend');
      const campaignName = cleanString(get('campaignName'));
      const source = cleanString(get('source'));
      const dateRaw = get('date');
      const dateCol = columns.find((x) => x.def.key === 'date');
      const date = cleanString(dateRaw) ? parseDate(dateRaw, dateCol ? (dateOrderFor.get(dateCol.col) ?? 'auto') : 'auto', input.date1904) : null;
      if (cleanString(dateRaw) && !date) warn(AD_FIELD_MAP.get('date')!, 'INVALID_DATE', 'Unrecognised date format; value ignored', dateRaw);
      const rec: AdRecord = {
        uid: `${fileId}:${rowNumber}`,
        fileId,
        fileName,
        rowNumber,
        campaignName,
        source,
        date,
        spend: spend ?? 0,
        impressions: num('impressions'),
        clicks: num('clicks'),
        budget: num('budget'),
        targetLeads: num('targetLeads'),
      };
      if (spend === null) {
        result.rejected++;
        result.rejectedRows.push({ rowNumber, code: 'MISSING_SPEND', reason: 'Spend is missing or invalid' });
        addIssue(rowNumber, AD_FIELD_MAP.get('spend')!, 'error', 'MISSING_SPEND', 'Row rejected: spend is missing or invalid.', get('spend'));
        return;
      }
      if (!campaignName && !source) {
        result.rejected++;
        result.rejectedRows.push({ rowNumber, code: 'NO_ATTRIBUTION', reason: 'No campaign name or source' });
        addIssue(rowNumber, null, 'error', 'NO_ATTRIBUTION', 'Row rejected: no campaign name or source to attribute the spend to.');
        return;
      }
      result.accepted++;
      if (warned) result.rowsWithWarnings++;
      result.ads.push(rec);
    }
  });

  return result;
}
