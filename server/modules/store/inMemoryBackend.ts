import crypto from 'node:crypto';
import type {
  AdminRole,
  AgentApplicationRecord,
  AgentCommissionRecord,
  AgentPayoutRecord,
  AgentProfileRecord,
  AuditLogRecord,
  BusinessAccountRecord,
  BusinessBulkOrderRecord,
  BusinessMemberRecord,
  BusinessMemberRole,
  CustomerEsimRecord,
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
  PhoneOrderRecord,
  PhoneProductRecord,
  StaffAdminSummary,
  StockItemStatus,
  SupportTicketRecord,
  UserAccountStatus,
  VerifiedUserSummary,
} from '../../../src/types/domain.ts';
import { DomainRuleError } from '../../lib/errors.ts';
import type { ScheduledJobRunRecord } from '../../lib/observability.ts';
import type {
  InternalActivationVault,
  InternalStockCredential,
  StaffAdminRecord,
  YenePersistenceBackend,
} from './persistenceBackend.ts';

function appendHistory(order: EsimOrderRecord, status: OrderStatus, actor: string, note: string, at: string): void {
  order.status = status;
  order.updatedAt = at;
  order.updateHistory.push({ status, actor, note, at });
}

export class InMemoryPersistenceBackend implements YenePersistenceBackend {
  public readonly isPostgreSql = false;

  private readonly users = new Map<string, VerifiedUserSummary>();
  private readonly staffAdmins = new Map<string, StaffAdminRecord>();
  private readonly staffInvites = new Map<string, { email: string; displayName: string | null; role: AdminRole; active: boolean; grantedAt: string }>();
  private readonly operators = new Map<OperatorCode, OperatorConfigRecord>();
  private readonly esimProducts = new Map<string, EsimProductRecord>();
  private readonly stockBatches = new Map<string, EsimStockBatchRecord>();
  private readonly stockItems = new Map<string, EsimStockItemRecord>();
  private readonly stockSecrets = new Map<string, InternalStockCredential>();
  private readonly orders = new Map<string, EsimOrderRecord>();
  private readonly kycRecords = new Map<string, KycVerificationRecord>();
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly processedWebhookEvents = new Set<string>();
  private readonly activations = new Map<string, InternalActivationVault>();
  private readonly esims = new Map<string, CustomerEsimRecord>();
  private readonly agentApplications = new Map<string, AgentApplicationRecord>();
  private readonly agents = new Map<string, AgentProfileRecord>();
  private readonly commissions = new Map<string, AgentCommissionRecord>();
  private readonly payouts = new Map<string, AgentPayoutRecord>();
  private readonly phoneProducts = new Map<string, PhoneProductRecord>();
  private readonly phoneOrders = new Map<string, PhoneOrderRecord>();
  private readonly supportTickets: SupportTicketRecord[] = [];
  private readonly businessAccounts = new Map<string, BusinessAccountRecord>();
  private readonly businessMembers = new Map<string, BusinessMemberRecord>();
  private readonly businessBulkOrders = new Map<string, BusinessBulkOrderRecord>();
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly scheduledJobRuns: ScheduledJobRunRecord[] = [];

  public async ensureSeedCatalog(seed: {
    operators: OperatorConfigRecord[];
    esimProducts: EsimProductRecord[];
    phoneProducts: PhoneProductRecord[];
    sandboxBatches?: Array<{
      batch: EsimStockBatchRecord;
      items: EsimStockItemRecord[];
      secrets: InternalStockCredential[];
    }>;
  }): Promise<void> {
    for (const op of seed.operators) {
      if (!this.operators.has(op.operatorCode)) this.operators.set(op.operatorCode, op);
    }
    for (const prod of seed.esimProducts) {
      if (!this.esimProducts.has(prod.id)) this.esimProducts.set(prod.id, prod);
    }
    for (const ph of seed.phoneProducts) {
      if (!this.phoneProducts.has(ph.id)) this.phoneProducts.set(ph.id, ph);
    }
    if (seed.sandboxBatches && this.stockBatches.size === 0) {
      for (const entry of seed.sandboxBatches) {
        this.stockBatches.set(entry.batch.id, entry.batch);
        for (const item of entry.items) this.stockItems.set(item.id, item);
        for (const secret of entry.secrets) this.stockSecrets.set(secret.stockItemId, secret);
      }
    }
  }

  public async getUser(uid: string): Promise<VerifiedUserSummary | null> {
    return this.users.get(uid) ?? null;
  }

  public async findUserByEmail(email: string): Promise<VerifiedUserSummary | null> {
    const clean = email.trim().toLowerCase();
    for (const u of this.users.values()) {
      if (u.email?.toLowerCase() === clean) return u;
    }
    return null;
  }

  public async listUsers(): Promise<VerifiedUserSummary[]> {
    return Array.from(this.users.values()).sort((a, b) => b.lastLoginAt.localeCompare(a.lastLoginAt));
  }

  public async upsertAuthenticatedUserTx(input: {
    user: VerifiedUserSummary;
    autoGrantAdmin?: StaffAdminRecord | null;
    auditEntry?: AuditLogRecord | null;
  }): Promise<{ user: VerifiedUserSummary; promotedFromInvite: boolean }> {
    const existing = this.users.get(input.user.uid);
    const merged: VerifiedUserSummary = {
      ...input.user,
      email: input.user.email ?? existing?.email ?? null,
      displayName: input.user.displayName ?? existing?.displayName ?? null,
      preferredLanguage: existing?.preferredLanguage ?? input.user.preferredLanguage,
      phoneNumber: existing?.phoneNumber ?? input.user.phoneNumber,
      accountStatus: existing?.accountStatus ?? input.user.accountStatus,
      suspendedReason: existing?.suspendedReason ?? input.user.suspendedReason,
      createdAt: existing?.createdAt ?? input.user.createdAt,
    };
    this.users.set(merged.uid, merged);

    let promotedFromInvite = false;
    if (input.autoGrantAdmin && !this.staffAdmins.has(merged.uid)) {
      this.staffAdmins.set(merged.uid, input.autoGrantAdmin);
    } else if (merged.emailVerified && merged.email) {
      const invite = this.staffInvites.get(merged.email.toLowerCase());
      if (invite && invite.active && !this.staffAdmins.has(merged.uid)) {
        this.staffInvites.delete(merged.email.toLowerCase());
        this.staffAdmins.set(merged.uid, {
          uid: merged.uid,
          email: invite.email,
          displayName: merged.displayName ?? invite.displayName,
          role: invite.role,
          active: true,
          source: 'admin_grant',
          grantedAt: invite.grantedAt,
        });
        promotedFromInvite = true;
      }
    }

    if (input.auditEntry) this.auditLogs.unshift(input.auditEntry);
    return { user: merged, promotedFromInvite };
  }

