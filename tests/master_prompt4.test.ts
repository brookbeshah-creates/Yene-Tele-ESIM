import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import {
  assertProductionConfigValid,
  getServerConfig,
  validateProductionConfig,
} from '../server/config/env.ts';
import { PostgresPersistenceRepository } from '../server/db/postgresRepository.ts';
import { StructuredLogger, redactForLog } from '../server/lib/logger.ts';
import { ObservabilityTracker } from '../server/lib/observability.ts';
import type { TokenVerifier, VerifiedIdentity } from '../server/modules/auth/firebaseVerifier.ts';
import { PaymentExpiryScheduler } from '../server/modules/jobs/paymentExpiryJob.ts';
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

async function startTestHttpServer(options: {
  store: YeneTeleStore;
  envMode?: 'local_dev' | 'demo' | 'sandbox' | 'production';
  allowedOrigins?: string[];
  scheduler?: PaymentExpiryScheduler;
  readinessCheck?: () => Promise<{
    ok: boolean;
    database: 'connected' | 'not_configured' | 'error';
    schemaOk: boolean;
    latencyMs?: number | null;
    details?: string;
  }>;
}) {
  const verifier = createFakeVerifier({
    'token-cust-1': {
      uid: 'uid-cust-1',
      email: 'abebe@example.com',
      phoneNumber: null,
      emailVerified: true,
      name: 'Abebe Customer',
    },
    'token-cust-2': {
      uid: 'uid-cust-2',
      email: 'tigist@example.com',
      phoneNumber: null,
      emailVerified: true,
      name: 'Tigist Customer',
    },
    'token-admin': {
      uid: 'uid-admin-1',
      email: 'ops@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Yene Super Admin',
    },
  });

  const baseCfg = getServerConfig({
    NODE_ENV: options.envMode === 'production' ? 'production' : 'development',
    YENE_ENV_MODE: options.envMode ?? 'sandbox',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/yene',
    ESIM_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    CHAPA_SECRET_KEY: 'CHASECK_TEST_KEY',
    CHAPA_WEBHOOK_SECRET: 'whsec-mp4-secret',
    YENE_ADMIN_EMAILS: 'ops@yenetele.example',
    ALLOWED_ORIGINS: (options.allowedOrigins ?? ['https://app.yenetele.et']).join(','),
  } as unknown as NodeJS.ProcessEnv);

  const { app } = createApp({
    verifier,
    adminEmails: new Set(['ops@yenetele.example']),
    store: options.store,
    config: baseCfg,
    scheduler: options.scheduler,
    readinessCheck: options.readinessCheck,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function reqJson(
  url: string,
  method = 'GET',
  token?: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, headers: res.headers, data };
}

test('MP4 Decision 1 & Concurrency: Normalized PG relational persistence across restarts, atomic stock race, and webhook deduplication', async () => {
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const encKey = crypto.randomBytes(32);
  const adminEmails = new Set(['ops@yenetele.example']);
  const webhookSecret = 'whsec-mp4-secret';

  const store1 = new YeneTeleStore(adminEmails, encKey, {
    envMode: 'sandbox',
    chapaWebhookSecret: webhookSecret,
    persistence: repo,
  });
  await store1.ensureCatalogSeeded();
  await store1.upsertAuthenticatedUser({
    uid: 'uid-cust-1',
    email: 'abebe@example.com',
    phoneNumber: null,
    emailVerified: true,
    name: 'Abebe Customer',
  });
  await store1.upsertAuthenticatedUser({
    uid: 'uid-cust-2',
    email: 'tigist@example.com',
    phoneNumber: null,
    emailVerified: true,
    name: 'Tigist Customer',
  });

  // Confirm two concurrent orders cannot reserve the same stock item
  const ordA = await store1.createDraftOrder('uid-cust-1', {
    operatorCode: 'ethio_telecom',
    productId: 'prod-ethio-new-line',
    deviceVerified: true,
  });
  const ordB = await store1.createDraftOrder('uid-cust-2', {
    operatorCode: 'ethio_telecom',
    productId: 'prod-ethio-new-line',
    deviceVerified: true,
  });
  await store1.submitOrderKyc(ordA.id, 'uid-cust-1', {
    fullName: 'Abebe Bikila',
    faydaFanReference: '123456789012',
    contactPhone: '+251911223344',
    consentGiven: true,
  });
  await store1.submitOrderKyc(ordB.id, 'uid-cust-2', {
    fullName: 'Tigist Assefa',
    faydaFanReference: '998877665544',
    contactPhone: '+251911223355',
    consentGiven: true,
  });

  const targetStockId = 'stk-ethio-101';
  const [raceA, raceB] = await Promise.allSettled([
    store1.reserveNumberForOrder(ordA.id, 'uid-cust-1', { stockItemId: targetStockId }),
    store1.reserveNumberForOrder(ordB.id, 'uid-cust-2', { stockItemId: targetStockId }),
  ]);
  const fulfilledCount = [raceA, raceB].filter((r) => r.status === 'fulfilled').length;
  const rejectedCount = [raceA, raceB].filter((r) => r.status === 'rejected').length;
  assert.equal(fulfilledCount, 1);
  assert.equal(rejectedCount, 1);

  const winnerOrd = raceA.status === 'fulfilled' ? raceA.value : (raceB as PromiseFulfilledResult<any>).value;
  const winnerUid = winnerOrd.userId;

  const checkout = await store1.initChapaPaymentForOrder(
    winnerOrd.id,
    winnerUid,
    'abebe@example.com',
    '/buy-esim',
  );

  // Concurrent verify + webhook delivery should produce exactly 1 eSIM activation
  const [verifyRes, hookRes] = await Promise.all([
    store1.verifyPaymentAndFulfillOrder(winnerOrd.id, checkout.payment.txRef, { actorUserId: winnerUid }),
    store1.processChapaWebhookEvent({
      txRef: checkout.payment.txRef,
      orderId: winnerOrd.id,
      eventId: 'evt-mp4-race-1',
      status: 'success',
    }),
  ]);
  assert.equal(verifyRes.payment.status, 'verified');
  assert.ok(hookRes.paymentStatus === 'verified');
  assert.equal((await store1.listEsimsForUser(winnerUid)).length, 1);

  // Restart into brand new store instance using the same relational PG pool + encryption key
  const store2 = new YeneTeleStore(adminEmails, encKey, {
    envMode: 'sandbox',
    chapaWebhookSecret: webhookSecret,
    persistence: repo,
  });
  await store2.ensureCatalogSeeded();

  const restoredOrder = await store2.getOrderForUser(winnerOrd.id, winnerUid);
  assert.equal(restoredOrder?.status, 'ready_for_installation');
  const restoredEsims = await store2.listEsimsForUser(winnerUid);
  assert.equal(restoredEsims.length, 1);
  const decrypted = await store2.getDecryptedActivationForUser(restoredEsims[0].id, winnerUid);
  assert.ok(decrypted.lpaUri.startsWith('LPA:1$'));

  // Zero yene_runtime_state reads/writes
  assert.equal(
    mock.queries.some((q) => q.text.includes('yene_runtime_state')),
    false,
  );
});

test('MP4 Audit Fix 1: Automated PaymentExpiryScheduler, advisory lock skip, error isolation, and admin endpoints', async () => {
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const logger = new StructuredLogger('error');
  const observability = new ObservabilityTracker(logger);
  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'sandbox',
    persistence: repo,
    paymentTimeoutMinutes: 30,
    observability,
  });
  await store.ensureCatalogSeeded();
  await store.upsertAuthenticatedUser({
    uid: 'uid-cust-1',
    email: 'abebe@example.com',
    phoneNumber: null,
    emailVerified: true,
    name: 'Abebe Customer',
  });
  await store.upsertAuthenticatedUser({
    uid: 'uid-admin-1',
    email: 'ops@yenetele.example',
    phoneNumber: null,
    emailVerified: true,
    name: 'Yene Super Admin',
  });

  const ord = await store.createDraftOrder('uid-cust-1', {
    operatorCode: 'ethio_telecom',
    productId: 'prod-ethio-new-line',
    deviceVerified: true,
  });
  await store.submitOrderKyc(ord.id, 'uid-cust-1', {
    fullName: 'Abebe Bikila',
    faydaFanReference: '123456789012',
    contactPhone: '+251911223344',
    consentGiven: true,
  });
  await store.reserveNumberForOrder(ord.id, 'uid-cust-1', { stockItemId: 'stk-ethio-102' });
  await store.initChapaPaymentForOrder(ord.id, 'uid-cust-1', 'abebe@example.com', '/buy-esim');

  const scheduler = new PaymentExpiryScheduler({
    store,
    logger,
    intervalMs: 60_000,
    instanceId: 'test-worker-1',
  });

  // 1. Advisory lock already held by another instance -> cleanly skips without touching rows
  mock.setHoldAdvisoryLock(true);
  const skipped = await scheduler.runOnce(Date.now() + 45 * 60 * 1000);
  assert.equal(skipped?.acquiredLock, false);
  assert.equal(skipped?.expiredPayments, 0);
  mock.setHoldAdvisoryLock(false);

  // 2. Simulated transient DB outage -> isolated without throwing, increments observability counter
  mock.setSimulateConnectionDown(true);
  const failed = await scheduler.runOnce(Date.now() + 45 * 60 * 1000);
  assert.equal(failed, null);
  assert.ok(scheduler.getStatus().lastError);
  assert.equal(store.observability.getSnapshot().counters.scheduledJobFailures.count, 1);
  mock.setSimulateConnectionDown(false);

  // 3. Recovery sweep past timeout window expires payment & releases stock reservation
  const swept = await scheduler.runOnce(Date.now() + 45 * 60 * 1000);
  assert.equal(swept?.acquiredLock, true);
  assert.equal(swept?.expiredPayments, 1);
  assert.equal(swept?.releasedReservations, 1);
  assert.equal(scheduler.getStatus().lastError, null);
  assert.equal(store.observability.getSnapshot().counters.expiredOrdersTotal, 1);

  const expiredOrd = await store.getOrderForUser(ord.id, 'uid-cust-1');
  assert.equal(expiredOrd?.status, 'expired');
  const releasedStock = (await store.listStockItems('ethio_telecom', 'available')).find(
    (s) => s.id === 'stk-ethio-102',
  );
  assert.equal(releasedStock?.status, 'available');

  // 4. Verify admin scheduler status & manual trigger HTTP endpoints
  const srv = await startTestHttpServer({ store, scheduler });
  try {
    const jobRes = await reqJson(`${srv.baseUrl}/api/v1/admin/jobs/payment-expiry`, 'GET', 'token-admin');
    assert.equal(jobRes.status, 200);
    assert.ok(Array.isArray(jobRes.data.runs) && jobRes.data.runs.length >= 1);

    const runRes = await reqJson(`${srv.baseUrl}/api/v1/admin/jobs/payment-expiry/run`, 'POST', 'token-admin');
    assert.equal(runRes.status, 200);
    assert.equal(runRes.data.sweep.acquiredLock, true);
  } finally {
    await srv.close();
  }
});

