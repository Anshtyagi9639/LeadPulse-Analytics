// Copies non-TypeScript runtime files (the plain-JS parse worker) into dist/.
import fs from 'node:fs';
fs.mkdirSync('dist/domain', { recursive: true });
fs.copyFileSync('src/domain/parseWorker.mjs', 'dist/domain/parseWorker.mjs');
