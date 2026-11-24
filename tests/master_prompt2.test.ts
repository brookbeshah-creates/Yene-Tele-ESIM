import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import type { TokenVerifier, VerifiedIdentity } from '../server/modules/auth/firebaseVerifier.ts';
import { YeneTeleStore } from '../server/modules/store/yeneStore.ts';

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
  options?: { chapaWebhookSecret?: string | null },
): Promise<void> {
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
    'token-finance': {
      uid: 'uid-finance-1',
      email: 'finance@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Yene Finance Officer',
    },
    'token-support': {
      uid: 'uid-support-1',
      email: 'support@yenetele.example',
      phoneNumber: null,
      emailVerified: true,
      name: 'Yene Support Agent',
    },
  });

  const adminEmails = new Set(['ops@yenetele.example']);
  const customStore = new YeneTeleStore(adminEmails, crypto.randomBytes(32), {
    chapaWebhookSecret: options?.chapaWebhookSecret ?? null,
  });
  await customStore.grantStaffAdmin('uid-finance-1', 'finance@yenetele.example', 'finance_staff', 'Finance Officer');
  await customStore.grantStaffAdmin('uid-support-1', 'support@yenetele.example', 'support_staff', 'Support Agent');

  const { app, store } = createApp({
    verifier,
    adminEmails,
    store: customStore,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl, store);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

async function api(
  baseUrl: string,
  route: string,
  options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(`${baseUrl}${route}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('Stock CSV validation preview, batch import, expiry, reconciliation & zero secret leakage', async () => {
  await withServer(async (baseUrl, store) => {
    const csvText = [
      'msisdn,iccid,smdpAddress,activationCode,numberTier,externalInventoryRef,expiresAt',
      '+251911550001,8925109900000001,sandbox-smdp.ethiotelecom.yene.invalid,CODE-VALID-1,gold,EXT-1,2030-01-01T00:00:00Z',
      '+251911550001,8925109900000002,sandbox-smdp.ethiotelecom.yene.invalid,CODE-DUP-MSISDN,silver,EXT-2,',
      '+251711550003,8925109900000003,sandbox-smdp.ethiotelecom.yene.invalid,CODE-WRONG-OP,standard,EXT-3,',
      'invalid-phone,,sandbox-smdp.ethiotelecom.yene.invalid,,bronze,EXT-4,',
    ].join('\n');

    const preview = await api(baseUrl, '/api/v1/admin/inventory/import-preview', {
      method: 'POST',
      token: 'token-admin',
      body: { operatorCode: 'ethio_telecom', csvText },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.preview.totalRows, 4);
    assert.equal(preview.data.preview.validCount, 1);
    assert.equal(preview.data.preview.invalidCount, 3);
    assert.ok(preview.data.preview.duplicateCount >= 1);

    // Import valid item + one already-expired item
    const batchRes = await api(baseUrl, '/api/v1/admin/inventory/batches', {
      method: 'POST',
      token: 'token-admin',
      body: {
        operatorCode: 'ethio_telecom',
        batchName: 'MP2 Audit Batch',
        sourceEnvironment: 'sandbox_demo',
        items: [
          {
            msisdn: '+251911550001',
            iccid: '8925109900000001',
            numberTier: 'gold',
            externalInventoryRef: 'EXT-1',
            smdpAddress: 'sandbox-smdp.ethiotelecom.yene.invalid',
            activationCode: 'SECRET-ACT-CODE-001',
          },
          {
            msisdn: '+251911550002',
            iccid: '8925109900000002',
            numberTier: 'standard',
            externalInventoryRef: 'EXT-EXP',
            expiresAt: '2020-01-01T00:00:00Z',
            smdpAddress: 'sandbox-smdp.ethiotelecom.yene.invalid',
            activationCode: 'SECRET-ACT-CODE-002',
          },
        ],
      },
    });
    assert.equal(batchRes.status, 201);
    assert.equal(batchRes.data.importedCount, 2);

    // Inventory API never leaks encrypted secrets or SM-DP+ activation codes
    const inv = await api(baseUrl, '/api/v1/admin/inventory?operator=ethio_telecom', {
      token: 'token-admin',
    });
    assert.equal(inv.status, 200);
    const invJson = JSON.stringify(inv.data);
    assert.ok(!invJson.includes('SECRET-ACT-CODE-001'));
    assert.ok(!invJson.includes('smdpAddress'));
    assert.ok(!invJson.includes('encryptedCredentials'));

    // Run stock reconciliation -> expires old item
    const reconcile = await api(baseUrl, '/api/v1/admin/inventory/reconcile', {
      method: 'POST',
      token: 'token-admin',
      body: {},
    });
    assert.equal(reconcile.status, 200);
    assert.equal(reconcile.data.report.expiredItems, 1);

    // Mark valid item invalid then restore to available
    const validItem = inv.data.items.find((i: { iccid: string }) => i.iccid === '8925109900000001');
    assert.ok(validItem);
    const markInvalid = await api(baseUrl, `/api/v1/admin/inventory/items/${validItem.id}`, {
      method: 'PATCH',
      token: 'token-admin',
      body: { status: 'invalid', reason: 'Operator recall test' },
    });
    assert.equal(markInvalid.status, 200);
    assert.equal(markInvalid.data.item.status, 'invalid');

    const restore = await api(baseUrl, `/api/v1/admin/inventory/items/${validItem.id}`, {
      method: 'PATCH',
      token: 'token-admin',
      body: { status: 'available', reason: 'Verified active again' },
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.item.status, 'available');

    // Reserve item then expire reservation clock
    const draft = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: { operatorCode: 'ethio_telecom', productId: 'prod-ethio-new-line', deviceModel: 'iPhone 15' },
    });
    await api(baseUrl, `/api/v1/orders/${draft.data.order.id}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { fullName: 'Abebe', faydaFanReference: 'FAN-100', contactPhone: '+251911223344', consentGiven: true },
    });
    await api(baseUrl, `/api/v1/orders/${draft.data.order.id}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { stockItemId: validItem.id },
    });
    const released = await store.expireStaleReservations(Date.now() + 20 * 60 * 1000);
    assert.equal(released, 1);
    const items = await store.listStockItems('ethio_telecom');
    const afterExpire = items.find((i) => i.id === validItem.id);
    assert.equal(afterExpire?.status, 'available');
  });
});

test('Order idempotency, operator toggles, SIM conversion gating, KYC retry & customer cancel', async () => {
  await withServer(async (baseUrl) => {
    // Idempotent order creation returns the same order
    const d1 = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        idempotencyKey: 'idemp-order-abc',
      },
    });
    const d2 = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        idempotencyKey: 'idemp-order-abc',
      },
    });
    assert.equal(d1.status, 201);
    assert.equal(d2.status, 201);
    assert.equal(d1.data.order.id, d2.data.order.id);

    // KYC failure creates auditable failed state and allows clean customer retry
    const orderId = d1.data.order.id;
    const failedKyc = await api(baseUrl, `/api/v1/orders/${orderId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { fullName: 'Abebe', faydaFanReference: 'FAN-1', contactPhone: '+251911223344', consentGiven: false },
    });
    assert.equal(failedKyc.status, 400);

    const retryKyc = await api(baseUrl, `/api/v1/orders/${orderId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { fullName: 'Abebe Bikila', faydaFanReference: 'FAN-999', contactPhone: '+251911223344', consentGiven: true },
    });
    assert.equal(retryKyc.status, 200);
    assert.equal(retryKyc.data.order.status, 'identity_verified');

    // Reserve stock item & then cancel -> stock item must be released back to available
    const availBefore = await api(baseUrl, '/api/v1/numbers/available?operator=ethio_telecom');
    const stockId = availBefore.data.numbers[0].id;
    await api(baseUrl, `/api/v1/orders/${orderId}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { stockItemId: stockId },
    });

    const cancelRes = await api(baseUrl, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { reason: 'Customer changed mind' },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.order.status, 'cancelled');

    const availAfter = await api(baseUrl, '/api/v1/numbers/available?operator=ethio_telecom');
    assert.ok(availAfter.data.numbers.some((n: { id: string }) => n.id === stockId));

    // SIM-to-eSIM conversion blocked by default, then works when enabled with existingMsisdn
    const convBlocked = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-sim-conv',
        existingMsisdn: '+251911223344',
      },
    });
    assert.equal(convBlocked.status, 409);

    await api(baseUrl, '/api/v1/admin/operators/ethio_telecom', {
      method: 'PATCH',
      token: 'token-admin',
      body: { supportsSimConversion: true, reason: 'Enable sandbox conversion gate test' },
    });
    const convAllowed = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-sim-conv',
        existingMsisdn: '0911223344',
      },
    });
    assert.equal(convAllowed.status, 201);
    assert.equal(convAllowed.data.order.reservedMsisdn, '+251911223344');

    // Disabled operator rejects new order creation
    await api(baseUrl, '/api/v1/admin/operators/ethio_telecom', {
      method: 'PATCH',
      token: 'token-admin',
      body: { isEnabled: false, reason: 'Maintenance test' },
    });
    const disabledOrder = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: { operatorCode: 'ethio_telecom', productId: 'prod-ethio-new-line' },
    });
    assert.equal(disabledOrder.status, 409);
    assert.equal(disabledOrder.data.error, 'OPERATOR_UNAVAILABLE');
  });
});

