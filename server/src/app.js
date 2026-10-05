import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler, publicLimiter, requestLogger } from './middleware/http.js';
import matchesRouter from './routes/matches.js';
import catalogRouter from './routes/catalog.js';
import { adminRouter, authRouter, healthRouter, publicRouter } from './routes/misc.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function corsOrigin() {
  // Capacitor's Android WebView uses https://localhost; dev servers use localhost ports.
  if (!config.corsOrigins.length) return config.isProd ? ['https://localhost', 'capacitor://localhost'] : true;
  return [...config.corsOrigins, 'https://localhost', 'capacitor://localhost'];
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: corsOrigin() }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestLogger);

  const api = express.Router();
  api.use(publicLimiter);
  api.use(healthRouter);
  api.use('/auth', authRouter);
  api.use('/admin', adminRouter);
  api.use('/matches', matchesRouter);
  api.use(catalogRouter);
  api.use(publicRouter);
  api.use(notFoundHandler);
  app.use('/api', api);

  if (config.serveStatic) mountStaticApps(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Serve the built apps: viewer at /, admin at /admin, LED at /led (each an SPA). */
function mountStaticApps(app) {
  const apps = [
    { mount: '/admin', dir: path.join(root, 'apps/admin/dist') },
    { mount: '/led', dir: path.join(root, 'apps/led/dist') },
    { mount: '/', dir: path.join(root, 'apps/viewer/dist') },
  ];
  for (const { mount, dir } of apps) {
    if (!fs.existsSync(path.join(dir, 'index.html'))) continue;
    // Hashed assets are immutable; index.html must always revalidate.
    app.use(mount, express.static(dir, {
      index: false,
      setHeaders: (res, file) => {
        res.set('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    const indexHtml = path.join(dir, 'index.html');
    app.get(mount === '/' ? /^\/(?!api\/|socket\.io\/).*/ : new RegExp(`^${mount}(/.*)?$`), (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }
}
