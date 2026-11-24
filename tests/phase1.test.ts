import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../server/app.ts';
import type { TokenVerifier, VerifiedIdentity } from '../server/modules/auth/firebaseVerifier.ts';
import { decryptActivationPayload, encryptActivationPayload } from '../server/modules/delivery/esimVault.ts';
import { inferOperatorFromEthiopianPhone, normalizeEthiopianPhone } from '../server/modules/rbac/permissions.ts';
import { resolveEffectiveTheme, THEME_STORAGE_KEY } from '../src/contexts/ThemeContext.tsx';

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
  fn: (baseUrl: string) => Promise<void>,
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
      name: 'Yene Operations Staff',
    },
  });

  const { app } = createApp({
    verifier,
    adminEmails: new Set(['ops@yenetele.example']),
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
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

test('Ethiopian MSISDN normalization and operator prefix inference', () => {
  assert.equal(normalizeEthiopianPhone('0911223344'), '+251911223344');
  assert.equal(normalizeEthiopianPhone('+251712345678'), '+251712345678');
  assert.equal(normalizeEthiopianPhone('251922334455'), '+251922334455');
  assert.equal(normalizeEthiopianPhone('12345'), null);
  assert.equal(inferOperatorFromEthiopianPhone('+251911223344'), 'ethio_telecom');
  assert.equal(inferOperatorFromEthiopianPhone('+251712345678'), 'safaricom_ethiopia');
});

test('AES-256-GCM activation credential vault encrypts & decrypts securely', () => {
  const key = crypto.randomBytes(32);
  const sample = {
    smdpAddress: 'sandbox-smdp.yene.invalid',
    activationCode: 'CODE-XYZ-123',
    lpaUri: 'LPA:1$sandbox-smdp.yene.invalid$CODE-XYZ-123',
    qrPayload: 'LPA:1$sandbox-smdp.yene.invalid$CODE-XYZ-123',
  };
  const encrypted = encryptActivationPayload(sample, key);
  assert.ok(!encrypted.includes('CODE-XYZ-123'));
  const decrypted = decryptActivationPayload(encrypted, key);
  assert.deepEqual(decrypted, sample);
});

test('Customer eSIM purchase lifecycle, KYC gate, stock reservation lock & vault retrieval', async () => {
  await withServer(async (baseUrl) => {
    const ops = await api(baseUrl, '/api/v1/operators');
    assert.equal(ops.status, 200);
    assert.equal(ops.data.operators.length, 2);

    // 1. Create draft order for Ethio telecom (Model A stock_based)
    const draft = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceModel: 'Apple iPhone 15',
        deviceOs: 'ios',
        deviceVerified: true,
      },
    });
    assert.equal(draft.status, 201);
    const orderId = draft.data.order.id;

    // Cannot reserve number before Fayda KYC
    const earlyReserve = await api(baseUrl, `/api/v1/orders/${orderId}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {},
    });
    assert.equal(earlyReserve.status, 409);

    // Agent KYC impersonation attempt must be blocked & logged
    const impersonateAttempt = await api(baseUrl, `/api/v1/orders/${orderId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        fullName: 'Abebe',
        faydaFanReference: 'FAN-001',
        contactPhone: '+251911223344',
        consentGiven: true,
        submittedByAgentAttempt: true,
      },
    });
    assert.equal(impersonateAttempt.status, 403);

    // 2. Valid subscriber Fayda KYC consent
    const kyc = await api(baseUrl, `/api/v1/orders/${orderId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        fullName: 'Abebe Bikila',
        faydaFanReference: 'FAN-987654',
        contactPhone: '+251911223344',
        consentGiven: true,
      },
    });
    assert.equal(kyc.status, 200);
    assert.equal(kyc.data.order.status, 'identity_verified');

    // 3. Reserve specific available stock item
    const avail = await api(baseUrl, '/api/v1/numbers/available?operator=ethio_telecom');
    const firstStockId = avail.data.numbers[0].id;

    const reserved1 = await api(baseUrl, `/api/v1/orders/${orderId}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { stockItemId: firstStockId },
    });
    assert.equal(reserved1.status, 200);
    assert.equal(reserved1.data.order.assignedStockItemId, firstStockId);

    // Second customer trying to reserve the SAME locked stock item must fail (409)
    const draft2 = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-2',
      body: {
        operatorCode: 'ethio_telecom',
        productId: 'prod-ethio-new-line',
        deviceModel: 'Samsung Galaxy S24',
      },
    });
    await api(baseUrl, `/api/v1/orders/${draft2.data.order.id}/kyc`, {
      method: 'POST',
      token: 'token-cust-2',
      body: {
        fullName: 'Tigist Test',
        faydaFanReference: 'FAN-222222',
        contactPhone: '+251922334455',
        consentGiven: true,
      },
    });
    const doubleReserve = await api(
      baseUrl,
      `/api/v1/orders/${draft2.data.order.id}/reserve-number`,
      {
        method: 'POST',
        token: 'token-cust-2',
        body: { stockItemId: firstStockId },
      },
    );
    assert.equal(doubleReserve.status, 409);
    assert.equal(doubleReserve.data.error, 'NUMBER_ALREADY_RESERVED');

    // 4. Initialize Chapa checkout & test webhook idempotency + server verification
    const checkout = await api(baseUrl, `/api/v1/orders/${orderId}/checkout`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { returnUrl: '/buy-esim' },
    });
    assert.equal(checkout.status, 201);
    const txRef = checkout.data.payment.txRef;

    const verify = await api(baseUrl, `/api/v1/orders/${orderId}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { txRef },
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.data.order.status, 'ready_for_installation');
    assert.ok(verify.data.esim?.id);

    // Idempotent second verification must not double-provision or error
    const verifyRepeat = await api(baseUrl, `/api/v1/orders/${orderId}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { txRef },
    });
    assert.equal(verifyRepeat.status, 200);
    assert.equal(verifyRepeat.data.deduplicated, true);

    // 5. Owner can decrypt activation credentials; non-owner is blocked
    const ownerSecret = await api(baseUrl, `/api/v1/esims/${verify.data.esim.id}/activation`, {
      token: 'token-cust-1',
    });
    assert.equal(ownerSecret.status, 200);
    assert.ok(ownerSecret.data.activation.lpaUri.startsWith('LPA:1$'));

    const otherSecret = await api(baseUrl, `/api/v1/esims/${verify.data.esim.id}/activation`, {
      token: 'token-cust-2',
    });
    assert.equal(otherSecret.status, 404);
  });
});

