import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { KPI_DEFINITIONS } from '../domain/definitions.js';
import { AD_FIELDS, LEAD_FIELDS } from '../domain/fields.js';
import type { TemplateStore } from '../session/templates.js';
import type { SessionService } from '../session/service.js';

const SaveTemplateBody = z.object({
  name: z.string().trim().min(1).max(80),
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
});

export function metaRoutes(config: AppConfig, templates: TemplateStore, service: SessionService): Router {
  const r = Router();

  r.get('/meta', (_req, res) => {
    const strip = (f: (typeof LEAD_FIELDS)[number]) => ({ key: f.key, label: f.label, group: f.group, type: f.type, pii: Boolean(f.pii) });
    res.json({
      fields: { leads: LEAD_FIELDS.map(strip), ad_spend: AD_FIELDS.map(strip) },
      definitions: KPI_DEFINITIONS,
      limits: {
        maxFileSizeMb: config.MAX_FILE_SIZE_MB,
        maxFilesPerSession: config.MAX_FILES_PER_SESSION,
        maxRowsPerSheet: config.MAX_ROWS_PER_SHEET,
        maxRowsPerSession: config.MAX_ROWS_PER_SESSION,
        sessionTtlHours: config.SESSION_TTL_HOURS,
      },
      currency: config.CURRENCY,
      aiEnabled: Boolean(config.OPENAI_API_KEY),
    });
  });

  r.get('/mapping-templates', async (_req, res) => {
    res.json({ templates: await templates.list() });
  });

  // Saves the current mapping of a session file as a reusable template (header names + field keys only).
  r.post('/mapping-templates', async (req, res) => {
    const body = SaveTemplateBody.parse(req.body);
    const s = service.store.get(body.sessionId);
    const f = service.getFile(s, body.fileId);
    const tpl = await templates.save(body.name, f.kind, f.headers, f.mapping);
    res.status(201).json({ template: tpl });
  });

  r.delete('/mapping-templates/:id', async (req, res) => {
    await templates.remove(z.string().uuid().parse(req.params.id));
    res.json({ deleted: true });
  });

  return r;
}