test('Chapa HMAC webhook verification, failure rejection, deduplication & finance refunds', async () => {
  const secret = 'test-chapa-hmac-secret-2026';
  await withServer(async (baseUrl) => {
    const draft = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: { operatorCode: 'safaricom_ethiopia', productId: 'prod-safari-new-line', deviceModel: 'Pixel 8a' },
    });
    const orderId = draft.data.order.id;
    await api(baseUrl, `/api/v1/orders/${orderId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { fullName: 'Abebe', faydaFanReference: 'FAN-700', contactPhone: '+251711223344', consentGiven: true },
    });
    await api(baseUrl, `/api/v1/orders/${orderId}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { preferredTier: 'standard' },
    });
    const checkout = await api(baseUrl, `/api/v1/orders/${orderId}/checkout`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { idempotencyKey: 'pay-idemp-1' },
    });
    const txRef = checkout.data.payment.txRef;
    const paymentId = checkout.data.payment.id;

    // Invalid webhook signature -> 401
    const badWebhook = await api(baseUrl, '/api/v1/payments/chapa/webhook', {
      method: 'POST',
      headers: { 'x-chapa-signature': 'bad-signature' },
      body: { tx_ref: txRef, orderId, eventId: 'evt-1', status: 'success' },
    });
    assert.equal(badWebhook.status, 401);

    // Simulated verification failure leaves order unpaid and unprovisioned
    const simFail = await api(baseUrl, `/api/v1/orders/${orderId}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { txRef, simulatePaymentFailure: true },
    });
    assert.equal(simFail.status, 402);

    // Valid signed webhook (status=success) verifies payment & routes Safaricom to manual queue
    const payloadObj = { tx_ref: txRef, orderId, eventId: 'evt-success-1', status: 'success' };
    const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(payloadObj)).digest('hex');
    const goodWebhook = await api(baseUrl, '/api/v1/payments/chapa/webhook', {
      method: 'POST',
      headers: { 'x-chapa-signature': sig },
      body: payloadObj,
    });
    assert.equal(goodWebhook.status, 200);
    assert.equal(goodWebhook.data.paymentStatus, 'verified');
    assert.equal(goodWebhook.data.orderStatus, 'awaiting_manual_fulfillment');

    // Duplicate webhook with same eventId is deduplicated
    const dupWebhook = await api(baseUrl, '/api/v1/payments/chapa/webhook', {
      method: 'POST',
      headers: { 'x-chapa-signature': sig },
      body: payloadObj,
    });
    assert.equal(dupWebhook.status, 200);
    assert.equal(dupWebhook.data.deduplicated, true);

    // Customer cancels paid unfulfilled order -> triggers refund_pending
    const cancelPaid = await api(baseUrl, `/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { reason: 'No longer needed before fulfillment' },
    });
    assert.equal(cancelPaid.status, 200);
    assert.equal(cancelPaid.data.order.status, 'refund_pending');

    // Finance staff reconciles & completes refund
    const reconcilePay = await api(baseUrl, `/api/v1/admin/payments/${paymentId}/reconcile`, {
      method: 'POST',
      token: 'token-finance',
      body: {},
    });
    assert.equal(reconcilePay.status, 200);

    const refundPay = await api(baseUrl, `/api/v1/admin/payments/${paymentId}/refund`, {
      method: 'POST',
      token: 'token-finance',
      body: { reason: 'Customer cancelled prior to partner activation' },
    });
    assert.equal(refundPay.status, 200);
    assert.equal(refundPay.data.payment.status, 'refunded');
  }, { chapaWebhookSecret: secret });
});

