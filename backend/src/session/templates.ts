import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileKind } from '../domain/fields.js';
import { fieldsFor } from '../domain/fields.js';
import { normalizeHeader } from '../domain/normalize.js';
import { AppError } from '../lib/errors.js';

/**
 * Saved column-mapping templates. Only header names and field keys are stored — never lead data.
 * Persisted as JSON in CONFIG_DIR so templates survive restarts.
 */
export interface MappingTemplate {
  id: string;
  name: string;
  kind: FileKind;
  /** normalised header -> field key */
  columns: Record<string, string>;
  createdAt: string;
}

const MAX_TEMPLATES = 100;

export class TemplateStore {
  private cache: MappingTemplate[] | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'mapping-templates.json');
  }

  async list(): Promise<MappingTemplate[]> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.cache = Array.isArray(parsed) ? parsed.filter((t) => t && typeof t.name === 'string' && t.columns) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  async save(name: string, kind: FileKind, headers: string[], mapping: Record<string, string>): Promise<MappingTemplate> {
    const valid = new Set(fieldsFor(kind).map((f) => f.key));
    const columns: Record<string, string> = {};
    for (const [col, key] of Object.entries(mapping)) {
      const h = normalizeHeader(headers[Number(col)]);
      if (h && valid.has(key)) columns[h] = key;
    }
    if (!Object.keys(columns).length) throw new AppError(400, 'EMPTY_TEMPLATE', 'The mapping has no mapped columns to save.');
    const list = await this.list();
    const existing = list.find((t) => t.name.toLowerCase() === name.toLowerCase() && t.kind === kind);
    const tpl: MappingTemplate = { id: existing?.id ?? randomUUID(), name, kind, columns, createdAt: new Date().toISOString() };
    const next = [...list.filter((t) => t.id !== tpl.id), tpl].slice(-MAX_TEMPLATES);
    await this.persist(next);
    return tpl;
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    if (!list.some((t) => t.id === id)) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Mapping template not found.');
    await this.persist(list.filter((t) => t.id !== id));
  }

  async get(id: string): Promise<MappingTemplate> {
    const t = (await this.list()).find((x) => x.id === id);
    if (!t) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Mapping template not found.');
    return t;
  }

  /** Best template for these headers: the one matching the most columns (at least 3). */
  async bestFor(headers: string[], kind: FileKind): Promise<MappingTemplate | null> {
    const norm = new Set(headers.map(normalizeHeader));
    let best: MappingTemplate | null = null;
    let bestScore = 2;
    for (const t of await this.list()) {
      if (t.kind !== kind) continue;
      const score = Object.keys(t.columns).filter((h) => norm.has(h)).length;
      if (score > bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }

  private async persist(list: MappingTemplate[]): Promise<void> {
    this.cache = list;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
      await fs.rename(tmp, this.file);
    });
    await this.writing;
  }
}
