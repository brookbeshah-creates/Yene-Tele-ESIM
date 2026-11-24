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
  PaymentRecord,
  PhoneOrderRecord,
  PhoneProductRecord,
  StaffAdminSummary,
  StockItemStatus,
  SupportTicketRecord,
  UserAccountStatus,
  VerifiedUserSummary,
} from '../../../src/types/domain.ts';
import type { ScheduledJobRunRecord } from '../../lib/observability.ts';

export interface StaffAdminRecord {
  uid: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  active: boolean;
  source?: 'env_allowlist' | 'admin_grant';
  grantedAt: string;
}

export interface InternalStockCredential {
  stockItemId: string;
  smdpAddress: string;
  activationCode: string;
  lpaUri: string;
  qrPayload: string;
  encryptedCredentials: string;
}

export interface InternalActivationVault {
  activationId: string;
  orderId: string;
  userId: string;
  operatorCode: OperatorCode;
  smdpAddress: string | null;
  iccid: string | null;
  eid: string | null;
  assignedMsisdn: string | null;
  encryptedCredentials: string | null;
  isSandboxSimulation: boolean;
  createdAt: string;
  downloadedAt: string | null;
  installedAt: string | null;
  activatedAt: string | null;
}

export interface YenePersistenceBackend {
  readonly isPostgreSql: boolean;

  ensureSeedCatalog(seed: {
    operators: OperatorConfigRecord[];
    esimProducts: EsimProductRecord[];
    phoneProducts: PhoneProductRecord[];
    sandboxBatches?: Array<{
      batch: EsimStockBatchRecord;
      items: EsimStockItemRecord[];
      secrets: InternalStockCredential[];
    }>;
  }): Promise<void>;

  // Users & Staff
  getUser(uid: string): Promise<VerifiedUserSummary | null>;
  findUserByEmail(email: string): Promise<VerifiedUserSummary | null>;
  listUsers(): Promise<VerifiedUserSummary[]>;
  upsertAuthenticatedUserTx(input: {
    user: VerifiedUserSummary;
    autoGrantAdmin?: StaffAdminRecord | null;
    auditEntry?: AuditLogRecord | null;
  }): Promise<{ user: VerifiedUserSummary; promotedFromInvite: boolean }>;
  updateUserPreferences(
    uid: string,
    patch: { displayName?: string; preferredLanguage?: 'en' | 'am'; phoneNumber?: string | null },
  ): Promise<VerifiedUserSummary | null>;
  updateCustomerAccountStatusTx(
    targetUid: string,
    status: UserAccountStatus,
    reason: string | null,
    auditEntry: AuditLogRecord,
  ): Promise<VerifiedUserSummary | null>;