test('Direct Operator API async polling, post-payment failure refund handling & RBAC guards', async () => {
  await withServer(async (baseUrl) => {
    // Switch ethio_telecom to Direct API without pre-payment reservation
    await api(baseUrl, '/api/v1/admin/operators/ethio_telecom', {
      method: 'PATCH',
      token: 'token-admin',
      body: {
        activeSupplyMethod: 'direct_api',
        supportsPrePaymentReservation: false,
        reason: 'Test Direct API Model B workflow',
      },
    });

    const avail = await api(baseUrl, '/api/v1/numbers/available?operator=ethio_telecom&tier=gold');
    assert.equal(avail.status, 200);
    assert.equal(avail.data.numbers.length, 1);
    assert.equal(avail.data.numbers[0].supportsPrePaymentReservation, false);

    // Order 1: Async pending -> poll -> ready_for_installation -> installed -> activated
    const d1 = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: { operatorCode: 'ethio_telecom', productId: 'prod-ethio-new-line', deviceModel: 'iPhone 16' },
    });
    const ord1 = d1.data.order.id;
    await api(baseUrl, `/api/v1/orders/${ord1}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { fullName: 'Abebe', faydaFanReference: 'FAN-11', contactPhone: '+251911223344', consentGiven: true },
    });
    await api(baseUrl, `/api/v1/orders/${ord1}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { requestedPhone: avail.data.numbers[0].msisdn, preferredTier: 'gold' },
    });
    const pay1 = await api(baseUrl, `/api/v1/orders/${ord1}/checkout`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {},
    });
    const verifyPending = await api(baseUrl, `/api/v1/orders/${ord1}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { txRef: pay1.data.payment.txRef, sandboxBehavior: 'pending' },
    });
    assert.equal(verifyPending.status, 200);
    assert.equal(verifyPending.data.order.status, 'operator_pending');
    assert.equal(verifyPending.data.esim, null);

    // Poll until provisioned
    const polled = await api(baseUrl, `/api/v1/orders/${ord1}/poll-provisioning`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { forceOutcome: 'provisioned' },
    });
    assert.equal(polled.status, 200);
    assert.equal(polled.data.order.status, 'ready_for_installation');
    assert.ok(polled.data.esim?.id);

    const inst = await api(baseUrl, `/api/v1/esims/${polled.data.esim.id}/mark-installed`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {},
    });
    assert.equal(inst.status, 200);
    assert.equal(inst.data.esim.status, 'installed');

    const act = await api(baseUrl, `/api/v1/esims/${polled.data.esim.id}/mark-activated`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {},
    });
    assert.equal(act.status, 200);
    assert.equal(act.data.esim.status, 'activated');

    // Order 2: Post-payment unavailability recheck fails cleanly & triggers refund_pending
    const d2 = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-2',
      body: { operatorCode: 'ethio_telecom', productId: 'prod-ethio-new-line', deviceModel: 'Galaxy S24' },
    });
    const ord2 = d2.data.order.id;
    await api(baseUrl, `/api/v1/orders/${ord2}/kyc`, {
      method: 'POST',
      token: 'token-cust-2',
      body: { fullName: 'Tigist', faydaFanReference: 'FAN-22', contactPhone: '+251922334455', consentGiven: true },
    });
    await api(baseUrl, `/api/v1/orders/${ord2}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-2',
      body: { requestedPhone: '+251900880202', preferredTier: 'bronze' },
    });
    const pay2 = await api(baseUrl, `/api/v1/orders/${ord2}/checkout`, {
      method: 'POST',
      token: 'token-cust-2',
      body: {},
    });
    const failFulfill = await api(baseUrl, `/api/v1/orders/${ord2}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-2',
      body: { txRef: pay2.data.payment.txRef, sandboxBehavior: 'unavailable_on_recheck' },
    });
    assert.equal(failFulfill.status, 200);
    assert.equal(failFulfill.data.order.status, 'failed');
    assert.equal(failFulfill.data.order.paymentStatus, 'refund_pending');

    // RBAC checks
    // 1. Customer B cannot inspect Customer A's order detail
    const crossOrder = await api(baseUrl, `/api/v1/orders/${ord1}`, { token: 'token-cust-2' });
    assert.equal(crossOrder.status, 404);

    // 2. Support staff blocked from stock import & manual fulfillment
    const supportStock = await api(baseUrl, '/api/v1/admin/inventory/batches', {
      method: 'POST',
      token: 'token-support',
      body: { operatorCode: 'ethio_telecom', batchName: 'Blocked', items: [] },
    });
    assert.equal(supportStock.status, 403);

    const supportManual = await api(baseUrl, `/api/v1/admin/orders/${ord2}/manual-fulfillment`, {
      method: 'POST',
      token: 'token-support',
      body: { iccid: '89251', smdpAddress: 'smdp', activationCode: 'code', partnerReference: 'ref' },
    });
    assert.equal(supportManual.status, 403);

    // 3. Finance staff blocked from provisioning retry but allowed to access payments
    const financeRetry = await api(baseUrl, `/api/v1/admin/orders/${ord2}/action`, {
      method: 'POST',
      token: 'token-finance',
      body: { action: 'retry_provisioning', reason: 'Should fail RBAC' },
    });
    assert.equal(financeRetry.status, 403);

    const financePayments = await api(baseUrl, '/api/v1/admin/payments', { token: 'token-finance' });
    assert.equal(financePayments.status, 200);
  });
});
