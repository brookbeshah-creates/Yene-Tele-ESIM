import express from 'express';
import type { Response, Router } from 'express';
import type {
  AdminRole,
  AgentReviewStatus,
  BusinessAccountRecord,
  BusinessVerificationStatus,
  NumberTier,
  OperatorCode,
  PhoneCategory,
  PhoneCompatibilityStatus,
  PhoneOrderRecord,
  PhoneUnlockStatus,
  StockItemStatus,
  SupplyMethod,
  SupportTicketRecord,
  UserAccountStatus,
} from '../../../src/types/domain.ts';
import { DatabaseConnectionError } from '../../db/pool.ts';
import { createRequireStaffAdmin, type AuthenticatedRequest } from '../auth/authMiddleware.ts';
import { getServerConfig } from '../../config/env.ts';
import type { PaymentExpiryScheduler } from '../jobs/paymentExpiryJob.ts';
import { DomainRuleError, YeneTeleStore } from '../store/yeneStore.ts';

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

function paginate<T>(items: T[], limitParam: unknown, offsetParam: unknown, defaultLimit = 200) {
  const parsedLimit = Number(limitParam);
  const parsedOffset = Number(offsetParam);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : defaultLimit;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  return {
    rows: items.slice(offset, offset + limit),
    pagination: { total: items.length, limit, offset },
  };
}

