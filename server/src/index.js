import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertProductionConfig } from './config/env.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp, corsOrigin } from './app.js';
import { createSocketServer } from './realtime/socket.js';
import { ensureBootstrapAdmin } from './services/auth.js';
import { reconcileMatches } from './services/scoring.js';
import { getTournament } from './services/tournament.js';
import { logger } from './utils/logger.js';
import { metrics } from './utils/metrics.js';

export async function startServer({ port = config.port, mongoUri } = {}) {
  assertProductionConfig();
  await connectDb(mongoUri);
  await import('./models/index.js').then((m) => Promise.all(Object.values(m).map((Model) => Model.syncIndexes())));
  await ensureBootstrapAdmin();
  await getTournament();
  const repair = await reconcileMatches();
  if (repair.repaired) logger.warn(repair, 'repaired match documents from event log');

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, { corsOrigin: corsOrigin() });
  server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts
  await new Promise((resolve) => server.listen(port, config.host, resolve));
  const actualPort = server.address().port;
  logger.info({ port: actualPort, env: config.env }, 'server listening');

  const stop = async () => {
    io.close();
    await new Promise((resolve) => server.close(resolve));
    await disconnectDb();
  };
  return { app, server, io, port: actualPort, stop };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  startServer().then(({ stop }) => {
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      logger.info({ signal }, 'shutting down');
      const timer = setTimeout(() => process.exit(1), 10_000);
      try { await stop(); } finally { clearTimeout(timer); process.exit(0); }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    setInterval(() => logger.info({ metrics: metrics.snapshot() }, 'metrics'), 5 * 60_000).unref();
  }).catch((err) => {
    logger.fatal({ err }, 'failed to start');
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}
