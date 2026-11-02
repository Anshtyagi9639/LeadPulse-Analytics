/**
 * Minimal structured logger. Callers must only pass operational metadata (ids, counts, durations, codes) —
 * never names, phone numbers, emails, or spreadsheet cell values.
 */
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, event: string, meta?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'test' && level !== 'error') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...meta });
  if (level === 'info') process.stdout.write(`${line}\n`);
  else console.error(line);
}

export const logger = {
  info: (event: string, meta?: Record<string, unknown>) => emit('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit('error', event, meta),
};
