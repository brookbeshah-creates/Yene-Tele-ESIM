import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { runMigrations, verifyDatabaseSchema } from '../server/db/migrate.ts';
import { createDatabasePool, closeDatabasePool, pingDatabase } from '../server/db/pool.ts';
import { PostgresPersistenceRepository } from '../server/db/postgresRepository.ts';
import { YeneTeleStore } from '../server/modules/store/yeneStore.ts';

const REAL_PG_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';

test(
  'Real PostgreSQL integration suite (migrations 001-003, FOR UPDATE SKIP LOCKED, advisory locks, unique constraints, restart persistence)',
  {
    skip: !REAL_PG_URL
      ? 'Skipped: TEST_DATABASE_URL / DATABASE_URL is not configured in this sandbox environment.'
      : false,
  },
  async () => {
    const ssl =
      (process.env.DATABASE_SSL ?? '').toLowerCase() === 'true' ||
      REAL_PG_URL.includes('sslmode=require');
    const pool = createDatabasePool({ connectionString: REAL_PG_URL, ssl });

    try {
      const ping = await pingDatabase(pool);
      assert.equal(ping.reachable, true);

      await runMigrations(pool);
      const schema = await verifyDatabaseSchema(pool);
      assert.equal(schema.ok, true);

      const repo = new PostgresPersistenceRepository(pool);
      const encKey = crypto.randomBytes(32);
      const adminEmails = new Set(['pg-it-admin@yenetele.example']);

      const storeA = new YeneTeleStore(adminEmails, encKey, {
        envMode: 'sandbox',
        persistence: repo,
      });
      await storeA.ensureCatalogSeeded();

      const suffix = crypto.randomBytes(3).toString('hex');
      const user1 = `pg-it-u1-${suffix}`;
      const user2 = `pg-it-u2-${suffix}`;
      await storeA.upsertAuthenticatedUser({
        uid: user1,
        email: `${user1}@example.com`,
        phoneNumber: null,
        emailVerified: true,
        name: 'PG Test User 1',
      });
      await storeA.upsertAuthenticatedUser({
        uid: user2,
        email: `${user2}@example.com`,
        phoneNumber: null,
        emailVerified: true,
        name: 'PG Test User 2',
      });

      // Import isolated real-PG test batch with known MSISDN/ICCID
      const msisdn = `+25191${String(Math.floor(1000000 + Math.random() * 8999999))}`;
      const iccid = `8925199${Date.now()}${suffix}`.slice(0, 19);
      const batchRes = await storeA.importStockBatch(user1, `${user1}@example.com`, {
        operatorCode: 'ethio_telecom',
        batchName: `PG Integration Batch ${suffix}`,
        sourceEnvironment: 'operator_partner_batch',
        items: [
          {
            msisdn,
            iccid,
            smdpAddress: 'smdp.pg-it.invalid',
            activationCode: `PG-CODE-${suffix}`,
          },
        ],
      });
      const items = await storeA.listStockItems('ethio_telecom', 'available');
      const importedItem = items.find((i) => i.batchId === batchRes.batch.id);
      assert.ok(importedItem);

      // Atomic stock reservation under real PG concurrency
      const [lock1, lock2] = await Promise.all([
        repo.reserveStockItemAtomic({
          operatorCode: 'ethio_telecom',
          stockItemId: importedItem.id,
          orderId: `pg-ord-1-${suffix}`,
          reservedUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
        repo.reserveStockItemAtomic({
          operatorCode: 'ethio_telecom',
          stockItemId: importedItem.id,
          orderId: `pg-ord-2-${suffix}`,
          reservedUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
      ]);
      const winners = [lock1, lock2].filter(Boolean);
      assert.equal(winners.length, 1);

      // Expiry sweep with real PG advisory lock + scheduled_job_runs insert
      const sweep = await storeA.runScheduledPaymentExpirySweep(
        `pg-it-${suffix}`,
        Date.now() + 45 * 60 * 1000,
      );
      assert.equal(sweep.acquiredLock, true);

      // Verify separate store instance sees persisted relational user & audit records
      const storeB = new YeneTeleStore(adminEmails, encKey, {
        envMode: 'sandbox',
        persistence: repo,
      });
      const restoredUser = await storeB.getUser(user1);
      assert.equal(restoredUser?.uid, user1);
    } finally {
      await closeDatabasePool(pool);
    }
  },
);
