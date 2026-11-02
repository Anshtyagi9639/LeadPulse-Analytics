// Dev helper: builds the PDF and Excel reports from the synthetic samples into the given directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildWorkbook } from '../src/export/excel.js';
import { buildPdf } from '../src/export/pdf.js';

const out = path.resolve(process.argv[2] ?? '.');
const dir = path.resolve('..', 'samples');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-sample-'));
const { service, store } = await createApp(loadConfig({ NODE_ENV: 'test', TEMP_DIR: tmp, CONFIG_DIR: tmp }), { aiClient: null });
const s = await store.create('2026-10-30');
const names = fs.readdirSync(dir).filter((n) => /^0\d_/.test(n));
await service.addFiles(s, names.map((n) => { const b = fs.readFileSync(path.join(dir, n)); return { originalname: n, buffer: b, size: b.length }; }));
await service.process(s);
fs.writeFileSync(path.join(out, 'sample-report.pdf'), await buildPdf(s.report!));
fs.writeFileSync(path.join(out, 'sample-report.xlsx'), await buildWorkbook(s.report!, service.allIssues(s).issues));
await store.stop(true);
fs.rmSync(tmp, { recursive: true, force: true });
console.warn(`Wrote sample-report.pdf and sample-report.xlsx to ${out}`);
