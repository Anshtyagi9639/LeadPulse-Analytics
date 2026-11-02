// Dev helper: processes the synthetic samples and prints the headline report (no PII is printed).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { executiveRows } from '../src/export/tables.js';

const dir = path.resolve('..', 'samples');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-dump-'));
const { service, store } = await createApp(loadConfig({ NODE_ENV: 'test', TEMP_DIR: tmp, CONFIG_DIR: tmp }), { aiClient: null });
const s = await store.create('2026-10-30');
const names = fs.readdirSync(dir).filter((n) => /^0\d_/.test(n));
await service.addFiles(s, names.map((n) => { const b = fs.readFileSync(path.join(dir, n)); return { originalname: n, buffer: b, size: b.length }; }));
await service.process(s);
const r = s.report!;
for (const x of executiveRows(r)) console.warn(x.metric.padEnd(34), String(x.value).padStart(10), ' ', x.note);
console.warn('\nCAMPAIGNS'); for (const c of r.campaigns) console.warn(c.label.padEnd(28), c.leads, c.qualified, c.spend, c.cpl, c.targetAchievement);
console.warn('\nSOURCES'); for (const c of r.sources) console.warn(c.label.padEnd(28), c.leads, c.spend, c.cpl);
console.warn('\nFUNNEL'); for (const f of r.funnel) console.warn(f.label.padEnd(16), f.count, f.coverage, f.note ?? '');
console.warn('\nCOUNSELLORS'); for (const c of r.counsellors) console.warn(c.counsellor.padEnd(20), c.leads, c.contactRate, c.medianFirstResponseMinutes, c.followUpsDue, c.followUpsOverdue);
console.warn('\nNOTES'); for (const n of r.notes) console.warn('-', n.level, n.message);
console.warn('\nDQ', JSON.stringify({ ...r.dataQuality, unmappedColumns: undefined }));
await store.stop(true); fs.rmSync(tmp, { recursive: true, force: true });
