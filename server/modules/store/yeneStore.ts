import crypto from 'node:crypto';
import type {
  AdminRole,
  AgentApplicationRecord,
  AgentCommissionRecord,
  AgentPayoutRecord,
  AgentProfileRecord,
  AgentReviewStatus,
  AuditLogRecord,
  BusinessAccountRecord,
  BusinessBulkOrderRecord,
  BusinessMemberRecord,
  BusinessMemberRole,
  BusinessVerificationStatus,
  CsvStockImportPreviewResult,
  CsvStockImportRowPreview,
  CustomerEsimRecord,
  DeviceCompatibilityRecord,
  EnvironmentMode,
  EsimActivationSecretView,
  EsimOrderRecord,
  EsimProductRecord,
  EsimStockBatchRecord,
  EsimStockItemRecord,
  KycVerificationRecord,
  NumberTier,
  OperatorCode,
  OperatorConfigRecord,
  OrderStatus,
  PaymentRecord,
  PhoneCategory,
  PhoneCompatibilityStatus,
  PhoneOrderRecord,
  PhoneProductRecord,
  PhoneUnlockStatus,
  PublicNumberOption,
  StaffAdminSummary,
  StockItemStatus,
  SupplyMethod,
  SupportTicketRecord,
  UserAccountStatus,
  VerifiedUserSummary,
} from '../../../src/types/domain.ts';
import { DomainRuleError } from '../../lib/errors.ts';
import { ObservabilityTracker, type ScheduledJobRunRecord } from '../../lib/observability.ts';
import {
  buildSeedDeviceCompatibility,
  buildSeedEsimProducts,
  buildSeedOperatorConfigs,
  buildSeedPhoneProducts,
  DirectOperatorApiAdapter,
  ManualPartnerProcessingAdapter,
  StockSupplyAdapter,
} from '../adapters/operatorAdapter.ts';
import type { VerifiedIdentity } from '../auth/firebaseVerifier.ts';
import { decryptActivationPayload, encryptActivationPayload } from '../delivery/esimVault.ts';
import { FaydaIdentityAdapter } from '../kyc/faydaAdapter.ts';
import { ChapaPaymentAdapter } from '../payments/chapaAdapter.ts';
import { inferOperatorFromEthiopianPhone, normalizeEthiopianPhone } from '../rbac/permissions.ts';
import { InMemoryPersistenceBackend } from './inMemoryBackend.ts';
import type {
  InternalActivationVault,
  InternalStockCredential,
  StaffAdminRecord,
  YenePersistenceBackend,
} from './persistenceBackend.ts';

export { DomainRuleError } from '../../lib/errors.ts';
export type { StaffAdminRecord } from './persistenceBackend.ts';

