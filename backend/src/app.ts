import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import * as helmetModule from 'helmet';
import type { HelmetOptions } from 'helmet';
import { createOpenAiClient, type AiClient } from './ai/insights.js';
import type { AppConfig } from './config.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { historyRoutes } from './routes/history.js';
import { metaRoutes } from './routes/meta.js';
import { sessionRoutes } from './routes/sessions.js';
import { HistoryStore } from './session/history.js';
import { ReportService } from './session/reports.js';
import { SessionService } from './session/service.js';
import { SessionStore } from './session/store.js';
import { TemplateStore } from './session/templates.js';

// helmet ships ESM and CommonJS builds whose typings both declare `helmet as default`, but which one TypeScript picks
// for this ESM file depends on the installer and resolver (Vercel resolves the CommonJS typings, where the default
// import is the whole module namespace and is not callable). Unwrap at runtime and type the factory explicitly so the
// build does not depend on that choice.
type HelmetFactory = (options?: Readonly<HelmetOptions>) => express.RequestHandler;
const helmetExport: unknown = helmetModule.default;
const helmet = (
  typeof helmetExport === 'function' ? helmetExport : (helmetExport as { default: unknown }).default
) as HelmetFactory;

export interface AppDeps {
  aiClient?: AiClient | null;
}

export async function createApp(config: AppConfig, deps: AppDeps = {}) {
  const store = new SessionStore(config);
  await store.init();
  const templates = new TemplateStore(config.CONFIG_DIR);
  const history = new HistoryStore(config.CONFIG_DIR, config.HISTORY_RETENTION_DAYS);
  // Each generated report is recorded in the owner's history (metadata + aggregate KPIs only).
  const service = new SessionService(store, templates, config, async (s) => {
    if (!s.ownerHash || !s.report) return;
    const r = s.report;
    await history.record({
      id: s.id,
      ownerHash: s.ownerHash,
      reportingPeriod: { from: r.period.from, to: r.period.to },
      fileNames: r.scope.fileNames,
      recordsProcessed: r.counts.rawRows,
      uniqueLeads: r.counts.uniqueLeads,
      lastGeneratedAt: r.generatedAt,
      processingMs: s.lastProcessingMs,
      sessionExpiresAt: new Date(s.expiresAt).toISOString(),
      snapshot: r,
      mode: s.mode,
    });
  });
  store.onDelete = (id) => service.dropCache(id);
  const reports = new ReportService(service, history);
  const aiClient = deps.aiClient !== undefined ? deps.aiClient : createOpenAiClient(config);

  const app = express();
  app.disable('x-powered-by');
  const trust = config.TRUST_PROXY;
  if (trust !== 'false') app.set('trust proxy', /^\d+$/.test(trust) ? Number(trust) : trust === 'true' ? 1 : trust);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // The portal sends only these; it uses no cookies or Authorization header, so credentials stay disabled.
      allowedHeaders: ['Content-Type', 'X-Client-Id'],
      exposedHeaders: ['Content-Disposition'],
      maxAge: 600,
    }),
  );
  // cors() answers allowed preflights itself and passes rejected ones on, where Express would reply 200 without
  // CORS headers. Refuse them explicitly so a misconfigured origin is visible as a 403.
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS' && req.headers.origin && req.headers['access-control-request-method']) {
      res.status(403).json({ error: { code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed to call the API.' } });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again shortly.' } } }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), activeSessions: store.size, aiConfigured: Boolean(aiClient), time: new Date().toISOString() });
  });
  app.use('/api', metaRoutes(config, templates, service));
  app.use('/api/sessions', sessionRoutes(service, config, aiClient, reports));
  app.use('/api/history', historyRoutes(history, store));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, store, service, templates, history, reports };
}
