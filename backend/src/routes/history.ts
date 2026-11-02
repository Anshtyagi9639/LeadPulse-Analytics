import { Router, type Request } from 'express';
import { z } from 'zod';
import { buildWorkbook } from '../export/excel.js';
import { buildPdf } from '../export/pdf.js';
import { clientHash } from '../lib/client.js';
import { AppError } from '../lib/errors.js';
import { safeFilename } from '../lib/sanitize.js';
import type { HistoryStore } from '../session/history.js';
import type { SessionStore } from '../session/store.js';

function owner(req: Request): string {
  const h = clientHash(req);
  if (!h) throw new AppError(400, 'CLIENT_ID_REQUIRED', 'Report history needs the X-Client-Id header sent by the portal.');
  return h;
}

/** Report history: list, re-download the summary report, delete. Entries hold metadata and aggregates only. */
export function historyRoutes(history: HistoryStore, store: SessionStore): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const list = await history.list(owner(req));
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      entries: list.map((e) => {
        const alive = store.has(e.id) && Date.parse(e.sessionExpiresAt) > Date.now();
        const live = alive ? store.get(e.id) : null;
        return {
          id: e.id,
          mode: e.mode,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          reportingPeriod: e.reportingPeriod,
          fileNames: e.fileNames,
          recordsProcessed: e.recordsProcessed,
          uniqueLeads: e.uniqueLeads,
          status: e.status,
          generations: e.generations,
          lastGeneratedAt: e.lastGeneratedAt,
          processingMs: e.processingMs,
          sessionExpiresAt: e.sessionExpiresAt,
          // Lead-level data (tables, lead exports, generated report files) only exists while the session is alive.
          sessionAvailable: alive,
          summaryAvailable: Boolean(e.snapshot),
          summary: e.snapshot
            ? {
                totalLeads: e.snapshot.overview.totalLeads,
                qualifiedLeads: e.snapshot.overview.qualifiedLeads,
                totalSpend: e.snapshot.overview.totalSpend,
                cpl: e.snapshot.overview.cpl,
                currency: e.snapshot.currency,
              }
            : null,
          reports: e.reports.map((rep) => ({
            ...rep,
            // The file can be downloaded again only while its session (and stored file) still exists.
            fileAvailable: Boolean(live?.generatedReports.some((g) => g.id === rep.id && g.path)),
          })),
        };
      }),
    });
  });

  r.get('/:id/export/:format', async (req, res) => {
    const format = z.enum(['pdf', 'excel']).parse(req.params.format);
    const e = await history.get(owner(req), z.string().uuid().parse(req.params.id));
    if (!e.snapshot) throw new AppError(404, 'NO_SUMMARY', 'This history entry has generated report files but no processed summary. Process the files to create one.');
    const p = e.reportingPeriod;
    const date = p.from === p.to ? p.from : `${p.from}_to_${p.to}`;
    const buf = format === 'pdf' ? await buildPdf(e.snapshot) : await buildWorkbook(e.snapshot, []);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(`lead-report_${date}_summary`)}.${format === 'pdf' ? 'pdf' : 'xlsx'}"`);
    res.send(buf);
  });

  r.delete('/:id', async (req, res) => {
    await history.remove(owner(req), z.string().uuid().parse(req.params.id));
    res.json({ deleted: true });
  });

  return r;
}