test('Manual Partner Processing queue, Agent manual approval separation & Secondary Phone orders', async () => {
  await withServer(async (baseUrl) => {
    // Customer blocked from Admin routes (403)
    const custAdmin = await api(baseUrl, '/api/v1/admin/overview', { token: 'token-cust-1' });
    assert.equal(custAdmin.status, 403);

    // Customer applies to be an agent -> starts pending_review and cannot view agent dashboard yet
    const apply = await api(baseUrl, '/api/v1/agent/application', {
      method: 'POST',
      token: 'token-cust-2',
      body: {
        fullName: 'Tigist Retail Shop',
        phone: '+251911998877',
        city: 'Addis Ababa',
        applicantType: 'retail_shop',
        experienceSummary: 'Mobile retail counter in Bole',
      },
    });
    assert.equal(apply.status, 201);
    assert.equal(apply.data.application.status, 'pending_review');

    const blockedAgentDash = await api(baseUrl, '/api/v1/agent/dashboard', {
      token: 'token-cust-2',
    });
    assert.equal(blockedAgentDash.status, 403);

    // Admin approves agent -> referral code created & dashboard unlocks
    const review = await api(
      baseUrl,
      `/api/v1/admin/agents/applications/${apply.data.application.id}/review`,
      {
        method: 'POST',
        token: 'token-admin',
        body: {
          decision: 'approved',
          reviewNotes: 'Approved after document verification',
          ethioTelecomAuthorized: true,
        },
      },
    );
    assert.equal(review.status, 200);
    const referralCode = review.data.agentProfile.referralCode;
    assert.ok(referralCode.startsWith('YT-AG-'));

    const approvedDash = await api(baseUrl, '/api/v1/agent/dashboard', {
      token: 'token-cust-2',
    });
    assert.equal(approvedDash.status, 200);

    // Safaricom Ethiopia is seeded with manual_processing -> purchase queues manually until admin fulfills
    const safariDraft = await api(baseUrl, '/api/v1/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        operatorCode: 'safaricom_ethiopia',
        productId: 'prod-safari-new-line',
        deviceModel: 'Pixel 8a',
        agentReferralCode: referralCode,
      },
    });
    const ordId = safariDraft.data.order.id;
    await api(baseUrl, `/api/v1/orders/${ordId}/kyc`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        fullName: 'Abebe Customer',
        faydaFanReference: 'FAN-777',
        contactPhone: '+251711223344',
        consentGiven: true,
      },
    });
    await api(baseUrl, `/api/v1/orders/${ordId}/reserve-number`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { preferredTier: 'silver' },
    });
    const pay = await api(baseUrl, `/api/v1/orders/${ordId}/checkout`, {
      method: 'POST',
      token: 'token-cust-1',
      body: {},
    });
    const verify = await api(baseUrl, `/api/v1/orders/${ordId}/verify-payment`, {
      method: 'POST',
      token: 'token-cust-1',
      body: { txRef: pay.data.payment.txRef },
    });
    assert.equal(verify.data.order.status, 'awaiting_manual_fulfillment');
    assert.equal(verify.data.esim, null);

    // Admin completes manual fulfillment
    const manual = await api(baseUrl, `/api/v1/admin/orders/${ordId}/manual-fulfillment`, {
      method: 'POST',
      token: 'token-admin',
      body: {
        iccid: '892510777777777777',
        smdpAddress: 'sandbox-smdp.safaricom.yene.invalid',
        activationCode: 'MANUAL-SAFARI-01',
        partnerReference: 'BOLE-PARTNER-01',
      },
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.data.order.status, 'ready_for_installation');

    // Agent sees 1 attributed order after fulfillment
    const agentDashAfter = await api(baseUrl, '/api/v1/agent/dashboard', {
      token: 'token-cust-2',
    });
    assert.equal(agentDashAfter.data.attributedOrders.length, 1);

    // Secondary Phone Marketplace & Klick boundary + atomic stock decrement
    const phoneOrder = await api(baseUrl, '/api/v1/phones/orders', {
      method: 'POST',
      token: 'token-cust-1',
      body: {
        phoneProductId: 'phone-iphone-15-128',
        orderKind: 'individual',
        quantity: 2,
        deliveryCity: 'Addis Ababa',
      },
    });
    assert.equal(phoneOrder.status, 201);
    assert.equal(phoneOrder.data.order.klickDeliveryPartnerStatus, 'klick_boundary_pending_onboarding');
  });
});

test('Theme helper resolution preserves preference & zero-secret frontend check', () => {
  assert.equal(THEME_STORAGE_KEY, 'yegna_theme');
  assert.equal(resolveEffectiveTheme('dark', false), 'dark');
  assert.equal(resolveEffectiveTheme('light', true), 'light');
  assert.equal(resolveEffectiveTheme('system', true), 'dark');

  const srcFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) srcFiles.push(p);
    }
  };
  walk(path.resolve(process.cwd(), 'src'));

  for (const file of srcFiles) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes('CHAPA_SECRET_KEY'), `Frontend file ${file} references CHAPA_SECRET_KEY`);
    assert.ok(!text.includes('ESIM_ENCRYPTION_KEY'), `Frontend file ${file} references ESIM_ENCRYPTION_KEY`);
    assert.ok(!text.includes('YENE_ADMIN_EMAILS'), `Frontend file ${file} references YENE_ADMIN_EMAILS`);
  }
});
