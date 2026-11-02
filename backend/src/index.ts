import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './lib/logger.js';

async function main() {
  const config = loadConfig();
  const { app, store } = await createApp(config);
  store.startSweeper();
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info('server_started', {
      port: config.PORT,
      env: config.NODE_ENV,
      sessionTtlHours: config.SESSION_TTL_HOURS,
      aiConfigured: Boolean(config.OPENAI_API_KEY),
      corsOrigins: config.corsOrigins,
    });
  });
  server.requestTimeout = 5 * 60_000;

  const shutdown = async (signal: string) => {
    logger.info('shutdown', { signal });
    server.close();
    // Temporary data is deleted on shutdown; sessions are not meant to survive restarts.
    await store.stop(true);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
