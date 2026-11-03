import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Set when running behind a reverse proxy / load balancer (needed for correct rate-limit IPs). */
  TRUST_PROXY: z.string().default('false'),

  SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(12),
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().positive().default(10),
  /** Root of the temporary upload area. A per-process sub-directory is created inside it. */
  TEMP_DIR: z.string().default(path.join(os.tmpdir(), 'leadpulse-sessions')),
  /** Non-sensitive configuration only (mapping templates). Never lead data. */
  CONFIG_DIR: z.string().default(path.resolve(process.cwd(), 'data')),

  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(15),
  MAX_FILES_PER_SESSION: z.coerce.number().int().positive().default(20),
  MAX_ROWS_PER_SHEET: z.coerce.number().int().positive().default(50000),
  MAX_ROWS_PER_SESSION: z.coerce.number().int().positive().default(200000),
  MAX_COLUMNS: z.coerce.number().int().positive().default(200),
  MAX_SESSIONS: z.coerce.number().int().positive().default(200),
  /** Report history (metadata + aggregate KPIs only, never lead rows) is kept this many days. */
  HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(30),
  /** Maximum total uncompressed size of an XLSX archive. */
  MAX_UNCOMPRESSED_MB: z.coerce.number().positive().default(250),
  PARSE_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  PARSE_MEMORY_MB: z.coerce.number().int().positive().default(768),
  PARSE_IN_WORKER: bool.default(true),

  CURRENCY: z.string().default('INR'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  AI_MAX_REQUESTS_PER_SESSION: z.coerce.number().int().positive().default(30),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(6),
  AI_INCLUDE_COUNSELLOR_NAMES: bool.default(false),
});

export type AppConfig = z.infer<typeof EnvSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  // Browsers send the Origin header without a trailing slash, so "https://app.example/" would never match.
  const corsOrigins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
  if (cfg.NODE_ENV === 'production') {
    // The localhost default would silently block every real browser request, and "*" would admit any site.
    if (!env.CORS_ORIGINS?.trim()) {
      throw new Error('Invalid environment configuration: CORS_ORIGINS must list the frontend origin(s) in production.');
    }
    if (corsOrigins.includes('*')) {
      throw new Error('Invalid environment configuration: CORS_ORIGINS must not contain "*" in production.');
    }
  }
  return {
    ...cfg,
    OPENAI_API_KEY: cfg.OPENAI_API_KEY?.trim() || undefined,
    corsOrigins,
    ...overrides,
  };
}