  getStaffAdmin(uid: string): Promise<StaffAdminRecord | null>;
  listStaffAdmins(): Promise<StaffAdminSummary[]>;
  grantStaffAdminDirect(admin: StaffAdminRecord, source?: 'env_allowlist' | 'admin_grant'): Promise<void>;
  grantStaffAdminByEmailTx(input: {
    email: string;
    role: AdminRole;
    displayName: string | null;
    grantedAt: string;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary>;
  updateStaffAdminRoleTx(input: {
    actorUid: string;
    targetUid: string;
    role?: AdminRole;
    active?: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary>;

  // Operators & Products
  listOperators(): Promise<OperatorConfigRecord[]>;
  getOperator(code: OperatorCode): Promise<OperatorConfigRecord | null>;
  updateOperatorTx(op: OperatorConfigRecord, auditEntry: AuditLogRecord): Promise<OperatorConfigRecord>;
  listEsimProducts(): Promise<EsimProductRecord[]>;
  getEsimProduct(id: string): Promise<EsimProductRecord | null>;
  updateEsimProductTx(product: EsimProductRecord, auditEntry: AuditLogRecord): Promise<EsimProductRecord>;

  // Stock Inventory
  listStockBatches(): Promise<EsimStockBatchRecord[]>;
  listStockItems(operatorCode?: OperatorCode, status?: StockItemStatus): Promise<EsimStockItemRecord[]>;
  checkStockConflicts(
    iccids: string[],
    msisdns: string[],
  ): Promise<{ existingIccids: Set<string>; activeMsisdns: Set<string> }>;
  importStockBatchTx(
    batch: EsimStockBatchRecord,
    items: EsimStockItemRecord[],
    secrets: InternalStockCredential[],
    auditEntry: AuditLogRecord,
  ): Promise<void>;
  updateStockItemStatusTx(
    itemId: string,
    status: Extract<StockItemStatus, 'available' | 'invalid' | 'expired'>,
    auditHistoryEntry: { action: string; actor: string; note: string; at: string },
    auditEntry: AuditLogRecord,
  ): Promise<EsimStockItemRecord | null>;
  reconcileStockTx(
    actorLabel: string,
    actorUid: string,
    actorEmail: string | null,
    nowMs: number,
  ): Promise<{
    releasedReservations: number;
    expiredItems: number;
    flaggedReconciliation: number;
    batchesRecalculated: number;
  }>;

  // Orders, Number Reservation, KYC, Payments, Provisioning
  findActiveOrderByIdempotency(userId: string, key: string): Promise<EsimOrderRecord | null>;
  createOrderTx(order: EsimOrderRecord, auditEntry: AuditLogRecord): Promise<EsimOrderRecord>;
  getOrder(orderId: string): Promise<EsimOrderRecord | null>;
  listOrders(userId?: string): Promise<EsimOrderRecord[]>;
  listActiveReservedMsisdns(operatorCode: OperatorCode, excludeOrderId?: string): Promise<Set<string>>;
  saveKycAttemptTx(
    order: EsimOrderRecord,
    kyc: KycVerificationRecord,
    auditEntry: AuditLogRecord,
  ): Promise<void>;

  getStockCredential(stockItemId: string): Promise<InternalStockCredential | null>;

  reserveStockItemAtomic(input: {
    operatorCode: string;
    stockItemId?: string | null;
    orderId: string;
    reservedUntil: string;
  }): Promise<{ stockItemId: string } | null>;

  reserveStockItemForOrderTx(input: {
    orderId: string;
    userId: string;
    operatorCode: OperatorCode;
    stockItemId?: string | null;
    preferredTier?: NumberTier;
    holdUntil: string;
    actor: string;
  }): Promise<EsimOrderRecord>;

  updateOrderReservationTx(input: {
    orderId: string;
    userId: string;
    operatorCode: OperatorCode;
    selectedNumberTier: NumberTier;
    reservedMsisdn: string | null;
    numberReservationConfirmed: boolean;
    reservedUntil: string | null;
    historyNote: string;
    actor: string;
  }): Promise<EsimOrderRecord>;

  findPaymentByIdempotency(orderId: string, idempotencyKey: string): Promise<PaymentRecord | null>;
  findPaymentByTxRef(txRef: string, orderId?: string): Promise<PaymentRecord | null>;
  findLatestPaymentForOrder(orderId: string): Promise<PaymentRecord | null>;
  findVerifiedPaymentForOrder(orderId: string): Promise<PaymentRecord | null>;
  getPaymentById(paymentId: string): Promise<PaymentRecord | null>;
  listPayments(): Promise<PaymentRecord[]>;

  recordInitializedPaymentTx(order: EsimOrderRecord, payment: PaymentRecord): Promise<void>;
  recordWebhookEventIdempotent(input: {
    eventId: string;
    provider: string;
    txRef: string;
    orderId: string;
    status: string;
  }): Promise<{ inserted: boolean }>;
  hasProcessedWebhookEvent(eventId: string): Promise<boolean>;
  incrementWebhookCountForDeduplicated(paymentId: string): Promise<void>;

  recordNonSuccessWebhookTx(input: {
    eventId: string;
    txRef: string;
    orderId: string;
    status: 'failed' | 'cancelled';
    failureReason: string;
  }): Promise<{
    deduplicated: boolean;
    orderStatus: EsimOrderRecord['status'];
    paymentStatus: PaymentRecord['status'];
  }>;

  settleVerifiedPaymentTx(input: {
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
  }>;

  recordPaymentVerificationFailureTx(input: {
    orderId: string;
    paymentId: string;
    failureReason: string;
    actor: string;
  }): Promise<void>;

  completeProvisioningTx(input: {
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
  }): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord }>;

  markProvisioningStateTx(input: {
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
  }): Promise<EsimOrderRecord>;

  cancelOrderTx(input: {
    orderId: string;
    userId: string;
    reason: string;
    isAdmin?: boolean;
    actorEmail?: string | null;
    auditEntry: AuditLogRecord;
  }): Promise<EsimOrderRecord>;

  beginRefundTx(input: {
    paymentId: string;
    reason: string;
  }): Promise<{ payment: PaymentRecord; alreadyRefunded: boolean }>;

  completeRefundTx(input: {
    paymentId: string;
    orderId: string;
    refundStatus: 'refunded' | 'refund_pending' | 'verified';
    refundReference: string | null;
    refundReason: string;
    note: string;
    actor: string;
    auditEntry: AuditLogRecord;
  }): Promise<PaymentRecord>;

  updatePaymentReconcileTx(input: {
    paymentId: string;
    patch: Partial<PaymentRecord>;
    verifyOrderIfVerified?: boolean;
    actorLabel: string;
    auditEntry: AuditLogRecord;
  }): Promise<PaymentRecord>;

  // eSIMs & Vault
  getEsimById(esimId: string): Promise<CustomerEsimRecord | null>;
  getEsimByOrderId(orderId: string): Promise<CustomerEsimRecord | null>;
  listEsims(userId?: string): Promise<CustomerEsimRecord[]>;
  getActivationById(activationId: string): Promise<InternalActivationVault | null>;
  markActivationDownloaded(activationId: string): Promise<void>;
  updateEsimLifecycleTx(
    esimId: string,
    userId: string,
    target: 'installed' | 'activated',
  ): Promise<CustomerEsimRecord | null>;
  getOrderKycAndAudit(orderId: string): Promise<{
    kyc: KycVerificationRecord | null;
    auditEvents: AuditLogRecord[];
  }>;

  // Expiry & Scheduled Jobs
  expireStaleReservationsAndPaymentsTx(input: {
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
  }>;
  listScheduledJobRuns(jobName?: string, limit?: number): Promise<ScheduledJobRunRecord[]>;

  // Agents
  submitAgentApplicationTx(app: AgentApplicationRecord, auditEntry: AuditLogRecord): Promise<AgentApplicationRecord>;
  getAgentApplicationForUser(userId: string): Promise<AgentApplicationRecord | null>;
  listAgentApplications(): Promise<AgentApplicationRecord[]>;
  getApprovedAgentByUserId(userId: string): Promise<AgentProfileRecord | null>;
  getAnyAgentProfileByUserId(userId: string): Promise<AgentProfileRecord | null>;
  getAgentByReferralCode(code: string): Promise<AgentProfileRecord | null>;
  getAgentById(id: string): Promise<AgentProfileRecord | null>;
  listAgents(): Promise<AgentProfileRecord[]>;
  reviewAgentApplicationTx(input: {
    applicationId: string;
    decision: 'approved' | 'rejected' | 'suspended';
    reviewNotes: string;
    reviewedBy: string;
    reviewedAt: string;
    newAgentIfApproved?: AgentProfileRecord | null;
    ethioTelecomAuthorized?: boolean;
    safaricomAuthorized?: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<{ application: AgentApplicationRecord; agentProfile: AgentProfileRecord | null }>;
  getAgentDashboardData(agentId: string): Promise<{
    agent: AgentProfileRecord;
    attributedOrders: Array<{
      id: string;
      orderNumber: string;
      operatorCode: OperatorCode;
      status: EsimOrderRecord['status'];
      createdAt: string;
    }>;
    commissions: AgentCommissionRecord[];
    payouts: AgentPayoutRecord[];
  } | null>;
  recordAgentPayoutTx(
    payout: AgentPayoutRecord,
    auditEntry: AuditLogRecord,
  ): Promise<AgentPayoutRecord | null>;

  // Business Portal
  getBusinessPortal(
    userId: string,
    userEmail: string | null,
    emailVerified: boolean,
  ): Promise<{
    account: BusinessAccountRecord | null;
    memberRole: BusinessMemberRole | null;
    members: BusinessMemberRecord[];
    bulkOrders: BusinessBulkOrderRecord[];
  }>;
  upsertBusinessAccountTx(input: {
    userId: string;
    account: BusinessAccountRecord;
    ownerMemberIfNew: BusinessMemberRecord | null;
    isUpdate: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<BusinessAccountRecord>;
  addBusinessMemberTx(member: BusinessMemberRecord, auditEntry: AuditLogRecord): Promise<BusinessMemberRecord>;
  createBusinessBulkOrderTx(bulk: BusinessBulkOrderRecord, auditEntry: AuditLogRecord): Promise<BusinessBulkOrderRecord>;
  listAllBusinesses(): Promise<{
    accounts: BusinessAccountRecord[];
    bulkOrders: BusinessBulkOrderRecord[];
  }>;
  reviewBusinessAccountTx(
    businessId: string,
    patch: {
      verificationStatus: BusinessAccountRecord['verificationStatus'];
      pricingTermsStatus?: BusinessAccountRecord['pricingTermsStatus'];
      commercialNotes?: string | null;
      reviewedBy: string;
      reviewedAt: string;
    },
    auditEntry: AuditLogRecord,
  ): Promise<BusinessAccountRecord | null>;

  // Secondary Phones & Support & Audit & Overview Metrics
  listPhoneProducts(activeOnly?: boolean): Promise<PhoneProductRecord[]>;
  getPhoneProduct(id: string): Promise<PhoneProductRecord | null>;
  upsertPhoneProductTx(
    product: PhoneProductRecord,
    isNew: boolean,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneProductRecord>;
  createPhoneOrderTx(
    order: PhoneOrderRecord,
    qtyToDecrement: number,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneOrderRecord>;
  getPhoneOrder(phoneOrderId: string): Promise<PhoneOrderRecord | null>;
  listPhoneOrders(userId?: string): Promise<PhoneOrderRecord[]>;
  updatePhoneOrderTx(
    phoneOrderId: string,
    patch: {
      paymentStatus?: PhoneOrderRecord['paymentStatus'];
      paymentReference?: string | null;
      checkoutUrl?: string | null;
      fulfillmentStatus?: PhoneOrderRecord['fulfillmentStatus'];
      klickDeliveryPartnerStatus?: PhoneOrderRecord['klickDeliveryPartnerStatus'];
    },
    auditEntry?: AuditLogRecord | null,
  ): Promise<PhoneOrderRecord | null>;

  createSupportTicket(ticket: SupportTicketRecord): Promise<SupportTicketRecord>;
  listSupportTickets(userId?: string): Promise<SupportTicketRecord[]>;
  updateSupportTicketTx(
    ticketId: string,
    status: SupportTicketRecord['status'],
    adminResponse: string,
    auditEntry: AuditLogRecord,
  ): Promise<SupportTicketRecord | null>;

  recordAudit(entry: AuditLogRecord): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRecord[]>;

  getOverviewMetrics(): Promise<{
    totalUsers: number;
    totalEsimOrders: number;
    awaitingManualFulfillment: number;
    provisionedEsims: number;
    availableStockCount: number;
    reservedStockCount: number;
    pendingAgentApplications: number;
    approvedAgentsCount: number;
    verifiedPaymentsEtb: number;
    openSupportTickets: number;
    phoneOrdersCount: number;
    businessAccountsCount: number;
    pendingBulkEsimRequests: number;
  }>;
}
