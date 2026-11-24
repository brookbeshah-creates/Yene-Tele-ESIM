import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { initializeBackendApp } from './server/bootstrap.ts';
import { closeDatabasePool } from './server/db/pool.ts';

async function startServer() {
  const { app, config, logger, pool, persistence, scheduler } = await initializeBackendApp();

  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(500).send('Build output missing.');
      }
    });
  }

  const httpServer = app.listen(config.port, '0.0.0.0', () => {
    logger.info('server_listening', {
      port: config.port,
      envMode: config.envMode,
      persistenceMode: persistence ? 'postgresql' : 'in_memory_sandbox',
    });
  });

  scheduler.start();

  const shutdown = async (signal: string) => {
    logger.info('shutdown_initiated', { signal });
    scheduler.stop();
    httpServer.close(async () => {
      await closeDatabasePool(pool);
      logger.info('shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start Yene Tele server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