  public async updateUserPreferences(
    uid: string,
    patch: { displayName?: string; preferredLanguage?: 'en' | 'am'; phoneNumber?: string | null },
  ): Promise<VerifiedUserSummary | null> {
    const existing = this.users.get(uid);
    if (!existing) return null;
    const updated: VerifiedUserSummary = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
      preferredLanguage: patch.preferredLanguage ?? existing.preferredLanguage,
      phoneNumber: patch.phoneNumber !== undefined ? patch.phoneNumber : existing.phoneNumber,
    };
    this.users.set(uid, updated);
    return updated;
  }

  public async updateCustomerAccountStatusTx(
    targetUid: string,
    status: UserAccountStatus,
    reason: string | null,
    auditEntry: AuditLogRecord,
  ): Promise<VerifiedUserSummary | null> {
    const user = this.users.get(targetUid);
    if (!user) return null;
    user.accountStatus = status;
    user.suspendedReason = status === 'active' ? null : reason;
    this.auditLogs.unshift(auditEntry);
    return user;
  }

  public async getStaffAdmin(uid: string): Promise<StaffAdminRecord | null> {
    const admin = this.staffAdmins.get(uid);
    return admin && admin.active ? admin : null;
  }

  public async listStaffAdmins(): Promise<StaffAdminSummary[]> {
    const combined: StaffAdminSummary[] = [
      ...Array.from(this.staffAdmins.values()).map((a) => ({
        uid: a.uid,
        email: a.email,
        displayName: a.displayName,
        role: a.role,
        active: a.active,
        source: a.source ?? ('admin_grant' as const),
        grantedAt: a.grantedAt,
      })),
      ...Array.from(this.staffInvites.values()).map((i) => ({
        uid: `invite:${i.email}`,
        email: i.email,
        displayName: i.displayName,
        role: i.role,
        active: i.active,
        source: 'admin_grant' as const,
        grantedAt: i.grantedAt,
      })),
    ];
    return combined.sort((a, b) => a.email.localeCompare(b.email));
  }

  public async grantStaffAdminDirect(
    admin: StaffAdminRecord,
    source: 'env_allowlist' | 'admin_grant' = 'admin_grant',
  ): Promise<void> {
    this.staffAdmins.set(admin.uid, { ...admin, source });
  }

  public async grantStaffAdminByEmailTx(input: {
    email: string;
    role: AdminRole;
    displayName: string | null;
    grantedAt: string;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary> {
    const existingUser = await this.findUserByEmail(input.email);
    if (existingUser) {
      const rec: StaffAdminRecord = {
        uid: existingUser.uid,
        email: input.email,
        displayName: input.displayName ?? existingUser.displayName,
        role: input.role,
        active: true,
        source: 'admin_grant',
        grantedAt: input.grantedAt,
      };
      this.staffAdmins.set(existingUser.uid, rec);
      this.auditLogs.unshift({ ...input.auditEntry, targetId: existingUser.uid });
      return {
        uid: rec.uid,
        email: rec.email,
        displayName: rec.displayName,
        role: rec.role,
        active: rec.active,
        source: 'admin_grant',
        grantedAt: rec.grantedAt,
      };
    }

    const invite = {
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      active: true,
      grantedAt: input.grantedAt,
    };
    this.staffInvites.set(input.email, invite);
    const uid = `invite:${input.email}`;
    this.auditLogs.unshift({ ...input.auditEntry, targetId: uid });
    return {
      uid,
      email: invite.email,
      displayName: invite.displayName,
      role: invite.role,
      active: invite.active,
      source: 'admin_grant',
      grantedAt: invite.grantedAt,
    };
  }

  public async updateStaffAdminRoleTx(input: {
    actorUid: string;
    targetUid: string;
    role?: AdminRole;
    active?: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary> {
    const activeSuperAdmins = Array.from(this.staffAdmins.values()).filter(
      (s) => s.active && s.role === 'super_admin',
    );

    if (input.targetUid.startsWith('invite:')) {
      const email = input.targetUid.slice('invite:'.length);
      const invite = this.staffInvites.get(email);
      if (!invite) throw new DomainRuleError(404, 'STAFF_NOT_FOUND', 'Staff administrator record not found.');
      if (input.role) invite.role = input.role;
      if (typeof input.active === 'boolean') invite.active = input.active;
      this.auditLogs.unshift(input.auditEntry);
      return {
        uid: input.targetUid,
        email: invite.email,
        displayName: invite.displayName,
        role: invite.role,
        active: invite.active,
        source: 'admin_grant',
        grantedAt: invite.grantedAt,
      };
    }

    const target = this.staffAdmins.get(input.targetUid);
    if (!target) throw new DomainRuleError(404, 'STAFF_NOT_FOUND', 'Staff administrator record not found.');
    if (
      target.role === 'super_admin' &&
      target.active &&
      activeSuperAdmins.length <= 1 &&
      (input.active === false || (input.role && input.role !== 'super_admin'))
    ) {
      throw new DomainRuleError(409, 'LAST_SUPER_ADMIN', 'At least one active Super Admin must remain.');
    }
    if (input.role) target.role = input.role;
    if (typeof input.active === 'boolean') target.active = input.active;
    this.auditLogs.unshift(input.auditEntry);
    return {
      uid: target.uid,
      email: target.email,
      displayName: target.displayName,
      role: target.role,
      active: target.active,
      source: target.source ?? 'admin_grant',
      grantedAt: target.grantedAt,
    };
  }

  public async listOperators(): Promise<OperatorConfigRecord[]> {
    const now = new Date().toISOString();
    const allOrders = Array.from(this.orders.values());
    return Array.from(this.operators.values()).map((op) => {
      const opOrders = allOrders.filter((o) => o.operatorCode === op.operatorCode);
      return {
        ...op,
        supportedEsimTypes: op.supportsSimConversion
          ? ['new_esim_line', 'sim_to_esim_conversion']
          : ['new_esim_line'],
        numberAvailabilityMode:
          op.activeSupplyMethod === 'stock_based'
            ? 'stock_pool'
            : op.activeSupplyMethod === 'direct_api'
              ? 'direct_api'
              : 'operator_assigned',
        supportsPrePaymentReservation:
          op.activeSupplyMethod === 'stock_based'
            ? true
            : op.activeSupplyMethod === 'direct_api'
              ? op.supportsPrePaymentReservation
              : false,
        healthSummary: {
          totalOrders: opOrders.length,
          provisionedOrders: opOrders.filter((o) =>
            ['provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated'].includes(o.status),
          ).length,
          pendingOrders: opOrders.filter((o) =>
            ['operator_pending', 'submitted_to_operator', 'awaiting_manual_fulfillment'].includes(o.status),
          ).length,
          failedOrders: opOrders.filter((o) => o.status === 'failed').length,
          lastCheckedAt: now,
        },
      };
    });
  }

  public async getOperator(code: OperatorCode): Promise<OperatorConfigRecord | null> {
    const all = await this.listOperators();
    return all.find((o) => o.operatorCode === code) ?? null;
  }

  public async updateOperatorTx(op: OperatorConfigRecord, auditEntry: AuditLogRecord): Promise<OperatorConfigRecord> {
    this.operators.set(op.operatorCode, op);
    const convProd = Array.from(this.esimProducts.values()).find(
      (p) => p.operatorCode === op.operatorCode && p.productType === 'sim_to_esim_conversion',
    );
    if (convProd) convProd.isActive = op.supportsSimConversion;
    this.auditLogs.unshift(auditEntry);
    return (await this.getOperator(op.operatorCode))!;
  }

  public async listEsimProducts(): Promise<EsimProductRecord[]> {
    return Array.from(this.esimProducts.values());
  }

  public async getEsimProduct(id: string): Promise<EsimProductRecord | null> {
    return this.esimProducts.get(id) ?? null;
  }

  public async updateEsimProductTx(product: EsimProductRecord, auditEntry: AuditLogRecord): Promise<EsimProductRecord> {
    this.esimProducts.set(product.id, product);
    this.auditLogs.unshift(auditEntry);
    return product;
  }

  private recalculateBatchAvailability(batchId: string): void {
    const batch = this.stockBatches.get(batchId);
    if (!batch) return;
    let total = 0;
    let avail = 0;
    for (const item of this.stockItems.values()) {
      if (item.batchId === batchId) {
        total += 1;
        if (item.status === 'available') avail += 1;
      }
    }
    batch.totalCount = total;
    batch.availableCount = avail;
  }

  public async listStockBatches(): Promise<EsimStockBatchRecord[]> {
    return Array.from(this.stockBatches.values());
  }

  public async listStockItems(operatorCode?: OperatorCode, status?: StockItemStatus): Promise<EsimStockItemRecord[]> {
    return Array.from(this.stockItems.values()).filter(
      (i) => (!operatorCode || i.operatorCode === operatorCode) && (!status || i.status === status),
    );
  }

  public async checkStockConflicts(
    iccids: string[],
    msisdns: string[],
  ): Promise<{ existingIccids: Set<string>; activeMsisdns: Set<string> }> {
    const iccidSet = new Set(iccids);
    const msisdnSet = new Set(msisdns);
    const existingIccids = new Set<string>();
    const activeMsisdns = new Set<string>();
    for (const item of this.stockItems.values()) {
      if (iccidSet.has(item.iccid)) existingIccids.add(item.iccid);
      if (
        item.msisdn &&
        msisdnSet.has(item.msisdn) &&
        ['imported', 'available', 'reserved', 'assigned', 'sold'].includes(item.status)
      ) {
        activeMsisdns.add(item.msisdn);
      }
    }
    return { existingIccids, activeMsisdns };
  }

  public async importStockBatchTx(
    batch: EsimStockBatchRecord,
    items: EsimStockItemRecord[],
    secrets: InternalStockCredential[],
    auditEntry: AuditLogRecord,
  ): Promise<void> {
    this.stockBatches.set(batch.id, batch);
    for (const item of items) this.stockItems.set(item.id, item);
    for (const sec of secrets) this.stockSecrets.set(sec.stockItemId, sec);
    this.auditLogs.unshift(auditEntry);
  }

  public async updateStockItemStatusTx(
    itemId: string,
    status: Extract<StockItemStatus, 'available' | 'invalid' | 'expired'>,
    auditHistoryEntry: { action: string; actor: string; note: string; at: string },
    auditEntry: AuditLogRecord,
  ): Promise<EsimStockItemRecord | null> {
    const item = this.stockItems.get(itemId);
    if (!item) return null;
    if (item.status === 'sold' || item.status === 'assigned') {
      throw new DomainRuleError(409, 'STOCK_ALREADY_ASSIGNED', 'Sold/assigned stock cannot be reverted directly.');
    }
    item.status = status;
    if (status === 'available') {
      item.reservedOrderId = null;
      item.reservedUntil = null;
    }
    item.auditHistory.push(auditHistoryEntry);
    this.recalculateBatchAvailability(item.batchId);
    this.auditLogs.unshift(auditEntry);
    return item;
  }

  public async reconcileStockTx(
    actorLabel: string,
    actorUid: string,
    actorEmail: string | null,
    nowMs: number,
  ): Promise<{
    releasedReservations: number;
    expiredItems: number;
    flaggedReconciliation: number;
    batchesRecalculated: number;
  }> {
    const exp = await this.expireStaleReservationsAndPaymentsTx({
      nowMs,
      timeoutMinutes: 30,
      instanceId: 'in-memory',
      recordJobRun: false,
    });
    const nowIso = new Date(nowMs).toISOString();
    let expiredItems = 0;
    let flaggedReconciliation = 0;

    for (const item of this.stockItems.values()) {
      if (
        (item.status === 'available' || item.status === 'imported') &&
        item.expiresAt &&
        new Date(item.expiresAt).getTime() <= nowMs
      ) {
        item.status = 'expired';
        item.auditHistory.push({
          action: 'EXPIRED_ON_RECONCILE',
          actor: actorLabel,
          note: `Stock validity expired at ${item.expiresAt}`,
          at: nowIso,
        });
        expiredItems += 1;
      }

      if (item.status === 'reserved' && item.reservedOrderId) {
        const ord = this.orders.get(item.reservedOrderId);
        if (!ord || ['cancelled', 'expired', 'failed', 'refunded'].includes(ord.status)) {
          item.status = 'reconciliation_required';
          item.auditHistory.push({
            action: 'FLAGGED_RECONCILIATION',
            actor: actorLabel,
            note: `Reserved item linked to terminal/missing order ${item.reservedOrderId}`,
            at: nowIso,
          });
          flaggedReconciliation += 1;
        }
      }

      if ((item.status === 'sold' || item.status === 'assigned') && (!item.soldOrderId || !this.orders.has(item.soldOrderId))) {
        item.status = 'reconciliation_required';
        item.auditHistory.push({
          action: 'FLAGGED_RECONCILIATION',
          actor: actorLabel,
          note: 'Assigned/sold stock item has missing linked order reference.',
          at: nowIso,
        });
        flaggedReconciliation += 1;
      }
    }

    let batchesRecalculated = 0;
    for (const batch of this.stockBatches.values()) {
      this.recalculateBatchAvailability(batch.id);
      batchesRecalculated += 1;
    }

    this.auditLogs.unshift({
      id: `aud-${crypto.randomUUID().slice(0, 12)}`,
      actorType: 'staff_admin',
      actorId: actorUid,
      actorEmail: actorEmail ?? undefined,
      action: 'STOCK_RECONCILIATION_RUN',
      targetType: 'inventory',
      targetId: 'all',
      reason: `Released ${exp.releasedReservations}, expired ${expiredItems}, flagged ${flaggedReconciliation} items.`,
      createdAt: nowIso,
    });

    return {
      releasedReservations: exp.releasedReservations,
      expiredItems,
      flaggedReconciliation,
      batchesRecalculated,
    };
  }

  public async findActiveOrderByIdempotency(userId: string, key: string): Promise<EsimOrderRecord | null> {
    for (const existing of this.orders.values()) {
      if (
        existing.userId === userId &&
        existing.idempotencyKey === key &&
        !['cancelled', 'expired', 'failed', 'refunded'].includes(existing.status)
      ) {
        return existing;
      }
    }
    return null;
  }

  public async createOrderTx(order: EsimOrderRecord, auditEntry: AuditLogRecord): Promise<EsimOrderRecord> {
    this.orders.set(order.id, order);
    this.auditLogs.unshift(auditEntry);
    return order;
  }

  public async getOrder(orderId: string): Promise<EsimOrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  public async listOrders(userId?: string): Promise<EsimOrderRecord[]> {
    const items = Array.from(this.orders.values());
    return (userId ? items.filter((o) => o.userId === userId) : items).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  public async listActiveReservedMsisdns(operatorCode: OperatorCode, excludeOrderId?: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const o of this.orders.values()) {
      if (
        o.operatorCode === operatorCode &&
        o.id !== excludeOrderId &&
        o.reservedMsisdn &&
        !['cancelled', 'expired', 'failed', 'refunded'].includes(o.status)
      ) {
        out.add(o.reservedMsisdn);
      }
    }
    return out;
  }

  public async saveKycAttemptTx(
    order: EsimOrderRecord,
    kyc: KycVerificationRecord,
    auditEntry: AuditLogRecord,
  ): Promise<void> {
    this.kycRecords.set(kyc.id, kyc);
    this.orders.set(order.id, order);
    this.auditLogs.unshift(auditEntry);
  }

  public async getStockCredential(stockItemId: string): Promise<InternalStockCredential | null> {
    return this.stockSecrets.get(stockItemId) ?? null;
  }

  public async reserveStockItemAtomic(input: {
    operatorCode: string;
    stockItemId?: string | null;
    orderId: string;
    reservedUntil: string;
  }): Promise<{ stockItemId: string } | null> {
    const candidate = input.stockItemId
      ? this.stockItems.get(input.stockItemId)
      : Array.from(this.stockItems.values()).find(
          (i) => i.operatorCode === input.operatorCode && i.status === 'available',
        );
    if (!candidate || candidate.operatorCode !== input.operatorCode || candidate.status !== 'available') {
      return null;
    }
    candidate.status = 'reserved';
    candidate.reservedOrderId = input.orderId;
    candidate.reservedUntil = input.reservedUntil;
    this.recalculateBatchAvailability(candidate.batchId);
    return { stockItemId: candidate.id };
  }

  public async reserveStockItemForOrderTx(input: {
    orderId: string;
    userId: string;
    operatorCode: OperatorCode;
    stockItemId?: string | null;
    preferredTier?: NumberTier;
    holdUntil: string;
    actor: string;
  }): Promise<EsimOrderRecord> {
    const order = this.orders.get(input.orderId);
    if (!order || order.userId !== input.userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }
    if (!['identity_verified', 'number_reserved', 'awaiting_payment'].includes(order.status)) {
      throw new DomainRuleError(
        409,
        'KYC_REQUIRED_BEFORE_RESERVATION',
        'Complete Fayda identity verification before selecting or reserving a mobile number.',
      );
    }

    if (order.assignedStockItemId) {
      const prev = this.stockItems.get(order.assignedStockItemId);
      if (prev && prev.reservedOrderId === order.id && prev.status === 'reserved') {
        prev.status = 'available';
        prev.reservedOrderId = null;
        prev.reservedUntil = null;
        prev.auditHistory.push({
          action: 'RESERVATION_SWAPPED',
          actor: input.actor,
          note: `Released during number re-selection on order ${order.orderNumber}`,
          at: new Date().toISOString(),
        });
        this.recalculateBatchAvailability(prev.batchId);
      }
      order.assignedStockItemId = null;
    }

    let targetItem: EsimStockItemRecord | null = null;
    if (input.stockItemId) {
      const requested = this.stockItems.get(input.stockItemId);
      if (!requested || requested.operatorCode !== order.operatorCode) {
        throw new DomainRuleError(404, 'STOCK_ITEM_NOT_FOUND', 'Selected stock number does not exist.');
      }
      if (requested.status !== 'available') {
        throw new DomainRuleError(
          409,
          'NUMBER_ALREADY_RESERVED',
          'This number is already reserved or sold. Please choose another available number.',
        );
      }
      targetItem = requested;
    } else {
      targetItem =
        Array.from(this.stockItems.values()).find(
          (i) =>
            i.operatorCode === order.operatorCode &&
            i.status === 'available' &&
            (!input.preferredTier || i.numberTier === input.preferredTier),
        ) ??
        Array.from(this.stockItems.values()).find(
          (i) => i.operatorCode === order.operatorCode && i.status === 'available',
        ) ??
        null;
    }

    if (!targetItem) {
      throw new DomainRuleError(
        409,
        'NO_AVAILABLE_STOCK',
        `No available ${order.operatorCode} stock eSIM profiles remain. Staff can import stock or switch to Manual Partner Processing.`,
      );
    }

    const now = new Date().toISOString();
    targetItem.status = 'reserved';
    targetItem.reservedOrderId = order.id;
    targetItem.reservedUntil = input.holdUntil;
    targetItem.auditHistory.push({
      action: 'RESERVED',
      actor: input.actor,
      note: `Locked for order ${order.orderNumber} until ${input.holdUntil}`,
      at: now,
    });
    this.recalculateBatchAvailability(targetItem.batchId);

    order.supplyMethodUsed = 'stock_based';
    order.assignedStockItemId = targetItem.id;
    order.reservedMsisdn = targetItem.msisdn;
    order.selectedNumberTier = targetItem.numberTier;
    order.reservedUntil = input.holdUntil;
    order.numberReservationConfirmed = true;
    appendHistory(
      order,
      'number_reserved',
      input.actor,
      `Stock number ${targetItem.msisdn ?? targetItem.iccid} reserved for 15 minutes.`,
      now,
    );
    return order;
  }

  public async updateOrderReservationTx(input: {
    orderId: string;
    userId: string;
    operatorCode: OperatorCode;
    selectedNumberTier: NumberTier;
    reservedMsisdn: string | null;
    numberReservationConfirmed: boolean;
    reservedUntil: string | null;
    historyNote: string;
    actor: string;
  }): Promise<EsimOrderRecord> {
    const order = this.orders.get(input.orderId);
    if (!order || order.userId !== input.userId) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }

    if (input.reservedMsisdn) {
      const inUse = await this.listActiveReservedMsisdns(input.operatorCode, order.id);
      if (inUse.has(input.reservedMsisdn)) {
        throw new DomainRuleError(409, 'NUMBER_ALREADY_RESERVED', 'This number is already held by another active order.');
      }
    }

    if (order.assignedStockItemId) {
      const prev = this.stockItems.get(order.assignedStockItemId);
      if (prev && prev.reservedOrderId === order.id && prev.status === 'reserved') {
        prev.status = 'available';
        prev.reservedOrderId = null;
        prev.reservedUntil = null;
        this.recalculateBatchAvailability(prev.batchId);
      }
      order.assignedStockItemId = null;
    }

    order.selectedNumberTier = input.selectedNumberTier;
    order.reservedMsisdn = input.reservedMsisdn;
    order.numberReservationConfirmed = input.numberReservationConfirmed;
    order.reservedUntil = input.reservedUntil;
    appendHistory(order, 'number_reserved', input.actor, input.historyNote, new Date().toISOString());
    return order;
  }

  public async findPaymentByIdempotency(orderId: string, idempotencyKey: string): Promise<PaymentRecord | null> {
    return (
      Array.from(this.payments.values()).find(
        (p) => p.orderId === orderId && p.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  public async findPaymentByTxRef(txRef: string, orderId?: string): Promise<PaymentRecord | null> {
    return (
      Array.from(this.payments.values()).find(
        (p) => p.txRef === txRef && (!orderId || p.orderId === orderId),
      ) ?? null
    );
  }

  public async findLatestPaymentForOrder(orderId: string): Promise<PaymentRecord | null> {
    return (
      Array.from(this.payments.values())
        .filter((p) => p.orderId === orderId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  public async findVerifiedPaymentForOrder(orderId: string): Promise<PaymentRecord | null> {
    return (
      Array.from(this.payments.values()).find((p) => p.orderId === orderId && p.status === 'verified') ?? null
    );
  }

  public async getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
    return this.payments.get(paymentId) ?? null;
  }

  public async listPayments(): Promise<PaymentRecord[]> {
    return Array.from(this.payments.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async recordInitializedPaymentTx(order: EsimOrderRecord, payment: PaymentRecord): Promise<void> {
    this.payments.set(payment.id, payment);
    this.orders.set(order.id, order);
  }

  public async recordWebhookEventIdempotent(input: {
    eventId: string;
    provider: string;
    txRef: string;
    orderId: string;
    status: string;
  }): Promise<{ inserted: boolean }> {
    if (this.processedWebhookEvents.has(input.eventId)) {
      return { inserted: false };
    }
    this.processedWebhookEvents.add(input.eventId);
    return { inserted: true };
  }

  public async hasProcessedWebhookEvent(eventId: string): Promise<boolean> {
    return this.processedWebhookEvents.has(eventId);
  }

  public async incrementWebhookCountForDeduplicated(paymentId: string): Promise<void> {
    const p = this.payments.get(paymentId);
    if (p) p.webhookEventCount += 1;
  }

  public async recordNonSuccessWebhookTx(input: {
    eventId: string;
    txRef: string;
    orderId: string;
    status: 'failed' | 'cancelled';
    failureReason: string;
  }): Promise<{
    deduplicated: boolean;
    orderStatus: EsimOrderRecord['status'];
    paymentStatus: PaymentRecord['status'];
  }> {
    const payment = await this.findPaymentByTxRef(input.txRef, input.orderId);
    const order = this.orders.get(input.orderId);
    if (!payment || !order) {
      throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
    }
    if (this.processedWebhookEvents.has(input.eventId)) {
      payment.webhookEventCount += 1;
      return { deduplicated: true, orderStatus: order.status, paymentStatus: payment.status };
    }
    if (payment.status === 'verified' || payment.status === 'refunded' || payment.status === 'refund_pending') {
      this.processedWebhookEvents.add(input.eventId);
      payment.webhookEventCount += 1;
      return { deduplicated: true, orderStatus: order.status, paymentStatus: payment.status };
    }

    const now = new Date().toISOString();
    this.processedWebhookEvents.add(input.eventId);
    payment.status = input.status;
    payment.failureReason = input.failureReason;
    payment.webhookEventCount += 1;
    payment.updatedAt = now;

    order.paymentStatus = input.status;
    order.failureReason = input.failureReason;
    appendHistory(order, 'awaiting_payment', 'chapa-webhook', input.failureReason, now);
    return { deduplicated: false, orderStatus: order.status, paymentStatus: payment.status };
  }

  public async settleVerifiedPaymentTx(input: {
    orderId: string;
    txRef: string;
    chapaReference: string | null;
    verifiedVia: 'server_verify' | 'webhook' | 'admin_reconcile';
    eventId?: string;
    actor: string;
  }): Promise<{
    alreadySettled: boolean;
    deduplicated: boolean;
    order: EsimOrderRecord;
    payment: PaymentRecord;
    existingEsim: CustomerEsimRecord | null;
    reservedStockItem: { item: EsimStockItemRecord; secret: InternalStockCredential } | null;
  }> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const payment = Array.from(this.payments.values()).find(
      (p) => p.orderId === input.orderId && p.txRef === input.txRef,
    );
    if (!payment) {
      throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
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
      if (input.eventId) {
        this.processedWebhookEvents.add(input.eventId);
        payment.webhookEventCount += 1;
      }
      const existingEsim = Array.from(this.esims.values()).find((e) => e.orderId === order.id) ?? null;
      return {
        alreadySettled: true,
        deduplicated: true,
        order,
        payment,
        existingEsim,
        reservedStockItem: null,
      };
    }

    const now = new Date().toISOString();
    payment.status = 'verified';
    payment.chapaReference = input.chapaReference;
    payment.verifiedVia = input.verifiedVia;
    if (input.verifiedVia === 'webhook') payment.webhookEventCount += 1;
    payment.failureReason = null;
    payment.updatedAt = now;
    if (input.eventId) this.processedWebhookEvents.add(input.eventId);

    order.paymentStatus = 'verified';
    order.failureReason = null;
    appendHistory(
      order,
      'payment_verified',
      input.actor,
      `Payment verified server-side (${payment.chapaReference ?? input.txRef})`,
      now,
    );

    const op = this.operators.get(order.operatorCode);
    const activeMethod = op?.activeSupplyMethod ?? order.supplyMethodUsed;
    let reservedStockItem: { item: EsimStockItemRecord; secret: InternalStockCredential } | null = null;

    if (activeMethod === 'stock_based') {
      let stockItem = order.assignedStockItemId
        ? this.stockItems.get(order.assignedStockItemId) ?? null
        : Array.from(this.stockItems.values()).find(
            (i) => i.operatorCode === order.operatorCode && i.status === 'available',
          ) ?? null;

      if (stockItem && stockItem.status === 'available') {
        stockItem.status = 'reserved';
        stockItem.reservedOrderId = order.id;
        order.assignedStockItemId = stockItem.id;
      } else if (stockItem && stockItem.status === 'reserved' && stockItem.reservedOrderId !== order.id) {
        stockItem = null;
      }

      const secret = stockItem ? this.stockSecrets.get(stockItem.id) : undefined;
      if (stockItem && secret) {
        reservedStockItem = { item: stockItem, secret };
      }
    }

    return {
      alreadySettled: false,
      deduplicated: false,
      order,
      payment,
      existingEsim: null,
      reservedStockItem,
    };
  }

  public async recordPaymentVerificationFailureTx(input: {
    orderId: string;
    paymentId: string;
    failureReason: string;
    actor: string;
  }): Promise<void> {
    const payment = this.payments.get(input.paymentId);
    const order = this.orders.get(input.orderId);
    if (!payment || !order || payment.status === 'verified') return;
    const now = new Date().toISOString();
    payment.status = 'failed';
    payment.failureReason = input.failureReason;
    payment.updatedAt = now;
    order.paymentStatus = 'failed';
    order.failureReason = input.failureReason;
    appendHistory(order, 'awaiting_payment', input.actor, input.failureReason, now);
  }

  public async completeProvisioningTx(input: {
    orderId: string;
    operatorTransactionRef: string | null;
    supplyMethodUsed: EsimOrderRecord['supplyMethodUsed'];
    stockItemIdToAssign: string | null;
    esim: CustomerEsimRecord;
    activation: InternalActivationVault;
    iccidMasked: string;
    commissionCandidate: Omit<AgentCommissionRecord, 'id' | 'createdAt'> | null;
    historyNote: string;
    auditEntry?: AuditLogRecord | null;
  }): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord }> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');

    const existing = Array.from(this.esims.values()).find((e) => e.orderId === input.orderId);
    if (existing) {
      return { order, esim: existing };
    }

    const now = new Date().toISOString();
    if (input.stockItemIdToAssign) {
      const stockItem = this.stockItems.get(input.stockItemIdToAssign);
      if (stockItem) {
        stockItem.status = 'assigned';
        stockItem.soldOrderId = order.id;
        stockItem.reservedUntil = null;
        stockItem.auditHistory.push({
          action: 'ASSIGNED_TO_ORDER',
          actor: 'system',
          note: `Assigned to order ${order.orderNumber}`,
          at: now,
        });
        this.recalculateBatchAvailability(stockItem.batchId);
      }
    }

    this.activations.set(input.activation.activationId, input.activation);
    this.esims.set(input.esim.id, input.esim);

    order.supplyMethodUsed = input.supplyMethodUsed;
    order.operatorTransactionRef = input.operatorTransactionRef;
    order.provisioningStatus = 'provisioned';
    order.deliveryStatus = 'delivered';
    order.failureReason = null;
    appendHistory(order, 'ready_for_installation', 'system', input.historyNote, now);

    if (input.commissionCandidate) {
      const already = Array.from(this.commissions.values()).find((c) => c.orderId === order.id);
      const agent = this.agents.get(input.commissionCandidate.agentId);
      if (!already && agent && agent.status === 'approved') {
        const comm: AgentCommissionRecord = {
          id: `com-${crypto.randomUUID().slice(0, 10)}`,
          createdAt: now,
          ...input.commissionCandidate,
        };
        this.commissions.set(comm.id, comm);
        agent.totalAttributedOrders += 1;
      }
    }

    if (input.auditEntry) this.auditLogs.unshift(input.auditEntry);
    return { order, esim: input.esim };
  }

  public async markProvisioningStateTx(input: {
    orderId: string;
    status: 'operator_pending' | 'awaiting_manual_fulfillment' | 'failed';
    provisioningStatus: EsimOrderRecord['provisioningStatus'];
    operatorTransactionRef: string | null;
    supplyMethodUsed: EsimOrderRecord['supplyMethodUsed'];
    failureReason: string | null;
    releaseStockItemId?: string | null;
    markVerifiedPaymentRefundPending?: boolean;
    actor: string;
    note: string;
  }): Promise<EsimOrderRecord> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const now = new Date().toISOString();

    order.provisioningStatus = input.provisioningStatus;
    order.supplyMethodUsed = input.supplyMethodUsed;
    if (input.operatorTransactionRef !== null) {
      order.operatorTransactionRef = input.operatorTransactionRef;
    }
    order.failureReason = input.failureReason;

    if (input.releaseStockItemId) {
      const stk = this.stockItems.get(input.releaseStockItemId);
      if (stk && stk.reservedOrderId === order.id && stk.status === 'reserved') {
        stk.status = 'available';
        stk.reservedOrderId = null;
        stk.reservedUntil = null;
        this.recalculateBatchAvailability(stk.batchId);
      }
      order.assignedStockItemId = null;
    }

    if (input.markVerifiedPaymentRefundPending) {
      const pay = Array.from(this.payments.values()).find(
        (p) => p.orderId === order.id && p.status === 'verified',
      );
      if (pay) {
        pay.status = 'refund_pending';
        pay.refundReason = input.failureReason;
        pay.updatedAt = now;
        order.paymentStatus = 'refund_pending';
      }
    }

    appendHistory(order, input.status, input.actor, input.note, now);
    return order;
  }

  public async cancelOrderTx(input: {
    orderId: string;
    userId: string;
    reason: string;
    isAdmin?: boolean;
    actorEmail?: string | null;
    auditEntry: AuditLogRecord;
  }): Promise<EsimOrderRecord> {
    const order = this.orders.get(input.orderId);
    if (!order || (!input.isAdmin && order.userId !== input.userId)) {
      throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
    }
    if (
      ['provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated', 'cancelled', 'refunded'].includes(
        order.status,
      )
    ) {
      throw new DomainRuleError(
        409,
        'CANNOT_CANCEL_FULFILLED_ORDER',
        `Orders in "${order.status}" status cannot be cancelled.`,
      );
    }

    const now = new Date().toISOString();
    if (order.assignedStockItemId) {
      const stk = this.stockItems.get(order.assignedStockItemId);
      if (stk && stk.reservedOrderId === order.id && stk.status === 'reserved') {
        stk.status = 'available';
        stk.reservedOrderId = null;
        stk.reservedUntil = null;
        stk.auditHistory.push({
          action: 'RELEASED_ON_CANCEL',
          actor: input.actorEmail ?? input.userId,
          note: `Released on cancellation of ${order.orderNumber}`,
          at: now,
        });
        this.recalculateBatchAvailability(stk.batchId);
      }
      order.assignedStockItemId = null;
    }

    const verifiedPay = Array.from(this.payments.values()).find(
      (p) => p.orderId === order.id && p.status === 'verified',
    );
    if (verifiedPay) {
      verifiedPay.status = 'refund_pending';
      verifiedPay.refundReason = input.reason;
      verifiedPay.updatedAt = now;
      order.paymentStatus = 'refund_pending';
      order.failureReason = input.reason;
      appendHistory(order, 'refund_pending', input.actorEmail ?? input.userId, `Cancelled after verified payment: ${input.reason}`, now);
    } else {
      order.failureReason = input.reason;
      appendHistory(order, 'cancelled', input.actorEmail ?? input.userId, input.reason, now);
    }

    this.auditLogs.unshift(input.auditEntry);
    return order;
  }

  public async beginRefundTx(input: {
    paymentId: string;
    reason: string;
  }): Promise<{ payment: PaymentRecord; alreadyRefunded: boolean }> {
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
    if (payment.status === 'refunded') {
      return { payment, alreadyRefunded: true };
    }
    if (!['verified', 'refund_pending'].includes(payment.status)) {
      throw new DomainRuleError(
        409,
        'CANNOT_REFUND_STATUS',
        `Payment in "${payment.status}" status cannot be refunded.`,
      );
    }
    return { payment, alreadyRefunded: false };
  }

  public async completeRefundTx(input: {
    paymentId: string;
    orderId: string;
    refundStatus: 'refunded' | 'refund_pending' | 'verified';
    refundReference: string | null;
    refundReason: string;
    note: string;
    actor: string;
    auditEntry: AuditLogRecord;
  }): Promise<PaymentRecord> {
    const payment = this.payments.get(input.paymentId)!;
    const now = new Date().toISOString();
    payment.status = input.refundStatus;
    payment.refundReason = input.refundReason;
    if (input.refundReference) payment.refundReference = input.refundReference;
    payment.refundStatusCheckedAt = now;
    payment.updatedAt = now;

    const order = this.orders.get(input.orderId);
    if (order) {
      order.paymentStatus = input.refundStatus;
      if (input.refundStatus === 'refunded' || input.refundStatus === 'refund_pending') {
        appendHistory(order, input.refundStatus, input.actor, input.note, now);
      }
    }
    this.auditLogs.unshift(input.auditEntry);
    return payment;
  }

  public async updatePaymentReconcileTx(input: {
    paymentId: string;
    patch: Partial<PaymentRecord>;
    verifyOrderIfVerified?: boolean;
    actorLabel: string;
    auditEntry: AuditLogRecord;
  }): Promise<PaymentRecord> {
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
    Object.assign(payment, input.patch);
    if (input.verifyOrderIfVerified) {
      const ord = this.orders.get(payment.orderId);
      if (ord && ord.paymentStatus !== 'verified') {
        ord.paymentStatus = 'verified';
        appendHistory(ord, 'payment_verified', input.actorLabel, 'Reconciled via Chapa status verify', new Date().toISOString());
      }
    } else if (input.patch.status === 'refunded') {
      const ord = this.orders.get(payment.orderId);
      if (ord && ord.status !== 'refunded') {
        ord.paymentStatus = 'refunded';
        appendHistory(ord, 'refunded', input.actorLabel, 'Refund verified via Chapa reconciliation', new Date().toISOString());
      }
    }
    this.auditLogs.unshift(input.auditEntry);
    return payment;
  }

  public async getEsimById(esimId: string): Promise<CustomerEsimRecord | null> {
    return this.esims.get(esimId) ?? null;
  }

  public async getEsimByOrderId(orderId: string): Promise<CustomerEsimRecord | null> {
    return Array.from(this.esims.values()).find((e) => e.orderId === orderId) ?? null;
  }

  public async listEsims(userId?: string): Promise<CustomerEsimRecord[]> {
    const items = Array.from(this.esims.values());
    return (userId ? items.filter((e) => e.userId === userId) : items).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  public async getActivationById(activationId: string): Promise<InternalActivationVault | null> {
    return this.activations.get(activationId) ?? null;
  }

  public async markActivationDownloaded(activationId: string): Promise<void> {
    const v = this.activations.get(activationId);
    if (v) v.downloadedAt = v.downloadedAt ?? new Date().toISOString();
  }

  public async updateEsimLifecycleTx(
    esimId: string,
    userId: string,
    target: 'installed' | 'activated',
  ): Promise<CustomerEsimRecord | null> {
    const esim = this.esims.get(esimId);
    if (!esim || esim.userId !== userId) return null;
    const now = new Date().toISOString();
    esim.installedAt = esim.installedAt ?? now;
    if (target === 'installed') {
      if (esim.status === 'ready_for_installation') esim.status = 'installed';
    } else {
      esim.activatedAt = now;
      esim.status = 'activated';
    }
    const vault = this.activations.get(esim.activationId);
    if (vault) {
      vault.installedAt = esim.installedAt;
      if (target === 'activated') vault.activatedAt = now;
    }
    const order = this.orders.get(esim.orderId);
    if (order) {
      order.deliveryStatus = target;
      appendHistory(
        order,
        target,
        userId,
        target === 'installed'
          ? 'Customer marked eSIM installed on device'
          : 'Subscriber confirmed active network registration',
        now,
      );
    }
    return esim;
  }

  public async getOrderKycAndAudit(orderId: string): Promise<{
    kyc: KycVerificationRecord | null;
    auditEvents: AuditLogRecord[];
  }> {
    const kyc =
      Array.from(this.kycRecords.values())
        .filter((k) => k.orderId === orderId)
        .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0] ?? null;
    const auditEvents = this.auditLogs.filter((l) => l.targetId === orderId);
    return { kyc, auditEvents };
  }

  public async expireStaleReservationsAndPaymentsTx(input: {
    nowMs: number;
    timeoutMinutes: number;
    instanceId: string;
    jobName?: string;
    recordJobRun?: boolean;
  }): Promise<{
    acquiredLock: boolean;
    releasedReservations: number;
    expiredPayments: number;
    runRecord: ScheduledJobRunRecord | null;
  }> {
    const startedAt = new Date().toISOString();
    let releasedReservations = 0;
    let expiredPayments = 0;
    const nowIso = new Date(input.nowMs).toISOString();

    for (const item of this.stockItems.values()) {
      if (
        item.status === 'reserved' &&
        item.reservedUntil &&
        new Date(item.reservedUntil).getTime() <= input.nowMs
      ) {
        const orderId = item.reservedOrderId;
        item.status = 'available';
        item.reservedOrderId = null;
        item.reservedUntil = null;
        item.auditHistory.push({
          action: 'RESERVATION_EXPIRED',
          actor: 'system',
          note: `Released stale reservation from order ${orderId ?? 'unknown'}`,
          at: nowIso,
        });
        releasedReservations += 1;

        if (orderId) {
          const ord = this.orders.get(orderId);
          if (
            ord &&
            ![
              'payment_verified',
              'submitted_to_operator',
              'operator_pending',
              'awaiting_manual_fulfillment',
              'provisioned',
              'delivered',
              'ready_for_installation',
              'installed',
              'activated',
            ].includes(ord.status)
          ) {
            ord.assignedStockItemId = null;
            ord.reservedUntil = null;
            ord.numberReservationConfirmed = false;
            ord.failureReason = 'Number reservation expired before checkout verification.';
            appendHistory(ord, 'expired', 'system', ord.failureReason, nowIso);
            this.auditLogs.unshift({
              id: `aud-${crypto.randomUUID().slice(0, 12)}`,
              actorType: 'system',
              actorId: input.instanceId,
              action: 'RESERVATION_EXPIRED',
              targetType: 'esim_order',
              targetId: ord.id,
              reason: ord.failureReason,
              createdAt: nowIso,
            });
          }
        }
        this.recalculateBatchAvailability(item.batchId);
      }
    }

    const cutoffMs = input.nowMs - input.timeoutMinutes * 60 * 1000;
    for (const pay of this.payments.values()) {
      if (pay.status === 'initialized' && new Date(pay.createdAt).getTime() <= cutoffMs) {
        pay.status = 'failed';
        pay.failureReason = `Chapa checkout expired after ${input.timeoutMinutes} minutes without payment confirmation.`;
        pay.updatedAt = nowIso;
        expiredPayments += 1;

        const ord = this.orders.get(pay.orderId);
        if (ord && ord.paymentStatus !== 'verified') {
          ord.paymentStatus = 'failed';
          ord.failureReason = pay.failureReason;
          if (ord.assignedStockItemId) {
            const stk = this.stockItems.get(ord.assignedStockItemId);
            if (stk && stk.reservedOrderId === ord.id && stk.status === 'reserved') {
              stk.status = 'available';
              stk.reservedOrderId = null;
              stk.reservedUntil = null;
              this.recalculateBatchAvailability(stk.batchId);
            }
            ord.assignedStockItemId = null;
            ord.reservedUntil = null;
            ord.numberReservationConfirmed = false;
          }
          appendHistory(ord, 'expired', 'system', pay.failureReason, nowIso);
          this.auditLogs.unshift({
            id: `aud-${crypto.randomUUID().slice(0, 12)}`,
            actorType: 'system',
            actorId: input.instanceId,
            action: 'ORDER_PAYMENT_EXPIRED',
            targetType: 'esim_order',
            targetId: ord.id,
            reason: pay.failureReason,
            createdAt: nowIso,
          });
        }
      }
    }

    let runRecord: ScheduledJobRunRecord | null = null;
    if (input.recordJobRun) {
      runRecord = {
        id: `job-${crypto.randomUUID().slice(0, 10)}`,
        jobName: input.jobName ?? 'payment_expiry_sweep',
        instanceId: input.instanceId,
        status: 'succeeded',
        processedCount: releasedReservations + expiredPayments,
        errorMessage: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      this.scheduledJobRuns.unshift(runRecord);
      if (this.scheduledJobRuns.length > 100) this.scheduledJobRuns.length = 100;
    }

    return { acquiredLock: true, releasedReservations, expiredPayments, runRecord };
  }

  public async listScheduledJobRuns(jobName?: string, limit = 25): Promise<ScheduledJobRunRecord[]> {
    return this.scheduledJobRuns
      .filter((r) => !jobName || r.jobName === jobName)
      .slice(0, limit);
  }

  public async submitAgentApplicationTx(
    app: AgentApplicationRecord,
    auditEntry: AuditLogRecord,
  ): Promise<AgentApplicationRecord> {
    this.agentApplications.set(app.id, app);
    this.auditLogs.unshift(auditEntry);
    return app;
  }

  public async getAgentApplicationForUser(userId: string): Promise<AgentApplicationRecord | null> {
    return (
      Array.from(this.agentApplications.values())
        .filter((a) => a.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  public async listAgentApplications(): Promise<AgentApplicationRecord[]> {
    return Array.from(this.agentApplications.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  public async getApprovedAgentByUserId(userId: string): Promise<AgentProfileRecord | null> {
    for (const agent of this.agents.values()) {
      if (agent.userId === userId && agent.status === 'approved') return agent;
    }
    return null;
  }

  public async getAnyAgentProfileByUserId(userId: string): Promise<AgentProfileRecord | null> {
    for (const agent of this.agents.values()) {
      if (agent.userId === userId) return agent;
    }
    return null;
  }

  public async getAgentByReferralCode(code: string): Promise<AgentProfileRecord | null> {
    const clean = code.trim().toUpperCase();
    for (const agent of this.agents.values()) {
      if (agent.referralCode === clean && agent.status === 'approved') return agent;
    }
    return null;
  }

  public async getAgentById(id: string): Promise<AgentProfileRecord | null> {
    return this.agents.get(id) ?? null;
  }

  public async listAgents(): Promise<AgentProfileRecord[]> {
    return Array.from(this.agents.values()).sort((a, b) =>
      b.approvedAt.localeCompare(a.approvedAt),
    );
  }

  public async reviewAgentApplicationTx(input: {
    applicationId: string;
    decision: 'approved' | 'rejected' | 'suspended';
    reviewNotes: string;
    reviewedBy: string;
    reviewedAt: string;
    newAgentIfApproved?: AgentProfileRecord | null;
    ethioTelecomAuthorized?: boolean;
    safaricomAuthorized?: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<{ application: AgentApplicationRecord; agentProfile: AgentProfileRecord | null }> {
    const application = this.agentApplications.get(input.applicationId);
    if (!application) throw new DomainRuleError(404, 'APPLICATION_NOT_FOUND', 'Agent application not found.');

    application.status = input.decision;
    application.reviewNotes = input.reviewNotes;
    application.reviewedBy = input.reviewedBy;
    application.reviewedAt = input.reviewedAt;

    let agentProfile = await this.getAnyAgentProfileByUserId(application.userId);
    if (input.decision === 'approved') {
      if (!agentProfile && input.newAgentIfApproved) {
        agentProfile = input.newAgentIfApproved;
        this.agents.set(agentProfile.id, agentProfile);
      } else if (agentProfile) {
        agentProfile.status = 'approved';
        agentProfile.operatorAuthorizationStatus = {
          ethio_telecom: input.ethioTelecomAuthorized ? 'authorized' : agentProfile.operatorAuthorizationStatus.ethio_telecom,
          safaricom_ethiopia: input.safaricomAuthorized ? 'authorized' : agentProfile.operatorAuthorizationStatus.safaricom_ethiopia,
        };
      }
    } else if (agentProfile && input.decision === 'suspended') {
      agentProfile.status = 'suspended';
    }

    this.auditLogs.unshift(input.auditEntry);
    return { application, agentProfile };
  }

  public async getAgentDashboardData(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const attributedOrders = Array.from(this.orders.values())
      .filter((o) => o.attributedAgentId === agent.id)
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        operatorCode: o.operatorCode,
        status: o.status,
        createdAt: o.createdAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const commissions = Array.from(this.commissions.values())
      .filter((c) => c.agentId === agent.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const payouts = Array.from(this.payouts.values())
      .filter((p) => p.agentId === agent.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { agent, attributedOrders, commissions, payouts };
  }

  public async recordAgentPayoutTx(
    payout: AgentPayoutRecord,
    auditEntry: AuditLogRecord,
  ): Promise<AgentPayoutRecord | null> {
    const agent = this.agents.get(payout.agentId);
    if (!agent) return null;
    this.payouts.set(payout.id, payout);
    if (payout.status === 'paid') {
      agent.totalPaidOutEtb = Number((agent.totalPaidOutEtb + payout.amountEtb).toFixed(2));
    }
    this.auditLogs.unshift(auditEntry);
    return payout;
  }

  public async getBusinessPortal(
    userId: string,
    userEmail: string | null,
    emailVerified: boolean,
  ): Promise<{
    account: BusinessAccountRecord | null;
    memberRole: BusinessMemberRole | null;
    members: BusinessMemberRecord[];
    bulkOrders: BusinessBulkOrderRecord[];
  }> {
    let found: { account: BusinessAccountRecord; role: BusinessMemberRole } | null = null;
    for (const acc of this.businessAccounts.values()) {
      if (acc.ownerUserId === userId) {
        found = { account: acc, role: 'owner' };
        break;
      }
    }
    const cleanEmail = userEmail?.trim().toLowerCase();
    if (!found && cleanEmail && emailVerified) {
      for (const m of this.businessMembers.values()) {
        if (m.email.toLowerCase() === cleanEmail && m.status !== 'revoked') {
          const acc = this.businessAccounts.get(m.businessId);
          if (acc) {
            found = { account: acc, role: m.role };
            break;
          }
        }
      }
    }

    if (!found) {
      return { account: null, memberRole: null, members: [], bulkOrders: [] };
    }
    const members = Array.from(this.businessMembers.values())
      .filter((m) => m.businessId === found!.account.id && m.status !== 'revoked')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const bulkOrders = Array.from(this.businessBulkOrders.values())
      .filter((o) => o.businessId === found!.account.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { account: found.account, memberRole: found.role, members, bulkOrders };
  }

  public async upsertBusinessAccountTx(input: {
    userId: string;
    account: BusinessAccountRecord;
    ownerMemberIfNew: BusinessMemberRecord | null;
    isUpdate: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<BusinessAccountRecord> {
    this.businessAccounts.set(input.account.id, input.account);
    if (!input.isUpdate && input.ownerMemberIfNew) {
      this.businessMembers.set(input.ownerMemberIfNew.id, input.ownerMemberIfNew);
    }
    this.auditLogs.unshift(input.auditEntry);
    return input.account;
  }

  public async addBusinessMemberTx(
    member: BusinessMemberRecord,
    auditEntry: AuditLogRecord,
  ): Promise<BusinessMemberRecord> {
    this.businessMembers.set(member.id, member);
    this.auditLogs.unshift(auditEntry);
    return member;
  }

  public async createBusinessBulkOrderTx(
    bulk: BusinessBulkOrderRecord,
    auditEntry: AuditLogRecord,
  ): Promise<BusinessBulkOrderRecord> {
    this.businessBulkOrders.set(bulk.id, bulk);
    this.auditLogs.unshift(auditEntry);
    return bulk;
  }

  public async listAllBusinesses(): Promise<{
    accounts: BusinessAccountRecord[];
    bulkOrders: BusinessBulkOrderRecord[];
  }> {
    return {
      accounts: Array.from(this.businessAccounts.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
      bulkOrders: Array.from(this.businessBulkOrders.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  }

  public async reviewBusinessAccountTx(
    businessId: string,
    patch: {
      verificationStatus: BusinessAccountRecord['verificationStatus'];
      pricingTermsStatus?: BusinessAccountRecord['pricingTermsStatus'];
      commercialNotes?: string | null;
      reviewedBy: string;
      reviewedAt: string;
    },
    auditEntry: AuditLogRecord,
  ): Promise<BusinessAccountRecord | null> {
    const account = this.businessAccounts.get(businessId);
    if (!account) return null;
    account.verificationStatus = patch.verificationStatus;
    if (patch.pricingTermsStatus) account.pricingTermsStatus = patch.pricingTermsStatus;
    if (patch.commercialNotes !== undefined) account.commercialNotes = patch.commercialNotes;
    account.reviewedBy = patch.reviewedBy;
    account.reviewedAt = patch.reviewedAt;
    account.updatedAt = patch.reviewedAt;
    this.auditLogs.unshift(auditEntry);
    return account;
  }

  public async listPhoneProducts(activeOnly = false): Promise<PhoneProductRecord[]> {
    const all = Array.from(this.phoneProducts.values());
    return activeOnly ? all.filter((p) => p.isActive) : all;
  }

  public async getPhoneProduct(id: string): Promise<PhoneProductRecord | null> {
    return this.phoneProducts.get(id) ?? null;
  }

  public async upsertPhoneProductTx(
    product: PhoneProductRecord,
    _isNew: boolean,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneProductRecord> {
    this.phoneProducts.set(product.id, product);
    this.auditLogs.unshift(auditEntry);
    return product;
  }

  public async createPhoneOrderTx(
    order: PhoneOrderRecord,
    qtyToDecrement: number,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneOrderRecord> {
    const product = this.phoneProducts.get(order.phoneProductId);
    if (!product || product.stockQty < qtyToDecrement) {
      throw new DomainRuleError(
        409,
        'INSUFFICIENT_PHONE_STOCK',
        `Only ${product?.stockQty ?? 0} units currently in secondary phone stock.`,
      );
    }
    product.stockQty -= qtyToDecrement;
    product.updatedAt = new Date().toISOString();
    this.phoneOrders.set(order.id, order);
    this.auditLogs.unshift(auditEntry);
    return order;
  }

  public async getPhoneOrder(phoneOrderId: string): Promise<PhoneOrderRecord | null> {
    return this.phoneOrders.get(phoneOrderId) ?? null;
  }

  public async listPhoneOrders(userId?: string): Promise<PhoneOrderRecord[]> {
    const items = Array.from(this.phoneOrders.values());
    return (userId ? items.filter((o) => o.userId === userId) : items).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  public async updatePhoneOrderTx(
    phoneOrderId: string,
    patch: {
      paymentStatus?: PhoneOrderRecord['paymentStatus'];
      paymentReference?: string | null;
      checkoutUrl?: string | null;
      fulfillmentStatus?: PhoneOrderRecord['fulfillmentStatus'];
      klickDeliveryPartnerStatus?: PhoneOrderRecord['klickDeliveryPartnerStatus'];
    },
    auditEntry?: AuditLogRecord | null,
  ): Promise<PhoneOrderRecord | null> {
    const ord = this.phoneOrders.get(phoneOrderId);
    if (!ord) return null;
    if (patch.paymentStatus !== undefined) ord.paymentStatus = patch.paymentStatus;
    if (patch.paymentReference !== undefined) ord.paymentReference = patch.paymentReference;
    if (patch.checkoutUrl !== undefined) ord.checkoutUrl = patch.checkoutUrl;
    if (patch.fulfillmentStatus) ord.fulfillmentStatus = patch.fulfillmentStatus;
    if (patch.klickDeliveryPartnerStatus) ord.klickDeliveryPartnerStatus = patch.klickDeliveryPartnerStatus;
    if (auditEntry) this.auditLogs.unshift(auditEntry);
    return ord;
  }

  public async createSupportTicket(ticket: SupportTicketRecord): Promise<SupportTicketRecord> {
    this.supportTickets.unshift(ticket);
    return ticket;
  }

  public async listSupportTickets(userId?: string): Promise<SupportTicketRecord[]> {
    return userId ? this.supportTickets.filter((t) => t.userId === userId) : [...this.supportTickets];
  }

  public async updateSupportTicketTx(
    ticketId: string,
    status: SupportTicketRecord['status'],
    adminResponse: string,
    auditEntry: AuditLogRecord,
  ): Promise<SupportTicketRecord | null> {
    const ticket = this.supportTickets.find((t) => t.id === ticketId);
    if (!ticket) return null;
    ticket.status = status;
    ticket.adminResponse = adminResponse;
    this.auditLogs.unshift(auditEntry);
    return ticket;
  }

  public async recordAudit(entry: AuditLogRecord): Promise<void> {
    this.auditLogs.unshift(entry);
  }

  public async listAuditLogs(limit: number): Promise<AuditLogRecord[]> {
    return this.auditLogs.slice(0, limit);
  }

  public async getOverviewMetrics() {
    const allOrders = Array.from(this.orders.values());
    const allStock = Array.from(this.stockItems.values());
    const allApps = Array.from(this.agentApplications.values());
    const allPayments = Array.from(this.payments.values());

    return {
      totalUsers: this.users.size,
      totalEsimOrders: allOrders.length,
      awaitingManualFulfillment: allOrders.filter((o) => o.status === 'awaiting_manual_fulfillment').length,
      provisionedEsims: this.esims.size,
      availableStockCount: allStock.filter((i) => i.status === 'available').length,
      reservedStockCount: allStock.filter((i) => i.status === 'reserved').length,
      pendingAgentApplications: allApps.filter((a) => a.status === 'pending_review').length,
      approvedAgentsCount: Array.from(this.agents.values()).filter((a) => a.status === 'approved').length,
      verifiedPaymentsEtb: allPayments
        .filter((p) => p.status === 'verified')
        .reduce((sum, p) => sum + p.amountEtb, 0),
      openSupportTickets: this.supportTickets.filter((t) => t.status === 'open').length,
      phoneOrdersCount: this.phoneOrders.size,
      businessAccountsCount: this.businessAccounts.size,
      pendingBulkEsimRequests: Array.from(this.businessBulkOrders.values()).filter(
        (b) => b.status === 'pending_commercial_review',
      ).length,
    };
  }
}