test('MP4 Decision 3: Strict Production Pricing Enforcement for eSIMs and Phones + Audit Trail', async () => {
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'production',
    chapaSecretKey: 'CHASECK_LIVE_TEST',
    chapaWebhookSecret: 'whsec-mp4-secret',
    persistence: repo,
  });
  await store.ensureCatalogSeeded();

  const srv = await startTestHttpServer({ store, envMode: 'production', allowedOrigins: ['https://yenetele.et'] });
  try {
    await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-admin');
    await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-cust-1');

    // Public catalog in production omits sandbox preview prices
    const pubProds = await reqJson(`${srv.baseUrl}/api/v1/products`, 'GET');
    assert.equal(pubProds.status, 200);
    assert.ok(pubProds.data.products.every((p: any) => p.sandboxPreviewAmountEtb === null));

    const pubPhones = await reqJson(`${srv.baseUrl}/api/v1/phones`, 'GET');
    assert.equal(pubPhones.status, 200);
    assert.ok(pubPhones.data.phones.every((p: any) => p.sandboxPreviewPriceEtb === null));

    // Unpriced eSIM product -> blocked in production
    const badEsim = await reqJson(`${srv.baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
      operatorCode: 'ethio_telecom',
      productId: 'prod-ethio-new-line',
      deviceVerified: true,
    });
    assert.equal(badEsim.status, 409);
    assert.equal(badEsim.data.error, 'PRODUCTION_PRICE_NOT_CONFIGURED');

    // Unpriced phone product -> blocked in production
    const badPhone = await reqJson(`${srv.baseUrl}/api/v1/phones/orders`, 'POST', 'token-cust-1', {
      phoneProductId: 'phone-iphone-15-128',
      orderKind: 'individual',
      quantity: 1,
      deliveryCity: 'Addis Ababa',
    });
    assert.equal(badPhone.status, 409);
    assert.equal(badPhone.data.error, 'PRODUCTION_PRICE_NOT_CONFIGURED');

    // Reject 0 or negative prices
    const zeroPrice = await reqJson(`${srv.baseUrl}/api/v1/admin/products/prod-ethio-new-line`, 'PATCH', 'token-admin', {
      priceEtb: 0,
      reason: 'Invalid zero tariff',
    });
    assert.equal(zeroPrice.status, 400);
    assert.equal(zeroPrice.data.error, 'INVALID_PRICE');

    // Configure approved production price -> audit logged & snapshot saved
    const setPrice = await reqJson(`${srv.baseUrl}/api/v1/admin/products/prod-ethio-new-line`, 'PATCH', 'token-admin', {
      priceEtb: 525,
      reason: 'Ethio telecom approved retail tariff',
    });
    assert.equal(setPrice.status, 200);
    assert.equal(setPrice.data.product.priceEtb, 525);

    const ord = await reqJson(`${srv.baseUrl}/api/v1/orders`, 'POST', 'token-cust-1', {
      operatorCode: 'ethio_telecom',
      productId: 'prod-ethio-new-line',
      deviceVerified: true,
    });
    assert.equal(ord.status, 201);
    assert.equal(ord.data.order.amountEtb, 525);
    assert.equal(ord.data.order.currency, 'ETB');
    assert.equal(ord.data.order.isSandboxPricing, false);
    assert.match(ord.data.order.pricingSnapshotNote, /525\.00 ETB/);

    const audits = await reqJson(`${srv.baseUrl}/api/v1/admin/audit-logs`, 'GET', 'token-admin');
    const priceAudit = audits.data.logs.find((l: any) => l.action === 'ESIM_PRODUCT_UPDATED');
    assert.ok(priceAudit?.reason.includes('[priceEtb: null -> 525 ETB]'));
  } finally {
    await srv.close();
  }
});

test('MP4 Decision 4 & Audit Fix 2: ALLOWED_ORIGINS startup validation & strict production CORS enforcement', async () => {
  const malformedCfg = getServerConfig({
    NODE_ENV: 'production',
    YENE_ENV_MODE: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/yene',
    ESIM_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
    CHAPA_SECRET_KEY: 'CHASECK_LIVE_TEST',
    CHAPA_WEBHOOK_SECRET: 'whsec-mp4-secret',
    YENE_ADMIN_EMAILS: 'ops@yenetele.example',
    ALLOWED_ORIGINS: 'https://yenetele.et/invalid-path',
  } as unknown as NodeJS.ProcessEnv);
  const issues = validateProductionConfig(malformedCfg);
  assert.ok(issues.some((i) => i.includes('ALLOWED_ORIGINS')));
  assert.throws(() => assertProductionConfigValid(malformedCfg), /Production startup aborted/);

  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'production',
    chapaSecretKey: 'CHASECK_LIVE_TEST',
    chapaWebhookSecret: 'whsec-mp4-secret',
  });
  await store.ensureCatalogSeeded();
  const srv = await startTestHttpServer({
    store,
    envMode: 'production',
    allowedOrigins: ['https://app.yenetele.et'],
  });
  try {
    // Approved origin preflight + GET
    const preflight = await fetch(`${srv.baseUrl}/api/v1/operators`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.yenetele.et' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://app.yenetele.et');

    // Unapproved origin blocked
    const evilRes = await reqJson(`${srv.baseUrl}/api/v1/operators`, 'GET', undefined, undefined, {
      Origin: 'https://evil-phish.example',
    });
    assert.equal(evilRes.status, 403);
    assert.equal(evilRes.data.error, 'CORS_FORBIDDEN');

    // Malformed origin blocked
    const malformedRes = await reqJson(`${srv.baseUrl}/api/v1/operators`, 'GET', undefined, undefined, {
      Origin: 'not-a-valid-origin',
    });
    assert.equal(malformedRes.status, 403);
    assert.equal(malformedRes.data.error, 'CORS_FORBIDDEN');

    // Missing Origin (webhooks / health probes) allowed
    const healthRes = await reqJson(`${srv.baseUrl}/api/health`, 'GET');
    assert.equal(healthRes.status, 200);
  } finally {
    await srv.close();
  }
});

test('MP4 Decision 4: Chapa live HTTP initialize, currency/amount checks, uncertain 503 resilience, and v1/v2 refund lifecycle', async () => {
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  let verifyAttempt = 0;
  let refundPostCalls = 0;
  let capturedInitAuth = '';
  let capturedRefundIdemp = '';

  const mockChapaFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://api.chapa.co/v1/transaction/initialize') {
      capturedInitAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/live-abc123' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.startsWith('https://api.chapa.co/v1/transaction/verify/')) {
      verifyAttempt += 1;
      const txRef = decodeURIComponent(url.split('/').pop() ?? '');
      if (verifyAttempt === 1) {
        // Transient 503 -> must preserve order/stock without failing
        return new Response('Upstream Chapa busy', { status: 503 });
      }
      if (verifyAttempt === 2) {
        // Currency mismatch must fail verification
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { status: 'success', currency: 'USD', amount: '500.00', tx_ref: txRef, reference: 'CHAPA-BAD-CCY' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (verifyAttempt === 3) {
        // Underpaid amount must fail verification
        return new Response(
          JSON.stringify({
            status: 'success',
            data: { status: 'success', currency: 'ETB', amount: '100.00', tx_ref: txRef, reference: 'CHAPA-UNDERPAID' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // Valid ETB verification
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { status: 'success', currency: 'ETB', amount: '500.00', tx_ref: txRef, reference: 'CHAPA-LIVE-991' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.startsWith('https://api.chapa.co/v1/refund/')) {
      refundPostCalls += 1;
      capturedRefundIdemp = (init?.headers as Record<string, string>)?.['Idempotency-Key'] ?? '';
      assert.equal((init?.headers as Record<string, string>)?.['Content-Type'], 'application/x-www-form-urlencoded');
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { ref_id: 'CHAPA-REF-777', status: 'initiated' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === 'https://api.chapa.global/v2/refunds/CHAPA-REF-777/verify') {
      return new Response(
        JSON.stringify({
          status: 'success',
          data: { status: 'refunded' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 404 });
  };

  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'production',
    chapaSecretKey: 'CHASECK_LIVE_MOCKED',
    chapaWebhookSecret: 'whsec-mp4-secret',
    appUrl: 'https://yenetele.et',
    persistence: repo,
    chapaFetchImpl: mockChapaFetch,
  });
  await store.ensureCatalogSeeded();
  await store.upsertAuthenticatedUser({
    uid: 'uid-admin-1',
    email: 'ops@yenetele.example',
    phoneNumber: null,
    emailVerified: true,
    name: 'Admin',
  });
  await store.upsertAuthenticatedUser({
    uid: 'uid-cust-1',
    email: 'abebe@example.com',
    phoneNumber: null,
    emailVerified: true,
    name: 'Abebe Customer',
  });

  await store.updateProductAdmin('prod-ethio-new-line', 'uid-admin-1', 'ops@yenetele.example', {
    priceEtb: 500,
    reason: 'Set live price',
  });
  await store.importStockBatch('uid-admin-1', 'ops@yenetele.example', {
    operatorCode: 'ethio_telecom',
    batchName: 'Official Live Batch',
    sourceEnvironment: 'operator_partner_batch',
    items: [
      {
        msisdn: '+251911223344',
        iccid: '89251010000000888',
        smdpAddress: 'smdp.ethiotelecom.et',
        activationCode: 'LIVE-CODE-888',
      },
    ],
  });

  const ord = await store.createDraftOrder('uid-cust-1', {
    operatorCode: 'ethio_telecom',
    productId: 'prod-ethio-new-line',
    deviceVerified: true,
  });
  await store.submitOrderKyc(ord.id, 'uid-cust-1', {
    fullName: 'Abebe Bikila',
    faydaFanReference: '123456789012',
    contactPhone: '+251911223344',
    consentGiven: true,
  });
  await store.reserveNumberForOrder(ord.id, 'uid-cust-1', {});
  const checkout = await store.initChapaPaymentForOrder(
    ord.id,
    'uid-cust-1',
    'abebe@example.com',
    '/buy-esim',
  );
  assert.equal(capturedInitAuth, 'Bearer CHASECK_LIVE_MOCKED');
  assert.equal(checkout.checkoutUrl, 'https://checkout.chapa.co/checkout/payment/live-abc123');
  assert.equal(checkout.payment.isSandbox, false);

  // Attempt 1: Chapa 503 -> 503 PAYMENT_STATUS_UNCERTAIN, order stays awaiting_payment & stock reservation kept
  await assert.rejects(
    store.verifyPaymentAndFulfillOrder(ord.id, checkout.payment.txRef, { actorUserId: 'uid-cust-1' }),
    (e: any) => e.code === 'PAYMENT_STATUS_UNCERTAIN' && e.statusCode === 503,
  );
  const afterUncertain = await store.getOrderForUser(ord.id, 'uid-cust-1');
  assert.equal(afterUncertain?.status, 'awaiting_payment');
  assert.ok(afterUncertain?.assignedStockItemId);

  // Attempt 2 & 3: Currency mismatch & underpaid -> rejected cleanly
  await assert.rejects(
    store.verifyPaymentAndFulfillOrder(ord.id, checkout.payment.txRef, { actorUserId: 'uid-cust-1' }),
    /currency mismatch/i,
  );
  await assert.rejects(
    store.verifyPaymentAndFulfillOrder(ord.id, checkout.payment.txRef, { actorUserId: 'uid-cust-1' }),
    /below expected/i,
  );

  // Attempt 4: Valid ETB response fulfills real partner batch eSIM
  const fulfilled = await store.verifyPaymentAndFulfillOrder(ord.id, checkout.payment.txRef, {
    actorUserId: 'uid-cust-1',
  });
  assert.equal(fulfilled.payment.status, 'verified');
  assert.equal(fulfilled.payment.chapaReference, 'CHAPA-LIVE-991');
  assert.equal(fulfilled.order.status, 'ready_for_installation');
  assert.equal(fulfilled.esim?.isSandboxSimulation, false);

  // Concurrent refund initiation -> single HTTP refund POST -> refund_pending -> v2 verify -> refunded
  const [r1, r2] = await Promise.all([
    store.processRefundAdmin(fulfilled.payment.id, 'uid-admin-1', 'ops@yenetele.example', 'Customer cancellation'),
    store.processRefundAdmin(fulfilled.payment.id, 'uid-admin-1', 'ops@yenetele.example', 'Customer cancellation'),
  ]);
  assert.equal(refundPostCalls, 1);
  assert.ok(capturedRefundIdemp.startsWith('refund-'));
  assert.equal(r1.status, 'refund_pending');
  assert.equal(r1.refundReference, 'CHAPA-REF-777');
  assert.equal(r2.refundReference, 'CHAPA-REF-777');

  const reconciled = await store.reconcilePaymentAdmin(
    fulfilled.payment.id,
    'uid-admin-1',
    'ops@yenetele.example',
  );
  assert.equal(reconciled.status, 'refunded');
});

test('MP4 Audit Fix 5 & DB Unavailability: Safe 503 DATABASE_UNAVAILABLE handling and log PII/secret redaction', async () => {
  const redacted = redactForLog({
    authorization: 'Bearer secret-jwt',
    lpaUri: 'LPA:1$smdp$SECRET',
    activationCode: 'TOP-SECRET',
    nested: { chapaSecretKey: 'CHASECK_123', safeField: 'ok' },
  }) as Record<string, any>;
  assert.equal(redacted.authorization, '[REDACTED]');
  assert.equal(redacted.lpaUri, '[REDACTED]');
  assert.equal(redacted.activationCode, '[REDACTED]');
  assert.equal(redacted.nested.chapaSecretKey, '[REDACTED]');
  assert.equal(redacted.nested.safeField, 'ok');

  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'sandbox',
    persistence: repo,
  });
  await store.ensureCatalogSeeded();

  const srv = await startTestHttpServer({
    store,
    readinessCheck: async () => {
      await repo.getUser('probe');
      return { ok: true, database: 'connected', schemaOk: true, latencyMs: 1 };
    },
  });
  try {
    mock.setSimulateConnectionDown(true);

    // Auth middleware must return 503 DATABASE_UNAVAILABLE (never 401)
    const meDown = await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-cust-1');
    assert.equal(meDown.status, 503);
    assert.equal(meDown.data.error, 'DATABASE_UNAVAILABLE');

    const readyDown = await reqJson(`${srv.baseUrl}/api/ready`, 'GET');
    assert.equal(readyDown.status, 503);
    assert.equal(readyDown.data.database, 'error');
    assert.equal(readyDown.data.observability.databaseHealth.status, 'error');
  } finally {
    mock.setSimulateConnectionDown(false);
    await srv.close();
  }
});

test('Phone Marketplace: Catalog filtering, contactPhone validation, Chapa checkout, and admin compatibility governance', async () => {
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const encKey = crypto.randomBytes(32);
  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), encKey, {
    envMode: 'sandbox',
    chapaWebhookSecret: 'whsec-mp4-secret',
    persistence: repo,
  });
  await store.ensureCatalogSeeded();

  const srv = await startTestHttpServer({ store, envMode: 'sandbox' });
  try {
    // Seed users
    await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-admin');
    await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-cust-1');
    await reqJson(`${srv.baseUrl}/api/v1/me`, 'GET', 'token-cust-2');

    // 1. Catalog filtering & detail route
    const iphoneUnlocked = await reqJson(
      `${srv.baseUrl}/api/v1/phones?category=iphone&unlockedOnly=true`,
      'GET',
    );
    assert.equal(iphoneUnlocked.status, 200);
    assert.ok(iphoneUnlocked.data.phones.length >= 2);
    assert.ok(
      iphoneUnlocked.data.phones.every(
        (p: any) => p.category === 'iphone' && p.networkUnlockStatus === 'verified_unlocked',
      ),
    );

    const notCompat = await reqJson(
      `${srv.baseUrl}/api/v1/phones?compatibility=not_compatible`,
      'GET',
    );
    assert.equal(notCompat.status, 200);
    assert.ok(notCompat.data.phones.some((p: any) => p.exactModelNumber.includes('A3092')));

    const searchRes = await reqJson(`${srv.baseUrl}/api/v1/phones?q=A3090`, 'GET');
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.data.phones.length, 1);
    assert.equal(searchRes.data.phones[0].exactModelNumber, 'A3090');

    const detailRes = await reqJson(`${srv.baseUrl}/api/v1/phones/${searchRes.data.phones[0].id}`, 'GET');
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.data.phone.exactModelNumber, 'A3090');

    const missingRes = await reqJson(`${srv.baseUrl}/api/v1/phones/nonexistent-phone-999`, 'GET');
    assert.equal(missingRes.status, 404);

    // 2. Phone order creation requires valid Ethiopian contactPhone when supplied
    const badPhoneOrder = await reqJson(`${srv.baseUrl}/api/v1/phones/orders`, 'POST', 'token-cust-1', {
      phoneProductId: detailRes.data.phone.id,
      orderKind: 'individual',
      quantity: 1,
      contactPhone: '12345',
      deliveryCity: 'Addis Ababa',
      deliveryAddress: 'Bole Medhanialem, House 12',
    });
    assert.equal(badPhoneOrder.status, 400);
    assert.equal(badPhoneOrder.data.error, 'INVALID_CONTACT_PHONE');

    const createdOrder = await reqJson(`${srv.baseUrl}/api/v1/phones/orders`, 'POST', 'token-cust-1', {
      phoneProductId: detailRes.data.phone.id,
      orderKind: 'individual',
      quantity: 1,
      contactPhone: '0911223344',
      deliveryCity: 'Addis Ababa',
      deliveryAddress: 'Bole Medhanialem, House 12',
      pairedEsimOperator: 'ethio_telecom',
    });
    assert.equal(createdOrder.status, 201);
    assert.equal(createdOrder.data.order.contactPhone, '+251911223344');
    assert.equal(createdOrder.data.order.deliveryAddress, 'Bole Medhanialem, House 12');
    assert.equal(createdOrder.data.order.pairedEsimOperator, 'ethio_telecom');
    assert.equal(createdOrder.data.order.paymentStatus, 'pending');

    // Static GET /api/v1/phones/orders must resolve cleanly (not shadowed by /phones/:phoneId)
    const myOrders = await reqJson(`${srv.baseUrl}/api/v1/phones/orders`, 'GET', 'token-cust-1');
    assert.equal(myOrders.status, 200);
    assert.equal(myOrders.data.orders.length, 1);
    assert.equal(myOrders.data.orders[0].id, createdOrder.data.order.id);

    // 3. Chapa checkout + verification on phone order
    const checkout = await reqJson(
      `${srv.baseUrl}/api/v1/phones/orders/${createdOrder.data.order.id}/checkout`,
      'POST',
      'token-cust-1',
      { returnUrl: '/phones' },
    );
    assert.equal(checkout.status, 201);
    assert.ok(checkout.data.payment.txRef);
    assert.equal(checkout.data.order.paymentStatus, 'initialized');

    const verify = await reqJson(
      `${srv.baseUrl}/api/v1/phones/orders/${createdOrder.data.order.id}/verify-payment`,
      'POST',
      'token-cust-1',
      { txRef: checkout.data.payment.txRef },
    );
    assert.equal(verify.status, 200);
    assert.equal(verify.data.verified, true);
    assert.equal(verify.data.order.paymentStatus, 'verified');

    // 4. Admin catalog governance & RBAC checks
    // Reject verified_compatible without exactModelNumber + compatibilityEvidence
    const missingEvidence = await reqJson(`${srv.baseUrl}/api/v1/admin/phones`, 'POST', 'token-admin', {
      brand: 'Google',
      category: 'google_pixel',
      model: 'Pixel 9 Pro',
      exactModelNumber: '',
      storage: '256 GB',
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      stockQty: 4,
      reason: 'Adding Pixel 9 Pro',
    });
    assert.equal(missingEvidence.status, 400);
    assert.equal(missingEvidence.data.error, 'COMPATIBILITY_EVIDENCE_REQUIRED');

    // Grant operations_staff role to token-cust-2 and ensure operations_staff cannot publish official unitPriceEtb
    const grantOps = await reqJson(`${srv.baseUrl}/api/v1/admin/staff`, 'POST', 'token-admin', {
      email: 'tigist@example.com',
      role: 'operations_staff',
      displayName: 'Catalog Ops Specialist',
    });
    assert.equal(grantOps.status, 201);

    const forbiddenPriceCreate = await reqJson(`${srv.baseUrl}/api/v1/admin/phones`, 'POST', 'token-cust-2', {
      brand: 'Google',
      category: 'google_pixel',
      model: 'Pixel 9',
      exactModelNumber: 'GUR25',
      storage: '128 GB',
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      compatibilityEvidence: 'Google Pixel 9 GUR25 Global spec sheet confirms dual SIM (nano + eSIM).',
      unitPriceEtb: 129000,
      stockQty: 5,
      reason: 'Ops attempting to set price directly',
    });
    assert.equal(forbiddenPriceCreate.status, 403);
    assert.equal(forbiddenPriceCreate.data.error, 'FORBIDDEN_ROLE');

    // Super Admin successfully creates verified phone listing with official price + audit log
    const createdPhone = await reqJson(`${srv.baseUrl}/api/v1/admin/phones`, 'POST', 'token-admin', {
      brand: 'Google',
      category: 'google_pixel',
      model: 'Pixel 9',
      exactModelNumber: 'GUR25',
      regionalVariant: 'Global / EU Factory Unlocked',
      storage: '128 GB',
      condition: 'Brand New · Sealed',
      warrantySummary: '1-Year Yene Tele Hardware Warranty',
      esimCompatibilityStatus: 'verified_compatible',
      networkUnlockStatus: 'verified_unlocked',
      ethioTelecomCompatibility: 'verified',
      safaricomCompatibility: 'verified',
      compatibilityNotes: 'Verified dual eSIM standby.',
      compatibilityEvidence: 'Google Pixel 9 GUR25 spec sheet confirms dual SIM (nano + eSIM).',
      imageKey: 'pixel-8a',
      isFeatured: true,
      unitPriceEtb: 129000,
      sandboxPreviewPriceEtb: 129000,
      stockQty: 5,
      reason: 'Launch Google Pixel 9 GUR25 in curated store',
    });
    assert.equal(createdPhone.status, 201);
    assert.equal(createdPhone.data.product.esimCompatibilityStatus, 'verified_compatible');
    assert.equal(createdPhone.data.product.unitPriceEtb, 129000);

    // Update listing compatibility & stock
    const updatedPhone = await reqJson(
      `${srv.baseUrl}/api/v1/admin/phones/${createdPhone.data.product.id}`,
      'PATCH',
      'token-admin',
      {
        stockQty: 8,
        reason: 'Restocked 3 additional verified GUR25 units',
      },
    );
    assert.equal(updatedPhone.status, 200);
    assert.equal(updatedPhone.data.product.stockQty, 8);

    const audits = await reqJson(`${srv.baseUrl}/api/v1/admin/audit-logs`, 'GET', 'token-admin');
    assert.ok(audits.data.logs.some((l: any) => l.action === 'PHONE_PRODUCT_CREATED'));
    assert.ok(audits.data.logs.some((l: any) => l.action === 'PHONE_PRODUCT_UPDATED'));
    assert.ok(audits.data.logs.some((l: any) => l.action === 'PHONE_ORDER_PAYMENT_VERIFIED'));
  } finally {
    await srv.close();
  }
});

test('Vercel serverless handler restores rewritten /api paths and preserves query parameters', async () => {
  const { default: vercelHandler } = await import('../api/index.ts');
  const server = http.createServer((req, res) => {
    void vercelHandler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  try {
    const health = await reqJson(`${baseUrl}/api?__vercel_path=health`, 'GET');
    assert.equal(health.status, 200);
    assert.equal(health.data.service, 'yene-tele-platform');

    const phones = await reqJson(`${baseUrl}/api?__vercel_path=v1/phones&category=iphone`, 'GET');
    assert.equal(phones.status, 200);
    assert.ok(Array.isArray(phones.data.phones));
    assert.ok(phones.data.phones.every((p: any) => p.category === 'iphone'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Mela assistant endpoint validates input and reports missing GEMINI_API_KEY without faking AI responses', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const mock = createMockRelationalPgPool();
  const repo = new PostgresPersistenceRepository(mock.pool);
  const store = new YeneTeleStore(new Set(['ops@yenetele.example']), crypto.randomBytes(32), {
    envMode: 'sandbox',
    persistence: repo,
  });
  await store.ensureCatalogSeeded();

  const srv = await startTestHttpServer({ store, envMode: 'sandbox' });
  try {
    const noKeyRes = await reqJson(`${srv.baseUrl}/api/v1/mela/ask`, 'POST', undefined, {
      question: 'Which operators are available?',
    });
    assert.equal(noKeyRes.status, 503);
    assert.equal(noKeyRes.data.error, 'MELA_AI_NOT_CONFIGURED');

    process.env.GEMINI_API_KEY = 'dummy-test-key-for-validation';
    const emptyQuestion = await reqJson(`${srv.baseUrl}/api/v1/mela/ask`, 'POST', undefined, {
      question: '   ',
    });
    assert.equal(emptyQuestion.status, 400);
    assert.equal(emptyQuestion.data.error, 'VALIDATION_ERROR');
  } finally {
    if (prevKey !== undefined) {
      process.env.GEMINI_API_KEY = prevKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    await srv.close();
  }
});


