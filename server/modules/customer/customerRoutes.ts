import express from 'express';
import type { Request, Response, Router } from 'express';
import type {
  BusinessMemberRole,
  NumberTier,
  OperatorCode,
  PhoneCategory,
  PhoneCompatibilityStatus,
} from '../../../src/types/domain.ts';
import { DatabaseConnectionError } from '../../db/pool.ts';
import type { AuthenticatedRequest } from '../auth/authMiddleware.ts';
import { DomainRuleError, YeneTeleStore } from '../store/yeneStore.ts';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

function handleError(res: Response, err: unknown, store: YeneTeleStore): void {
  if (err instanceof DomainRuleError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof DatabaseConnectionError) {
    store.observability.recordDbHealth(false, null, true, 'DATABASE_UNAVAILABLE');
    res.status(503).json({
      error: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable. Please retry shortly.',
    });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
}

export function createCustomerRouter(
  store: YeneTeleStore,
  requireAuth: (req: AuthenticatedRequest, res: Response, next: () => void) => void,
): Router {
  const router = express.Router();

  /* --------------------------------------------------------------------------
   * PUBLIC DISCOVERY ENDPOINTS (No auth required)
   * -------------------------------------------------------------------------- */
  router.get('/operators', async (_req, res) => {
    try {
      res.json({ operators: await store.listOperators() });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/products', async (_req, res) => {
    try {
      res.json({ products: await store.listEsimProducts() });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/devices/compatibility', (req, res) => {
    const query = String(req.query.q ?? '').trim().toLowerCase();
    const os = String(req.query.os ?? '').trim().toLowerCase();
    let devices = store.listDevices();
    if (os === 'ios' || os === 'android') {
      devices = devices.filter((d) => d.osPlatform === os);
    }
    if (query) {
      devices = devices.filter(
        (d) =>
          d.brand.toLowerCase().includes(query) ||
          d.modelFamily.toLowerCase().includes(query) ||
          d.regionalCaveat.toLowerCase().includes(query),
      );
    }
    res.json({ devices });
  });

  router.get('/numbers/available', async (req, res) => {
    try {
      const operatorCode = req.query.operator as OperatorCode | undefined;
      const query = req.query.q ? String(req.query.q) : undefined;
      const tier = req.query.tier ? (String(req.query.tier) as NumberTier) : undefined;
      // Routed through operator-aware discovery — never exposes encrypted credentials or internal ICCIDs
      const numbers = await store.listAvailableNumbersForDiscovery({ operatorCode, query, tier });
      res.json({ numbers });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/phones', async (req, res) => {
    try {
      const category = req.query.category ? (String(req.query.category) as PhoneCategory) : undefined;
      const q = req.query.q ? String(req.query.q) : undefined;
      const compatibility = req.query.compatibility
        ? (String(req.query.compatibility) as PhoneCompatibilityStatus)
        : undefined;
      const unlockedOnly = req.query.unlockedOnly === 'true';
      res.json({
        phones: await store.listPhoneProducts({ category, q, compatibility, unlockedOnly }),
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/phones/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ orders: await store.listPhoneOrdersForUser(req.identity!.uid) });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/phones/:phoneId', async (req, res) => {
    try {
      const phone = await store.getPhoneProductById(String(req.params.phoneId));
      res.json({ phone });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/support/inquiries', async (req: AuthenticatedRequest, res) => {
    try {
      const { email, subject, category, orderId, message } = (req.body ?? {}) as {
        email?: string;
        subject?: string;
        category?: 'esim_setup' | 'fayda_kyc' | 'payment' | 'agent_programme' | 'phone_order' | 'general';
        orderId?: string;
        message?: string;
      };
      if (!email?.trim() || !subject?.trim() || !message?.trim()) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Email, subject, and message are required.',
        });
        return;
      }
      const ticket = await store.createSupportTicket({
        userId: req.identity?.uid ?? null,
        email,
        subject,
        category: category ?? 'general',
        orderId: orderId ?? null,
        message,
      });
      res.status(201).json({ ticket });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * CHAPA WEBHOOK (HMAC Signature Verified + Idempotent)
   * -------------------------------------------------------------------------- */
  router.post('/payments/chapa/webhook', async (req: RawBodyRequest, res: Response) => {
    try {
      const sig =
        (req.headers['x-chapa-signature'] as string | undefined) ??
        (req.headers['chapa-signature'] as string | undefined);
      const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
      if (!store.chapaAdapter.verifyWebhookSignature(rawBody, sig)) {
        store.observability.recordWebhookFailure('INVALID_WEBHOOK_SIGNATURE');
        await store.recordAudit({
          actorType: 'system',
          actorId: 'chapa-webhook',
          action: 'CHAPA_WEBHOOK_INVALID_SIGNATURE',
          targetType: 'payment',
          targetId: 'unknown',
          reason: 'Rejected webhook due to missing or invalid HMAC-SHA256 signature',
        });
        res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE', message: 'Invalid signature.' });
        return;
      }

      const { tx_ref: txRef, orderId, eventId, status } = (req.body ?? {}) as {
        tx_ref?: string;
        orderId?: string;
        eventId?: string;
        status?: string;
      };
      if (!txRef) {
        res.status(400).json({ error: 'MISSING_FIELDS', message: 'tx_ref is required.' });
        return;
      }

      const result = await store.processChapaWebhookEvent({
        txRef,
        orderId,
        eventId,
        status: status ?? 'success',
      });
      res.json({
        received: true,
        deduplicated: result.deduplicated,
        orderStatus: result.orderStatus,
        paymentStatus: result.paymentStatus,
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * AUTHENTICATED CUSTOMER ROUTES
   * -------------------------------------------------------------------------- */
  router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.identity!.uid;
      const [user, admin, agentApp, agentProfile] = await Promise.all([
        store.getUser(uid),
        store.getStaffAdmin(uid),
        store.getAgentApplicationForUser(uid),
        store.getAnyAgentProfileByUserId(uid),
      ]);

      res.json({
        user,
        isStaffAdmin: Boolean(admin),
        adminRole: admin?.role ?? null,
        agentStatus: agentProfile?.status ?? agentApp?.status ?? 'none',
        agentProfile: agentProfile ?? null,
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { displayName, preferredLanguage, phoneNumber } = (req.body ?? {}) as {
        displayName?: string;
        preferredLanguage?: 'en' | 'am';
        phoneNumber?: string | null;
      };
      const user = await store.updateUserPreferences(req.identity!.uid, {
        displayName,
        preferredLanguage,
        phoneNumber,
      });
      res.json({ user });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ orders: await store.listOrdersForUser(req.identity!.uid) });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/orders/:orderId', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const detail = await store.getOrderDetailForUser(String(req.params.orderId), req.identity!.uid);
      res.json(detail);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const {
        operatorCode,
        productId,
        deviceModel,
        deviceOs,
        deviceVerified,
        agentReferralCode,
        idempotencyKey,
        existingMsisdn,
      } = (req.body ?? {}) as {
        operatorCode?: OperatorCode;
        productId?: string;
        deviceModel?: string;
        deviceOs?: 'ios' | 'android';
        deviceVerified?: boolean;
        agentReferralCode?: string | null;
        idempotencyKey?: string | null;
        existingMsisdn?: string | null;
      };
      if (!operatorCode || !productId) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'operatorCode and productId are required.' });
        return;
      }
      const order = await store.createDraftOrder(req.identity!.uid, {
        operatorCode,
        productId,
        deviceModel,
        deviceOs,
        deviceVerified,
        agentReferralCode,
        idempotencyKey,
        existingMsisdn,
      });
      res.status(201).json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/kyc', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { fullName, faydaFanReference, contactPhone, consentGiven, submittedByAgentAttempt } =
        (req.body ?? {}) as {
          fullName?: string;
          faydaFanReference?: string;
          contactPhone?: string;
          consentGiven?: boolean;
          submittedByAgentAttempt?: boolean;
        };

      const result = await store.submitOrderKyc(String(req.params.orderId), req.identity!.uid, {
        fullName: fullName ?? '',
        faydaFanReference: faydaFanReference ?? '',
        contactPhone: contactPhone ?? '',
        consentGiven: Boolean(consentGiven),
        submittedByAgentAttempt: Boolean(submittedByAgentAttempt),
      });
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/reserve-number', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { stockItemId, preferredTier, requestedPhone } = (req.body ?? {}) as {
        stockItemId?: string | null;
        preferredTier?: NumberTier;
        requestedPhone?: string;
      };
      const order = await store.reserveNumberForOrder(String(req.params.orderId), req.identity!.uid, {
        stockItemId,
        preferredTier,
        requestedPhone,
      });
      res.json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { returnUrl, idempotencyKey } = (req.body ?? {}) as {
        returnUrl?: string;
        idempotencyKey?: string;
      };
      const result = await store.initChapaPaymentForOrder(
        String(req.params.orderId),
        req.identity!.uid,
        req.identity!.email,
        returnUrl ?? '/buy-esim',
        idempotencyKey,
      );
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/verify-payment', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { txRef, simulatePaymentFailure, sandboxBehavior } = (req.body ?? {}) as {
        txRef?: string;
        simulatePaymentFailure?: boolean;
        sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck';
      };
      if (!txRef?.trim()) {
        res.status(400).json({ error: 'MISSING_TX_REF', message: 'Chapa txRef is required.' });
        return;
      }
      const result = await store.verifyPaymentAndFulfillOrder(String(req.params.orderId), txRef.trim(), {
        actorUserId: req.identity!.uid,
        simulatePaymentFailure: Boolean(simulatePaymentFailure),
        sandboxBehavior,
      });
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/poll-provisioning', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { forceOutcome } = (req.body ?? {}) as {
        forceOutcome?: 'provisioned' | 'failed' | 'operator_pending';
      };
      const result = await store.pollOrderProvisioning(String(req.params.orderId), req.identity!.uid, {
        forceOutcome,
      });
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/cancel', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { reason } = (req.body ?? {}) as { reason?: string };
      const order = await store.cancelOrderForUser(
        String(req.params.orderId),
        req.identity!.uid,
        reason?.trim() || 'Cancelled by customer',
      );
      res.json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/esims', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ esims: await store.listEsimsForUser(req.identity!.uid) });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/esims/:esimId/activation', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const activation = await store.getDecryptedActivationForUser(
        String(req.params.esimId),
        req.identity!.uid,
      );
      res.json({ activation });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/esims/:esimId/mark-installed', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const esim = await store.markEsimInstalled(String(req.params.esimId), req.identity!.uid);
      res.json({ esim });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/esims/:esimId/mark-activated', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const esim = await store.markEsimActivated(String(req.params.esimId), req.identity!.uid);
      res.json({ esim });
    } catch (err) {
      handleError(res, err, store);
    }
  });


  router.post('/phones/orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const {
        phoneProductId,
        orderKind,
        quantity,
        companyName,
        contactPhone,
        deliveryCity,
        deliveryAddress,
        deliveryNotes,
        pairedEsimOperator,
        agentReferralCode,
      } = (req.body ?? {}) as {
        phoneProductId?: string;
        orderKind?: 'individual' | 'bulk_business';
        quantity?: number;
        companyName?: string;
        contactPhone?: string;
        deliveryCity?: string;
        deliveryAddress?: string;
        deliveryNotes?: string;
        pairedEsimOperator?: OperatorCode | null;
        agentReferralCode?: string | null;
      };
      if (!phoneProductId || !deliveryCity?.trim()) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'phoneProductId and deliveryCity are required.',
        });
        return;
      }
      const order = await store.createPhoneOrder(req.identity!.uid, {
        phoneProductId,
        orderKind: orderKind ?? 'individual',
        quantity: Number(quantity ?? 1),
        companyName,
        contactPhone,
        deliveryCity,
        deliveryAddress,
        deliveryNotes,
        pairedEsimOperator,
        agentReferralCode,
      });
      res.status(201).json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/phones/orders/:phoneOrderId/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { returnUrl } = (req.body ?? {}) as { returnUrl?: string };
      const result = await store.initChapaPaymentForPhoneOrder(
        String(req.params.phoneOrderId),
        req.identity!.uid,
        req.identity!.email,
        returnUrl ?? '/phones',
      );
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/phones/orders/:phoneOrderId/verify-payment', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { txRef, simulatePaymentFailure } = (req.body ?? {}) as {
        txRef?: string;
        simulatePaymentFailure?: boolean;
      };
      if (!txRef?.trim()) {
        res.status(400).json({ error: 'MISSING_TX_REF', message: 'Chapa txRef is required.' });
        return;
      }
      const result = await store.verifyPaymentAndConfirmPhoneOrder(
        String(req.params.phoneOrderId),
        req.identity!.uid,
        txRef.trim(),
        { simulatePaymentFailure: Boolean(simulatePaymentFailure) },
      );
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/support/my-tickets', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json({ tickets: await store.listSupportTicketsForUser(req.identity!.uid) });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * BUSINESS CUSTOMER ACCOUNT & BULK eSIM PREPARATION ROUTES
   * -------------------------------------------------------------------------- */
  router.get('/business', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      res.json(await store.getBusinessPortalForUser(req.identity!.uid, req.identity!.email));
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/business/profile', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { companyName, tinNumber, contactEmail, contactPhone, city } = (req.body ?? {}) as {
        companyName?: string;
        tinNumber?: string;
        contactEmail?: string;
        contactPhone?: string;
        city?: string;
      };
      const account = await store.upsertBusinessAccountForUser(req.identity!.uid, req.identity!.email, {
        companyName: companyName ?? '',
        tinNumber: tinNumber ?? '',
        contactEmail: contactEmail ?? req.identity!.email ?? '',
        contactPhone: contactPhone ?? '',
        city: city ?? '',
      });
      res.status(201).json({ account });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/business/members', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { email, fullName, role } = (req.body ?? {}) as {
        email?: string;
        fullName?: string;
        role?: BusinessMemberRole;
      };
      const member = await store.addBusinessMemberForUser(req.identity!.uid, req.identity!.email, {
        email: email ?? '',
        fullName: fullName ?? '',
        role: role ?? 'buyer',
      });
      res.status(201).json({ member });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/business/bulk-orders', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { operatorCode, serviceType, quantity, preferredTier, departmentNote } = (req.body ?? {}) as {
        operatorCode?: OperatorCode;
        serviceType?: 'new_esim_line' | 'sim_to_esim_conversion';
        quantity?: number;
        preferredTier?: NumberTier;
        departmentNote?: string;
      };
      if (!operatorCode) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'operatorCode is required.' });
        return;
      }
      const bulkOrder = await store.createBusinessBulkOrderForUser(req.identity!.uid, req.identity!.email, {
        operatorCode,
        serviceType: serviceType ?? 'new_esim_line',
        quantity: Number(quantity ?? 0),
        preferredTier,
        departmentNote,
      });
      res.status(201).json({ bulkOrder });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  return router;
}
