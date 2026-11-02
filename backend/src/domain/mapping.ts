import { fieldsFor, type FileKind } from './fields.js';
import { normalizeHeader } from './normalize.js';

/** column index (as string) -> field key */
export type ColumnMapping = Record<string, string>;

export interface MappingSuggestion {
  mapping: ColumnMapping;
  /** column index -> confidence (1 = exact synonym, 0.6 = partial) */
  confidence: Record<string, number>;
  unmapped: number[];
}

const synonymIndex = new Map<FileKind, Map<string, string>>();

function indexFor(kind: FileKind): Map<string, string> {
  let idx = synonymIndex.get(kind);
  if (!idx) {
    idx = new Map();
    for (const f of fieldsFor(kind)) {
      idx.set(normalizeHeader(f.label), f.key);
      idx.set(normalizeHeader(f.key.replace(/([A-Z])/g, ' $1')), f.key);
      for (const s of f.synonyms) if (!idx.has(normalizeHeader(s))) idx.set(normalizeHeader(s), f.key);
    }
    synonymIndex.set(kind, idx);
  }
  return idx;
}

/** Exact synonym match for one header. */
export function matchHeader(header: string, kind: FileKind): string | null {
  const n = normalizeHeader(header);
  if (!n) return null;
  return indexFor(kind).get(n) ?? null;
}

/**
 * Suggests a mapping for the given headers. Exact synonym matches win; otherwise a header that
 * contains a multi-word synonym gets a lower-confidence suggestion. Each field is mapped at most once.
 */
export function suggestMapping(headers: string[], kind: FileKind): MappingSuggestion {
  const idx = indexFor(kind);
  const mapping: ColumnMapping = {};
  const confidence: Record<string, number> = {};
  const used = new Set<string>();

  headers.forEach((h, i) => {
    const key = idx.get(normalizeHeader(h));
    if (key && !used.has(key)) {
      mapping[String(i)] = key;
      confidence[String(i)] = 1;
      used.add(key);
    }
  });

  const partials = [...idx.entries()].filter(([syn]) => syn.includes(' ')).sort((a, b) => b[0].length - a[0].length);
  headers.forEach((h, i) => {
    if (mapping[String(i)]) return;
    const n = ` ${normalizeHeader(h)} `;
    if (n.trim().length < 3) return;
    for (const [syn, key] of partials) {
      if (!used.has(key) && n.includes(` ${syn} `)) {
        mapping[String(i)] = key;
        confidence[String(i)] = 0.6;
        used.add(key);
        break;
      }
    }
  });

  const unmapped = headers.map((_, i) => i).filter((i) => !mapping[String(i)] && normalizeHeader(headers[i]));
  return { mapping, confidence, unmapped };
}

/** Score used to guess whether a sheet is a lead export or an advertising-spend export. */
export function detectFileKind(headers: string[]): FileKind {
  const leads = suggestMapping(headers, 'leads').mapping;
  const ads = suggestMapping(headers, 'ad_spend').mapping;
  const leadKeys = new Set(Object.values(leads));
  const adKeys = new Set(Object.values(ads));
  const hasIdentity = ['leadId', 'phone', 'email', 'name'].some((k) => leadKeys.has(k));
  if (adKeys.has('spend') && !hasIdentity) return 'ad_spend';
  return 'leads';
}

/** Applies a saved template (normalised header -> field) to the current headers. */
export function applyTemplate(headers: string[], template: Record<string, string>, kind: FileKind): ColumnMapping {
  const valid = new Set(fieldsFor(kind).map((f) => f.key));
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  headers.forEach((h, i) => {
    const key = template[normalizeHeader(h)];
    if (key && valid.has(key) && !used.has(key)) {
      mapping[String(i)] = key;
      used.add(key);
    }
  });
  return mapping;
}
