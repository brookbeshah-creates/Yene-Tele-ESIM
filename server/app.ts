import express from 'express';
import rateLimit from 'express-rate-limit';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  getServerConfig,
  validateProductionConfig,
  type ServerConfig,
} from './config/env.ts';
import { DatabaseConnectionError } from './db/pool.ts';
import { StructuredLogger } from './lib/logger.ts';
import { ObservabilityTracker } from './lib/observability.ts';
import { createAdminRouter } from './modules/admin/adminRoutes.ts';
import { createAgentRouter } from './modules/agents/agentRoutes.ts';
import { createRequireAuth } from './modules/auth/authMiddleware.ts';
import type { TokenVerifier } from './modules/auth/firebaseVerifier.ts';
import { createCustomerRouter } from './modules/customer/customerRoutes.ts';
import type { PaymentExpiryScheduler } from './modules/jobs/paymentExpiryJob.ts';
import { YeneTeleStore } from './modules/store/yeneStore.ts';

export interface ReadinessCheckResult {
  ok: boolean;
  database: 'connected' | 'not_configured' | 'error';
  schemaOk: boolean;
  latencyMs?: number | null;
  details?: string;
}

export interface CreateAppOptions {
  verifier: TokenVerifier;
  adminEmails?: Set<string>;
  store?: YeneTeleStore;
  config?: ServerConfig;
  logger?: StructuredLogger;
  observability?: ObservabilityTracker;
  scheduler?: PaymentExpiryScheduler;
  readinessCheck?: () => Promise<ReadinessCheckResult>;
  rateLimitMaxPerMinute?: number;
}

