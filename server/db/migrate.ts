import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { getServerConfig } from '../config/env.ts';
import { closeDatabasePool, createDatabasePool, withTransaction } from './pool.ts';

export interface MigrationSummary {
  applied: string[];
  alreadyApplied: string[];
}

function resolveDefaultMigrationsDir(): string {
  const cwdDir = path.resolve(process.cwd(), 'server/db/migrations');
  if (fs.existsSync(cwdDir)) return cwdDir;
  return path.resolve(import.meta.dirname, 'migrations');
}

export function listMigrationFiles(
  migrationsDir = resolveDefaultMigrationsDir(),
): Array<{ version: string; filePath: string }> {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => ({
      version: fileName,
      filePath: path.join(migrationsDir, fileName),
    }));
}

export async function runMigrations(
  pool: Pick<Pool, 'connect' | 'query'>,
  migrationsDir = resolveDefaultMigrationsDir(),
): Promise<MigrationSummary> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  );

  const existingResult = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const appliedSet = new Set(existingResult.rows.map((r) => r.version));

  const files = listMigrationFiles(migrationsDir);
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file.version)) {
      alreadyApplied.push(file.version);
      continue;
    }
    const sql = fs.readFileSync(file.filePath, 'utf8');
    await withTransaction(pool, async (client: Pick<PoolClient, 'query'>) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [file.version],
      );
    });
    applied.push(file.version);
  }

  return { applied, alreadyApplied };
}

export async function verifyDatabaseSchema(
  pool: Pick<Pool, 'query'>,
): Promise<{ ok: boolean; appliedMigrations: string[]; missingTables: string[] }> {
  const requiredTables = [
    'users',
    'staff_admins',
    'staff_admin_invites',
    'operators',
    'esim_products',
    'esim_stock_batches',
    'esim_stock_items',
    'esim_orders',
    'kyc_verifications',
    'payments',
    'esim_activations',
    'processed_webhook_events',
    'agent_applications',
    'agents',
    'agent_commissions',
    'agent_payouts',
    'phone_products',
    'phone_orders',
    'support_tickets',
    'business_accounts',
    'business_members',
    'business_bulk_orders',
    'audit_logs',
    'scheduled_job_runs',
  ];

  const tablesRes = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'`,
  );
  const present = new Set(tablesRes.rows.map((r) => r.table_name));
  const missingTables = requiredTables.filter((t) => !present.has(t));

  let appliedMigrations: string[] = [];
  if (present.has('schema_migrations')) {
    const migRes = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    appliedMigrations = migRes.rows.map((r) => r.version);
  }

  return {
    ok: missingTables.length === 0,
    appliedMigrations,
    missingTables,
  };
}

// CLI execution entrypoint when invoked via `npm run db:migrate`
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('migrate.ts');

if (invokedDirectly) {
  const cfg = getServerConfig();
  if (!cfg.databaseConfigured || !cfg.databaseUrl) {
    console.error('Cannot run database migrations: DATABASE_URL is not configured.');
    process.exit(1);
  }
  const pool = createDatabasePool({
    connectionString: cfg.databaseUrl,
    ssl: cfg.databaseSsl,
  });
  runMigrations(pool)
    .then(async (summary) => {
      console.log(
        JSON.stringify({
          status: 'ok',
          applied: summary.applied,
          alreadyApplied: summary.alreadyApplied,
        }),
      );
      await closeDatabasePool(pool);
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : 'unknown error');
      await closeDatabasePool(pool);
      process.exit(1);
    });
}
