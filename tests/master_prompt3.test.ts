import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { createApp, type CreateAppOptions } from '../server/app.ts';
import {
  assertProductionConfigValid,
  getServerConfig,
  validateProductionConfig,
} from '../server/config/env.ts';
import { runMigrations, verifyDatabaseSchema } from '../server/db/migrate.ts';
import { withTransaction } from '../server/db/pool.ts';
import { PostgresPersistenceRepository } from '../server/db/postgresRepository.ts';
import type { TokenVerifier, VerifiedIdentity } from '../server/modules/auth/firebaseVerifier.ts';
import { YeneTeleStore } from '../server/modules/store/yeneStore.ts';
import { createMockRelationalPgPool } from './helpers/mockRelationalPgPool.ts';

function createFakeVerifier(tokens: Record<string, VerifiedIdentity>): TokenVerifier {
  return {
    async verifyIdToken(token: string) {
      const identity = tokens[token];
      if (!identity) throw new Error('Invalid test token');
      return identity;
    },
  };
}

async function withServer(
  fn: (baseUrl: string, store: YeneTeleStore) => Promise<void>,
  options?: Partial<CreateAppOptions> & {
    envMode?: 'local_dev' | 'demo' | 'sandbox' | 'production';
    chapaSecretKey?: string | null;
    chapaWebhookSecret?: string | null;
    chapaFetchImpl?: typeof fetch;
    persistence?: PostgresPersistenceRepository | null;
  },
): Promise<void> {
  const verifier = createFakeVerifier({
    'token-cust-1': {
      uid: 'uid-cust-1',
      email: 'abebe@example.com',
      phoneNumber: null,
      emailVerified: true,
      name: 'Abebe Customer',
    },
    'token-buyer': {
      uid: 'uid-buyer-1',
      email: 'buyer@abay.et',
      phoneNumber: null,
      emailVerified: true,
      name: 'Abay Buyer',
    },
    'token-viewer': {
      uid: 'uid-viewer-1',
      email: 'viewer@abay.et',
      phoneNumber: null,
      emailVerified: true,
      name: 'Abay Viewer',
    },
    'token-admin': {
      uid: 'uid-admin-1',
      email: 'ops@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Yene Super Admin',
    },
    'token-ops': {
      uid: 'uid-ops-1',
      email: 'staff.ops@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Ops Manager',
    },
  });

  const adminEmails = new Set(['ops@yenetele.example']);
  const customStore =
    options?.store ??
    new YeneTeleStore(adminEmails, crypto.randomBytes(32), {
      envMode: options?.envMode ?? 'sandbox',
      chapaSecretKey: options?.chapaSecretKey ?? null,
      chapaWebhookSecret: options?.chapaWebhookSecret ?? null,
      chapaFetchImpl: options?.chapaFetchImpl,
      persistence: options?.persistence ?? null,
    });

  await customStore.ensureCatalogSeeded();
  if (!options?.store) {
    await customStore.grantStaffAdmin('uid-ops-1', 'staff.ops@yenetele.example', 'operations_staff', 'Ops Manager');
  }

  const { app, store } = createApp({
    verifier,
    adminEmails,
    store: customStore,
    config: options?.config,
    readinessCheck: options?.readinessCheck,
    rateLimitMaxPerMinute: options?.rateLimitMaxPerMinute,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`, store);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function jsonReq(
  url: string,
  method = 'GET',
  token?: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

test('Production config validation fails closed when mandatory secrets, ALLOWED_ORIGINS, or DB are missing', () => {
  const badProdCfg = getServerConfig({
    NODE_ENV: 'production',
    YENE_ENV_MODE: 'production',
    DATABASE_URL: '',
    ESIM_ENCRYPTION_KEY: 'too-short',
    CHAPA_SECRET_KEY: '',
    CHAPA_WEBHOOK_SECRET: '',
    YENE_ADMIN_EMAILS: '',
    ALLOWED_ORIGINS: '',
  } as unknown as NodeJS.ProcessEnv);

  const issues = validateProductionConfig(badProdCfg);
  assert.equal(issues.length, 6);
  assert.throws(() => assertProductionConfigValid(badProdCfg), /Production startup aborted/);

  const validProdCfg = getServerConfig({
    NODE_ENV: 'production',
    YENE_ENV_MODE: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/yene',
    ESIM_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    CHAPA_SECRET_KEY: 'CHASECK_LIVE_TEST',
    CHAPA_WEBHOOK_SECRET: 'CHAPA_WEBHOOK_SECRET_TEST',
    YENE_ADMIN_EMAILS: 'ops@yenetele.example',
    ALLOWED_ORIGINS: 'https://yenetele.et',
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(validateProductionConfig(validProdCfg).length, 0);
});

test('Production mode blocks sandbox_demo stock imports and sandbox test flags', async () => {
  await withServer(
    async (baseUrl, store) => {
      assert.equal((await store.listStockItems()).length, 0);

      await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-admin');

      const sbxBatch = await jsonReq(`${baseUrl}/api/v1/admin/inventory/batches`, 'POST', 'token-admin', {
        operatorCode: 'ethio_telecom',
        batchName: 'Forbidden Sandbox Batch',
        sourceEnvironment: 'sandbox_demo',
        items: [
          {
            msisdn: '+251911223344',
            iccid: '89251010000000999',
            smdpAddress: 'smdp.ethiotelecom.et',
            activationCode: 'PROD-TEST-CODE',
          },
        ],
      });
      assert.equal(sbxBatch.status, 403);
      assert.equal(sbxBatch.data.error, 'SANDBOX_FORBIDDEN_IN_PRODUCTION');

      const realBatch = await jsonReq(`${baseUrl}/api/v1/admin/inventory/batches`, 'POST', 'token-admin', {
        operatorCode: 'ethio_telecom',
        batchName: 'Official Partner Batch',
        sourceEnvironment: 'operator_partner_batch',
        items: [
          {
            msisdn: '+251911223344',
            iccid: '89251010000000999',
            smdpAddress: 'smdp.ethiotelecom.et',
            activationCode: 'PROD-REAL-CODE',
          },
        ],
      });
      assert.equal(realBatch.status, 201);

      // Strict Decision 3: unpriced product is rejected until official priceEtb > 0 is configured
      const blockedUnpriced = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      assert.equal(blockedUnpriced.status, 409);
      assert.equal(blockedUnpriced.data.error, 'PRODUCTION_PRICE_NOT_CONFIGURED');

      const priceSet = await jsonReq(`${baseUrl}/api/v1/admin/products/prod-ethio-new-line`, 'PATCH', 'token-admin', {
        priceEtb: 450,
        reason: 'Configured approved production tariff',
      });
      assert.equal(priceSet.status, 200);

      const ord = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      assert.equal(ord.status, 201);

      await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/kyc`, 'POST', 'token-cust-1', {
        fullName: 'Abebe Bikila',
        faydaFanReference: '123456789012',
        contactPhone: '+251911223344',
        consentGiven: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/reserve-number`, 'POST', 'token-cust-1', {});
      const blockedPay = await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/checkout`, 'POST', 'token-cust-1', {});
      assert.equal(blockedPay.status, 503);
      assert.equal(blockedPay.data.error, 'PAYMENT_PROVIDER_UNCONFIGURED');
    },
    { envMode: 'production', chapaWebhookSecret: 'prod-webhook-secret' },
  );

  await withServer(
    async (baseUrl) => {
      await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-admin');
      await jsonReq(`${baseUrl}/api/v1/admin/products/prod-ethio-new-line`, 'PATCH', 'token-admin', {
        priceEtb: 450,
        reason: 'Configured approved production tariff',
      });
      await jsonReq(`${baseUrl}/api/v1/admin/inventory/batches`, 'POST', 'token-admin', {
        operatorCode: 'ethio_telecom',
        batchName: 'Official Partner Batch',
        sourceEnvironment: 'operator_partner_batch',
        items: [
          {
            msisdn: '+251911223344',
            iccid: '89251010000000999',
            smdpAddress: 'smdp.ethiotelecom.et',
            activationCode: 'PROD-REAL-CODE',
          },
        ],
      });
      const ord = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/kyc`, 'POST', 'token-cust-1', {
        fullName: 'Abebe Bikila',
        faydaFanReference: '123456789012',
        contactPhone: '+251911223344',
        consentGiven: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/reserve-number`, 'POST', 'token-cust-1', {});
      const pay = await jsonReq(`${baseUrl}/api/v1/orders/${ord.data.order.id}/checkout`, 'POST', 'token-cust-1', {});
      assert.equal(pay.status, 201);
      const verifyWithSimFlag = await jsonReq(
        `${baseUrl}/api/v1/orders/${ord.data.order.id}/verify-payment`,
        'POST',
        'token-cust-1',
        { txRef: pay.data.payment.txRef, simulatePaymentFailure: true },
      );
      assert.equal(verifyWithSimFlag.status, 403);
      assert.equal(verifyWithSimFlag.data.error, 'SANDBOX_FLAGS_FORBIDDEN');
    },
    {
      envMode: 'production',
      chapaSecretKey: 'CHASECK_LIVE_TEST',
      chapaWebhookSecret: 'prod-webhook-secret',
      chapaFetchImpl: async (input) => {
        if (String(input) === 'https://api.chapa.co/v1/transaction/initialize') {
          return new Response(
            JSON.stringify({
              status: 'success',
              data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/test-mp3-123' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      },
    },
  );
});

test('PostgreSQL migrations 001-003, transaction rollback, FOR UPDATE SKIP LOCKED, and relational restart persistence', async () => {
  const mock = createMockRelationalPgPool();

  const firstRun = await runMigrations(mock.pool);
  assert.ok(firstRun.applied.includes('001_yene_tele_core.sql'));
  assert.ok(firstRun.applied.includes('002_yene_tele_production_hardening.sql'));
  assert.ok(firstRun.applied.includes('003_yene_tele_relational_runtime.sql'));
  const secondRun = await runMigrations(mock.pool);
  assert.equal(secondRun.applied.length, 0);

  const schemaCheck = await verifyDatabaseSchema(mock.pool);
  assert.equal(schemaCheck.ok, true);

  mock.setSimulateInsertError(true);
  await assert.rejects(
    withTransaction(mock.pool, async (client) => {
      await client.query('INSERT INTO users VALUES ($1)', ['u1']);
      await client.query('SIMULATE_ERROR');
    }),
    /Simulated transaction error/,
  );
  assert.ok(mock.queries.some((q) => q.text === 'ROLLBACK'));
  mock.setSimulateInsertError(false);

  const repo = new PostgresPersistenceRepository(mock.pool);
  const sharedKey = crypto.randomBytes(32);
  const adminSet = new Set(['ops@yenetele.example']);

  const postMigrateQueryCount = mock.queries.length;

  await withServer(
    async (baseUrl) => {
      const ord = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      assert.equal(ord.status, 201);
    },
    { persistence: repo },
  );

  // Confirm zero runtime reads/writes to legacy yene_runtime_state
  assert.equal(
    mock.queries.slice(postMigrateQueryCount).some((q) => q.text.includes('yene_runtime_state')),
    false,
  );

  const lockRes = await repo.reserveStockItemAtomic({
    operatorCode: 'ethio_telecom',
    orderId: 'ord-test-lock',
    reservedUntil: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.ok(lockRes?.stockItemId);
  const lockQuery = mock.queries.find((q) => q.text.includes('FOR UPDATE SKIP LOCKED'));
  assert.ok(lockQuery?.values?.includes('ethio_telecom'));

  const webhookIns = await repo.recordWebhookEventIdempotent({
    eventId: 'evt-pg-1',
    provider: 'chapa',
    txRef: 'YN-CHAPA-1',
    orderId: 'ord-1',
    status: 'success',
  });
  assert.equal(webhookIns.inserted, true);

  // Separate store instance against same relational pool restores persisted order across restart
  const restoredStore = new YeneTeleStore(adminSet, sharedKey, { persistence: repo });
  await restoredStore.ensureCatalogSeeded();
  const restoredOrders = await restoredStore.listOrdersForUser('uid-cust-1');
  assert.equal(restoredOrders.length, 1);
});

test('Chapa raw-body HMAC webhook signature, abandoned checkout timeout expiry, and CSV formula injection protection', async () => {
  const webhookSecret = 'whsec-yene-strict-secret';
  await withServer(
    async (baseUrl, store) => {
      const preview = await store.previewCsvStockImport(
        'ethio_telecom',
        'msisdn,iccid,smdp,code\n+251911000999,=CMD|calc,smdp.et,CODE-1\n+251911000888,892510100099,@SUM(1),CODE-2',
      );
      assert.equal(preview.invalidCount, 2);
      await assert.rejects(
        async () =>
          store.importStockBatch('uid-admin-1', 'ops@yenetele.example', {
            operatorCode: 'ethio_telecom',
            batchName: 'Unsafe CSV Batch',
            sourceEnvironment: 'operator_partner_batch',
            items: [
              {
                msisdn: '+251911000999',
                iccid: '=CMD|calc',
                smdpAddress: 'smdp.et',
                activationCode: 'CODE-1',
              },
            ],
          }),
        /UNSAFE_CSV_FORMULA|spreadsheet formula/i,
      );

      const ord = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      const orderId = ord.data.order.id;
      await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/kyc`, 'POST', 'token-cust-1', {
        fullName: 'Abebe Customer',
        faydaFanReference: '555666777888',
        contactPhone: '+251911223344',
        consentGiven: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/reserve-number`, 'POST', 'token-cust-1', {});
      const checkout = await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/checkout`, 'POST', 'token-cust-1', {});
      const txRef = checkout.data.payment.txRef as string;

      const rawPayload = `{"tx_ref": "${txRef}",   "orderId": "${orderId}", "eventId": "evt-raw-1", "status": "success"}`;
      const badRes = await fetch(`${baseUrl}/api/v1/payments/chapa/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-chapa-signature': 'bad-signature' },
        body: rawPayload,
      });
      assert.equal(badRes.status, 401);

      const validSig = crypto.createHmac('sha256', webhookSecret).update(rawPayload, 'utf8').digest('hex');
      const goodRes = await fetch(`${baseUrl}/api/v1/payments/chapa/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-chapa-signature': validSig },
        body: rawPayload,
      });
      assert.equal(goodRes.status, 200);
      const goodJson = (await goodRes.json()) as { orderStatus: string; paymentStatus: string };
      assert.equal(goodJson.paymentStatus, 'verified');
      assert.equal(goodJson.orderStatus, 'ready_for_installation');

      const ord2 = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceVerified: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${ord2.data.order.id}/kyc`, 'POST', 'token-cust-1', {
        fullName: 'Abebe Customer',
        faydaFanReference: '555666777888',
        contactPhone: '+251911223344',
        consentGiven: true,
      });
      await jsonReq(`${baseUrl}/api/v1/orders/${ord2.data.order.id}/reserve-number`, 'POST', 'token-cust-1', {});
      await jsonReq(`${baseUrl}/api/v1/orders/${ord2.data.order.id}/checkout`, 'POST', 'token-cust-1', {});

      const expiredCount = await store.expireStalePayments(Date.now() + 35 * 60 * 1000, 30);
      assert.equal(expiredCount, 1);
      const refreshed = await store.getOrderForUser(ord2.data.order.id, 'uid-cust-1');
      assert.equal(refreshed?.status, 'expired');
    },
    { chapaWebhookSecret: webhookSecret },
  );
});

test('Suspended user blocking, Staff RBAC governance, Business Customer Account portal, pagination & readiness probe', async () => {
  await withServer(async (baseUrl) => {
    await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-cust-1');
    await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-admin');
    await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-ops');

    const forbiddenStaff = await jsonReq(`${baseUrl}/api/v1/admin/staff`, 'GET', 'token-ops');
    assert.equal(forbiddenStaff.status, 403);
    assert.equal(forbiddenStaff.data.error, 'INSUFFICIENT_ADMIN_ROLE');

    const granted = await jsonReq(`${baseUrl}/api/v1/admin/staff`, 'POST', 'token-admin', {
      email: 'new.support@yenetele.example',
      role: 'support_staff',
    });
    assert.equal(granted.status, 201);
    const selfDemote = await jsonReq(`${baseUrl}/api/v1/admin/staff/uid-admin-1`, 'PATCH', 'token-admin', {
      active: false,
    });
    assert.equal(selfDemote.status, 409);

    const suspend = await jsonReq(
      `${baseUrl}/api/v1/admin/customers/uid-cust-1/status`,
      'PATCH',
      'token-admin',
      { status: 'suspended', reason: 'Fraud verification pending' },
    );
    assert.equal(suspend.status, 200);
    const blockedMe = await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-cust-1');
    assert.equal(blockedMe.status, 403);
    assert.equal(blockedMe.data.error, 'ACCOUNT_SUSPENDED');

    await jsonReq(`${baseUrl}/api/v1/admin/customers/uid-cust-1/status`, 'PATCH', 'token-admin', {
      status: 'active',
      reason: 'Identity confirmed',
    });
    const activeMe = await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-cust-1');
    assert.equal(activeMe.status, 200);

    const bizRes = await jsonReq(`${baseUrl}/api/v1/business/profile`, 'POST', 'token-cust-1', {
      companyName: 'Abay Logistics PLC',
      tinNumber: '0045123456',
      contactEmail: 'telecom@abay.et',
      contactPhone: '+251911223344',
      city: 'Addis Ababa',
    });
    assert.equal(bizRes.status, 201);
    assert.equal(bizRes.data.account.pricingTermsStatus, 'pending_commercial_agreement');

    await jsonReq(`${baseUrl}/api/v1/business/members`, 'POST', 'token-cust-1', {
      fullName: 'Abay Buyer',
      email: 'buyer@abay.et',
      role: 'buyer',
    });
    await jsonReq(`${baseUrl}/api/v1/business/members`, 'POST', 'token-cust-1', {
      fullName: 'Abay Viewer',
      email: 'viewer@abay.et',
      role: 'viewer',
    });

    const viewerBulk = await jsonReq(`${baseUrl}/api/v1/business/bulk-orders`, 'POST', 'token-viewer', {
      operatorCode: 'ethio_telecom',
      serviceType: 'new_esim_line',
      quantity: 25,
    });
    assert.equal(viewerBulk.status, 403);

    const buyerBulk = await jsonReq(`${baseUrl}/api/v1/business/bulk-orders`, 'POST', 'token-buyer', {
      operatorCode: 'ethio_telecom',
      serviceType: 'new_esim_line',
      quantity: 25,
      preferredTier: 'standard',
      departmentNote: 'Logistics fleet devices',
    });
    assert.equal(buyerBulk.status, 201);
    assert.equal(buyerBulk.data.bulkOrder.estimatedAmountEtb, null);

    const bizAdminReview = await jsonReq(
      `${baseUrl}/api/v1/admin/businesses/${bizRes.data.account.id}/review`,
      'POST',
      'token-ops',
      { verificationStatus: 'verified' },
    );
    assert.equal(bizAdminReview.status, 200);
    assert.equal(bizAdminReview.data.account.verificationStatus, 'verified');

    const paginatedCust = await jsonReq(`${baseUrl}/api/v1/admin/customers?limit=1&offset=0`, 'GET', 'token-admin');
    assert.equal(paginatedCust.status, 200);
    assert.equal(paginatedCust.data.pagination.limit, 1);

    const ready = await jsonReq(`${baseUrl}/api/ready`, 'GET');
    assert.equal(ready.status, 200);
    assert.equal(ready.data.status, 'ready');
  });
});

test('Rate limiter triggers 429 when request threshold is exceeded', async () => {
  await withServer(
    async (baseUrl) => {
      const r1 = await jsonReq(`${baseUrl}/api/v1/operators`, 'GET');
      const r2 = await jsonReq(`${baseUrl}/api/v1/operators`, 'GET');
      const r3 = await jsonReq(`${baseUrl}/api/v1/operators`, 'GET');
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(r3.status, 429);
      assert.equal(r3.data.error, 'RATE_LIMITED');
    },
    { rateLimitMaxPerMinute: 2 },
  );
});

test('Security & concurrency regressions: unverified-email admin block, concurrent verify/webhook deduplication, and manual double-fulfillment guard', async () => {
  const webhookSecret = 'whsec-concurrency-test';
  const adminEmails = new Set(['ops@yenetele.example']);
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const store = new YeneTeleStore(adminEmails, crypto.randomBytes(32), {
    envMode: 'sandbox',
    chapaWebhookSecret: webhookSecret,
    persistence: repo,
  });
  await store.ensureCatalogSeeded();

  const verifier = createFakeVerifier({
    'token-unverified-admin': {
      uid: 'uid-unverified-admin',
      email: 'ops@yenetele.example',
      phoneNumber: null,
      emailVerified: false,
      name: 'Unverified Attacker',
    },
    'token-admin': {
      uid: 'uid-admin-1',
      email: 'ops@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Verified Admin',
    },
    'token-cust-1': {
      uid: 'uid-cust-1',
      email: 'abebe@example.com',
      phoneNumber: null,
      emailVerified: true,
      name: 'Abebe Customer',
    },
  });

  const { app } = createApp({ verifier, adminEmails, store });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  try {
    const unverifiedMe = await jsonReq(`${baseUrl}/api/v1/me`, 'GET', 'token-unverified-admin');
    assert.equal(unverifiedMe.status, 200);
    assert.equal(unverifiedMe.data.isStaffAdmin, false);
    const unverifiedAdminRes = await jsonReq(`${baseUrl}/api/v1/admin/overview`, 'GET', 'token-unverified-admin');
    assert.equal(unverifiedAdminRes.status, 403);

    const ord = await jsonReq(`${baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
      operatorCode: 'ethio_telecom',
      productId: 'prod-ethio-new-line',
      deviceVerified: true,
    });
    const orderId = ord.data.order.id as string;
    await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/kyc`, 'POST', 'token-cust-1', {
      fullName: 'Abebe Bikila',
      faydaFanReference: 'FAN-555555',
      contactPhone: '+251911223344',
      consentGiven: true,
    });
    await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/reserve-number`, 'POST', 'token-cust-1', {});
    const checkout = await jsonReq(`${baseUrl}/api/v1/orders/${orderId}/checkout`, 'POST', 'token-cust-1', {});
    const txRef = checkout.data.payment.txRef as string;

    const webhookBody = JSON.stringify({ tx_ref: txRef, status: 'success', eventId: 'evt-race-1' });
    const sig = crypto.createHmac('sha256', webhookSecret).update(webhookBody, 'utf8').digest('hex');

    const [verifyRes, webhookRes] = await Promise.all([
      jsonReq(`${baseUrl}/api/v1/orders/${orderId}/verify-payment`, 'POST', 'token-cust-1', { txRef }),
      fetch(`${baseUrl}/api/v1/payments/chapa/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-chapa-signature': sig },
        body: webhookBody,
      }).then(async (r) => ({ status: r.status, data: await r.json() })),
    ]);

    assert.equal(verifyRes.status, 200);
    assert.equal(webhookRes.status, 200);
    assert.equal((await store.listEsimsForUser('uid-cust-1')).length, 1);

    const doubleFulfill = await jsonReq(
      `${baseUrl}/api/v1/admin/orders/${orderId}/manual-fulfillment`,
      'POST',
      'token-admin',
      {
        iccid: '892510999999999999',
        smdpAddress: 'sandbox-smdp.ethiotelecom.yene.invalid',
        activationCode: 'DUP-MANUAL-01',
        partnerReference: 'DUP-REF-01',
      },
    );
    assert.equal(doubleFulfill.status, 409);
    assert.equal(doubleFulfill.data.error, 'ORDER_ALREADY_FULFILLED');

    // Relational support persistence writes to support_tickets table (zero yene_runtime_state)
    const supCountBefore = mock.queries.filter((q) => q.text.includes('INSERT INTO support_tickets')).length;
    const sup = await jsonReq(`${baseUrl}/api/v1/support/inquiries`, 'POST', undefined, {
      email: 'help@example.com',
      subject: 'Activation help',
      message: 'Need QR install guidance',
    });
    assert.equal(sup.status, 201);
    const supCountAfter = mock.queries.filter((q) => q.text.includes('INSERT INTO support_tickets')).length;
    assert.ok(supCountAfter > supCountBefore);
    assert.equal(
      mock.queries.some((q) => q.text.includes('yene_runtime_state')),
      false,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