function parseExactHttpOrigin(rawOrigin: string): string | null {
  const trimmed = rawOrigin.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function createApp(options: CreateAppOptions): {
  app: Express;
  store: YeneTeleStore;
} {
  const app = express();
  const cfg = options.config ?? getServerConfig();
  const logger = options.logger ?? new StructuredLogger(cfg.logLevel);
  const observability = options.observability ?? options.store?.observability ?? new ObservabilityTracker(logger);

  const store =
    options.store ??
    new YeneTeleStore(options.adminEmails ?? cfg.adminEmails, cfg.esimEncryptionKey, {
      envMode: cfg.envMode,
      chapaSecretKey: cfg.chapaSecretKey,
      chapaWebhookSecret: cfg.chapaWebhookSecret,
      chapaCallbackUrl: cfg.chapaCallbackUrl,
      appUrl: cfg.appUrl,
      faydaConfigured: cfg.faydaConfigured,
      paymentTimeoutMinutes: cfg.paymentTimeoutMinutes,
      observability,
    });

  const requireAuth = createRequireAuth(options.verifier, store);

  app.set('trust proxy', 1);

  // Security headers (kept iframe-compatible for AI Studio preview unless standalone headers set by reverse proxy)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  // Strict CORS policy on /api routes
  app.use('/api', (req, res, next) => {
    const rawOriginHeader = req.headers.origin;
    if (rawOriginHeader === undefined) {
      // Server-to-server webhooks (e.g. Chapa), curl, and health probes omit Origin.
      next();
      return;
    }

    const originStr = Array.isArray(rawOriginHeader) ? rawOriginHeader[0] ?? '' : rawOriginHeader;
    const normalizedOrigin = parseExactHttpOrigin(originStr);

    if (!normalizedOrigin) {
      if (cfg.envMode === 'production') {
        logger.warn('cors_origin_blocked', { reason: 'malformed_origin', path: req.originalUrl });
        res.status(403).json({ error: 'CORS_FORBIDDEN', message: 'Malformed Origin header.' });
        return;
      }
      next();
      return;
    }

    const isAllowedConfigured = cfg.allowedOrigins.includes(normalizedOrigin);
    const isLocalOrigin =
      cfg.envMode !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin);

    if (isAllowedConfigured || isLocalOrigin) {
      res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Chapa-Signature, Chapa-Signature');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
      return;
    }

    if (cfg.envMode === 'production') {
      logger.warn('cors_origin_blocked', { origin: normalizedOrigin, path: req.originalUrl });
      res.status(403).json({ error: 'CORS_FORBIDDEN', message: 'Origin is not permitted.' });
      return;
    }

    next();
  });

  // Preserve raw UTF-8 body for HMAC-SHA256 webhook signature verification
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );

  // Rate limiting on API routes
  const generalMax = options.rateLimitMaxPerMinute ?? 300;
  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: generalMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many requests, please retry shortly.' },
  });

  const sensitiveLimiter = rateLimit({
    windowMs: 60_000,
    max: Math.min(options.rateLimitMaxPerMinute ?? 45, 45),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message: 'Too many sensitive requests, please wait one minute.' },
  });

  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/payments/chapa/webhook', sensitiveLimiter);
  app.use('/api/v1/support/inquiries', sensitiveLimiter);
  app.use('/api/v1/orders/:orderId/checkout', sensitiveLimiter);
  app.use('/api/v1/orders/:orderId/verify-payment', sensitiveLimiter);

  // Structured API access log (no authorization headers or secret bodies logged)
  app.use('/api', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/health') return;
      logger.info('http_request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
      });
    });
    next();
  });

  app.get('/api/health', async (_req, res) => {
    try {
      const [ethio, safari] = await Promise.all([
        store.getOperator('ethio_telecom'),
        store.getOperator('safaricom_ethiopia'),
      ]);
      res.json({
        status: 'ok',
        service: 'yene-tele-platform',
        envMode: cfg.envMode,
        persistenceMode: store.isUsingPostgreSql() ? 'postgresql' : 'in_memory_sandbox',
        integrationModes: {
          auth: 'firebase_auth',
          database: cfg.databaseConfigured
            ? store.isUsingPostgreSql()
              ? 'POSTGRESQL_ACTIVE'
              : 'POSTGRESQL_CONFIGURED'
            : 'IN_MEMORY_SANDBOX_STORE',
          chapa: cfg.chapaConfigured ? 'CONFIGURED' : 'SANDBOX_FALLBACK',
          ethioTelecom: ethio?.integrationStatus ?? 'sandbox',
          safaricomEthiopia: safari?.integrationStatus ?? 'sandbox',
          fayda: cfg.faydaConfigured ? 'CONFIGURED' : 'SANDBOX_CONSENT_BOUNDARY',
          klick: cfg.klickConfigured ? 'CONFIGURED' : 'BOUNDARY_PENDING_ONBOARDING',
        },
      });
    } catch (err) {
      if (err instanceof DatabaseConnectionError) {
        store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
        res.status(503).json({
          status: 'degraded',
          error: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable.',
        });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Health check failed.' });
    }
  });

  app.get('/api/ready', async (_req, res) => {
    const prodIssues = validateProductionConfig(cfg);
    let dbState: ReadinessCheckResult = {
      ok: !cfg.databaseConfigured,
      database: cfg.databaseConfigured ? 'connected' : 'not_configured',
      schemaOk: !cfg.databaseConfigured,
      latencyMs: null,
    };

    if (options.readinessCheck) {
      try {
        dbState = await options.readinessCheck();
      } catch (err) {
        dbState = {
          ok: false,
          database: 'error',
          schemaOk: false,
          latencyMs: null,
          details: err instanceof Error ? err.message : 'Database readiness probe failed.',
        };
      }
    }

    store.observability.recordDbHealth(
      dbState.ok,
      dbState.latencyMs ?? null,
      dbState.database !== 'not_configured',
      dbState.ok ? undefined : 'DATABASE_UNAVAILABLE',
    );

    const readyInCurrentMode =
      cfg.envMode === 'production'
        ? prodIssues.length === 0 && dbState.ok && dbState.schemaOk
        : !cfg.databaseConfigured || (dbState.ok && dbState.schemaOk);

    const payload = {
      status: readyInCurrentMode ? 'ready' : 'not_ready',
      envMode: cfg.envMode,
      persistenceMode: store.isUsingPostgreSql()
        ? 'postgresql'
        : cfg.databaseConfigured
          ? 'postgresql'
          : 'in_memory_sandbox',
      database: dbState.database,
      schemaOk: dbState.schemaOk,
      encryptionKeyPersistent: cfg.encryptionKeyPersistent,
      productionConfigIssues: prodIssues,
      observability: store.observability.getSnapshot(),
      scheduler: options.scheduler ? options.scheduler.getStatus() : null,
      ...(dbState.details ? { details: dbState.details } : {}),
    };

    res.status(readyInCurrentMode ? 200 : 503).json(payload);
  });

  app.use('/api/v1', createCustomerRouter(store, requireAuth));
  app.use('/api/v1/agent', createAgentRouter(store, requireAuth));
  app.use('/api/v1/admin', createAdminRouter(store, requireAuth, options.scheduler));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'API endpoint not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DatabaseConnectionError) {
      store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
      logger.error('database_unavailable', {
        path: req.path,
        method: req.method,
      });
      res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable. Please retry shortly.',
      });
      return;
    }

    logger.error('unhandled_server_error', {
      path: req.path,
      method: req.method,
      error: err instanceof Error ? err.message : 'unknown',
    });
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
  });

  return { app, store };
}
