import type { Express } from 'express';
import type { Pool } from 'pg';
import { createApp, type ReadinessCheckResult } from './app.ts';
import { assertProductionConfigValid, getServerConfig, type ServerConfig } from './config/env.ts';
import { runMigrations, verifyDatabaseSchema } from './db/migrate.ts';
import { closeDatabasePool, createDatabasePool, pingDatabase } from './db/pool.ts';
import { PostgresPersistenceRepository } from './db/postgresRepository.ts';
import { StructuredLogger } from './lib/logger.ts';
import { ObservabilityTracker } from './lib/observability.ts';
import { createFirebaseTokenVerifier } from './modules/auth/firebaseVerifier.ts';
import { PaymentExpiryScheduler } from './modules/jobs/paymentExpiryJob.ts';
import { YeneTeleStore } from './modules/store/yeneStore.ts';

export interface BootstrappedBackend {
  app: Express;
  config: ServerConfig;
  logger: StructuredLogger;
  pool: Pool | null;
  persistence: PostgresPersistenceRepository | null;
  scheduler: PaymentExpiryScheduler;
  store: YeneTeleStore;
}

export async function initializeBackendApp(options?: {
  maxConnections?: number;
}): Promise<BootstrappedBackend> {
  const config = getServerConfig();
  const logger = new StructuredLogger(config.logLevel);
  const observability = new ObservabilityTracker(logger);

  // Fail closed on startup if running in production without mandatory secrets, ALLOWED_ORIGINS, or PostgreSQL
  assertProductionConfigValid(config);

  let pool: Pool | null = null;
  let persistence: PostgresPersistenceRepository | null = null;

  if (config.databaseConfigured && config.databaseUrl) {
    pool = createDatabasePool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl,
      maxConnections: options?.maxConnections ?? (process.env.VERCEL ? 3 : 10),
    });
    try {
      const ping = await pingDatabase(pool);
      const migrations = await runMigrations(pool);
      persistence = new PostgresPersistenceRepository(pool);
      observability.recordDbHealth(true, ping.latencyMs, true);
      logger.info('postgresql_connected', {
        latencyMs: ping.latencyMs,
        appliedMigrations: migrations.applied.length,
        alreadyAppliedMigrations: migrations.alreadyApplied.length,
      });
    } catch (err) {
      observability.recordDbHealth(false, null, true, 'STARTUP_FAILED');
      logger.error('postgresql_startup_failed', {
        error: err instanceof Error ? err.message : 'unknown',
        envMode: config.envMode,
      });
      await closeDatabasePool(pool);
      if (config.envMode === 'production') {
        throw err;
      }
      pool = null;
      persistence = null;
    }
  } else {
    observability.recordDbHealth(false, null, false);
    logger.warn('postgresql_not_configured', {
      envMode: config.envMode,
      persistenceMode: 'in_memory_sandbox',
    });
  }

  const store = new YeneTeleStore(config.adminEmails, config.esimEncryptionKey, {
    envMode: config.envMode,
    chapaSecretKey: config.chapaSecretKey,
    chapaWebhookSecret: config.chapaWebhookSecret,
    chapaCallbackUrl: config.chapaCallbackUrl,
    appUrl: config.appUrl,
    faydaConfigured: config.faydaConfigured,
    paymentTimeoutMinutes: config.paymentTimeoutMinutes,
    observability,
    persistence,
  });

  await store.ensureCatalogSeeded();
  if (persistence) {
    logger.info('relational_catalog_initialized', { persistenceMode: 'postgresql' });
  }

  const scheduler = new PaymentExpiryScheduler({
    store,
    logger,
    intervalMs: config.paymentExpiryIntervalMs,
  });

  const readinessCheck = async (): Promise<ReadinessCheckResult> => {
    if (!pool) {
      return {
        ok: config.envMode !== 'production',
        database: 'not_configured',
        schemaOk: config.envMode !== 'production',
        latencyMs: null,
      };
    }
    try {
      const ping = await pingDatabase(pool);
      const schema = await verifyDatabaseSchema(pool);
      return {
        ok: true,
        database: 'connected',
        schemaOk: schema.ok,
        latencyMs: ping.latencyMs,
        details: schema.ok
          ? undefined
          : `Missing tables: ${schema.missingTables.join(', ')}`,
      };
    } catch (err) {
      return {
        ok: false,
        database: 'error',
        schemaOk: false,
        latencyMs: null,
        details: err instanceof Error ? err.message : 'Database ping failed',
      };
    }
  };

  const verifier = createFirebaseTokenVerifier(config.firebaseProjectId);
  const { app } = createApp({
    verifier,
    adminEmails: config.adminEmails,
    store,
    config,
    logger,
    observability,
    scheduler,
    readinessCheck,
  });

  return {
    app,
    config,
    logger,
    pool,
    persistence,
    scheduler,
    store,
  };
}