function makeOrderNumber(prefix: string): string {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${rand}`;
}

function hasCsvFormulaPrefix(value: string, allowLeadingPlus = false): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const first = trimmed[0];
  if (first === '=' || first === '@' || first === '\t' || first === '\r') {
    return true;
  }
  if (first === '-' || (first === '+' && !allowLeadingPlus)) {
    return true;
  }
  return false;
}

function maskIccid(iccid: string | null): string {
  if (!iccid) return 'pending';
  return iccid.length > 8 ? `${iccid.slice(0, 6)}...${iccid.slice(-4)}` : iccid;
}

export class YeneTeleStore {
  private readonly devices: DeviceCompatibilityRecord[] = buildSeedDeviceCompatibility();
  private readonly operatorConfigCache = new Map<OperatorCode, OperatorConfigRecord>();
  private readonly stockAdapter = new StockSupplyAdapter();
  private readonly manualAdapter = new ManualPartnerProcessingAdapter();
  private readonly directApiAdapter: DirectOperatorApiAdapter;
  private readonly faydaAdapter: FaydaIdentityAdapter;
  public readonly chapaAdapter: ChapaPaymentAdapter;
  public readonly envMode: EnvironmentMode;
  public readonly observability: ObservabilityTracker;
  private readonly adminEmails: Set<string>;
  private readonly encryptionKey: Buffer;
  private readonly backend: YenePersistenceBackend;
  private readonly paymentTimeoutMinutes: number;
  private readonly inFlightPaymentVerifications = new Map<
    string,
    Promise<{ order: EsimOrderRecord; payment: PaymentRecord; esim: CustomerEsimRecord | null; deduplicated: boolean }>
  >();
  private readonly inFlightRefunds = new Map<string, Promise<PaymentRecord>>();

  constructor(
    adminEmails: Set<string>,
    encryptionKey: Buffer,
    options?: {
      envMode?: EnvironmentMode;
      chapaSecretKey?: string | null;
      chapaWebhookSecret?: string | null;
      chapaCallbackUrl?: string | null;
      appUrl?: string | null;
      faydaConfigured?: boolean;
      paymentTimeoutMinutes?: number;
      chapaFetchImpl?: typeof fetch;
      observability?: ObservabilityTracker;
      persistence?: YenePersistenceBackend | null;
    },
  ) {
    this.adminEmails = adminEmails;
    this.encryptionKey = encryptionKey;
    this.envMode = options?.envMode ?? 'sandbox';
    this.backend = options?.persistence ?? new InMemoryPersistenceBackend();
    this.observability = options?.observability ?? new ObservabilityTracker();
    this.paymentTimeoutMinutes = options?.paymentTimeoutMinutes ?? 30;

    for (const op of buildSeedOperatorConfigs()) {
      this.operatorConfigCache.set(op.operatorCode, op);
    }

    this.directApiAdapter = new DirectOperatorApiAdapter(this.operatorConfigCache);
    this.chapaAdapter = new ChapaPaymentAdapter(
      options?.chapaSecretKey ?? null,
      options?.chapaWebhookSecret ?? null,
      {
        allowSandbox: this.envMode !== 'production',
        appUrl: options?.appUrl ?? null,
        callbackUrl: options?.chapaCallbackUrl ?? null,
        fetchImpl: options?.chapaFetchImpl,
      },
    );
    this.faydaAdapter = new FaydaIdentityAdapter(Boolean(options?.faydaConfigured));

    if (!this.backend.isPostgreSql) {
      // In-memory backend seeds synchronously before its resolved promise returns
      void this.ensureCatalogSeeded();
    }
  }

  public isUsingPostgreSql(): boolean {
    return this.backend.isPostgreSql;
  }

  public async ensureCatalogSeeded(): Promise<void> {
    const operators = buildSeedOperatorConfigs();
    const esimProducts = buildSeedEsimProducts();
    const phoneProducts = buildSeedPhoneProducts();
    const sandboxBatches =
      this.envMode !== 'production' ? this.buildSandboxSeedBatches() : undefined;

    await this.backend.ensureSeedCatalog({
      operators,
      esimProducts,
      phoneProducts,
      sandboxBatches,
    });
    await this.syncOperatorCache();
  }

  private async syncOperatorCache(): Promise<OperatorConfigRecord[]> {
    const ops = await this.backend.listOperators();
    for (const op of ops) {
      this.operatorConfigCache.set(op.operatorCode, op);
    }
    return ops;
  }

  private buildSandboxSeedBatches(): Array<{
    batch: EsimStockBatchRecord;
    items: EsimStockItemRecord[];
    secrets: InternalStockCredential[];
  }> {
    const now = new Date().toISOString();
    const ethioBatchId = 'batch-sandbox-ethio-01';
    const safariBatchId = 'batch-sandbox-safari-01';

    const ethioItems: EsimStockItemRecord[] = [];
    const ethioSecrets: InternalStockCredential[] = [];
    const ethioTiers: NumberTier[] = ['standard', 'standard', 'bronze', 'silver', 'gold', 'platinum'];
    for (let i = 0; i < ethioTiers.length; i += 1) {
      const idx = 101 + i;
      const id = `stk-ethio-${idx}`;
      const smdp = 'sandbox-smdp.ethiotelecom.yene.invalid';
      const activationCode = `ET-SANDBOX-${idx}-ALPHA`;
      const lpaUri = `LPA:1$${smdp}$${activationCode}`;
      const encrypted = encryptActivationPayload(
        { smdpAddress: smdp, activationCode, lpaUri, qrPayload: lpaUri },
        this.encryptionKey,
      );
      ethioItems.push({
        id,
        batchId: ethioBatchId,
        operatorCode: 'ethio_telecom',
        msisdn: `+251900000${idx}`,
        numberTier: ethioTiers[i],
        iccid: `8925101000000000${idx}`,
        eid: null,
        externalInventoryRef: `ET-SBX-REF-${idx}`,
        inventoryType: 'msisdn_profile_bundle',
        status: 'available',
        reservedOrderId: null,
        reservedUntil: null,
        soldOrderId: null,
        sourceEnvironment: 'sandbox_demo',
        importedAt: now,
        expiresAt: null,
        auditHistory: [
          { action: 'IMPORTED', actor: 'system-seed', note: 'Seeded sandbox evaluation stock', at: now },
        ],
        createdAt: now,
      });
      ethioSecrets.push({
        stockItemId: id,
        smdpAddress: smdp,
        activationCode,
        lpaUri,
        qrPayload: lpaUri,
        encryptedCredentials: encrypted,
      });
    }

    const safariItems: EsimStockItemRecord[] = [];
    const safariSecrets: InternalStockCredential[] = [];
    const safariTiers: NumberTier[] = ['standard', 'bronze', 'silver', 'gold'];
    for (let i = 0; i < safariTiers.length; i += 1) {
      const idx = 201 + i;
      const id = `stk-safari-${idx}`;
      const smdp = 'sandbox-smdp.safaricom.yene.invalid';
      const activationCode = `SF-SANDBOX-${idx}-BETA`;
      const lpaUri = `LPA:1$${smdp}$${activationCode}`;
      const encrypted = encryptActivationPayload(
        { smdpAddress: smdp, activationCode, lpaUri, qrPayload: lpaUri },
        this.encryptionKey,
      );
      safariItems.push({
        id,
        batchId: safariBatchId,
        operatorCode: 'safaricom_ethiopia',
        msisdn: `+251700000${idx}`,
        numberTier: safariTiers[i],
        iccid: `8925102000000000${idx}`,
        eid: null,
        externalInventoryRef: `SF-SBX-REF-${idx}`,
        inventoryType: 'msisdn_profile_bundle',
        status: 'available',
        reservedOrderId: null,
        reservedUntil: null,
        soldOrderId: null,
        sourceEnvironment: 'sandbox_demo',
        importedAt: now,
        expiresAt: null,
        auditHistory: [
          { action: 'IMPORTED', actor: 'system-seed', note: 'Seeded sandbox evaluation stock', at: now },
        ],
        createdAt: now,
      });
      safariSecrets.push({
        stockItemId: id,
        smdpAddress: smdp,
        activationCode,
        lpaUri,
        qrPayload: lpaUri,
        encryptedCredentials: encrypted,
      });
    }

    return [
      {
        batch: {
          id: ethioBatchId,
          operatorCode: 'ethio_telecom',
          batchName: 'Ethio telecom Sandbox Evaluation Stock',
          sourceEnvironment: 'sandbox_demo',
          supplierReference: 'SANDBOX-SEED-ETHIO',
          totalCount: ethioItems.length,
          availableCount: ethioItems.length,
          importedBy: 'system-seed',
          createdAt: now,
        },
        items: ethioItems,
        secrets: ethioSecrets,
      },
      {
        batch: {
          id: safariBatchId,
          operatorCode: 'safaricom_ethiopia',
          batchName: 'Safaricom Ethiopia Sandbox Evaluation Stock',
          sourceEnvironment: 'sandbox_demo',
          supplierReference: 'SANDBOX-SEED-SAFARICOM',
          totalCount: safariItems.length,
          availableCount: safariItems.length,
          importedBy: 'system-seed',
          createdAt: now,
        },
        items: safariItems,
        secrets: safariSecrets,
      },
    ];
  }

  public async recordAudit(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>): Promise<AuditLogRecord> {
    const log: AuditLogRecord = {
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    await this.backend.recordAudit(log);
    return log;
  }

  private buildAudit(entry: Omit<AuditLogRecord, 'id' | 'createdAt'>): AuditLogRecord {
    return {
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      ...entry,
    };
  }

  /* --------------------------------------------------------------------------
   * AUTHENTICATION, USERS & STAFF ADMINS
   * -------------------------------------------------------------------------- */
  public async upsertAuthenticatedUser(identity: VerifiedIdentity): Promise<VerifiedUserSummary> {
    const now = new Date().toISOString();
    const normalizedEmail = identity.email?.trim().toLowerCase() ?? null;
    const isEnvAllowlistedAdmin = Boolean(
      identity.emailVerified && normalizedEmail && this.adminEmails.has(normalizedEmail),
    );

    const autoGrantAdmin: StaffAdminRecord | null = isEnvAllowlistedAdmin
      ? {
          uid: identity.uid,
          email: normalizedEmail!,
          displayName: identity.name ?? null,
          role: 'super_admin',
          active: true,
          source: 'env_allowlist',
          grantedAt: now,
        }
      : null;

    const result = await this.backend.upsertAuthenticatedUserTx({
      user: {
        uid: identity.uid,
        email: normalizedEmail,
        displayName: identity.name ?? null,
        emailVerified: identity.emailVerified,
        preferredLanguage: 'en',
        phoneNumber: null,
        accountStatus: 'active',
        suspendedReason: null,
        createdAt: now,
        lastLoginAt: now,
      },
      autoGrantAdmin,
      auditEntry: autoGrantAdmin
        ? this.buildAudit({
            actorType: 'system',
            actorId: 'system',
            action: 'STAFF_ADMIN_SYNCED',
            targetType: 'staff_admin',
            targetId: identity.uid,
            reason: 'Email matched YENE_ADMIN_EMAILS configuration',
          })
        : null,
    });

    if (result.promotedFromInvite) {
      await this.recordAudit({
        actorType: 'system',
        actorId: 'system',
        action: 'STAFF_ADMIN_INVITE_PROMOTED',
        targetType: 'staff_admin',
        targetId: identity.uid,
        reason: 'Verified email matched pre-provisioned staff admin invite',
      });
    }

    return result.user;
  }

  public async updateUserPreferences(
    uid: string,
    patch: { displayName?: string; preferredLanguage?: 'en' | 'am'; phoneNumber?: string | null },
  ): Promise<VerifiedUserSummary> {
    const updated = await this.backend.updateUserPreferences(uid, patch);
    if (!updated) {
      throw new DomainRuleError(404, 'USER_NOT_FOUND', 'Customer account not found.');
    }
    return updated;
  }

  public async getUser(uid: string): Promise<VerifiedUserSummary | null> {
    return this.backend.getUser(uid);
  }

  public async getStaffAdmin(uid: string): Promise<StaffAdminRecord | null> {
    return this.backend.getStaffAdmin(uid);
  }

  public async listStaffAdmins(): Promise<StaffAdminSummary[]> {
    return this.backend.listStaffAdmins();
  }

  public async grantStaffAdmin(
    uid: string,
    email: string,
    role: AdminRole,
    displayName: string | null = null,
  ): Promise<StaffAdminRecord> {
    const record: StaffAdminRecord = {
      uid,
      email: email.trim().toLowerCase(),
      displayName,
      role,
      active: true,
      source: 'admin_grant',
      grantedAt: new Date().toISOString(),
    };
    await this.backend.grantStaffAdminDirect(record, 'admin_grant');
    return record;
  }

  public async grantStaffAdminByEmail(
    actorUid: string,
    actorEmail: string | null,
    input: { email: string; role: AdminRole; displayName?: string | null },
  ): Promise<StaffAdminSummary> {
    const cleanEmail = input.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new DomainRuleError(400, 'INVALID_EMAIL', 'Valid staff email address is required.');
    }
    const validRoles: AdminRole[] = [
      'super_admin',
      'operations_staff',
      'finance_staff',
      'support_staff',
      'agent_supervisor',
      'read_only_auditor',
    ];
    if (!validRoles.includes(input.role)) {
      throw new DomainRuleError(400, 'INVALID_ROLE', 'Unsupported staff admin role.');
    }

    return this.backend.grantStaffAdminByEmailTx({
      email: cleanEmail,
      role: input.role,
      displayName: input.displayName?.trim() || null,
      grantedAt: new Date().toISOString(),
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: actorUid,
        actorEmail: actorEmail ?? undefined,
        action: 'STAFF_ADMIN_GRANTED',
        targetType: 'staff_admin',
        targetId: cleanEmail,
        reason: `Assigned role ${input.role} to ${cleanEmail}`,
      }),
    });
  }

  public async updateStaffAdminRole(
    actorUid: string,
    actorEmail: string | null,
    targetUid: string,
    input: { role?: AdminRole; active?: boolean },
  ): Promise<StaffAdminSummary> {
    if (targetUid === actorUid && (input.active === false || (input.role && input.role !== 'super_admin'))) {
      throw new DomainRuleError(
        409,
        'CANNOT_DEMOTE_SELF',
        'You cannot deactivate or demote your own Super Admin session.',
      );
    }
    return this.backend.updateStaffAdminRoleTx({
      actorUid,
      targetUid,
      role: input.role,
      active: input.active,
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: actorUid,
        actorEmail: actorEmail ?? undefined,
        action: 'STAFF_ADMIN_UPDATED',
        targetType: 'staff_admin',
        targetId: targetUid,
        reason: `Updated ${targetUid} -> role=${input.role ?? 'unchanged'}, active=${input.active ?? 'unchanged'}`,
      }),
    });
  }

  public async updateCustomerAccountStatusAdmin(
    actorUid: string,
    actorEmail: string | null,
    targetUid: string,
    input: { status: UserAccountStatus; reason: string },
  ): Promise<VerifiedUserSummary> {
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required to change account status.');
    }
    if (targetUid === actorUid && input.status !== 'active') {
      throw new DomainRuleError(409, 'CANNOT_SUSPEND_SELF', 'Staff cannot suspend their own signed-in account.');
    }
    const updated = await this.backend.updateCustomerAccountStatusTx(
      targetUid,
      input.status,
      input.reason.trim(),
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: actorUid,
        actorEmail: actorEmail ?? undefined,
        action: `USER_ACCOUNT_${input.status.toUpperCase()}`,
        targetType: 'user',
        targetId: targetUid,
        reason: input.reason.trim(),
      }),
    );
    if (!updated) {
      throw new DomainRuleError(404, 'USER_NOT_FOUND', 'Customer account not found.');
    }
    return updated;
  }

  /* --------------------------------------------------------------------------
   * PUBLIC CATALOG, OPERATOR HEALTH & NUMBER DISCOVERY
   * -------------------------------------------------------------------------- */
  public async listOperators(): Promise<OperatorConfigRecord[]> {
    return this.syncOperatorCache();
  }

  public async getOperator(code: OperatorCode): Promise<OperatorConfigRecord | null> {
    const ops = await this.syncOperatorCache();
    return ops.find((o) => o.operatorCode === code) ?? null;
  }

  public async listEsimProducts(): Promise<EsimProductRecord[]> {
    const products = await this.backend.listEsimProducts();
    if (this.envMode !== 'production') return products;
    return products.map((p) => ({ ...p, sandboxPreviewAmountEtb: null }));
  }

  public listDevices(): DeviceCompatibilityRecord[] {
    return this.devices;
  }

  public async listAvailableNumbersForDiscovery(options?: {
    operatorCode?: OperatorCode;
    query?: string;
    tier?: NumberTier;
  }): Promise<PublicNumberOption[]> {
    await this.expireStaleReservations();
    const query = options?.query?.trim().toLowerCase() ?? '';
    const tierFilter = options?.tier;
    const ops = await this.syncOperatorCache();

    const targetOperators: OperatorCode[] = options?.operatorCode
      ? [options.operatorCode]
      : ['ethio_telecom', 'safaricom_ethiopia'];

    const collected: PublicNumberOption[] = [];

    for (const opCode of targetOperators) {
      const op = ops.find((o) => o.operatorCode === opCode);
      if (!op || !op.isEnabled || op.integrationStatus === 'coming_soon') continue;

      if (op.activeSupplyMethod === 'stock_based') {
        const items = await this.backend.listStockItems(opCode, 'available');
        for (const item of items) {
          if (this.envMode === 'production' && item.sourceEnvironment === 'sandbox_demo') continue;
          if (item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now()) continue;
          collected.push({
            id: item.id,
            operatorCode: item.operatorCode,
            msisdn: item.msisdn,
            numberTier: item.numberTier,
            sourceEnvironment: item.sourceEnvironment,
            supplyMethod: 'stock_based',
            supportsPrePaymentReservation: true,
          });
        }
      } else if (op.activeSupplyMethod === 'direct_api' && this.envMode !== 'production') {
        const activeMsisdns = await this.backend.listActiveReservedMsisdns(opCode);
        const directPool = this.directApiAdapter.listAvailableNumbers(opCode);
        for (const entry of directPool) {
          if (!entry.msisdn || !activeMsisdns.has(entry.msisdn)) {
            collected.push(entry);
          }
        }
      }
    }

    return collected.filter((item) => {
      if (tierFilter && item.numberTier !== tierFilter) return false;
      if (query) {
        const numMatch = (item.msisdn ?? '').toLowerCase().includes(query);
        const tierMatch = item.numberTier.toLowerCase().includes(query);
        return numMatch || tierMatch;
      }
      return true;
    });
  }

  public async listAvailableNumbers(operatorCode?: OperatorCode): Promise<EsimStockItemRecord[]> {
    await this.expireStaleReservations();
    const items = await this.backend.listStockItems(operatorCode, 'available');
    return this.envMode === 'production'
      ? items.filter((i) => i.sourceEnvironment !== 'sandbox_demo')
      : items;
  }

  public async listPhoneProducts(filters?: {
    category?: PhoneCategory;
    q?: string;
    compatibility?: PhoneCompatibilityStatus;
    unlockedOnly?: boolean;
  }): Promise<PhoneProductRecord[]> {
    const raw = await this.backend.listPhoneProducts(true);
    const products =
      this.envMode === 'production'
        ? raw.map((p) => ({ ...p, sandboxPreviewPriceEtb: null }))
        : raw;

    return products.filter((p) => {
      if (filters?.category && p.category !== filters.category) return false;
      if (filters?.compatibility && p.esimCompatibilityStatus !== filters.compatibility) return false;
      if (filters?.unlockedOnly && p.networkUnlockStatus !== 'verified_unlocked') return false;
      if (filters?.q?.trim()) {
        const needle = filters.q.trim().toLowerCase();
        const hay = `${p.brand} ${p.model} ${p.exactModelNumber} ${p.regionalVariant} ${p.storage}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  public async getPhoneProductById(id: string): Promise<PhoneProductRecord> {
    const product = await this.backend.getPhoneProduct(id);
    if (!product || !product.isActive) {
      throw new DomainRuleError(404, 'PHONE_PRODUCT_NOT_FOUND', 'Phone product was not found.');
    }
    return this.envMode === 'production'
      ? { ...product, sandboxPreviewPriceEtb: null }
      : product;
  }

  public async listAllPhoneProductsAdmin(): Promise<PhoneProductRecord[]> {
    return this.backend.listPhoneProducts(false);
  }

  /* --------------------------------------------------------------------------
   * AUTOMATED EXPIRY SWEEPS & INVENTORY RECONCILIATION
   * -------------------------------------------------------------------------- */
  public async expireStaleReservations(nowMs = Date.now()): Promise<number> {
    const res = await this.backend.expireStaleReservationsAndPaymentsTx({
      nowMs,
      timeoutMinutes: this.paymentTimeoutMinutes,
      instanceId: 'inline-sweep',
      recordJobRun: false,
    });
    if (res.expiredPayments > 0) {
      this.observability.recordExpiredOrders(res.expiredPayments);
    }
    return res.releasedReservations;
  }

  public async expireStalePayments(nowMs = Date.now(), timeoutMinutes = this.paymentTimeoutMinutes): Promise<number> {
    const res = await this.backend.expireStaleReservationsAndPaymentsTx({
      nowMs,
      timeoutMinutes,
      instanceId: 'inline-payment-expiry',
      recordJobRun: false,
    });
    if (res.expiredPayments > 0) {
      this.observability.recordExpiredOrders(res.expiredPayments);
    }
    return res.expiredPayments;
  }

  public async runScheduledPaymentExpirySweep(
    instanceId = 'scheduler',
    nowMs = Date.now(),
  ): Promise<{
    acquiredLock: boolean;
    releasedReservations: number;
    expiredPayments: number;
    runRecord: ScheduledJobRunRecord | null;
  }> {
    const res = await this.backend.expireStaleReservationsAndPaymentsTx({
      nowMs,
      timeoutMinutes: this.paymentTimeoutMinutes,
      instanceId,
      jobName: 'payment_expiry_sweep',
      recordJobRun: true,
    });
    if (res.expiredPayments > 0) {
      this.observability.recordExpiredOrders(res.expiredPayments);
    }
    return res;
  }

  public async listScheduledJobRuns(jobName?: string, limit = 25): Promise<ScheduledJobRunRecord[]> {
    return this.backend.listScheduledJobRuns(jobName, limit);
  }

  public async reconcileStockInventory(
    actorUid: string,
    actorEmail: string | null,
    nowMs = Date.now(),
  ) {
    return this.backend.reconcileStockTx(actorEmail ?? actorUid, actorUid, actorEmail, nowMs);
  }

  public async updateStockItemStatusAdmin(
    itemId: string,
    staffUid: string,
    staffEmail: string | null,
    input: { status: Extract<StockItemStatus, 'available' | 'invalid' | 'expired'>; reason: string },
  ): Promise<EsimStockItemRecord> {
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required.');
    }
    const actor = staffEmail ?? staffUid;
    const item = await this.backend.updateStockItemStatusTx(
      itemId,
      input.status,
      {
        action: `STATUS_TO_${input.status.toUpperCase()}`,
        actor,
        note: input.reason.trim(),
        at: new Date().toISOString(),
      },
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'STOCK_ITEM_STATUS_UPDATED',
        targetType: 'esim_stock_item',
        targetId: itemId,
        reason: `-> ${input.status}: ${input.reason.trim()}`,
      }),
    );
    if (!item) {
      throw new DomainRuleError(404, 'STOCK_ITEM_NOT_FOUND', 'Stock item not found.');
    }
    return item;
  }

  public async previewCsvStockImport(
    operatorCode: OperatorCode,
    csvText: string,
  ): Promise<CsvStockImportPreviewResult> {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      throw new DomainRuleError(400, 'EMPTY_CSV', 'CSV content cannot be empty.');
    }

    const firstLower = lines[0].toLowerCase();
    const startIdx = firstLower.includes('iccid') && firstLower.includes('smdp') ? 1 : 0;
    if (lines.length - startIdx > 500) {
      throw new DomainRuleError(400, 'BATCH_TOO_LARGE', 'CSV import batches cannot exceed 500 rows at once.');
    }

    const parsedCols = lines.slice(startIdx).map((l) => l.split(',').map((c) => c.trim()));
    const candidateIccids = parsedCols.map((c) => c[1] ?? '').filter(Boolean);
    const candidateMsisdns = parsedCols
      .map((c) => (c[0] ? normalizeEthiopianPhone(c[0]) : null))
      .filter((m): m is string => Boolean(m));
    const dbConflicts = await this.backend.checkStockConflicts(candidateIccids, candidateMsisdns);

    const seenIccids = new Set<string>();
    const seenMsisdns = new Set<string>();
    const rows: CsvStockImportRowPreview[] = [];
    let duplicateCount = 0;

    for (let idx = 0; idx < parsedCols.length; idx += 1) {
      const cols = parsedCols[idx];
      const [rawMsisdn = '', rawIccid = '', rawSmdp = '', rawCode = '', rawTier = 'standard', rawExtRef = '', rawExpires = ''] = cols;
      const errors: string[] = [];

      if (
        hasCsvFormulaPrefix(rawIccid) ||
        hasCsvFormulaPrefix(rawSmdp) ||
        hasCsvFormulaPrefix(rawCode) ||
        hasCsvFormulaPrefix(rawExtRef) ||
        hasCsvFormulaPrefix(rawMsisdn, true)
      ) {
        errors.push('Rejected unsafe formula character prefix in CSV row');
      }

      if (!rawIccid) errors.push('Missing ICCID');
      if (!rawSmdp) errors.push('Missing SM-DP+ address');
      if (!rawCode) errors.push('Missing activation code');

      const normMsisdn = rawMsisdn ? normalizeEthiopianPhone(rawMsisdn) : null;
      if (rawMsisdn && !normMsisdn) {
        errors.push(`Invalid Ethiopian MSISDN: ${rawMsisdn}`);
      } else if (normMsisdn) {
        const inferredOp = inferOperatorFromEthiopianPhone(normMsisdn);
        if (inferredOp && inferredOp !== operatorCode) {
          errors.push(`MSISDN ${normMsisdn} belongs to ${inferredOp}, expected ${operatorCode}`);
        }
      }

      const tierCandidate = rawTier.toLowerCase() as NumberTier;
      const validTiers: NumberTier[] = ['standard', 'bronze', 'silver', 'gold', 'platinum'];
      const numberTier: NumberTier = validTiers.includes(tierCandidate) ? tierCandidate : 'standard';

      if (rawIccid) {
        if (seenIccids.has(rawIccid)) {
          errors.push('Duplicate ICCID within CSV');
          duplicateCount += 1;
        } else if (dbConflicts.existingIccids.has(rawIccid)) {
          errors.push(`ICCID ${rawIccid} already exists in inventory`);
          duplicateCount += 1;
        }
        seenIccids.add(rawIccid);
      }

      if (normMsisdn) {
        if (seenMsisdns.has(normMsisdn)) {
          errors.push('Duplicate MSISDN within CSV');
          duplicateCount += 1;
        } else if (dbConflicts.activeMsisdns.has(normMsisdn)) {
          errors.push(`MSISDN ${normMsisdn} already exists as active/reserved/assigned stock`);
          duplicateCount += 1;
        }
        seenMsisdns.add(normMsisdn);
      }

      rows.push({
        rowNumber: startIdx + idx + 1,
        msisdn: normMsisdn,
        iccid: rawIccid,
        numberTier,
        externalInventoryRef: rawExtRef || null,
        expiresAt: rawExpires || null,
        valid: errors.length === 0,
        errors,
      });
    }

    const validCount = rows.filter((r) => r.valid).length;
    return {
      operatorCode,
      totalRows: rows.length,
      validCount,
      invalidCount: rows.length - validCount,
      duplicateCount,
      rows,
    };
  }

  public async importStockBatch(
    actorUid: string,
    actorEmail: string | null,
    input: {
      operatorCode: OperatorCode;
      batchName: string;
      sourceEnvironment: 'sandbox_demo' | 'operator_partner_batch';
      supplierReference?: string;
      initialStatus?: 'imported' | 'available';
      items: Array<{
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
    },
  ): Promise<{ batch: EsimStockBatchRecord; importedCount: number }> {
    if (!input.items.length) {
      throw new DomainRuleError(400, 'EMPTY_BATCH', 'At least one stock item is required.');
    }
    if (input.items.length > 500) {
      throw new DomainRuleError(400, 'BATCH_TOO_LARGE', 'Stock import batch cannot exceed 500 items.');
    }
    if (this.envMode === 'production' && input.sourceEnvironment === 'sandbox_demo') {
      throw new DomainRuleError(
        403,
        'SANDBOX_FORBIDDEN_IN_PRODUCTION',
        'Sandbox demonstration stock batches cannot be imported when running in production mode.',
      );
    }

    const batchId = `batch-${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    const initialStatus: StockItemStatus = input.initialStatus === 'imported' ? 'imported' : 'available';

    const batchSeenIccids = new Set<string>();
    const batchSeenMsisdns = new Set<string>();

    for (const row of input.items) {
      if (!row.iccid?.trim() || !row.smdpAddress?.trim() || !row.activationCode?.trim()) {
        throw new DomainRuleError(
          400,
          'INVALID_STOCK_ROW',
          'Each stock item must include ICCID, SM-DP+ address, and activation code.',
        );
      }
      if (
        hasCsvFormulaPrefix(row.iccid) ||
        hasCsvFormulaPrefix(row.smdpAddress) ||
        hasCsvFormulaPrefix(row.activationCode) ||
        (row.externalInventoryRef && hasCsvFormulaPrefix(row.externalInventoryRef)) ||
        (row.msisdn && hasCsvFormulaPrefix(row.msisdn, true))
      ) {
        throw new DomainRuleError(
          400,
          'UNSAFE_CSV_FORMULA',
          'Stock batch contains rejected spreadsheet formula control characters.',
        );
      }
      const iccidTrimmed = row.iccid.trim();
      if (batchSeenIccids.has(iccidTrimmed)) {
        throw new DomainRuleError(409, 'DUPLICATE_ICCID', `Duplicate ICCID in batch: ${iccidTrimmed}`);
      }
      batchSeenIccids.add(iccidTrimmed);

      const normMsisdn = row.msisdn ? normalizeEthiopianPhone(row.msisdn) : null;
      if (row.msisdn && !normMsisdn) {
        throw new DomainRuleError(400, 'INVALID_MSISDN', `Invalid Ethiopian phone number: ${row.msisdn}`);
      }
      if (normMsisdn) {
        const inferredOp = inferOperatorFromEthiopianPhone(normMsisdn);
        if (inferredOp && inferredOp !== input.operatorCode) {
          throw new DomainRuleError(
            400,
            'OPERATOR_MSISDN_MISMATCH',
            `MSISDN ${normMsisdn} belongs to ${inferredOp}, not ${input.operatorCode}.`,
          );
        }
        if (batchSeenMsisdns.has(normMsisdn)) {
          throw new DomainRuleError(409, 'DUPLICATE_MSISDN', `Duplicate MSISDN in batch: ${normMsisdn}`);
        }
        batchSeenMsisdns.add(normMsisdn);
      }
    }

    const dbConflicts = await this.backend.checkStockConflicts(
      Array.from(batchSeenIccids),
      Array.from(batchSeenMsisdns),
    );
    if (dbConflicts.existingIccids.size > 0) {
      const first = Array.from(dbConflicts.existingIccids)[0];
      throw new DomainRuleError(409, 'DUPLICATE_ICCID', `Duplicate ICCID in inventory: ${first}`);
    }
    if (dbConflicts.activeMsisdns.size > 0) {
      const first = Array.from(dbConflicts.activeMsisdns)[0];
      throw new DomainRuleError(
        409,
        'DUPLICATE_MSISDN',
        `MSISDN ${first} already exists as active/reserved/assigned stock.`,
      );
    }

    const batch: EsimStockBatchRecord = {
      id: batchId,
      operatorCode: input.operatorCode,
      batchName: input.batchName.trim(),
      sourceEnvironment: input.sourceEnvironment,
      supplierReference: input.supplierReference?.trim() || null,
      totalCount: input.items.length,
      availableCount: initialStatus === 'available' ? input.items.length : 0,
      importedBy: actorEmail ?? actorUid,
      createdAt: now,
    };

    const items: EsimStockItemRecord[] = [];
    const secrets: InternalStockCredential[] = [];

    for (const row of input.items) {
      const id = `stk-${crypto.randomUUID().slice(0, 10)}`;
      const msisdn = row.msisdn ? normalizeEthiopianPhone(row.msisdn) : null;
      const smdp = row.smdpAddress.trim();
      const activationCode = row.activationCode.trim();
      const lpaUri = `LPA:1$${smdp}$${activationCode}`;
      const encryptedCredentials = encryptActivationPayload(
        { smdpAddress: smdp, activationCode, lpaUri, qrPayload: lpaUri },
        this.encryptionKey,
      );

      items.push({
        id,
        batchId,
        operatorCode: input.operatorCode,
        msisdn,
        numberTier: row.numberTier ?? 'standard',
        iccid: row.iccid.trim(),
        eid: row.eid?.trim() || null,
        externalInventoryRef: row.externalInventoryRef?.trim() || null,
        inventoryType: row.inventoryType ?? 'msisdn_profile_bundle',
        status: initialStatus,
        reservedOrderId: null,
        reservedUntil: null,
        soldOrderId: null,
        sourceEnvironment: input.sourceEnvironment,
        importedAt: now,
        expiresAt: row.expiresAt || null,
        auditHistory: [
          {
            action: 'BATCH_IMPORTED',
            actor: actorEmail ?? actorUid,
            note: `Imported into batch ${batch.batchName} (${initialStatus})`,
            at: now,
          },
        ],
        createdAt: now,
      });

      secrets.push({
        stockItemId: id,
        smdpAddress: smdp,
        activationCode,
        lpaUri,
        qrPayload: lpaUri,
        encryptedCredentials,
      });
    }

    await this.backend.importStockBatchTx(
      batch,
      items,
      secrets,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: actorUid,
        actorEmail: actorEmail ?? undefined,
        action: 'STOCK_BATCH_IMPORTED',
        targetType: 'esim_stock_batch',
        targetId: batchId,
        reason: `Imported ${input.items.length} ${input.operatorCode} items (${input.sourceEnvironment})`,
      }),
    );

    return { batch, importedCount: input.items.length };
  }

  public async listStockBatches(): Promise<EsimStockBatchRecord[]> {
    return this.backend.listStockBatches();
  }

  public async listStockItems(
    operatorCode?: OperatorCode,
    status?: StockItemStatus,
  ): Promise<EsimStockItemRecord[]> {
    await this.expireStaleReservations();
    return this.backend.listStockItems(operatorCode, status);
  }

  /* --------------------------------------------------------------------------
   * CUSTOMER ORDER LIFECYCLE (IDEMPOTENCY -> KYC -> RESERVATION -> CHAPA -> PROVISIONING)
   * -------------------------------------------------------------------------- */
  public async createDraftOrder(
    userId: string,
    input: {
      operatorCode: OperatorCode;
      productId: string;
      deviceModel?: string;
      deviceOs?: 'ios' | 'android';
      deviceVerified?: boolean;
      agentReferralCode?: string | null;
      idempotencyKey?: string | null;
      existingMsisdn?: string | null;
    },
  ): Promise<EsimOrderRecord> {
    const cleanIdemp = input.idempotencyKey?.trim() || null;
    if (cleanIdemp) {
      const existing = await this.backend.findActiveOrderByIdempotency(userId, cleanIdemp);
      if (existing) return existing;
    }

    const op = await this.getOperator(input.operatorCode);
    if (!op) {
      throw new DomainRuleError(404, 'OPERATOR_NOT_FOUND', 'Selected telecom operator was not found.');
    }
    if (!op.isEnabled || op.integrationStatus === 'coming_soon') {
      throw new DomainRuleError(
        409,
        'OPERATOR_UNAVAILABLE',
        `${op.displayName} eSIM service is currently disabled or unavailable.`,
      );
    }

    const product = await this.backend.getEsimProduct(input.productId);
    if (!product || product.operatorCode !== input.operatorCode) {
      throw new DomainRuleError(404, 'PRODUCT_NOT_FOUND', 'Selected eSIM product was not found.');
    }
    if (product.productType === 'sim_to_esim_conversion') {
      if (!op.supportsSimConversion || !product.isActive || !op.kycRequired) {
        throw new DomainRuleError(
          409,
          'CONVERSION_NOT_ENABLED',
          'Physical SIM to eSIM conversion is pending formal operator authorization.',
        );
      }
    } else if (!product.isActive) {
      throw new DomainRuleError(409, 'PRODUCT_DISABLED', 'This eSIM service is not currently enabled.');
    }

    // Strict Production Pricing Enforcement (Decision 3)
    let resolvedAmountEtb: number;
    let isSandboxPricing: boolean;
    let pricingSnapshotNote: string;

    if (this.envMode === 'production') {
      if (product.priceEtb === null || !Number.isFinite(product.priceEtb) || product.priceEtb <= 0) {
        throw new DomainRuleError(
          409,
          'PRODUCTION_PRICE_NOT_CONFIGURED',
          `Official ETB pricing for "${product.name}" must be approved and configured (> 0 ETB) before checkout is permitted in production.`,
        );
      }
      resolvedAmountEtb = Number(product.priceEtb.toFixed(2));
      isSandboxPricing = false;
      pricingSnapshotNote = `Production price snapshot: ${resolvedAmountEtb.toFixed(2)} ETB`;
    } else {
      if (product.priceEtb !== null && Number.isFinite(product.priceEtb) && product.priceEtb > 0) {
        resolvedAmountEtb = Number(product.priceEtb.toFixed(2));
        isSandboxPricing = false;
        pricingSnapshotNote = `Configured ETB price snapshot: ${resolvedAmountEtb.toFixed(2)} ETB`;
      } else {
        resolvedAmountEtb = Number((product.sandboxPreviewAmountEtb ?? 0).toFixed(2));
        isSandboxPricing = true;
        pricingSnapshotNote = 'Sandbox preview amount snapshot (official commercial price pending agreement)';
      }
    }

    let normalizedExistingMsisdn: string | null = null;
    if (product.productType === 'sim_to_esim_conversion') {
      if (!input.existingMsisdn?.trim()) {
        throw new DomainRuleError(
          400,
          'EXISTING_MSISDN_REQUIRED',
          'Your existing Ethiopian mobile number is required for SIM to eSIM conversion.',
        );
      }
      normalizedExistingMsisdn = normalizeEthiopianPhone(input.existingMsisdn);
      if (!normalizedExistingMsisdn) {
        throw new DomainRuleError(400, 'INVALID_MSISDN', 'Provide a valid Ethiopian mobile number.');
      }
      if (inferOperatorFromEthiopianPhone(normalizedExistingMsisdn) !== input.operatorCode) {
        throw new DomainRuleError(
          400,
          'OPERATOR_NUMBER_MISMATCH',
          'Existing number prefix does not match selected telecom operator.',
        );
      }
    }

    let attributedAgentId: string | null = null;
    let appliedReferralCode: string | null = null;
    if (input.agentReferralCode?.trim()) {
      const code = input.agentReferralCode.trim().toUpperCase();
      const agent = await this.backend.getAgentByReferralCode(code);
      if (agent && agent.status === 'approved') {
        attributedAgentId = agent.id;
        appliedReferralCode = code;
      }
    }

    const now = new Date().toISOString();
    const initialStatus: OrderStatus = op.kycRequired ? 'awaiting_identity_verification' : 'draft';
    const order: EsimOrderRecord = {
      id: `ord-${crypto.randomUUID().slice(0, 12)}`,
      orderNumber: makeOrderNumber('YN'),
      idempotencyKey: cleanIdemp,
      userId,
      operatorCode: input.operatorCode,
      productId: product.id,
      productType: product.productType,
      supplyMethodUsed: op.activeSupplyMethod,
      deviceModel: input.deviceModel?.trim() || null,
      deviceOs: input.deviceOs ?? null,
      deviceVerified: Boolean(input.deviceVerified),
      selectedNumberTier: 'standard',
      reservedMsisdn: normalizedExistingMsisdn,
      existingMsisdn: normalizedExistingMsisdn,
      assignedStockItemId: null,
      reservedUntil: null,
      numberReservationConfirmed: false,
      kycStatus: 'not_started',
      paymentStatus: 'pending',
      provisioningStatus: 'not_started',
      deliveryStatus: 'pending',
      operatorTransactionRef: null,
      amountEtb: resolvedAmountEtb,
      currency: 'ETB',
      isSandboxPricing,
      pricingSnapshotNote,
      attributedAgentId,
      agentReferralCode: appliedReferralCode,
      status: initialStatus,
      failureReason: null,
      updateHistory: [
        {
          status: initialStatus,
          actor: userId,
          note: `Order created (${product.productType}, supply mode ${op.activeSupplyMethod}, ${resolvedAmountEtb.toFixed(2)} ETB)`,
          at: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    return this.backend.createOrderTx(
      order,
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'ORDER_CREATED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: `Created ${order.operatorCode} eSIM order (${order.supplyMethodUsed}, ${order.amountEtb.toFixed(2)} ETB)`,
      }),
    );
  }

  public async submitOrderKyc(
    orderId: string,
    actorUserId: string,
    input: {
      fullName: string;
      faydaFanReference: string;
      contactPhone: string;
      consentGiven: boolean;
      submittedByAgentAttempt?: boolean;
    },
  ): Promise<{ order: EsimOrderRecord; kyc: KycVerificationRecord }> {
    const order = await this.backend.getOrder(orderId);
    if (!order || order.userId !== actorUserId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }
    if (['cancelled', 'expired', 'refunded'].includes(order.status)) {
      throw new DomainRuleError(409, 'ORDER_TERMINAL', `Order in status "${order.status}" cannot be verified.`);
    }

    if (input.submittedByAgentAttempt) {
      await this.recordAudit({
        actorType: 'customer',
        actorId: actorUserId,
        action: 'AGENT_KYC_IMPERSONATION_BLOCKED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: 'Agents cannot submit Fayda identity consent or OTPs on behalf of a customer.',
      });
      throw new DomainRuleError(
        403,
        'KYC_SELF_CONSENT_REQUIRED',
        'Subscribers must complete Fayda identity verification personally.',
      );
    }

    const result = this.faydaAdapter.verifySubscriberConsent({
      orderId: order.id,
      userId: actorUserId,
      operatorCode: order.operatorCode,
      fullName: input.fullName,
      faydaFanReference: input.faydaFanReference,
      contactPhone: input.contactPhone,
      consentGiven: input.consentGiven,
      actorUserId,
    });

    const now = new Date().toISOString();
    if (!result.verified) {
      order.kycStatus = 'failed';
      order.failureReason = result.errorMessage;
      order.status = 'awaiting_identity_verification';
      order.updatedAt = now;
      order.updateHistory.push({
        status: 'awaiting_identity_verification',
        actor: actorUserId,
        note: `Fayda verification retry required: ${result.errorMessage ?? 'invalid input'}`,
        at: now,
      });

      await this.backend.saveKycAttemptTx(
        order,
        result.verificationRecord,
        this.buildAudit({
          actorType: 'customer',
          actorId: actorUserId,
          action: 'FAYDA_KYC_ATTEMPT_FAILED',
          targetType: 'esim_order',
          targetId: order.id,
          reason: result.errorMessage ?? 'KYC validation failed',
        }),
      );
      throw new DomainRuleError(400, result.errorCode ?? 'KYC_FAILED', result.errorMessage ?? 'KYC failed.');
    }

    order.kycStatus = result.verificationRecord.status;
    order.failureReason = null;
    order.status = 'identity_verified';
    order.updatedAt = now;
    order.updateHistory.push({
      status: 'identity_verified',
      actor: actorUserId,
      note: `Consent verified via ${result.verificationRecord.verificationMode}`,
      at: now,
    });

    await this.backend.saveKycAttemptTx(
      order,
      result.verificationRecord,
      this.buildAudit({
        actorType: 'customer',
        actorId: actorUserId,
        action: 'FAYDA_KYC_RECORDED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: `Consent recorded via ${result.verificationRecord.verificationMode}`,
      }),
    );

    return { order, kyc: result.verificationRecord };
  }

  public async reserveNumberForOrder(
    orderId: string,
    userId: string,
    input: { stockItemId?: string | null; preferredTier?: NumberTier; requestedPhone?: string },
  ): Promise<EsimOrderRecord> {
    await this.expireStaleReservations();
    const order = await this.backend.getOrder(orderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }
    if (!['identity_verified', 'number_reserved', 'awaiting_payment'].includes(order.status)) {
      throw new DomainRuleError(
        409,
        'KYC_REQUIRED_BEFORE_RESERVATION',
        'Complete Fayda identity verification before selecting or reserving a mobile number.',
      );
    }

    const op = await this.getOperator(order.operatorCode);
    const supplyMethod = op?.activeSupplyMethod ?? order.supplyMethodUsed;
    const holdUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    if (order.productType === 'sim_to_esim_conversion') {
      return this.backend.updateOrderReservationTx({
        orderId: order.id,
        userId,
        operatorCode: order.operatorCode,
        selectedNumberTier: 'standard',
        reservedMsisdn: order.existingMsisdn,
        numberReservationConfirmed: false,
        reservedUntil: null,
        historyNote: `Existing subscriber number ${order.existingMsisdn} confirmed for conversion eligibility.`,
        actor: userId,
      });
    }

    if (supplyMethod === 'stock_based') {
      try {
        return await this.backend.reserveStockItemForOrderTx({
          orderId: order.id,
          userId,
          operatorCode: order.operatorCode,
          stockItemId: input.stockItemId,
          preferredTier: input.preferredTier,
          holdUntil,
          actor: userId,
        });
      } catch (err) {
        if (err instanceof DomainRuleError && (err.code === 'NO_AVAILABLE_STOCK' || err.code === 'NUMBER_ALREADY_RESERVED')) {
          this.observability.recordStockReservationFailure(err.code, { operatorCode: order.operatorCode });
        }
        throw err;
      }
    }

    if (supplyMethod === 'direct_api') {
      const msisdn = input.requestedPhone ? normalizeEthiopianPhone(input.requestedPhone) : null;
      if (input.requestedPhone && !msisdn) {
        throw new DomainRuleError(400, 'INVALID_MSISDN', 'Provide a valid Ethiopian mobile number.');
      }
      if (msisdn && inferOperatorFromEthiopianPhone(msisdn) !== order.operatorCode) {
        throw new DomainRuleError(
          400,
          'OPERATOR_NUMBER_MISMATCH',
          'Requested number prefix does not match selected telecom operator.',
        );
      }

      const activeMsisdns = await this.backend.listActiveReservedMsisdns(order.operatorCode, order.id);
      const chosenMsisdn =
        msisdn ??
        this.directApiAdapter.listAvailableNumbers(order.operatorCode).find(
          (n) => n.msisdn && !activeMsisdns.has(n.msisdn) && (!input.preferredTier || n.numberTier === input.preferredTier),
        )?.msisdn ??
        (order.operatorCode === 'ethio_telecom'
          ? `+2519009${Math.floor(10000 + Math.random() * 89999)}`
          : `+2517009${Math.floor(10000 + Math.random() * 89999)}`);

      if (activeMsisdns.has(chosenMsisdn)) {
        this.observability.recordStockReservationFailure('NUMBER_ALREADY_RESERVED', {
          operatorCode: order.operatorCode,
        });
        throw new DomainRuleError(409, 'NUMBER_ALREADY_RESERVED', 'This number is already held by another active order.');
      }

      const check = await this.directApiAdapter.checkNumberAvailability(order.operatorCode, chosenMsisdn);
      if (!check.available) {
        this.observability.recordStockReservationFailure('NUMBER_UNAVAILABLE', {
          operatorCode: order.operatorCode,
        });
        throw new DomainRuleError(409, 'NUMBER_UNAVAILABLE', check.reason ?? 'Selected number is unavailable.');
      }

      return this.backend.updateOrderReservationTx({
        orderId: order.id,
        userId,
        operatorCode: order.operatorCode,
        selectedNumberTier: input.preferredTier ?? 'standard',
        reservedMsisdn: chosenMsisdn,
        numberReservationConfirmed: check.reservationSupported,
        reservedUntil: check.reservationSupported ? holdUntil : null,
        historyNote: check.reservationSupported
          ? `Direct API number ${chosenMsisdn} reserved prior to payment.`
          : `Number ${chosenMsisdn} selected; operator requires post-payment availability recheck (not pre-locked).`,
        actor: userId,
      });
    }

    // manual_processing
    const msisdn = input.requestedPhone ? normalizeEthiopianPhone(input.requestedPhone) : null;
    if (input.requestedPhone && !msisdn) {
      throw new DomainRuleError(400, 'INVALID_MSISDN', 'Provide a valid Ethiopian mobile number.');
    }
    if (msisdn && inferOperatorFromEthiopianPhone(msisdn) !== order.operatorCode) {
      throw new DomainRuleError(
        400,
        'OPERATOR_NUMBER_MISMATCH',
        'Requested number prefix does not match selected telecom operator.',
      );
    }

    const tier = input.preferredTier ?? 'standard';
    return this.backend.updateOrderReservationTx({
      orderId: order.id,
      userId,
      operatorCode: order.operatorCode,
      selectedNumberTier: tier,
      reservedMsisdn: msisdn,
      numberReservationConfirmed: false,
      reservedUntil: null,
      historyNote: msisdn
        ? `Preferred tier (${tier}) & request ${msisdn} recorded for authorized manual partner assignment.`
        : `Preferred tier (${tier}) recorded; number assigned by authorized partner on fulfillment.`,
      actor: userId,
    });
  }

  public async initChapaPaymentForOrder(
    orderId: string,
    userId: string,
    customerEmail: string | null,
    returnUrl: string,
    idempotencyKey?: string,
  ): Promise<{ order: EsimOrderRecord; payment: PaymentRecord; checkoutUrl: string }> {
    await this.expireStaleReservations();
    const order = await this.backend.getOrder(orderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }
    if (!['identity_verified', 'number_reserved', 'awaiting_payment', 'failed'].includes(order.status)) {
      throw new DomainRuleError(
        409,
        'ORDER_NOT_READY_FOR_PAYMENT',
        `Order in status "${order.status}" cannot start checkout.`,
      );
    }
    if (order.kycStatus !== 'verified_sandbox' && order.kycStatus !== 'verified_live') {
      throw new DomainRuleError(409, 'KYC_REQUIRED', 'Fayda identity consent must succeed before payment.');
    }

    if (this.envMode === 'production') {
      if (!Number.isFinite(order.amountEtb) || order.amountEtb <= 0 || order.isSandboxPricing) {
        this.observability.recordPaymentInitFailure('PRODUCTION_PRICE_NOT_CONFIGURED', { orderId });
        throw new DomainRuleError(
          409,
          'PRODUCTION_PRICE_NOT_CONFIGURED',
          'Official active ETB pricing is required before initiating checkout in production mode.',
        );
      }
      if (!this.chapaAdapter.isLiveConfigured()) {
        this.observability.recordPaymentInitFailure('PAYMENT_PROVIDER_UNCONFIGURED', { orderId });
        throw new DomainRuleError(
          503,
          'PAYMENT_PROVIDER_UNCONFIGURED',
          'Chapa live credentials are required before initiating checkout in production mode.',
        );
      }
    }

    if (idempotencyKey?.trim()) {
      const existingPay = await this.backend.findPaymentByIdempotency(order.id, idempotencyKey.trim());
      if (existingPay && existingPay.status !== 'failed' && existingPay.status !== 'cancelled') {
        return {
          order,
          payment: existingPay,
          checkoutUrl:
            existingPay.checkoutUrl ??
            `${returnUrl}?chapa_sandbox_tx=${encodeURIComponent(existingPay.txRef)}`,
        };
      }
    }

    const user = await this.backend.getUser(userId);
    let initialized: { payment: PaymentRecord; checkoutUrl: string };
    try {
      initialized = await this.chapaAdapter.initializeCheckout({
        orderType: 'esim_order',
        orderId: order.id,
        userId,
        amountEtb: order.amountEtb,
        customerEmail: customerEmail ?? user?.email ?? null,
        customerName: user?.displayName ?? null,
        customerPhone: user?.phoneNumber ?? order.existingMsisdn ?? null,
        returnUrl,
        idempotencyKey,
      });
    } catch (err) {
      const code = err instanceof DomainRuleError ? err.code : (err as { code?: string })?.code ?? 'CHAPA_INIT_ERROR';
      this.observability.recordPaymentInitFailure(code, { orderId });
      if (err instanceof DomainRuleError) throw err;
      const gwErr = err as { statusCode?: number; code?: string; message?: string };
      if (gwErr.statusCode && gwErr.code) {
        throw new DomainRuleError(gwErr.statusCode, gwErr.code, gwErr.message ?? 'Chapa initialization failed.');
      }
      throw err;
    }

    const now = new Date().toISOString();
    order.paymentStatus = 'initialized';
    order.failureReason = null;
    order.status = 'awaiting_payment';
    order.updatedAt = now;
    order.updateHistory.push({
      status: 'awaiting_payment',
      actor: userId,
      note: `Initialized Chapa checkout (${initialized.payment.txRef})`,
      at: now,
    });

    await this.backend.recordInitializedPaymentTx(order, initialized.payment);
    return { order, payment: initialized.payment, checkoutUrl: initialized.checkoutUrl };
  }

  public async processChapaWebhookEvent(input: {
    txRef: string;
    orderId?: string;
    eventId?: string;
    status: string;
  }): Promise<{
    deduplicated: boolean;
    orderStatus: OrderStatus;
    paymentStatus: PaymentRecord['status'];
  }> {
    const payment = await this.backend.findPaymentByTxRef(input.txRef, input.orderId);
    if (!payment) {
      this.observability.recordWebhookFailure('PAYMENT_NOT_FOUND', { txRef: input.txRef });
      throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
    }
    const order = await this.backend.getOrder(input.orderId ?? payment.orderId);
    if (!order) {
      this.observability.recordWebhookFailure('ORDER_NOT_FOUND', { txRef: input.txRef });
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    const resolvedEventId = input.eventId ?? `${input.txRef}:${order.id}:${input.status}`;

    if (await this.backend.hasProcessedWebhookEvent(resolvedEventId)) {
      await this.backend.incrementWebhookCountForDeduplicated(payment.id);
      return {
        deduplicated: true,
        orderStatus: order.status,
        paymentStatus: payment.status,
      };
    }

    if (input.status === 'failed' || input.status === 'cancelled') {
      const normalizedStatus = input.status === 'cancelled' ? 'cancelled' : 'failed';
      return this.backend.recordNonSuccessWebhookTx({
        eventId: resolvedEventId,
        txRef: input.txRef,
        orderId: order.id,
        status: normalizedStatus,
        failureReason: `Chapa webhook reported payment ${input.status}.`,
      });
    }

    if (input.status !== 'success') {
      return {
        deduplicated: false,
        orderStatus: order.status,
        paymentStatus: payment.status,
      };
    }

    try {
      const result = await this.verifyPaymentAndFulfillOrder(order.id, input.txRef, {
        viaWebhook: true,
        eventId: resolvedEventId,
      });
      return {
        deduplicated: result.deduplicated,
        orderStatus: result.order.status,
        paymentStatus: result.payment.status,
      };
    } catch (err) {
      const code = err instanceof DomainRuleError ? err.code : 'WEBHOOK_VERIFY_FAILED';
      this.observability.recordWebhookFailure(code, { txRef: input.txRef });
      throw err;
    }
  }

  public async verifyPaymentAndFulfillOrder(
    orderId: string,
    txRef: string,
    options: {
      viaWebhook?: boolean;
      actorUserId?: string;
      eventId?: string;
      simulatePaymentFailure?: boolean;
      sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck';
    } = {},
  ): Promise<{ order: EsimOrderRecord; payment: PaymentRecord; esim: CustomerEsimRecord | null; deduplicated: boolean }> {
    const existingFlight = this.inFlightPaymentVerifications.get(orderId);
    if (existingFlight) {
      const prior = await existingFlight;
      if (options.actorUserId && prior.order.userId !== options.actorUserId) {
        throw new DomainRuleError(403, 'FORBIDDEN', 'You do not have permission to verify this order.');
      }
      if (options.eventId) {
        await this.backend.recordWebhookEventIdempotent({
          eventId: options.eventId,
          provider: 'chapa',
          txRef,
          orderId,
          status: 'success',
        });
        await this.backend.incrementWebhookCountForDeduplicated(prior.payment.id);
      }
      return { ...prior, deduplicated: true };
    }

    const run = this.executeVerifyPaymentAndFulfillOrder(orderId, txRef, options);
    this.inFlightPaymentVerifications.set(orderId, run);
    try {
      return await run;
    } finally {
      this.inFlightPaymentVerifications.delete(orderId);
    }
  }

  private async executeVerifyPaymentAndFulfillOrder(
    orderId: string,
    txRef: string,
    options: {
      viaWebhook?: boolean;
      actorUserId?: string;
      eventId?: string;
      simulatePaymentFailure?: boolean;
      sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck';
    } = {},
  ): Promise<{ order: EsimOrderRecord; payment: PaymentRecord; esim: CustomerEsimRecord | null; deduplicated: boolean }> {
    if (
      this.envMode === 'production' &&
      (options.simulatePaymentFailure || (options.sandboxBehavior && options.sandboxBehavior !== 'success'))
    ) {
      throw new DomainRuleError(
        403,
        'SANDBOX_FLAGS_FORBIDDEN',
        'Sandbox simulation flags are rejected in production mode.',
      );
    }

    if (options.eventId && (await this.backend.hasProcessedWebhookEvent(options.eventId))) {
      const existingOrder = await this.backend.getOrder(orderId);
      const existingPay = await this.backend.findPaymentByTxRef(txRef, orderId);
      if (existingOrder && existingPay) {
        await this.backend.incrementWebhookCountForDeduplicated(existingPay.id);
        const existingEsim = await this.backend.getEsimByOrderId(orderId);
        return { order: existingOrder, payment: existingPay, esim: existingEsim, deduplicated: true };
      }
    }

    const order = await this.backend.getOrder(orderId);
    if (!order) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    if (options.actorUserId && order.userId !== options.actorUserId) {
      throw new DomainRuleError(403, 'FORBIDDEN', 'You do not have permission to verify this order.');
    }

    const payment = await this.backend.findPaymentByTxRef(txRef, orderId);
    if (!payment) {
      throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
    }

    if (order.kycStatus !== 'verified_sandbox' && order.kycStatus !== 'verified_live') {
      throw new DomainRuleError(
        409,
        'KYC_REQUIRED_BEFORE_FULFILLMENT',
        'Fayda KYC must be verified before payment settlement and provisioning.',
      );
    }

    if (
      payment.status === 'verified' &&
      [
        'submitted_to_operator',
        'operator_pending',
        'provisioned',
        'delivered',
        'ready_for_installation',
        'installed',
        'activated',
        'awaiting_manual_fulfillment',
      ].includes(order.status)
    ) {
      const existingEsim = await this.backend.getEsimByOrderId(orderId);
      return { order, payment, esim: existingEsim, deduplicated: true };
    }

    const verified = await this.chapaAdapter.verifyTransactionServerSide(txRef, payment.amountEtb, {
      simulateFailure: options.simulatePaymentFailure,
    });

    if (verified.outcome === 'uncertain') {
      this.observability.recordPaymentVerifyFailure('PAYMENT_STATUS_UNCERTAIN', { orderId, txRef });
      throw new DomainRuleError(
        503,
        'PAYMENT_STATUS_UNCERTAIN',
        verified.reason ?? 'Chapa verification outcome is uncertain. Retry verification or finance reconciliation.',
      );
    }

    if (verified.outcome === 'pending') {
      this.observability.recordPaymentVerifyFailure('PAYMENT_PENDING', { orderId, txRef });
      throw new DomainRuleError(
        409,
        'PAYMENT_PENDING',
        verified.reason ?? 'Payment is still pending confirmation at Chapa.',
      );
    }

    if (!verified.verified) {
      const reason = verified.reason ?? 'Chapa verification failed.';
      this.observability.recordPaymentVerifyFailure('PAYMENT_VERIFICATION_FAILED', { orderId, txRef });
      await this.backend.recordPaymentVerificationFailureTx({
        orderId: order.id,
        paymentId: payment.id,
        failureReason: reason,
        actor: options.actorUserId ?? 'chapa',
      });
      throw new DomainRuleError(402, 'PAYMENT_VERIFICATION_FAILED', reason);
    }

    const settled = await this.backend.settleVerifiedPaymentTx({
      orderId: order.id,
      txRef,
      chapaReference: verified.chapaReference,
      verifiedVia: options.viaWebhook ? 'webhook' : 'server_verify',
      eventId: options.eventId,
      actor: options.viaWebhook ? 'chapa-webhook' : (options.actorUserId ?? 'chapa'),
    });

    if (settled.alreadySettled) {
      return {
        order: settled.order,
        payment: settled.payment,
        esim: settled.existingEsim,
        deduplicated: true,
      };
    }

    const fulfillment = await this.runFulfillmentForOrder(
      settled.order,
      options.sandboxBehavior,
      settled.reservedStockItem,
    );
    return {
      order: fulfillment.order,
      payment: settled.payment,
      esim: fulfillment.esim,
      deduplicated: false,
    };
  }

  private async runFulfillmentForOrder(
    order: EsimOrderRecord,
    sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck',
    lockedStock?: { item: EsimStockItemRecord; secret: InternalStockCredential } | null,
  ): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord | null }> {
    if (order.kycStatus === 'not_started' || order.kycStatus === 'failed') {
      throw new DomainRuleError(409, 'KYC_NOT_VERIFIED', 'Cannot provision an unverified order.');
    }
    if (order.paymentStatus !== 'verified') {
      throw new DomainRuleError(409, 'PAYMENT_NOT_VERIFIED', 'Cannot provision an unpaid order.');
    }

    await this.syncOperatorCache();
    const opCfg = this.operatorConfigCache.get(order.operatorCode);
    const activeMethod = opCfg?.activeSupplyMethod ?? order.supplyMethodUsed;

    let result;
    let stockItemIdUsed: string | null = lockedStock?.item.id ?? order.assignedStockItemId;

    if (activeMethod === 'stock_based') {
      let stockBundle = lockedStock ?? null;
      if (!stockBundle) {
        // Retry provisioning or late fulfillment: acquire atomic lock if no stock was bound
        const picked = await this.backend.reserveStockItemAtomic({
          operatorCode: order.operatorCode,
          stockItemId: order.assignedStockItemId,
          orderId: order.id,
          reservedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (picked) {
          stockItemIdUsed = picked.stockItemId;
          const items = await this.backend.listStockItems(order.operatorCode);
          const item = items.find((i) => i.id === picked.stockItemId) ?? null;
          // Note: stockBundle secret lookup handled cleanly by InMemory/PG when bound at settleVerifiedPaymentTx;
          // for PG retry, query via getStockSecret or fallback to manual queue if no encrypted payload.
          if (item) {
            stockBundle = await this.loadStockBundleById(item);
          }
        }
      }

      if (stockBundle) {
        const decrypted = decryptActivationPayload(stockBundle.secret.encryptedCredentials, this.encryptionKey);
        result = await this.stockAdapter.fulfill(
          {
            orderId: order.id,
            orderNumber: order.orderNumber,
            operatorCode: order.operatorCode,
            supplyMethod: 'stock_based',
            stockItem: stockBundle.item,
            reservedMsisdn: order.reservedMsisdn,
            deviceModel: order.deviceModel,
          },
          decrypted,
        );
      } else {
        // Fallback to Model C: Authorized Manual Partner Processing when stock is depleted
        result = await this.manualAdapter.fulfill({
          orderId: order.id,
          orderNumber: order.orderNumber,
          operatorCode: order.operatorCode,
          supplyMethod: 'manual_processing',
          stockItem: null,
          reservedMsisdn: order.reservedMsisdn,
          deviceModel: order.deviceModel,
        });
      }
    } else if (activeMethod === 'direct_api') {
      result = await this.directApiAdapter.fulfill({
        orderId: order.id,
        orderNumber: order.orderNumber,
        operatorCode: order.operatorCode,
        supplyMethod: activeMethod,
        stockItem: null,
        reservedMsisdn: order.reservedMsisdn,
        deviceModel: order.deviceModel,
        productType: order.productType,
        existingMsisdn: order.existingMsisdn,
        sandboxBehavior,
      });
    } else {
      result = await this.manualAdapter.fulfill({
        orderId: order.id,
        orderNumber: order.orderNumber,
        operatorCode: order.operatorCode,
        supplyMethod: 'manual_processing',
        stockItem: null,
        reservedMsisdn: order.reservedMsisdn,
        deviceModel: order.deviceModel,
      });
    }

    const usedMethod: SupplyMethod =
      activeMethod === 'stock_based' && result.outcome === 'awaiting_manual_fulfillment'
        ? 'manual_processing'
        : activeMethod;

    if (result.outcome === 'operator_pending') {
      const updatedOrder = await this.backend.markProvisioningStateTx({
        orderId: order.id,
        status: 'operator_pending',
        provisioningStatus: 'operator_pending',
        operatorTransactionRef: result.providerReference,
        supplyMethodUsed: usedMethod,
        failureReason: null,
        actor: order.operatorCode,
        note: `Awaiting asynchronous confirmation from operator (ref ${result.providerReference ?? 'pending'}).`,
      });
      return { order: updatedOrder, esim: null };
    }

    if (result.outcome === 'awaiting_manual_fulfillment') {
      const updatedOrder = await this.backend.markProvisioningStateTx({
        orderId: order.id,
        status: 'awaiting_manual_fulfillment',
        provisioningStatus: 'awaiting_manual_fulfillment',
        operatorTransactionRef: result.providerReference,
        supplyMethodUsed: 'manual_processing',
        failureReason: result.failureReason,
        actor: 'system',
        note: result.failureReason ?? 'Queued for authorized manual partner processing.',
      });
      return { order: updatedOrder, esim: null };
    }

    if (
      result.outcome === 'failed' ||
      !result.smdpAddress ||
      !result.activationCode ||
      !result.lpaUri ||
      (this.envMode === 'production' && result.isSandboxSimulation)
    ) {
      const failReason =
        this.envMode === 'production' && result.isSandboxSimulation
          ? 'Simulated sandbox eSIM profile cannot be delivered in production mode.'
          : result.failureReason ?? 'Provisioning failed.';
      this.observability.recordProvisioningFailure('PROVISIONING_FAILED', {
        orderId: order.id,
        operatorCode: order.operatorCode,
      });
      const updatedOrder = await this.backend.markProvisioningStateTx({
        orderId: order.id,
        status: 'failed',
        provisioningStatus: 'failed',
        operatorTransactionRef: result.providerReference,
        supplyMethodUsed: usedMethod,
        failureReason: failReason,
        releaseStockItemId: stockItemIdUsed,
        markVerifiedPaymentRefundPending: Boolean(result.requiresRefundOnFailure),
        actor: order.operatorCode,
        note: failReason,
      });
      return { order: updatedOrder, esim: null };
    }

    return this.commitEsimDelivery(order, {
      operatorTransactionRef: result.providerReference,
      supplyMethodUsed: usedMethod,
      stockItemIdToAssign: stockItemIdUsed,
      assignedMsisdn: result.assignedMsisdn,
      iccid: result.iccid,
      eid: result.eid,
      smdpAddress: result.smdpAddress,
      activationCode: result.activationCode,
      lpaUri: result.lpaUri,
      qrPayload: result.qrPayload ?? result.lpaUri,
      isSandboxSimulation: result.isSandboxSimulation,
      historyNote: 'Encrypted activation credentials stored in customer vault',
    });
  }

  private async loadStockBundleById(
    item: EsimStockItemRecord,
  ): Promise<{ item: EsimStockItemRecord; secret: InternalStockCredential } | null> {
    const secret = await this.backend.getStockCredential(item.id);
    return secret ? { item, secret } : null;
  }

  private async commitEsimDelivery(
    order: EsimOrderRecord,
    creds: {
      operatorTransactionRef: string | null;
      supplyMethodUsed: SupplyMethod;
      stockItemIdToAssign: string | null;
      assignedMsisdn: string | null;
      iccid: string | null;
      eid: string | null;
      smdpAddress: string;
      activationCode: string;
      lpaUri: string;
      qrPayload: string;
      isSandboxSimulation: boolean;
      historyNote: string;
      auditEntry?: AuditLogRecord | null;
    },
  ): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord }> {
    const now = new Date().toISOString();
    const coreId = crypto.randomUUID().slice(0, 12);
    const activationId = `act-${coreId}`;
    const esimId = `esim-${coreId}`;
    const encryptedCredentials = encryptActivationPayload(
      {
        smdpAddress: creds.smdpAddress,
        activationCode: creds.activationCode,
        lpaUri: creds.lpaUri,
        qrPayload: creds.qrPayload,
      },
      this.encryptionKey,
    );

    const vault: InternalActivationVault = {
      activationId,
      orderId: order.id,
      userId: order.userId,
      operatorCode: order.operatorCode,
      smdpAddress: creds.smdpAddress,
      iccid: creds.iccid,
      eid: creds.eid,
      assignedMsisdn: creds.assignedMsisdn,
      encryptedCredentials,
      isSandboxSimulation: creds.isSandboxSimulation,
      createdAt: now,
      downloadedAt: null,
      installedAt: null,
      activatedAt: null,
    };

    const esim: CustomerEsimRecord = {
      id: esimId,
      orderId: order.id,
      userId: order.userId,
      operatorCode: order.operatorCode,
      assignedMsisdn: creds.assignedMsisdn,
      iccid: creds.iccid,
      deviceModel: order.deviceModel,
      status: 'ready_for_installation',
      supplyMethodUsed: creds.supplyMethodUsed,
      isSandboxSimulation: creds.isSandboxSimulation,
      activationId,
      createdAt: now,
      installedAt: null,
      activatedAt: null,
    };

    let commissionCandidate: Omit<AgentCommissionRecord, 'id' | 'createdAt'> | null = null;
    if (order.attributedAgentId) {
      const ag = await this.backend.getAgentById(order.attributedAgentId);
      if (ag && ag.status === 'approved') {
        commissionCandidate = {
          agentId: ag.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          operatorCode: order.operatorCode,
          commissionAmountEtb: null,
          pricingStatus: 'pending_commercial_rate',
          status: 'pending_commercial_schedule',
        };
      }
    }

    return this.backend.completeProvisioningTx({
      orderId: order.id,
      operatorTransactionRef: creds.operatorTransactionRef,
      supplyMethodUsed: creds.supplyMethodUsed,
      stockItemIdToAssign: creds.stockItemIdToAssign,
      esim,
      activation: vault,
      iccidMasked: maskIccid(creds.iccid),
      commissionCandidate,
      historyNote: creds.historyNote,
      auditEntry: creds.auditEntry,
    });
  }

  public async pollOrderProvisioning(
    orderId: string,
    actorId: string,
    options?: { isStaff?: boolean; forceOutcome?: 'provisioned' | 'failed' | 'operator_pending' },
  ): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord | null }> {
    if (this.envMode === 'production' && options?.forceOutcome) {
      throw new DomainRuleError(
        403,
        'SANDBOX_FLAGS_FORBIDDEN',
        'Sandbox forceOutcome override is forbidden in production mode.',
      );
    }

    const order = await this.backend.getOrder(orderId);
    if (!order || (!options?.isStaff && order.userId !== actorId)) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    if (order.status !== 'operator_pending' && order.status !== 'submitted_to_operator') {
      const existingEsim = await this.backend.getEsimByOrderId(orderId);
      return { order, esim: existingEsim };
    }

    await this.syncOperatorCache();
    const result = await this.directApiAdapter.pollStatus({
      orderId: order.id,
      orderNumber: order.orderNumber,
      operatorCode: order.operatorCode,
      reservedMsisdn: order.reservedMsisdn,
      providerReference: order.operatorTransactionRef,
      forceOutcome: options?.forceOutcome,
    });

    if (result.outcome === 'operator_pending') {
      return { order, esim: null };
    }

    if (
      result.outcome === 'failed' ||
      !result.smdpAddress ||
      !result.activationCode ||
      !result.lpaUri ||
      (this.envMode === 'production' && result.isSandboxSimulation)
    ) {
      const failReason = result.failureReason ?? 'Operator provisioning failed during polling.';
      this.observability.recordProvisioningFailure('POLL_PROVISIONING_FAILED', {
        orderId: order.id,
        operatorCode: order.operatorCode,
      });
      const updatedOrder = await this.backend.markProvisioningStateTx({
        orderId: order.id,
        status: 'failed',
        provisioningStatus: 'failed',
        operatorTransactionRef: result.providerReference,
        supplyMethodUsed: order.supplyMethodUsed,
        failureReason: failReason,
        markVerifiedPaymentRefundPending: true,
        actor: order.operatorCode,
        note: failReason,
      });
      return { order: updatedOrder, esim: null };
    }

    return this.commitEsimDelivery(order, {
      operatorTransactionRef: result.providerReference,
      supplyMethodUsed: order.supplyMethodUsed,
      stockItemIdToAssign: order.assignedStockItemId,
      assignedMsisdn: result.assignedMsisdn,
      iccid: result.iccid,
      eid: result.eid,
      smdpAddress: result.smdpAddress,
      activationCode: result.activationCode,
      lpaUri: result.lpaUri,
      qrPayload: result.qrPayload ?? result.lpaUri,
      isSandboxSimulation: result.isSandboxSimulation,
      historyNote: 'Operator async provisioning completed and stored in customer vault',
    });
  }

  public async cancelOrderForUser(
    orderId: string,
    userId: string,
    reason = 'Cancelled by customer',
  ): Promise<EsimOrderRecord> {
    const order = await this.backend.getOrder(orderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }

    if (order.supplyMethodUsed === 'direct_api' && order.operatorTransactionRef) {
      await this.syncOperatorCache();
      await this.directApiAdapter.cancelOrReverse({
        operatorCode: order.operatorCode,
        providerReference: order.operatorTransactionRef,
      });
    }

    return this.backend.cancelOrderTx({
      orderId,
      userId,
      reason,
      isAdmin: false,
      auditEntry: this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'ORDER_CANCELLED_BY_CUSTOMER',
        targetType: 'esim_order',
        targetId: orderId,
        reason,
      }),
    });
  }

  public async completeManualFulfillment(
    orderId: string,
    staffUid: string,
    staffEmail: string | null,
    input: {
      assignedMsisdn?: string;
      iccid: string;
      smdpAddress: string;
      activationCode: string;
      partnerReference: string;
      isSandboxSimulation?: boolean;
    },
  ): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord }> {
    if (this.envMode === 'production' && input.isSandboxSimulation === true) {
      throw new DomainRuleError(
        403,
        'SANDBOX_FORBIDDEN_IN_PRODUCTION',
        'Simulated manual fulfillment credentials cannot be issued in production mode.',
      );
    }

    const order = await this.backend.getOrder(orderId);
    if (!order) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    const existingEsim = await this.backend.getEsimByOrderId(order.id);
    if (
      existingEsim ||
      ['provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated', 'cancelled', 'refunded'].includes(
        order.status,
      )
    ) {
      throw new DomainRuleError(
        409,
        'ORDER_ALREADY_FULFILLED',
        `Order in "${order.status}" status cannot be manually fulfilled again.`,
      );
    }
    if (order.paymentStatus !== 'verified') {
      throw new DomainRuleError(409, 'PAYMENT_REQUIRED', 'Cannot fulfill an order without verified payment.');
    }
    if (order.kycStatus === 'not_started' || order.kycStatus === 'failed') {
      throw new DomainRuleError(409, 'KYC_REQUIRED', 'Cannot fulfill an order without verified subscriber KYC.');
    }

    const smdpAddress = input.smdpAddress.trim();
    const activationCode = input.activationCode.trim();
    const lpaUri = `LPA:1$${smdpAddress}$${activationCode}`;
    const msisdn = input.assignedMsisdn
      ? normalizeEthiopianPhone(input.assignedMsisdn) ?? input.assignedMsisdn.trim()
      : order.reservedMsisdn;

    const isSandboxSim =
      this.envMode === 'production' ? false : (input.isSandboxSimulation ?? true);

    return this.commitEsimDelivery(order, {
      operatorTransactionRef: input.partnerReference.trim(),
      supplyMethodUsed: 'manual_processing',
      stockItemIdToAssign: order.assignedStockItemId,
      assignedMsisdn: msisdn,
      iccid: input.iccid.trim(),
      eid: null,
      smdpAddress,
      activationCode,
      lpaUri,
      qrPayload: lpaUri,
      isSandboxSimulation: isSandboxSim,
      historyNote: 'Manual partner processing completed; activation credentials stored in vault',
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'MANUAL_PARTNER_FULFILLMENT_COMPLETED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: `Manual fulfillment logged via partner ref ${input.partnerReference.trim()}`,
      }),
    });
  }

  public async getOrderForUser(orderId: string, userId: string): Promise<EsimOrderRecord | null> {
    const ord = await this.backend.getOrder(orderId);
    return ord && ord.userId === userId ? ord : null;
  }

  public async getOrderDetailForUser(orderId: string, userId: string): Promise<{
    order: EsimOrderRecord;
    payment: PaymentRecord | null;
    kyc: KycVerificationRecord | null;
    esim: CustomerEsimRecord | null;
  }> {
    const order = await this.backend.getOrder(orderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    const [payment, kycAudit, esim] = await Promise.all([
      this.backend.findLatestPaymentForOrder(order.id),
      this.backend.getOrderKycAndAudit(order.id),
      this.backend.getEsimByOrderId(order.id),
    ]);
    return { order, payment, kyc: kycAudit.kyc, esim };
  }

  public async getOrderDetailAdmin(orderId: string): Promise<{
    order: EsimOrderRecord;
    payment: PaymentRecord | null;
    kyc: KycVerificationRecord | null;
    esim: CustomerEsimRecord | null;
    auditEvents: AuditLogRecord[];
  }> {
    const order = await this.backend.getOrder(orderId);
    if (!order) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    const [payment, kycAudit, esim] = await Promise.all([
      this.backend.findLatestPaymentForOrder(order.id),
      this.backend.getOrderKycAndAudit(order.id),
      this.backend.getEsimByOrderId(order.id),
    ]);
    return {
      order,
      payment,
      kyc: kycAudit.kyc,
      esim,
      auditEvents: kycAudit.auditEvents,
    };
  }

  public async listOrdersForUser(userId: string): Promise<EsimOrderRecord[]> {
    await this.expireStaleReservations();
    return this.backend.listOrders(userId);
  }

  public async listEsimsForUser(userId: string): Promise<CustomerEsimRecord[]> {
    return this.backend.listEsims(userId);
  }

  public async getDecryptedActivationForUser(
    esimId: string,
    userId: string,
  ): Promise<EsimActivationSecretView> {
    const esim = await this.backend.getEsimById(esimId);
    if (!esim || esim.userId !== userId) {
      await this.recordAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'UNAUTHORIZED_ESIM_SECRET_ACCESS_BLOCKED',
        targetType: 'customer_esim',
        targetId: esimId,
        reason: 'User requested activation credentials for unowned or missing eSIM.',
      });
      throw new DomainRuleError(404, 'ESIM_NOT_FOUND', 'eSIM profile was not found for your account.');
    }

    const order = await this.backend.getOrder(esim.orderId);
    if (
      !order ||
      order.paymentStatus !== 'verified' ||
      (order.kycStatus !== 'verified_sandbox' && order.kycStatus !== 'verified_live') ||
      !['provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated'].includes(order.status)
    ) {
      throw new DomainRuleError(
        409,
        'ESIM_NOT_PROVISIONED',
        'eSIM activation credentials are only available after payment, KYC, and provisioning succeed.',
      );
    }

    const vault = await this.backend.getActivationById(esim.activationId);
    if (!vault || !vault.encryptedCredentials) {
      throw new DomainRuleError(404, 'ACTIVATION_NOT_FOUND', 'Encrypted activation payload missing.');
    }

    const decrypted = decryptActivationPayload(vault.encryptedCredentials, this.encryptionKey);
    await this.backend.markActivationDownloaded(vault.activationId);

    await this.recordAudit({
      actorType: 'customer',
      actorId: userId,
      action: 'ESIM_ACTIVATION_ACCESSED',
      targetType: 'customer_esim',
      targetId: esim.id,
      reason: 'Owner decrypted eSIM installation payload',
    });

    return {
      esimId: esim.id,
      orderId: esim.orderId,
      operatorCode: esim.operatorCode,
      assignedMsisdn: esim.assignedMsisdn,
      iccid: esim.iccid,
      smdpAddress: decrypted.smdpAddress,
      activationCode: decrypted.activationCode,
      lpaUri: decrypted.lpaUri,
      qrPayload: decrypted.qrPayload,
      isSandboxSimulation: vault.isSandboxSimulation,
      installedAt: esim.installedAt,
      activatedAt: esim.activatedAt,
    };
  }

  public async markEsimInstalled(esimId: string, userId: string): Promise<CustomerEsimRecord> {
    const esim = await this.backend.updateEsimLifecycleTx(esimId, userId, 'installed');
    if (!esim) {
      throw new DomainRuleError(404, 'ESIM_NOT_FOUND', 'eSIM profile not found.');
    }
    return esim;
  }

  public async markEsimActivated(esimId: string, userId: string): Promise<CustomerEsimRecord> {
    const esim = await this.backend.updateEsimLifecycleTx(esimId, userId, 'activated');
    if (!esim) {
      throw new DomainRuleError(404, 'ESIM_NOT_FOUND', 'eSIM profile not found.');
    }
    return esim;
  }

  /* --------------------------------------------------------------------------
   * PAYMENT RECONCILIATION & REFUNDS (ADMIN FINANCE)
   * -------------------------------------------------------------------------- */
  public async reconcilePaymentAdmin(
    paymentId: string,
    staffUid: string,
    staffEmail: string | null,
  ): Promise<PaymentRecord> {
    const payment = await this.backend.getPaymentById(paymentId);
    if (!payment) {
      throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
    }

    const now = new Date().toISOString();
    if (payment.status === 'refund_pending') {
      const refStatus = await this.chapaAdapter.verifyRefundStatus(
        payment.txRef,
        payment.refundReference ?? null,
      );
      return this.backend.updatePaymentReconcileTx({
        paymentId: payment.id,
        patch: {
          status: refStatus.refundStatus,
          refundStatusCheckedAt: now,
          reconciledAt: now,
          updatedAt: now,
        },
        verifyOrderIfVerified: false,
        actorLabel: staffEmail ?? staffUid,
        auditEntry: this.buildAudit({
          actorType: 'staff_admin',
          actorId: staffUid,
          actorEmail: staffEmail ?? undefined,
          action: 'CHAPA_REFUND_RECONCILED',
          targetType: 'payment',
          targetId: payment.id,
          reason: refStatus.note,
        }),
      });
    }

    const res = await this.chapaAdapter.verifyTransactionServerSide(payment.txRef, payment.amountEtb);
    let nextStatus = payment.status;
    let nextRef = payment.chapaReference;
    let nextVia = payment.verifiedVia;
    let verifyOrder = false;

    if (res.verified && payment.status !== 'refunded') {
      nextStatus = 'verified';
      nextRef = res.chapaReference ?? payment.chapaReference;
      nextVia = 'admin_reconcile';
      verifyOrder = true;
    } else if (res.outcome === 'failed' && payment.status === 'initialized') {
      nextStatus = 'failed';
    }

    return this.backend.updatePaymentReconcileTx({
      paymentId: payment.id,
      patch: {
        status: nextStatus,
        chapaReference: nextRef,
        verifiedVia: nextVia,
        reconciledAt: now,
        updatedAt: now,
        ...(res.outcome === 'failed' ? { failureReason: res.reason } : {}),
      },
      verifyOrderIfVerified: verifyOrder,
      actorLabel: staffEmail ?? staffUid,
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'CHAPA_PAYMENT_RECONCILED',
        targetType: 'payment',
        targetId: payment.id,
        reason: `Reconciled txRef ${payment.txRef} -> outcome ${res.outcome}, status ${nextStatus}`,
      }),
    });
  }

  public async processRefundAdmin(
    paymentId: string,
    staffUid: string,
    staffEmail: string | null,
    reason: string,
  ): Promise<PaymentRecord> {
    if (!reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Refund reason is required.');
    }

    const inFlight = this.inFlightRefunds.get(paymentId);
    if (inFlight) {
      const prior = await inFlight;
      if (prior.status === 'refunded') {
        throw new DomainRuleError(
          409,
          'CANNOT_REFUND_STATUS',
          'Payment has already been refunded.',
        );
      }
      return prior;
    }

    const run = this.executeRefundAdmin(paymentId, staffUid, staffEmail, reason.trim());
    this.inFlightRefunds.set(paymentId, run);
    try {
      return await run;
    } finally {
      this.inFlightRefunds.delete(paymentId);
    }
  }

  private async executeRefundAdmin(
    paymentId: string,
    staffUid: string,
    staffEmail: string | null,
    reason: string,
  ): Promise<PaymentRecord> {
    const { payment, alreadyRefunded } = await this.backend.beginRefundTx({ paymentId, reason });
    if (alreadyRefunded) {
      throw new DomainRuleError(409, 'CANNOT_REFUND_STATUS', 'Payment in "refunded" status cannot be refunded again.');
    }

    // If a refund reference was already created in a prior uncertain/pending attempt, verify before creating a new refund
    if (payment.status === 'refund_pending' && payment.refundReference) {
      const check = await this.chapaAdapter.verifyRefundStatus(payment.txRef, payment.refundReference);
      if (check.outcome === 'refunded') {
        return this.backend.completeRefundTx({
          paymentId: payment.id,
          orderId: payment.orderId,
          refundStatus: 'refunded',
          refundReference: payment.refundReference,
          refundReason: reason,
          note: check.note,
          actor: staffEmail ?? staffUid,
          auditEntry: this.buildAudit({
            actorType: 'staff_admin',
            actorId: staffUid,
            actorEmail: staffEmail ?? undefined,
            action: 'CHAPA_REFUND_PROCESSED',
            targetType: 'payment',
            targetId: payment.id,
            reason: check.note,
          }),
        });
      }
    }

    const refRes = await this.chapaAdapter.initiateRefund(payment.txRef, payment.amountEtb, reason, {
      idempotencyKey: `refund-${payment.id}`,
      refundReference: payment.refundReference ?? undefined,
    });

    if (!refRes.accepted && refRes.outcome === 'failed') {
      throw new DomainRuleError(409, 'CHAPA_REFUND_REJECTED', refRes.note);
    }

    return this.backend.completeRefundTx({
      paymentId: payment.id,
      orderId: payment.orderId,
      refundStatus: refRes.refundStatus,
      refundReference: refRes.refundReference,
      refundReason: reason,
      note: refRes.note,
      actor: staffEmail ?? staffUid,
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'CHAPA_REFUND_PROCESSED',
        targetType: 'payment',
        targetId: payment.id,
        reason: refRes.note,
      }),
    });
  }

  /* --------------------------------------------------------------------------
   * AGENTS
   * -------------------------------------------------------------------------- */
  public async submitAgentApplication(
    userId: string,
    userEmail: string | null,
    input: {
      fullName: string;
      phone: string;
      city: string;
      businessName?: string;
      applicantType: 'individual_agent' | 'retail_shop' | 'corporate_reseller';
      experienceSummary: string;
    },
  ): Promise<AgentApplicationRecord> {
    const existing = await this.backend.getAgentApplicationForUser(userId);
    if (existing && ['pending_review', 'approved'].includes(existing.status)) {
      throw new DomainRuleError(
        409,
        'APPLICATION_ALREADY_EXISTS',
        `You already have an agent application in "${existing.status}" status.`,
      );
    }

    const now = new Date().toISOString();
    const appRecord: AgentApplicationRecord = {
      id: `agapp-${crypto.randomUUID().slice(0, 10)}`,
      userId,
      email: userEmail,
      fullName: input.fullName.trim(),
      phone: normalizeEthiopianPhone(input.phone) ?? input.phone.trim(),
      city: input.city.trim(),
      businessName: input.businessName?.trim() || null,
      applicantType: input.applicantType,
      experienceSummary: input.experienceSummary.trim(),
      status: 'pending_review',
      reviewNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    };

    return this.backend.submitAgentApplicationTx(
      appRecord,
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        actorEmail: userEmail ?? undefined,
        action: 'AGENT_APPLICATION_SUBMITTED',
        targetType: 'agent_application',
        targetId: appRecord.id,
        reason: `Submitted ${input.applicantType} agent application`,
      }),
    );
  }

  public async getAgentApplicationForUser(userId: string): Promise<AgentApplicationRecord | null> {
    return this.backend.getAgentApplicationForUser(userId);
  }

  public async getApprovedAgentByUserId(userId: string): Promise<AgentProfileRecord | null> {
    return this.backend.getApprovedAgentByUserId(userId);
  }

  public async getAnyAgentProfileByUserId(userId: string): Promise<AgentProfileRecord | null> {
    return this.backend.getAnyAgentProfileByUserId(userId);
  }

  public async reviewAgentApplication(
    applicationId: string,
    staffUid: string,
    staffEmail: string | null,
    input: {
      decision: Extract<AgentReviewStatus, 'approved' | 'rejected' | 'suspended'>;
      reviewNotes: string;
      ethioTelecomAuthorized?: boolean;
      safaricomAuthorized?: boolean;
    },
  ): Promise<{ application: AgentApplicationRecord; agentProfile: AgentProfileRecord | null }> {
    if (!input.reviewNotes?.trim()) {
      throw new DomainRuleError(400, 'REVIEW_NOTES_REQUIRED', 'Review notes are required.');
    }

    const existingApp = (await this.backend.listAgentApplications()).find((a) => a.id === applicationId);
    if (!existingApp) {
      throw new DomainRuleError(404, 'APPLICATION_NOT_FOUND', 'Agent application not found.');
    }
    const existingProfile = await this.backend.getAnyAgentProfileByUserId(existingApp.userId);
    const now = new Date().toISOString();

    const newAgentIfApproved: AgentProfileRecord | null =
      input.decision === 'approved' && !existingProfile
        ? {
            id: `agt-${crypto.randomUUID().slice(0, 10)}`,
            userId: existingApp.userId,
            applicationId: existingApp.id,
            fullName: existingApp.fullName,
            email: existingApp.email,
            referralCode: `YT-AG-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
            status: 'approved',
            operatorAuthorizationStatus: {
              ethio_telecom: input.ethioTelecomAuthorized ? 'authorized' : 'not_authorized',
              safaricom_ethiopia: input.safaricomAuthorized ? 'authorized' : 'not_authorized',
            },
            totalAttributedOrders: 0,
            totalEarnedCommissionEtb: 0,
            totalPaidOutEtb: 0,
            approvedAt: now,
          }
        : null;

    return this.backend.reviewAgentApplicationTx({
      applicationId,
      decision: input.decision,
      reviewNotes: input.reviewNotes.trim(),
      reviewedBy: staffEmail ?? staffUid,
      reviewedAt: now,
      newAgentIfApproved,
      ethioTelecomAuthorized: input.ethioTelecomAuthorized,
      safaricomAuthorized: input.safaricomAuthorized,
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: `AGENT_APPLICATION_${input.decision.toUpperCase()}`,
        targetType: 'agent_application',
        targetId: applicationId,
        reason: input.reviewNotes.trim(),
      }),
    });
  }

  public async getAgentDashboard(agentId: string) {
    const data = await this.backend.getAgentDashboardData(agentId);
    if (!data) {
      throw new DomainRuleError(404, 'AGENT_NOT_FOUND', 'Agent profile not found.');
    }
    return data;
  }

  public async recordAgentPayout(
    agentId: string,
    staffUid: string,
    staffEmail: string | null,
    input: { amountEtb: number; paymentReference: string; status: 'scheduled' | 'paid' },
  ): Promise<AgentPayoutRecord> {
    if (!Number.isFinite(input.amountEtb) || input.amountEtb <= 0) {
      throw new DomainRuleError(400, 'INVALID_AMOUNT', 'Payout amount must be positive.');
    }
    const payout: AgentPayoutRecord = {
      id: `pay-${crypto.randomUUID().slice(0, 10)}`,
      agentId,
      amountEtb: Number(input.amountEtb.toFixed(2)),
      paymentReference: input.paymentReference.trim(),
      status: input.status,
      createdAt: new Date().toISOString(),
    };
    const saved = await this.backend.recordAgentPayoutTx(
      payout,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'AGENT_PAYOUT_RECORDED',
        targetType: 'agent_payout',
        targetId: payout.id,
        reason: `Recorded ${payout.status} payout of ${payout.amountEtb} ETB (${payout.paymentReference})`,
      }),
    );
    if (!saved) {
      throw new DomainRuleError(404, 'AGENT_NOT_FOUND', 'Agent profile not found.');
    }
    return saved;
  }

  /* --------------------------------------------------------------------------
   * SECONDARY PHONE MARKETPLACE
   * -------------------------------------------------------------------------- */
  public async createPhoneOrder(
    userId: string,
    input: {
      phoneProductId: string;
      orderKind: 'individual' | 'bulk_business';
      quantity: number;
      companyName?: string;
      contactPhone?: string;
      deliveryCity: string;
      deliveryAddress?: string;
      deliveryNotes?: string;
      pairedEsimOperator?: OperatorCode | null;
      agentReferralCode?: string | null;
    },
  ): Promise<PhoneOrderRecord> {
    const product = await this.backend.getPhoneProduct(input.phoneProductId);
    if (!product || !product.isActive) {
      throw new DomainRuleError(404, 'PHONE_PRODUCT_NOT_FOUND', 'Phone product was not found.');
    }

    const qty = Math.floor(input.quantity);
    if (!Number.isFinite(qty) || qty < 1) {
      throw new DomainRuleError(400, 'INVALID_QUANTITY', 'Quantity must be at least 1.');
    }
    if (input.orderKind === 'bulk_business' && qty < product.bulkMinimumQty) {
      throw new DomainRuleError(
        400,
        'BULK_MINIMUM_NOT_MET',
        `Bulk business orders for ${product.model} require at least ${product.bulkMinimumQty} units.`,
      );
    }
    if (qty > product.stockQty) {
      throw new DomainRuleError(
        409,
        'INSUFFICIENT_PHONE_STOCK',
        `Only ${product.stockQty} units currently in secondary phone stock.`,
      );
    }

    let normalizedContactPhone: string | null = null;
    if (input.contactPhone?.trim()) {
      normalizedContactPhone = normalizeEthiopianPhone(input.contactPhone);
      if (!normalizedContactPhone) {
        throw new DomainRuleError(
          400,
          'INVALID_CONTACT_PHONE',
          'Provide a valid Ethiopian contact phone number (+2519... or +2517...).',
        );
      }
    }

    if (
      input.pairedEsimOperator &&
      input.pairedEsimOperator !== 'ethio_telecom' &&
      input.pairedEsimOperator !== 'safaricom_ethiopia'
    ) {
      throw new DomainRuleError(400, 'INVALID_OPERATOR', 'Unsupported paired eSIM operator.');
    }

    // Strict Production Pricing Enforcement (Decision 3)
    if (
      this.envMode === 'production' &&
      (product.unitPriceEtb === null || !Number.isFinite(product.unitPriceEtb) || product.unitPriceEtb <= 0)
    ) {
      throw new DomainRuleError(
        409,
        'PRODUCTION_PRICE_NOT_CONFIGURED',
        `Official ETB price for "${product.model}" is not yet configured for production checkout.`,
      );
    }

    let attributedAgentId: string | null = null;
    if (input.agentReferralCode?.trim()) {
      const ag = await this.backend.getAgentByReferralCode(input.agentReferralCode.trim().toUpperCase());
      if (ag && ag.status === 'approved') attributedAgentId = ag.id;
    }

    const hasOfficialPrice =
      product.unitPriceEtb !== null && Number.isFinite(product.unitPriceEtb) && product.unitPriceEtb > 0;
    const unitBasis = hasOfficialPrice
      ? product.unitPriceEtb!
      : this.envMode === 'production'
        ? 0
        : (product.sandboxPreviewPriceEtb ?? 0);

    const order: PhoneOrderRecord = {
      id: `phord-${crypto.randomUUID().slice(0, 10)}`,
      orderNumber: makeOrderNumber('PH'),
      userId,
      phoneProductId: product.id,
      phoneModel: product.model,
      orderKind: input.orderKind,
      quantity: qty,
      companyName: input.companyName?.trim() || null,
      contactPhone: normalizedContactPhone,
      deliveryCity: input.deliveryCity.trim(),
      deliveryAddress: input.deliveryAddress?.trim() || null,
      deliveryNotes: input.deliveryNotes?.trim() || null,
      pairedEsimOperator: input.pairedEsimOperator ?? null,
      estimatedTotalEtb: Number((unitBasis * qty).toFixed(2)),
      isSandboxEstimate: !hasOfficialPrice,
      paymentStatus: 'pending',
      paymentReference: null,
      checkoutUrl: null,
      fulfillmentStatus: 'awaiting_confirmation',
      klickDeliveryPartnerStatus: 'klick_boundary_pending_onboarding',
      attributedAgentId,
      createdAt: new Date().toISOString(),
    };

    return this.backend.createPhoneOrderTx(
      order,
      qty,
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'PHONE_ORDER_CREATED',
        targetType: 'phone_order',
        targetId: order.id,
        reason: `${input.orderKind} order for ${qty}x ${product.model}${normalizedContactPhone ? ` (${normalizedContactPhone})` : ''}`,
      }),
    );
  }

  public async initChapaPaymentForPhoneOrder(
    phoneOrderId: string,
    userId: string,
    customerEmail: string | null,
    returnUrl: string,
  ): Promise<{ order: PhoneOrderRecord; payment: PaymentRecord; checkoutUrl: string }> {
    const order = await this.backend.getPhoneOrder(phoneOrderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'PHONE_ORDER_NOT_FOUND', 'Phone order not found for your account.');
    }
    if (order.paymentStatus === 'verified') {
      throw new DomainRuleError(409, 'PHONE_ORDER_ALREADY_PAID', 'This phone order is already paid.');
    }
    if (order.fulfillmentStatus === 'cancelled') {
      throw new DomainRuleError(409, 'PHONE_ORDER_CANCELLED', 'Cancelled phone orders cannot start checkout.');
    }

    if (this.envMode === 'production') {
      if (!Number.isFinite(order.estimatedTotalEtb) || order.estimatedTotalEtb <= 0 || order.isSandboxEstimate) {
        throw new DomainRuleError(
          409,
          'PRODUCTION_PRICE_NOT_CONFIGURED',
          'Official active ETB pricing is required before initiating phone checkout in production mode.',
        );
      }
      if (!this.chapaAdapter.isLiveConfigured()) {
        throw new DomainRuleError(
          503,
          'PAYMENT_PROVIDER_UNCONFIGURED',
          'Chapa live credentials are required before initiating checkout in production mode.',
        );
      }
    }

    const user = await this.backend.getUser(userId);
    const initialized = await this.chapaAdapter.initializeCheckout({
      orderType: 'phone_order',
      orderId: order.id,
      userId,
      amountEtb: order.estimatedTotalEtb,
      customerEmail: customerEmail ?? user?.email ?? null,
      customerName: user?.displayName ?? null,
      customerPhone: order.contactPhone ?? user?.phoneNumber ?? null,
      returnUrl,
    });

    const updated = await this.backend.updatePhoneOrderTx(
      order.id,
      {
        paymentStatus: 'initialized',
        paymentReference: initialized.payment.txRef,
        checkoutUrl: initialized.checkoutUrl,
      },
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'PHONE_ORDER_CHECKOUT_INITIALIZED',
        targetType: 'phone_order',
        targetId: order.id,
        reason: `Initialized Chapa phone checkout (${initialized.payment.txRef})`,
      }),
    );

    if (!updated) {
      throw new DomainRuleError(404, 'PHONE_ORDER_NOT_FOUND', 'Phone order not found.');
    }

    return { order: updated, payment: initialized.payment, checkoutUrl: initialized.checkoutUrl };
  }

  public async verifyPaymentAndConfirmPhoneOrder(
    phoneOrderId: string,
    userId: string,
    txRef: string,
    options?: { simulatePaymentFailure?: boolean },
  ): Promise<{ order: PhoneOrderRecord; verified: boolean }> {
    if (this.envMode === 'production' && options?.simulatePaymentFailure) {
      throw new DomainRuleError(
        403,
        'SANDBOX_FLAGS_FORBIDDEN',
        'Sandbox simulation flags are rejected in production mode.',
      );
    }

    const order = await this.backend.getPhoneOrder(phoneOrderId);
    if (!order || order.userId !== userId) {
      throw new DomainRuleError(404, 'PHONE_ORDER_NOT_FOUND', 'Phone order not found for your account.');
    }
    if (order.paymentStatus === 'verified') {
      return { order, verified: true };
    }
    if (order.paymentReference && order.paymentReference !== txRef) {
      throw new DomainRuleError(
        400,
        'TX_REF_MISMATCH',
        'Payment reference does not match this phone order checkout session.',
      );
    }

    const verified = await this.chapaAdapter.verifyTransactionServerSide(txRef, order.estimatedTotalEtb, {
      simulateFailure: options?.simulatePaymentFailure,
    });

    if (verified.outcome === 'uncertain') {
      throw new DomainRuleError(
        503,
        'PAYMENT_STATUS_UNCERTAIN',
        verified.reason ?? 'Chapa verification outcome is uncertain. Retry verification.',
      );
    }
    if (verified.outcome === 'pending') {
      throw new DomainRuleError(
        409,
        'PAYMENT_PENDING',
        verified.reason ?? 'Payment is still pending confirmation at Chapa.',
      );
    }

    if (!verified.verified) {
      const failReason = verified.reason ?? 'Chapa verification failed.';
      await this.backend.updatePhoneOrderTx(
        order.id,
        { paymentStatus: 'failed' },
        this.buildAudit({
          actorType: 'customer',
          actorId: userId,
          action: 'PHONE_ORDER_PAYMENT_FAILED',
          targetType: 'phone_order',
          targetId: order.id,
          reason: failReason,
        }),
      );
      throw new DomainRuleError(402, 'PAYMENT_VERIFICATION_FAILED', failReason);
    }

    const updated = await this.backend.updatePhoneOrderTx(
      order.id,
      {
        paymentStatus: 'verified',
        paymentReference: txRef,
      },
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        action: 'PHONE_ORDER_PAYMENT_VERIFIED',
        targetType: 'phone_order',
        targetId: order.id,
        reason: `Verified phone payment ${txRef} (${verified.chapaReference ?? 'chapa'})`,
      }),
    );

    if (!updated) {
      throw new DomainRuleError(404, 'PHONE_ORDER_NOT_FOUND', 'Phone order not found.');
    }

    return { order: updated, verified: true };
  }

  public async listPhoneOrdersForUser(userId: string): Promise<PhoneOrderRecord[]> {
    return this.backend.listPhoneOrders(userId);
  }

  public async listAllPhoneOrdersAdmin(): Promise<PhoneOrderRecord[]> {
    return this.backend.listPhoneOrders();
  }

  public async createPhoneProductAdmin(
    staffUid: string,
    staffEmail: string | null,
    input: {
      brand: string;
      category: PhoneCategory;
      model: string;
      exactModelNumber: string;
      regionalVariant: string;
      storage: string;
      condition: string;
      warrantySummary: string;
      esimCompatibilityStatus: PhoneCompatibilityStatus;
      networkUnlockStatus: PhoneUnlockStatus;
      ethioTelecomCompatibility: 'verified' | 'not_compatible' | 'unverified';
      safaricomCompatibility: 'verified' | 'not_compatible' | 'unverified';
      compatibilityNotes: string;
      compatibilityEvidence?: string | null;
      imageKey?: string | null;
      imageUrl?: string | null;
      isFeatured?: boolean;
      unitPriceEtb?: number | null;
      sandboxPreviewPriceEtb?: number | null;
      stockQty: number;
      bulkMinimumQty?: number;
      supportsBulkOrder?: boolean;
      isActive?: boolean;
      reason: string;
    },
  ): Promise<PhoneProductRecord> {
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required.');
    }
    if (!input.brand?.trim() || !input.model?.trim() || !input.storage?.trim()) {
      throw new DomainRuleError(400, 'VALIDATION_ERROR', 'Brand, model, and storage are required.');
    }
    if (input.esimCompatibilityStatus === 'verified_compatible') {
      if (!input.exactModelNumber?.trim() || !input.compatibilityEvidence?.trim()) {
        throw new DomainRuleError(
          400,
          'COMPATIBILITY_EVIDENCE_REQUIRED',
          'Verified eSIM compatibility requires both an exact model number and explicit compatibility evidence.',
        );
      }
    }
    if (
      input.unitPriceEtb !== undefined &&
      input.unitPriceEtb !== null &&
      (!Number.isFinite(Number(input.unitPriceEtb)) || Number(input.unitPriceEtb) <= 0)
    ) {
      throw new DomainRuleError(400, 'INVALID_PRICE', 'Official phone price must be greater than 0 ETB.');
    }

    const now = new Date().toISOString();
    const officialPrice =
      input.unitPriceEtb !== undefined && input.unitPriceEtb !== null
        ? Number(Number(input.unitPriceEtb).toFixed(2))
        : null;
    const product: PhoneProductRecord = {
      id: `phone-${crypto.randomUUID().slice(0, 8)}`,
      brand: input.brand.trim(),
      category: input.category,
      model: input.model.trim(),
      exactModelNumber: input.exactModelNumber?.trim() ?? '',
      regionalVariant: input.regionalVariant?.trim() || 'Global Variant',
      storage: input.storage.trim(),
      condition: input.condition?.trim() || 'Brand New · Sealed',
      warrantySummary: input.warrantySummary?.trim() || 'Standard Seller Warranty',
      esimCapable: input.esimCompatibilityStatus === 'verified_compatible',
      esimCompatibilityStatus: input.esimCompatibilityStatus,
      networkUnlockStatus: input.networkUnlockStatus,
      ethioTelecomCompatibility: input.ethioTelecomCompatibility,
      safaricomCompatibility: input.safaricomCompatibility,
      compatibilityNotes: input.compatibilityNotes?.trim() ?? '',
      compatibilityEvidence: input.compatibilityEvidence?.trim() || null,
      imageKey: input.imageKey?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      isFeatured: Boolean(input.isFeatured),
      unitPriceEtb: officialPrice,
      sandboxPreviewPriceEtb:
        input.sandboxPreviewPriceEtb !== undefined && input.sandboxPreviewPriceEtb !== null
          ? Number(Number(input.sandboxPreviewPriceEtb).toFixed(2))
          : null,
      pricingStatus: officialPrice !== null ? 'active' : 'pending_commercial_quote',
      stockQty: Math.max(0, Math.floor(Number(input.stockQty ?? 0))),
      bulkMinimumQty: Math.max(1, Math.floor(Number(input.bulkMinimumQty ?? 5))),
      supportsBulkOrder: input.supportsBulkOrder ?? true,
      deliveryPartner: 'klick',
      isActive: input.isActive ?? true,
      updatedAt: now,
    };

    return this.backend.upsertPhoneProductTx(
      product,
      true,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'PHONE_PRODUCT_CREATED',
        targetType: 'phone_product',
        targetId: product.id,
        reason: `${input.reason.trim()} [${product.brand} ${product.model} (${product.exactModelNumber || 'no model code'}) · ${product.esimCompatibilityStatus}]`,
      }),
    );
  }

  public async updatePhoneProductAdmin(
    phoneId: string,
    staffUid: string,
    staffEmail: string | null,
    input: Partial<{
      brand: string;
      category: PhoneCategory;
      model: string;
      exactModelNumber: string;
      regionalVariant: string;
      storage: string;
      condition: string;
      warrantySummary: string;
      esimCompatibilityStatus: PhoneCompatibilityStatus;
      networkUnlockStatus: PhoneUnlockStatus;
      ethioTelecomCompatibility: 'verified' | 'not_compatible' | 'unverified';
      safaricomCompatibility: 'verified' | 'not_compatible' | 'unverified';
      compatibilityNotes: string;
      compatibilityEvidence: string | null;
      imageKey: string | null;
      imageUrl: string | null;
      isFeatured: boolean;
      unitPriceEtb: number | null;
      sandboxPreviewPriceEtb: number | null;
      stockQty: number;
      bulkMinimumQty: number;
      supportsBulkOrder: boolean;
      isActive: boolean;
    }> & { reason: string },
  ): Promise<PhoneProductRecord> {
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required.');
    }
    const existing = await this.backend.getPhoneProduct(phoneId);
    if (!existing) {
      throw new DomainRuleError(404, 'PHONE_PRODUCT_NOT_FOUND', 'Phone product not found.');
    }

    const nextCompatStatus = input.esimCompatibilityStatus ?? existing.esimCompatibilityStatus;
    const nextExactModel =
      input.exactModelNumber !== undefined ? input.exactModelNumber.trim() : existing.exactModelNumber;
    const nextEvidence =
      input.compatibilityEvidence !== undefined
        ? input.compatibilityEvidence?.trim() || null
        : existing.compatibilityEvidence;

    if (nextCompatStatus === 'verified_compatible' && (!nextExactModel || !nextEvidence)) {
      throw new DomainRuleError(
        400,
        'COMPATIBILITY_EVIDENCE_REQUIRED',
        'Verified eSIM compatibility requires both an exact model number and explicit compatibility evidence.',
      );
    }

    if (
      input.unitPriceEtb !== undefined &&
      input.unitPriceEtb !== null &&
      (!Number.isFinite(Number(input.unitPriceEtb)) || Number(input.unitPriceEtb) <= 0)
    ) {
      throw new DomainRuleError(400, 'INVALID_PRICE', 'Official phone price must be greater than 0 ETB.');
    }

    const nextUnitPrice =
      input.unitPriceEtb !== undefined
        ? input.unitPriceEtb === null
          ? null
          : Number(Number(input.unitPriceEtb).toFixed(2))
        : existing.unitPriceEtb;

    const updated: PhoneProductRecord = {
      ...existing,
      brand: input.brand !== undefined ? input.brand.trim() : existing.brand,
      category: input.category ?? existing.category,
      model: input.model !== undefined ? input.model.trim() : existing.model,
      exactModelNumber: nextExactModel,
      regionalVariant:
        input.regionalVariant !== undefined ? input.regionalVariant.trim() : existing.regionalVariant,
      storage: input.storage !== undefined ? input.storage.trim() : existing.storage,
      condition: input.condition !== undefined ? input.condition.trim() : existing.condition,
      warrantySummary:
        input.warrantySummary !== undefined ? input.warrantySummary.trim() : existing.warrantySummary,
      esimCompatibilityStatus: nextCompatStatus,
      esimCapable: nextCompatStatus === 'verified_compatible',
      networkUnlockStatus: input.networkUnlockStatus ?? existing.networkUnlockStatus,
      ethioTelecomCompatibility: input.ethioTelecomCompatibility ?? existing.ethioTelecomCompatibility,
      safaricomCompatibility: input.safaricomCompatibility ?? existing.safaricomCompatibility,
      compatibilityNotes:
        input.compatibilityNotes !== undefined
          ? input.compatibilityNotes.trim()
          : existing.compatibilityNotes,
      compatibilityEvidence: nextEvidence,
      imageKey: input.imageKey !== undefined ? input.imageKey?.trim() || null : existing.imageKey,
      imageUrl: input.imageUrl !== undefined ? input.imageUrl?.trim() || null : existing.imageUrl,
      isFeatured: input.isFeatured ?? existing.isFeatured,
      unitPriceEtb: nextUnitPrice,
      pricingStatus: nextUnitPrice !== null ? 'active' : 'pending_commercial_quote',
      sandboxPreviewPriceEtb:
        input.sandboxPreviewPriceEtb !== undefined
          ? input.sandboxPreviewPriceEtb === null
            ? null
            : Number(Number(input.sandboxPreviewPriceEtb).toFixed(2))
          : existing.sandboxPreviewPriceEtb,
      stockQty:
        input.stockQty !== undefined ? Math.max(0, Math.floor(Number(input.stockQty))) : existing.stockQty,
      bulkMinimumQty:
        input.bulkMinimumQty !== undefined
          ? Math.max(1, Math.floor(Number(input.bulkMinimumQty)))
          : existing.bulkMinimumQty,
      supportsBulkOrder: input.supportsBulkOrder ?? existing.supportsBulkOrder,
      isActive: input.isActive ?? existing.isActive,
      updatedAt: new Date().toISOString(),
    };

    return this.backend.upsertPhoneProductTx(
      updated,
      false,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'PHONE_PRODUCT_UPDATED',
        targetType: 'phone_product',
        targetId: updated.id,
        reason: `${input.reason.trim()} [compat: ${existing.esimCompatibilityStatus} -> ${updated.esimCompatibilityStatus}, price: ${existing.unitPriceEtb ?? 'null'} -> ${updated.unitPriceEtb ?? 'null'}]`,
      }),
    );
  }

  public async updatePhoneOrderStatusAdmin(
    phoneOrderId: string,
    staffUid: string,
    staffEmail: string | null,
    patch: {
      fulfillmentStatus?: PhoneOrderRecord['fulfillmentStatus'];
      klickDeliveryPartnerStatus?: PhoneOrderRecord['klickDeliveryPartnerStatus'];
    },
  ): Promise<PhoneOrderRecord> {
    const updated = await this.backend.updatePhoneOrderTx(
      phoneOrderId,
      patch,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'PHONE_ORDER_UPDATED',
        targetType: 'phone_order',
        targetId: phoneOrderId,
        reason: `Updated phone order fulfillment=${patch.fulfillmentStatus ?? 'unchanged'}`,
      }),
    );
    if (!updated) {
      throw new DomainRuleError(404, 'PHONE_ORDER_NOT_FOUND', 'Phone order not found.');
    }
    return updated;
  }

  /* --------------------------------------------------------------------------
   * SUPPORT, ADMIN OPERATIONS & OVERVIEW
   * -------------------------------------------------------------------------- */
  public async createSupportTicket(input: {
    userId: string | null;
    email: string;
    subject: string;
    category: SupportTicketRecord['category'];
    orderId?: string | null;
    message: string;
  }): Promise<SupportTicketRecord> {
    const ticket: SupportTicketRecord = {
      id: `sup-${crypto.randomUUID().slice(0, 10)}`,
      userId: input.userId,
      email: input.email.trim(),
      subject: input.subject.trim(),
      category: input.category,
      orderId: input.orderId?.trim() || null,
      message: input.message.trim(),
      status: 'open',
      adminResponse: null,
      createdAt: new Date().toISOString(),
    };
    return this.backend.createSupportTicket(ticket);
  }

  public async listSupportTicketsForUser(userId: string): Promise<SupportTicketRecord[]> {
    return this.backend.listSupportTickets(userId);
  }

  public async listAllSupportTicketsAdmin(): Promise<SupportTicketRecord[]> {
    return this.backend.listSupportTickets();
  }

  public async updateSupportTicketAdmin(
    ticketId: string,
    staffUid: string,
    staffEmail: string | null,
    input: { status: SupportTicketRecord['status']; adminResponse: string },
  ): Promise<SupportTicketRecord> {
    const updated = await this.backend.updateSupportTicketTx(
      ticketId,
      input.status,
      input.adminResponse.trim(),
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'SUPPORT_TICKET_UPDATED',
        targetType: 'support_ticket',
        targetId: ticketId,
        reason: `Status set to ${input.status}`,
      }),
    );
    if (!updated) {
      throw new DomainRuleError(404, 'TICKET_NOT_FOUND', 'Support ticket not found.');
    }
    return updated;
  }

  public async updateOperatorConfigAdmin(
    code: OperatorCode,
    staffUid: string,
    staffEmail: string | null,
    input: {
      isEnabled?: boolean;
      integrationStatus?: OperatorConfigRecord['integrationStatus'];
      activeSupplyMethod?: SupplyMethod;
      supportsSimConversion?: boolean;
      supportsPrePaymentReservation?: boolean;
      customerVisibleNote?: string;
      reason: string;
    },
  ): Promise<OperatorConfigRecord> {
    if (!input.reason?.trim()) {
      throw new DomainRuleError(
        400,
        'REASON_REQUIRED',
        'Operational reason is required to change operator configuration.',
      );
    }
    const cfg = await this.getOperator(code);
    if (!cfg) {
      throw new DomainRuleError(404, 'OPERATOR_NOT_FOUND', 'Operator configuration not found.');
    }
    if (typeof input.isEnabled === 'boolean') cfg.isEnabled = input.isEnabled;
    if (input.integrationStatus) cfg.integrationStatus = input.integrationStatus;
    if (input.activeSupplyMethod) {
      cfg.activeSupplyMethod = input.activeSupplyMethod;
      cfg.provisioningStatus =
        input.activeSupplyMethod === 'manual_processing' ? 'manual_queue' : 'operational_sandbox';
    }
    if (typeof input.supportsPrePaymentReservation === 'boolean') {
      cfg.supportsPrePaymentReservation = input.supportsPrePaymentReservation;
    }
    if (typeof input.supportsSimConversion === 'boolean') {
      cfg.supportsSimConversion = input.supportsSimConversion;
    }
    if (typeof input.customerVisibleNote === 'string') {
      cfg.customerVisibleNote = input.customerVisibleNote.trim();
    }
    cfg.updatedAt = new Date().toISOString();

    const updated = await this.backend.updateOperatorTx(
      cfg,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'OPERATOR_CONFIG_UPDATED',
        targetType: 'operator_config',
        targetId: code,
        reason: input.reason.trim(),
      }),
    );
    this.operatorConfigCache.set(updated.operatorCode, updated);
    return updated;
  }

  public async updateProductAdmin(
    productId: string,
    staffUid: string,
    staffEmail: string | null,
    input: {
      priceEtb?: number | null;
      sandboxPreviewAmountEtb?: number | null;
      isActive?: boolean;
      reason: string;
    },
  ): Promise<EsimProductRecord> {
    const product = await this.backend.getEsimProduct(productId);
    if (!product) {
      throw new DomainRuleError(404, 'PRODUCT_NOT_FOUND', 'eSIM product not found.');
    }
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required.');
    }

    const prevPrice = product.priceEtb;
    if (input.priceEtb !== undefined) {
      if (input.priceEtb !== null && (!Number.isFinite(Number(input.priceEtb)) || Number(input.priceEtb) <= 0)) {
        throw new DomainRuleError(
          400,
          'INVALID_PRICE',
          'Official eSIM price must be greater than 0 ETB (or null while pending agreement).',
        );
      }
      product.priceEtb = input.priceEtb === null ? null : Number(Number(input.priceEtb).toFixed(2));
      product.pricingStatus = product.priceEtb !== null ? 'active' : 'pending_operator_agreement';
    }
    if (input.sandboxPreviewAmountEtb !== undefined) {
      if (
        input.sandboxPreviewAmountEtb !== null &&
        (!Number.isFinite(Number(input.sandboxPreviewAmountEtb)) || Number(input.sandboxPreviewAmountEtb) < 0)
      ) {
        throw new DomainRuleError(400, 'INVALID_PRICE', 'Sandbox preview amount cannot be negative.');
      }
      product.sandboxPreviewAmountEtb =
        input.sandboxPreviewAmountEtb === null ? null : Number(input.sandboxPreviewAmountEtb);
    }
    if (typeof input.isActive === 'boolean') {
      product.isActive = input.isActive;
    }
    product.updatedAt = new Date().toISOString();

    const priceAuditNote =
      input.priceEtb !== undefined
        ? ` [priceEtb: ${prevPrice ?? 'null'} -> ${product.priceEtb ?? 'null'} ETB]`
        : '';

    return this.backend.updateEsimProductTx(
      product,
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'ESIM_PRODUCT_UPDATED',
        targetType: 'esim_product',
        targetId: product.id,
        reason: `${input.reason.trim()}${priceAuditNote}`,
      }),
    );
  }

  public async updateOrderStatusAdmin(
    orderId: string,
    staffUid: string,
    staffEmail: string | null,
    input: { action: 'retry_provisioning' | 'refund' | 'cancel'; reason: string },
  ): Promise<EsimOrderRecord> {
    const order = await this.backend.getOrder(orderId);
    if (!order) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    if (!input.reason?.trim()) {
      throw new DomainRuleError(400, 'REASON_REQUIRED', 'Audit reason is required.');
    }

    if (input.action === 'retry_provisioning') {
      if (order.paymentStatus !== 'verified' || order.kycStatus === 'not_started' || order.kycStatus === 'failed') {
        throw new DomainRuleError(409, 'CANNOT_RETRY_UNVERIFIED', 'Order must have verified KYC and payment first.');
      }
      const res = await this.runFulfillmentForOrder(order);
      await this.recordAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'ORDER_PROVISIONING_RETRIED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: input.reason.trim(),
      });
      return res.order;
    }

    if (input.action === 'refund') {
      const pay = await this.backend.findLatestPaymentForOrder(order.id);
      if (pay && ['verified', 'refund_pending'].includes(pay.status)) {
        await this.processRefundAdmin(pay.id, staffUid, staffEmail, input.reason.trim());
        return (await this.backend.getOrder(order.id))!;
      }
    }

    return this.backend.cancelOrderTx({
      orderId: order.id,
      userId: order.userId,
      reason: input.reason.trim(),
      isAdmin: true,
      actorEmail: staffEmail,
      auditEntry: this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: input.action === 'refund' ? 'ORDER_REFUNDED' : 'ORDER_CANCELLED',
        targetType: 'esim_order',
        targetId: order.id,
        reason: input.reason.trim(),
      }),
    });
  }

  public async getAdminOverview() {
    await this.expireStaleReservations();
    await this.expireStalePayments();
    const [metrics, operators, allOrders, scheduledJobs] = await Promise.all([
      this.backend.getOverviewMetrics(),
      this.listOperators(),
      this.backend.listOrders(),
      this.backend.listScheduledJobRuns('payment_expiry_sweep', 10),
    ]);

    return {
      metrics,
      operators,
      recentOrders: allOrders.slice(0, 10),
      observability: this.observability.getSnapshot(),
      scheduledJobs,
    };
  }

  public async listAllOrdersAdmin(): Promise<EsimOrderRecord[]> {
    await this.expireStaleReservations();
    await this.expireStalePayments();
    return this.backend.listOrders();
  }

  public async listAllPaymentsAdmin(): Promise<PaymentRecord[]> {
    await this.expireStalePayments();
    return this.backend.listPayments();
  }

  public async listAllCustomersAdmin(): Promise<VerifiedUserSummary[]> {
    return this.backend.listUsers();
  }

  public async listAllAgentApplicationsAdmin(): Promise<AgentApplicationRecord[]> {
    return this.backend.listAgentApplications();
  }

  public async listAllAgentsAdmin(): Promise<AgentProfileRecord[]> {
    return this.backend.listAgents();
  }

  public async listAuditLogs(limit = 100): Promise<AuditLogRecord[]> {
    return this.backend.listAuditLogs(limit);
  }

  /* --------------------------------------------------------------------------
   * BUSINESS CUSTOMER ACCOUNTS & BULK eSIM PREPARATION
   * -------------------------------------------------------------------------- */
  public async getBusinessPortalForUser(
    userId: string,
    userEmail: string | null,
  ): Promise<{
    account: BusinessAccountRecord | null;
    memberRole: BusinessMemberRole | null;
    members: BusinessMemberRecord[];
    bulkOrders: BusinessBulkOrderRecord[];
  }> {
    const userRecord = await this.backend.getUser(userId);
    return this.backend.getBusinessPortal(userId, userEmail, Boolean(userRecord?.emailVerified));
  }

  public async upsertBusinessAccountForUser(
    userId: string,
    userEmail: string | null,
    input: {
      companyName: string;
      tinNumber: string;
      contactEmail: string;
      contactPhone: string;
      city: string;
    },
  ): Promise<BusinessAccountRecord> {
    if (!input.companyName?.trim() || !input.tinNumber?.trim() || !input.contactEmail?.trim() || !input.city?.trim()) {
      throw new DomainRuleError(
        400,
        'VALIDATION_ERROR',
        'Company name, Ethiopian TIN/registration reference, contact email, and city are required.',
      );
    }

    const portal = await this.getBusinessPortalForUser(userId, userEmail);
    const existing = portal.account && portal.account.ownerUserId === userId ? portal.account : null;
    const now = new Date().toISOString();
    const normPhone = normalizeEthiopianPhone(input.contactPhone) ?? input.contactPhone.trim();

    if (existing) {
      const updatedAccount: BusinessAccountRecord = {
        ...existing,
        companyName: input.companyName.trim(),
        tinNumber: input.tinNumber.trim(),
        contactEmail: input.contactEmail.trim().toLowerCase(),
        contactPhone: normPhone,
        city: input.city.trim(),
        updatedAt: now,
      };
      return this.backend.upsertBusinessAccountTx({
        userId,
        account: updatedAccount,
        ownerMemberIfNew: null,
        isUpdate: true,
        auditEntry: this.buildAudit({
          actorType: 'customer',
          actorId: userId,
          actorEmail: userEmail ?? undefined,
          action: 'BUSINESS_PROFILE_UPDATED',
          targetType: 'business_account',
          targetId: updatedAccount.id,
          reason: `Updated business profile for ${updatedAccount.companyName}`,
        }),
      });
    }

    const account: BusinessAccountRecord = {
      id: `biz-${crypto.randomUUID().slice(0, 10)}`,
      ownerUserId: userId,
      companyName: input.companyName.trim(),
      tinNumber: input.tinNumber.trim(),
      contactEmail: input.contactEmail.trim().toLowerCase(),
      contactPhone: normPhone,
      city: input.city.trim(),
      verificationStatus: 'pending_review',
      pricingTermsStatus: 'pending_commercial_agreement',
      commercialNotes: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const ownerRecord = await this.backend.getUser(userId);
    const ownerMember: BusinessMemberRecord = {
      id: `bmem-${crypto.randomUUID().slice(0, 10)}`,
      businessId: account.id,
      email: (userEmail ?? account.contactEmail).toLowerCase(),
      fullName: ownerRecord?.displayName ?? account.companyName,
      role: 'owner',
      status: 'active',
      addedByUserId: userId,
      createdAt: now,
    };

    return this.backend.upsertBusinessAccountTx({
      userId,
      account,
      ownerMemberIfNew: ownerMember,
      isUpdate: false,
      auditEntry: this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        actorEmail: userEmail ?? undefined,
        action: 'BUSINESS_ACCOUNT_CREATED',
        targetType: 'business_account',
        targetId: account.id,
        reason: `Registered Business Account for ${account.companyName} (pending commercial verification)`,
      }),
    });
  }

  public async addBusinessMemberForUser(
    userId: string,
    userEmail: string | null,
    input: { email: string; fullName: string; role: BusinessMemberRole },
  ): Promise<BusinessMemberRecord> {
    const portal = await this.getBusinessPortalForUser(userId, userEmail);
    if (!portal.account) {
      throw new DomainRuleError(404, 'BUSINESS_NOT_FOUND', 'Create a Business Account profile first.');
    }
    if (portal.memberRole !== 'owner') {
      throw new DomainRuleError(
        403,
        'FORBIDDEN_BUSINESS_ROLE',
        'Only the Business Account owner can manage team members.',
      );
    }
    const cleanEmail = input.email.trim().toLowerCase();
    if (!cleanEmail.includes('@') || !input.fullName?.trim()) {
      throw new DomainRuleError(400, 'VALIDATION_ERROR', 'Valid member email and full name are required.');
    }
    const duplicate = portal.members.find((m) => m.email.toLowerCase() === cleanEmail);
    if (duplicate) {
      throw new DomainRuleError(409, 'MEMBER_EXISTS', 'This email is already registered on the business team.');
    }

    const member: BusinessMemberRecord = {
      id: `bmem-${crypto.randomUUID().slice(0, 10)}`,
      businessId: portal.account.id,
      email: cleanEmail,
      fullName: input.fullName.trim(),
      role: input.role,
      status: 'invited',
      addedByUserId: userId,
      createdAt: new Date().toISOString(),
    };

    return this.backend.addBusinessMemberTx(
      member,
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        actorEmail: userEmail ?? undefined,
        action: 'BUSINESS_MEMBER_ADDED',
        targetType: 'business_account',
        targetId: portal.account.id,
        reason: `Added ${cleanEmail} as business ${input.role}`,
      }),
    );
  }

  public async createBusinessBulkOrderForUser(
    userId: string,
    userEmail: string | null,
    input: {
      operatorCode: OperatorCode;
      serviceType: 'new_esim_line' | 'sim_to_esim_conversion';
      quantity: number;
      preferredTier?: NumberTier;
      departmentNote?: string;
    },
  ): Promise<BusinessBulkOrderRecord> {
    const portal = await this.getBusinessPortalForUser(userId, userEmail);
    if (!portal.account) {
      throw new DomainRuleError(
        404,
        'BUSINESS_NOT_FOUND',
        'Register your Business Account before preparing bulk eSIM orders.',
      );
    }
    if (portal.memberRole === 'viewer') {
      throw new DomainRuleError(403, 'FORBIDDEN_BUSINESS_ROLE', 'Business viewers cannot submit bulk eSIM requests.');
    }
    if (portal.account.verificationStatus === 'suspended') {
      throw new DomainRuleError(403, 'BUSINESS_SUSPENDED', 'This Business Account is currently suspended.');
    }
    const qty = Math.floor(Number(input.quantity));
    if (!Number.isFinite(qty) || qty < 2 || qty > 500) {
      throw new DomainRuleError(400, 'INVALID_QUANTITY', 'Bulk eSIM preparation requests must be between 2 and 500 lines.');
    }
    const op = await this.getOperator(input.operatorCode);
    if (!op) {
      throw new DomainRuleError(404, 'OPERATOR_NOT_FOUND', 'Selected operator was not found.');
    }

    const now = new Date().toISOString();
    const bulk: BusinessBulkOrderRecord = {
      id: `bbulk-${crypto.randomUUID().slice(0, 10)}`,
      requestNumber: makeOrderNumber('BIZ'),
      businessId: portal.account.id,
      requestedByUserId: userId,
      operatorCode: input.operatorCode,
      serviceType: input.serviceType,
      quantity: qty,
      preferredTier: input.preferredTier ?? 'standard',
      departmentNote: input.departmentNote?.trim() || null,
      estimatedAmountEtb: null,
      pricingNote: 'Pending approved corporate/operator commercial quote — no automated discount applied.',
      status: 'pending_commercial_review',
      createdAt: now,
      updatedAt: now,
    };

    return this.backend.createBusinessBulkOrderTx(
      bulk,
      this.buildAudit({
        actorType: 'customer',
        actorId: userId,
        actorEmail: userEmail ?? undefined,
        action: 'BUSINESS_BULK_ESIM_REQUESTED',
        targetType: 'business_bulk_order',
        targetId: bulk.id,
        reason: `${portal.account.companyName} requested ${qty}x ${input.operatorCode} lines (${input.serviceType})`,
      }),
    );
  }

  public async listAllBusinessesAdmin() {
    return this.backend.listAllBusinesses();
  }

  public async reviewBusinessAccountAdmin(
    businessId: string,
    staffUid: string,
    staffEmail: string | null,
    input: {
      verificationStatus: BusinessVerificationStatus;
      pricingTermsStatus?: BusinessAccountRecord['pricingTermsStatus'];
      commercialNotes?: string;
    },
  ): Promise<BusinessAccountRecord> {
    const now = new Date().toISOString();
    const updated = await this.backend.reviewBusinessAccountTx(
      businessId,
      {
        verificationStatus: input.verificationStatus,
        pricingTermsStatus: input.pricingTermsStatus,
        commercialNotes: input.commercialNotes !== undefined ? input.commercialNotes.trim() || null : undefined,
        reviewedBy: staffEmail ?? staffUid,
        reviewedAt: now,
      },
      this.buildAudit({
        actorType: 'staff_admin',
        actorId: staffUid,
        actorEmail: staffEmail ?? undefined,
        action: 'BUSINESS_ACCOUNT_REVIEWED',
        targetType: 'business_account',
        targetId: businessId,
        reason: `Verification -> ${input.verificationStatus}`,
      }),
    );
    if (!updated) {
      throw new DomainRuleError(404, 'BUSINESS_NOT_FOUND', 'Business Account not found.');
    }
    return updated;
  }
}
