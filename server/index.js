import path from 'node:path';

import express from 'express';

import { loadConfig, maskConfig, ROOT } from './config.js';
import carsRouter from './routes/cars.js';
import configRouter from './routes/config.js';
import flightsRouter from './routes/flights.js';
import healthRouter from './routes/health.js';
import hotelsRouter from './routes/hotels.js';
import { ApiError, errorEnvelope } from './util.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use((req, res, next) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    next();
  });

  app.use('/api', healthRouter);
  app.use('/api', configRouter);
  app.use('/api/hotels', hotelsRouter);
  app.use('/api/flights', flightsRouter);
  app.use('/api/cars', carsRouter);

  // Unknown API routes -> envelope
  app.use('/api', (req, res) => {
    res.status(404).json(errorEnvelope(new ApiError('NOT_FOUND', `Endpoint non trovato: ${req.method} ${req.originalUrl}`, { status: 404 })));
  });

  const publicDir = path.join(ROOT, 'public');
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: 0 }));

  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Central error handler: never crashes, never leaks secrets.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const meta = { path: req.path, method: req.method };
    if (!(err instanceof ApiError)) {
      console.error(`[routestack-web] errore inatteso su ${req.method} ${req.path}:`, err?.message);
    }
    const status = err instanceof ApiError ? err.status : 500;
    res.status(status).json(errorEnvelope(err, meta));
  });

  return app;
}

export function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '127.0.0.1';
  const cfg = loadConfig({ force: true });
  const masked = maskConfig(cfg);
  const server = app.listen(port, host, () => {
    console.log(`[routestack-web] in ascolto su http://${host}:${port}`);
    console.log(`[routestack-web] sorgente: ${masked.source} (${masked.baseUrl})`);
    console.log(`[routestack-web] credenziali: apiKey=${masked.apiKeySet ? masked.apiKey : 'assente'} da ${masked.credentialsResolvedFrom.apiKey}; authMode=${masked.authMode}`);
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) startServer();
