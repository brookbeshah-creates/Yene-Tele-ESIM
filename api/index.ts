import type { IncomingMessage, ServerResponse } from 'node:http';
import { initializeBackendApp, type BootstrappedBackend } from '../server/bootstrap.ts';

let backendPromise: Promise<BootstrappedBackend> | null = null;

function getBackend(): Promise<BootstrappedBackend> {
  if (!backendPromise) {
    backendPromise = initializeBackendApp({ maxConnections: 3 }).catch((err) => {
      backendPromise = null;
      throw err;
    });
  }
  return backendPromise;
}

function restoreVercelRewrittenUrl(req: IncomingMessage): void {
  const rawUrl = req.url ?? '/api';
  const parsed = new URL(rawUrl, 'http://localhost');
  const rewrittenPath = parsed.searchParams.get('__vercel_path');
  if (rewrittenPath !== null) {
    parsed.searchParams.delete('__vercel_path');
    const qs = parsed.searchParams.toString();
    const normalizedSubPath = rewrittenPath.replace(/^\/+/, '');
    req.url = `/api/${normalizedSubPath}${qs ? `?${qs}` : ''}`;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  restoreVercelRewrittenUrl(req);
  try {
    const { app } = await getBackend();
    app(req as never, res as never);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backend initialization failed.';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: 'SERVER_STARTUP_ERROR',
        message: process.env.YENE_ENV_MODE === 'production' ? 'Service unavailable.' : message,
      }),
    );
  }
}
