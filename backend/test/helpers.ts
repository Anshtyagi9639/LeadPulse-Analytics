import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type AppDeps } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';

export const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
export const REPORT_DATE = '2026-10-30';

export function sample(name: string): string {
  return path.join(SAMPLES_DIR, name);
}

export async function makeTestApp(overrides: Partial<AppConfig> = {}, deps: AppDeps = { aiClient: null }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leadpulse-test-'));
  const config = loadConfig(
    { NODE_ENV: 'test', TEMP_DIR: path.join(tmp, 'sessions'), CONFIG_DIR: path.join(tmp, 'config'), CORS_ORIGINS: 'http://localhost:3000' },
    overrides,
  );
  const ctx = await createApp(config, deps);
  return {
    ...ctx,
    config,
    tmp,
    cleanup: async () => {
      await ctx.store.stop(true);
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