export function createAdminRouter(
  store: YeneTeleStore,
  requireAuth: (req: AuthenticatedRequest, res: Response, next: () => void) => void,
  scheduler?: PaymentExpiryScheduler,
): Router {
  const router = express.Router();
  const requireStaff = createRequireStaffAdmin(store);
  const requireSuperAdmin = createRequireStaffAdmin(store, ['super_admin']);
  const requireOps = createRequireStaffAdmin(store, ['super_admin', 'operations_staff']);
  const requireAgentSup = createRequireStaffAdmin(store, ['super_admin', 'agent_supervisor', 'operations_staff']);
  const requireFinance = createRequireStaffAdmin(store, ['super_admin', 'finance_staff']);
  const requireOpsOrFinance = createRequireStaffAdmin(store, ['super_admin', 'operations_staff', 'finance_staff']);
  const requireSupport = createRequireStaffAdmin(store, ['super_admin', 'support_staff', 'operations_staff']);

  router.use(requireAuth, requireStaff);

  router.get('/overview', async (_req, res) => {
    try {
      const config = getServerConfig();
      const overview = await store.getAdminOverview();
      res.json({
        ...overview,
        schedulerStatus: scheduler ? scheduler.getStatus() : null,
        environment: {
          envMode: config.envMode,
          databaseConfigured: config.databaseConfigured,
          postgresqlActive: store.isUsingPostgreSql(),
          encryptionKeyPersistent: config.encryptionKeyPersistent,
          chapaConfigured: config.chapaConfigured,
          chapaWebhookSecretConfigured: Boolean(config.chapaWebhookSecret),
          faydaConfigured: config.faydaConfigured,
          klickConfigured: config.klickConfigured,
          ethioTelecomConfigured: config.ethioTelecomConfigured,
          safaricomConfigured: config.safaricomConfigured,
          allowedOriginsConfigured: config.allowedOrigins.length > 0,
        },
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/orders', async (req, res) => {
    try {
      const all = await store.listAllOrdersAdmin();
      const { rows, pagination } = paginate(all, req.query.limit, req.query.offset);
      res.json({ orders: rows, pagination });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/orders/:orderId', async (req, res) => {
    try {
      const detail = await store.getOrderDetailAdmin(String(req.params.orderId));
      res.json(detail);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/manual-fulfillment', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { assignedMsisdn, iccid, smdpAddress, activationCode, partnerReference, isSandboxSimulation } =
        (req.body ?? {}) as {
          assignedMsisdn?: string;
          iccid?: string;
          smdpAddress?: string;
          activationCode?: string;
          partnerReference?: string;
          isSandboxSimulation?: boolean;
        };
      if (!iccid?.trim() || !smdpAddress?.trim() || !activationCode?.trim() || !partnerReference?.trim()) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'ICCID, SM-DP+ address, activation code, and partner reference are required.',
        });
        return;
      }
      const result = await store.completeManualFulfillment(
        String(req.params.orderId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          assignedMsisdn,
          iccid,
          smdpAddress,
          activationCode,
          partnerReference,
          isSandboxSimulation,
        },
      );
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/poll-provisioning', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { forceOutcome } = (req.body ?? {}) as {
        forceOutcome?: 'provisioned' | 'failed' | 'operator_pending';
      };
      const result = await store.pollOrderProvisioning(
        String(req.params.orderId),
        req.staffAdmin!.uid,
        { isStaff: true, forceOutcome },
      );
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/orders/:orderId/action', requireOpsOrFinance, async (req: AuthenticatedRequest, res) => {
    try {
      const { action, reason } = (req.body ?? {}) as {
        action?: 'retry_provisioning' | 'refund' | 'cancel';
        reason?: string;
      };
      if (!action || !reason?.trim()) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'action and reason are required.' });
        return;
      }
      if (action === 'retry_provisioning' && req.staffAdmin!.role === 'finance_staff') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Finance staff cannot trigger provisioning retries.',
        });
        return;
      }
      const order = await store.updateOrderStatusAdmin(
        String(req.params.orderId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        { action, reason },
      );
      res.json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/operators', async (_req, res) => {
    try {
      const [operators, products] = await Promise.all([
        store.listOperators(),
        store.listEsimProducts(),
      ]);
      res.json({ operators, products });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/operators/:code', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const code = String(req.params.code) as OperatorCode;
      const {
        isEnabled,
        integrationStatus,
        activeSupplyMethod,
        supportsSimConversion,
        supportsPrePaymentReservation,
        customerVisibleNote,
        reason,
      } = (req.body ?? {}) as {
        isEnabled?: boolean;
        integrationStatus?: 'sandbox' | 'coming_soon' | 'live';
        activeSupplyMethod?: SupplyMethod;
        supportsSimConversion?: boolean;
        supportsPrePaymentReservation?: boolean;
        customerVisibleNote?: string;
        reason?: string;
      };
      const updated = await store.updateOperatorConfigAdmin(
        code,
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          isEnabled,
          integrationStatus,
          activeSupplyMethod,
          supportsSimConversion,
          supportsPrePaymentReservation,
          customerVisibleNote,
          reason: reason ?? '',
        },
      );
      res.json({ operator: updated });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/products/:productId', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { priceEtb, sandboxPreviewAmountEtb, isActive, reason } = (req.body ?? {}) as {
        priceEtb?: number | null;
        sandboxPreviewAmountEtb?: number | null;
        isActive?: boolean;
        reason?: string;
      };
      const product = await store.updateProductAdmin(
        String(req.params.productId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          priceEtb,
          sandboxPreviewAmountEtb,
          isActive,
          reason: reason ?? '',
        },
      );
      res.json({ product });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/inventory', async (req, res) => {
    try {
      const operatorCode = req.query.operator as OperatorCode | undefined;
      const status = req.query.status as StockItemStatus | undefined;
      const [allItems, batches] = await Promise.all([
        store.listStockItems(operatorCode, status),
        store.listStockBatches(),
      ]);
      const { rows, pagination } = paginate(allItems, req.query.limit, req.query.offset);
      res.json({
        batches,
        items: rows,
        pagination,
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/inventory/import-preview', requireOps, async (req, res) => {
    try {
      const { operatorCode, csvText } = (req.body ?? {}) as {
        operatorCode?: OperatorCode;
        csvText?: string;
      };
      if (!operatorCode || !csvText?.trim()) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'operatorCode and csvText are required.' });
        return;
      }
      const preview = await store.previewCsvStockImport(operatorCode, csvText);
      res.json({ preview });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/inventory/batches', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { operatorCode, batchName, sourceEnvironment, supplierReference, initialStatus, items } =
        (req.body ?? {}) as {
          operatorCode?: OperatorCode;
          batchName?: string;
          sourceEnvironment?: 'sandbox_demo' | 'operator_partner_batch';
          supplierReference?: string;
          initialStatus?: 'imported' | 'available';
          items?: Array<{
            msisdn?: string;
            numberTier?: NumberTier;
            iccid: string;
            eid?: string;
            externalInventoryRef?: string;
            inventoryType?: 'msisdn_profile_bundle' | 'activation_voucher' | 'number_allocation';
            expiresAt?: string | null;
            smdpAddress: string;
            activationCode: string;
          }>;
        };
      if (!operatorCode || !batchName?.trim() || !Array.isArray(items)) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'operatorCode, batchName, and items array are required.',
        });
        return;
      }
      const result = await store.importStockBatch(req.staffAdmin!.uid, req.staffAdmin!.email, {
        operatorCode,
        batchName,
        sourceEnvironment: sourceEnvironment ?? 'sandbox_demo',
        supplierReference,
        initialStatus,
        items,
      });
      res.status(201).json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/inventory/expire-reservations', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const released = await store.expireStaleReservations();
      await store.recordAudit({
        actorType: 'staff_admin',
        actorId: req.staffAdmin!.uid,
        actorEmail: req.staffAdmin!.email,
        action: 'EXPIRE_STALE_RESERVATIONS_RUN',
        targetType: 'inventory',
        targetId: 'all',
        reason: `Released ${released} expired stock reservation(s)`,
      });
      res.json({ releasedCount: released });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/inventory/reconcile', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const report = await store.reconcileStockInventory(req.staffAdmin!.uid, req.staffAdmin!.email);
      res.json({ report });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/inventory/items/:itemId', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { status, reason } = (req.body ?? {}) as {
        status?: Extract<StockItemStatus, 'available' | 'invalid' | 'expired'>;
        reason?: string;
      };
      if (!status || !['available', 'invalid', 'expired'].includes(status)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid status (available, invalid, expired) is required.' });
        return;
      }
      const item = await store.updateStockItemStatusAdmin(
        String(req.params.itemId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        { status, reason: reason ?? '' },
      );
      res.json({ item });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * SCHEDULED PAYMENT & RESERVATION EXPIRY JOBS
   * -------------------------------------------------------------------------- */
  router.get('/jobs/payment-expiry', requireOps, async (_req, res) => {
    try {
      const runs = await store.listScheduledJobRuns('payment_expiry_sweep', 25);
      res.json({
        scheduler: scheduler ? scheduler.getStatus() : null,
        runs,
        observability: store.observability.getSnapshot(),
      });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/jobs/payment-expiry/run', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const sweep = await store.runScheduledPaymentExpirySweep(
        `admin:${req.staffAdmin!.uid}`,
      );
      await store.recordAudit({
        actorType: 'staff_admin',
        actorId: req.staffAdmin!.uid,
        actorEmail: req.staffAdmin!.email,
        action: 'PAYMENT_EXPIRY_SWEEP_TRIGGERED',
        targetType: 'scheduled_job',
        targetId: 'payment_expiry_sweep',
        reason: `Released ${sweep.releasedReservations} reservation(s), expired ${sweep.expiredPayments} payment(s)`,
      });
      res.json({ sweep });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/agents', async (_req, res) => {
    try {
      const [applications, agents] = await Promise.all([
        store.listAllAgentApplicationsAdmin(),
        store.listAllAgentsAdmin(),
      ]);
      res.json({ applications, agents });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/agents/applications/:applicationId/review', requireAgentSup, async (req: AuthenticatedRequest, res) => {
    try {
      const { decision, reviewNotes, ethioTelecomAuthorized, safaricomAuthorized } =
        (req.body ?? {}) as {
          decision?: Extract<AgentReviewStatus, 'approved' | 'rejected' | 'suspended'>;
          reviewNotes?: string;
          ethioTelecomAuthorized?: boolean;
          safaricomAuthorized?: boolean;
        };
      if (!decision || !['approved', 'rejected', 'suspended'].includes(decision)) {
        res.status(400).json({ error: 'INVALID_DECISION', message: 'Decision must be approved, rejected, or suspended.' });
        return;
      }
      const result = await store.reviewAgentApplication(
        String(req.params.applicationId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          decision,
          reviewNotes: reviewNotes ?? '',
          ethioTelecomAuthorized,
          safaricomAuthorized,
        },
      );
      res.json(result);
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/agents/:agentId/payouts', requireFinance, async (req: AuthenticatedRequest, res) => {
    try {
      const { amountEtb, paymentReference, status } = (req.body ?? {}) as {
        amountEtb?: number;
        paymentReference?: string;
        status?: 'scheduled' | 'paid';
      };
      if (!paymentReference?.trim()) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'paymentReference is required.' });
        return;
      }
      const payout = await store.recordAgentPayout(
        String(req.params.agentId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          amountEtb: Number(amountEtb ?? 0),
          paymentReference,
          status: status ?? 'scheduled',
        },
      );
      res.status(201).json({ payout });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/payments', async (req, res) => {
    try {
      const all = await store.listAllPaymentsAdmin();
      const { rows, pagination } = paginate(all, req.query.limit, req.query.offset);
      res.json({ payments: rows, pagination });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/payments/:paymentId/reconcile', requireFinance, async (req: AuthenticatedRequest, res) => {
    try {
      const payment = await store.reconcilePaymentAdmin(
        String(req.params.paymentId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
      );
      res.json({ payment });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/payments/:paymentId/refund', requireFinance, async (req: AuthenticatedRequest, res) => {
    try {
      const { reason } = (req.body ?? {}) as { reason?: string };
      const payment = await store.processRefundAdmin(
        String(req.params.paymentId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        reason ?? '',
      );
      res.json({ payment });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/customers', async (req, res) => {
    try {
      const all = await store.listAllCustomersAdmin();
      const { rows, pagination } = paginate(all, req.query.limit, req.query.offset);
      res.json({ customers: rows, pagination });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/customers/:uid/status', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { status, reason } = (req.body ?? {}) as {
        status?: UserAccountStatus;
        reason?: string;
      };
      if (!status || !['active', 'suspended', 'disabled'].includes(status)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid status (active, suspended, disabled) required.' });
        return;
      }
      const customer = await store.updateCustomerAccountStatusAdmin(
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        String(req.params.uid),
        { status, reason: reason ?? '' },
      );
      res.json({ customer });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * STAFF ADMIN ROLE MANAGEMENT (SUPER ADMIN ONLY)
   * -------------------------------------------------------------------------- */
  router.get('/staff', requireSuperAdmin, async (_req, res) => {
    try {
      res.json({ staff: await store.listStaffAdmins() });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/staff', requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const { email, role, displayName } = (req.body ?? {}) as {
        email?: string;
        role?: AdminRole;
        displayName?: string;
      };
      if (!email || !role) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'email and role are required.' });
        return;
      }
      const staff = await store.grantStaffAdminByEmail(req.staffAdmin!.uid, req.staffAdmin!.email, {
        email,
        role,
        displayName,
      });
      res.status(201).json({ staff });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/staff/:uid', requireSuperAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const { role, active } = (req.body ?? {}) as { role?: AdminRole; active?: boolean };
      const staff = await store.updateStaffAdminRole(
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        String(req.params.uid),
        { role, active },
      );
      res.json({ staff });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  /* --------------------------------------------------------------------------
   * BUSINESS CUSTOMER ACCOUNTS REVIEW (ADMIN OPS)
   * -------------------------------------------------------------------------- */
  router.get('/businesses', async (_req, res) => {
    try {
      res.json(await store.listAllBusinessesAdmin());
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/businesses/:businessId/review', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { verificationStatus, pricingTermsStatus, commercialNotes } = (req.body ?? {}) as {
        verificationStatus?: BusinessVerificationStatus;
        pricingTermsStatus?: BusinessAccountRecord['pricingTermsStatus'];
        commercialNotes?: string;
      };
      if (!verificationStatus || !['pending_review', 'verified', 'suspended'].includes(verificationStatus)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid verificationStatus is required.' });
        return;
      }
      const account = await store.reviewBusinessAccountAdmin(
        String(req.params.businessId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        { verificationStatus, pricingTermsStatus, commercialNotes },
      );
      res.json({ account });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/phones', async (_req, res) => {
    try {
      const [products, orders] = await Promise.all([
        store.listAllPhoneProductsAdmin(),
        store.listAllPhoneOrdersAdmin(),
      ]);
      res.json({ products, orders });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.post('/phones', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const body = (req.body ?? {}) as {
        brand?: string;
        category?: PhoneCategory;
        model?: string;
        exactModelNumber?: string;
        regionalVariant?: string;
        storage?: string;
        condition?: string;
        warrantySummary?: string;
        esimCompatibilityStatus?: PhoneCompatibilityStatus;
        networkUnlockStatus?: PhoneUnlockStatus;
        ethioTelecomCompatibility?: 'verified' | 'not_compatible' | 'unverified';
        safaricomCompatibility?: 'verified' | 'not_compatible' | 'unverified';
        compatibilityNotes?: string;
        compatibilityEvidence?: string | null;
        imageKey?: string | null;
        imageUrl?: string | null;
        isFeatured?: boolean;
        unitPriceEtb?: number | null;
        sandboxPreviewPriceEtb?: number | null;
        stockQty?: number;
        bulkMinimumQty?: number;
        supportsBulkOrder?: boolean;
        isActive?: boolean;
        reason?: string;
      };
      if (body.unitPriceEtb !== undefined && body.unitPriceEtb !== null && req.staffAdmin!.role !== 'super_admin') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only Super Admin may publish official commercial ETB phone pricing.',
        });
        return;
      }
      const product = await store.createPhoneProductAdmin(req.staffAdmin!.uid, req.staffAdmin!.email, {
        brand: body.brand ?? '',
        category: body.category ?? 'other',
        model: body.model ?? '',
        exactModelNumber: body.exactModelNumber ?? '',
        regionalVariant: body.regionalVariant ?? 'Global Variant',
        storage: body.storage ?? '',
        condition: body.condition ?? 'Brand New · Sealed',
        warrantySummary: body.warrantySummary ?? '1-Year Standard Seller Warranty',
        esimCompatibilityStatus: body.esimCompatibilityStatus ?? 'needs_verification',
        networkUnlockStatus: body.networkUnlockStatus ?? 'needs_verification',
        ethioTelecomCompatibility: body.ethioTelecomCompatibility ?? 'unverified',
        safaricomCompatibility: body.safaricomCompatibility ?? 'unverified',
        compatibilityNotes: body.compatibilityNotes ?? '',
        compatibilityEvidence: body.compatibilityEvidence ?? null,
        imageKey: body.imageKey ?? null,
        imageUrl: body.imageUrl ?? null,
        isFeatured: body.isFeatured,
        unitPriceEtb: body.unitPriceEtb,
        sandboxPreviewPriceEtb: body.sandboxPreviewPriceEtb,
        stockQty: Number(body.stockQty ?? 0),
        bulkMinimumQty: body.bulkMinimumQty,
        supportsBulkOrder: body.supportsBulkOrder,
        isActive: body.isActive,
        reason: body.reason ?? '',
      });
      res.status(201).json({ product });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/phones/:phoneId', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (body.unitPriceEtb !== undefined && req.staffAdmin!.role !== 'super_admin') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only Super Admin may modify official commercial ETB phone pricing.',
        });
        return;
      }
      const product = await store.updatePhoneProductAdmin(
        String(req.params.phoneId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        {
          ...(body as Record<string, never>),
          reason: typeof body.reason === 'string' ? body.reason : '',
        },
      );
      res.json({ product });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/phones/orders/:phoneOrderId', requireOps, async (req: AuthenticatedRequest, res) => {
    try {
      const { fulfillmentStatus, klickDeliveryPartnerStatus } = (req.body ?? {}) as {
        fulfillmentStatus?: PhoneOrderRecord['fulfillmentStatus'];
        klickDeliveryPartnerStatus?: PhoneOrderRecord['klickDeliveryPartnerStatus'];
      };
      const order = await store.updatePhoneOrderStatusAdmin(
        String(req.params.phoneOrderId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        { fulfillmentStatus, klickDeliveryPartnerStatus },
      );
      res.json({ order });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/support', async (_req, res) => {
    try {
      res.json({ tickets: await store.listAllSupportTicketsAdmin() });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.patch('/support/:ticketId', requireSupport, async (req: AuthenticatedRequest, res) => {
    try {
      const { status, adminResponse } = (req.body ?? {}) as {
        status?: SupportTicketRecord['status'];
        adminResponse?: string;
      };
      const ticket = await store.updateSupportTicketAdmin(
        String(req.params.ticketId),
        req.staffAdmin!.uid,
        req.staffAdmin!.email,
        { status: status ?? 'in_review', adminResponse: adminResponse ?? '' },
      );
      res.json({ ticket });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  router.get('/audit-logs', async (req, res) => {
    try {
      const all = await store.listAuditLogs(500);
      const { rows, pagination } = paginate(all, req.query.limit, req.query.offset, 120);
      res.json({ logs: rows, pagination });
    } catch (err) {
      handleError(res, err, store);
    }
  });

  return router;
}
