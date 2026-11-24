export type Language = 'en' | 'am';

export type EnvironmentMode = 'local_dev' | 'demo' | 'sandbox' | 'production';

export type OperatorCode = 'ethio_telecom' | 'safaricom_ethiopia';

export type SupplyMethod = 'stock_based' | 'direct_api' | 'manual_processing';

export type NumberTier = 'standard' | 'bronze' | 'silver' | 'gold' | 'platinum';

export type OrderStatus =
  | 'draft'
  | 'awaiting_identity_verification'
  | 'identity_verified'
  | 'number_reserved'
  | 'awaiting_payment'
  | 'payment_verified'
  | 'provisioning_in_progress'
  | 'submitted_to_operator'
  | 'operator_pending'
  | 'awaiting_manual_fulfillment'
  | 'provisioned'
  | 'delivered'
  | 'ready_for_installation'
  | 'installed'
  | 'activated'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type StockItemStatus =
  | 'imported'
  | 'available'
  | 'reserved'
  | 'assigned'
  | 'sold'
  | 'expired'
  | 'invalid'
  | 'reconciliation_required';

export type KycStatus = 'not_started' | 'pending' | 'verified_sandbox' | 'verified_live' | 'failed';

export type PaymentStatus =
  | 'pending'
  | 'initialized'
  | 'verified'
  | 'failed'
  | 'cancelled'
  | 'reversal_pending'
  | 'reversed'
  | 'refund_pending'
  | 'refunded';

export type AgentReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'suspended';

export type AdminRole =
  | 'super_admin'
  | 'operations_staff'
  | 'finance_staff'
  | 'support_staff'
  | 'agent_supervisor'
  | 'read_only_auditor';

export type StatusKind =
  | 'successful'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'cancelled'
  | 'refunded'
  | 'reversed'
  | 'archived'
  | 'sandbox'
  | 'manual'
  | 'coming_soon'
  | 'verified'
  | 'neutral';

export type UserAccountStatus = 'active' | 'suspended' | 'disabled';

export interface StaffAdminSummary {
  uid: string;
  email: string;
  displayName: string | null;
  role: AdminRole;
  active: boolean;
  source: 'env_allowlist' | 'admin_grant';
  grantedAt: string;
}

export type BusinessVerificationStatus = 'pending_review' | 'verified' | 'suspended';
export type BusinessMemberRole = 'owner' | 'buyer' | 'viewer';

export interface BusinessAccountRecord {
  id: string;
  ownerUserId: string;
  companyName: string;
  tinNumber: string;
  contactEmail: string;
  contactPhone: string;
  city: string;
  verificationStatus: BusinessVerificationStatus;
  pricingTermsStatus: 'pending_commercial_agreement' | 'approved_custom_terms';
  commercialNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessMemberRecord {
  id: string;
  businessId: string;
  email: string;
  fullName: string;
  role: BusinessMemberRole;
  status: 'active' | 'invited' | 'revoked';
  addedByUserId: string;
  createdAt: string;
}

export interface BusinessBulkOrderRecord {
  id: string;
  requestNumber: string;
  businessId: string;
  requestedByUserId: string;
  operatorCode: OperatorCode;
  serviceType: 'new_esim_line' | 'sim_to_esim_conversion';
  quantity: number;
  preferredTier: NumberTier;
  departmentNote: string | null;
  estimatedAmountEtb: number | null;
  pricingNote: string;
  status: 'pending_commercial_review' | 'quoted_awaiting_approval' | 'ready_for_batch_fulfillment' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResultMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface VerifiedUserSummary {
  uid: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  preferredLanguage: Language;
  phoneNumber: string | null;
  accountStatus: UserAccountStatus;
  suspendedReason: string | null;
  createdAt: string;
  lastLoginAt: string;
}

export interface OperatorHealthSummary {
  totalOrders: number;
  provisionedOrders: number;
  pendingOrders: number;
  failedOrders: number;
  lastCheckedAt: string;
}

export interface OperatorConfigRecord {
  operatorCode: OperatorCode;
  displayName: string;
  isEnabled: boolean;
  integrationStatus: 'sandbox' | 'coming_soon' | 'live';
  activeSupplyMethod: SupplyMethod;
  supportedEsimTypes: Array<'new_esim_line' | 'sim_to_esim_conversion'>;
  numberAvailabilityMode: 'stock_pool' | 'direct_api' | 'operator_assigned';
  supportsPrePaymentReservation: boolean;
  provisioningStatus: 'operational_sandbox' | 'manual_queue' | 'maintenance' | 'not_configured';
  supportsNewNumber: boolean;
  supportsSimConversion: boolean;
  kycRequired: boolean;
  customerVisibleNote: string;
  healthSummary: OperatorHealthSummary;
  updatedAt: string;
}

export interface EsimProductRecord {
  id: string;
  operatorCode: OperatorCode;
  productType: 'new_esim_line' | 'sim_to_esim_conversion';
  name: string;
  nameAm: string;
  description: string;
  descriptionAm: string;
  priceEtb: number | null;
  sandboxPreviewAmountEtb: number | null;
  pricingStatus: 'pending_operator_agreement' | 'active';
  isActive: boolean;
  requiresFaydaKyc: boolean;
  updatedAt: string;
}

export interface DeviceCompatibilityRecord {
  id: string;
  brand: string;
  modelFamily: string;
  osPlatform: 'ios' | 'android';
  minOsVersion: string;
  esimSupported: boolean;
  dualEsimSupported: boolean;
  regionalCaveat: string;
}

export interface EsimStockBatchRecord {
  id: string;
  operatorCode: OperatorCode;
  batchName: string;
  sourceEnvironment: 'sandbox_demo' | 'operator_partner_batch';
  supplierReference: string | null;
  totalCount: number;
  availableCount: number;
  importedBy: string;
  createdAt: string;
}

export interface InventoryAuditEntry {
  action: string;
  actor: string;
  note: string;
  at: string;
}

export interface EsimStockItemRecord {
  id: string;
  batchId: string;
  operatorCode: OperatorCode;
  msisdn: string | null;
  numberTier: NumberTier;
  iccid: string;
  eid: string | null;
  externalInventoryRef: string | null;
  inventoryType: 'msisdn_profile_bundle' | 'activation_voucher' | 'number_allocation';
  status: StockItemStatus;
  reservedOrderId: string | null;
  reservedUntil: string | null;
  soldOrderId: string | null;
  sourceEnvironment: 'sandbox_demo' | 'operator_partner_batch';
  importedAt: string;
  expiresAt: string | null;
  auditHistory: InventoryAuditEntry[];
  createdAt: string;
}

export interface CsvStockImportRowPreview {
  rowNumber: number;
  msisdn: string | null;
  iccid: string;
  numberTier: NumberTier;
  externalInventoryRef: string | null;
  expiresAt: string | null;
  valid: boolean;
  errors: string[];
}

export interface CsvStockImportPreviewResult {
  operatorCode: OperatorCode;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  rows: CsvStockImportRowPreview[];
}

export interface OrderHistoryEvent {
  status: OrderStatus;
  note: string;
  actor: string;
  at: string;
}

export interface EsimOrderRecord {
  id: string;
  orderNumber: string;
  idempotencyKey: string | null;
  userId: string;
  operatorCode: OperatorCode;
  productId: string;
  productType: 'new_esim_line' | 'sim_to_esim_conversion';
  supplyMethodUsed: SupplyMethod;
  deviceModel: string | null;
  deviceOs: 'ios' | 'android' | null;
  deviceVerified: boolean;
  selectedNumberTier: NumberTier;
  reservedMsisdn: string | null;
  existingMsisdn: string | null;
  assignedStockItemId: string | null;
  reservedUntil: string | null;
  numberReservationConfirmed: boolean;
  kycStatus: KycStatus;
  paymentStatus: PaymentStatus;
  provisioningStatus:
    | 'not_started'
    | 'submitted_to_operator'
    | 'operator_pending'
    | 'awaiting_manual_fulfillment'
    | 'provisioned'
    | 'failed';
  deliveryStatus: 'pending' | 'delivered' | 'installed' | 'activated';
  operatorTransactionRef: string | null;
  amountEtb: number;
  currency?: 'ETB';
  pricingSnapshotNote?: string | null;
  isSandboxPricing: boolean;
  attributedAgentId: string | null;
  agentReferralCode: string | null;
  status: OrderStatus;
  failureReason: string | null;
  updateHistory: OrderHistoryEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface KycVerificationRecord {
  id: string;
  orderId: string;
  userId: string;
  operatorCode: OperatorCode;
  fullName: string;
  faydaFanMasked: string;
  contactPhone: string;
  consentGiven: boolean;
  verificationMode: 'fayda_sandbox_boundary' | 'fayda_official';
  status: KycStatus;
  failureReason?: string | null;
  verifiedAt: string;
}

export interface PaymentRecord {
  id: string;
  orderType: 'esim_order' | 'phone_order';
  orderId: string;
  userId: string;
  provider: 'chapa';
  txRef: string;
  idempotencyKey: string;
  chapaReference: string | null;
  amountEtb: number;
  currency?: 'ETB';
  checkoutUrl?: string | null;
  status: PaymentStatus;
  verifiedVia: 'server_verify' | 'webhook' | 'admin_reconcile' | null;
  webhookEventCount: number;
  isSandbox: boolean;
  failureReason: string | null;
  refundReason: string | null;
  refundReference?: string | null;
  refundStatusCheckedAt?: string | null;
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerEsimRecord {
  id: string;
  orderId: string;
  userId: string;
  operatorCode: OperatorCode;
  assignedMsisdn: string | null;
  iccid: string | null;
  deviceModel: string | null;
  status: 'ready_for_installation' | 'installed' | 'activated';
  supplyMethodUsed: SupplyMethod;
  isSandboxSimulation: boolean;
  activationId: string;
  createdAt: string;
  installedAt: string | null;
  activatedAt: string | null;
}

export interface EsimActivationSecretView {
  esimId: string;
  orderId: string;
  operatorCode: OperatorCode;
  assignedMsisdn: string | null;
  iccid: string | null;
  smdpAddress: string;
  activationCode: string;
  lpaUri: string;
  qrPayload: string;
  isSandboxSimulation: boolean;
  installedAt: string | null;
  activatedAt: string | null;
}

export interface PublicNumberOption {
  id: string;
  operatorCode: OperatorCode;
  msisdn: string | null;
  numberTier: NumberTier;
  sourceEnvironment: string;
  supplyMethod: SupplyMethod;
  supportsPrePaymentReservation: boolean;
}

export interface AgentApplicationRecord {
  id: string;
  userId: string;
  email: string | null;
  fullName: string;
  phone: string;
  city: string;
  businessName: string | null;
  applicantType: 'individual_agent' | 'retail_shop' | 'corporate_reseller';
  experienceSummary: string;
  status: AgentReviewStatus;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface AgentProfileRecord {
  id: string;
  userId: string;
  applicationId: string;
  fullName: string;
  email: string | null;
  referralCode: string;
  status: 'approved' | 'suspended';
  operatorAuthorizationStatus: {
    ethio_telecom: 'authorized' | 'not_authorized';
    safaricom_ethiopia: 'authorized' | 'not_authorized';
  };
  totalAttributedOrders: number;
  totalEarnedCommissionEtb: number;
  totalPaidOutEtb: number;
  approvedAt: string;
}

export interface AgentCommissionRecord {
  id: string;
  agentId: string;
  orderId: string;
  orderNumber: string;
  operatorCode: OperatorCode;
  commissionAmountEtb: number | null;
  pricingStatus: 'pending_commercial_rate' | 'approved';
  status: 'pending_commercial_schedule' | 'payable' | 'paid';
  createdAt: string;
}

export interface AgentPayoutRecord {
  id: string;
  agentId: string;
  amountEtb: number;
  paymentReference: string;
  status: 'scheduled' | 'paid';
  createdAt: string;
}

export type PhoneCategory = 'iphone' | 'samsung_galaxy' | 'google_pixel' | 'other';

export type PhoneCompatibilityStatus =
  | 'verified_compatible'
  | 'not_compatible'
  | 'needs_verification';

export type PhoneUnlockStatus =
  | 'verified_unlocked'
  | 'carrier_locked'
  | 'needs_verification';

export type OperatorCompatibilityStatus = 'verified' | 'not_compatible' | 'unverified';

export interface PhoneProductRecord {
  id: string;
  brand: string;
  category: PhoneCategory;
  model: string;
  exactModelNumber: string;
  regionalVariant: string;
  storage: string;
  condition: string;
  warrantySummary: string;
  esimCapable: boolean;
  esimCompatibilityStatus: PhoneCompatibilityStatus;
  networkUnlockStatus: PhoneUnlockStatus;
  ethioTelecomCompatibility: OperatorCompatibilityStatus;
  safaricomCompatibility: OperatorCompatibilityStatus;
  compatibilityNotes: string;
  compatibilityEvidence: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  isFeatured: boolean;
  unitPriceEtb: number | null;
  sandboxPreviewPriceEtb: number | null;
  pricingStatus: 'pending_commercial_quote' | 'active';
  stockQty: number;
  bulkMinimumQty: number;
  supportsBulkOrder: boolean;
  deliveryPartner: 'klick';
  isActive: boolean;
  updatedAt: string;
}

export interface PhoneOrderRecord {
  id: string;
  orderNumber: string;
  userId: string;
  phoneProductId: string;
  phoneModel: string;
  orderKind: 'individual' | 'bulk_business';
  quantity: number;
  companyName: string | null;
  contactPhone: string | null;
  deliveryCity: string;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  pairedEsimOperator: OperatorCode | null;
  estimatedTotalEtb: number;
  isSandboxEstimate: boolean;
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
  checkoutUrl: string | null;
  fulfillmentStatus: 'awaiting_confirmation' | 'dispatched_via_klick' | 'delivered' | 'cancelled';
  klickDeliveryPartnerStatus: 'klick_boundary_pending_onboarding' | 'sandbox_dispatched' | 'delivered';
  attributedAgentId: string | null;
  createdAt: string;
}

export interface SupportTicketRecord {
  id: string;
  userId: string | null;
  email: string;
  subject: string;
  category: 'esim_setup' | 'fayda_kyc' | 'payment' | 'agent_programme' | 'phone_order' | 'general';
  orderId: string | null;
  message: string;
  status: 'open' | 'in_review' | 'resolved';
  adminResponse: string | null;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorType: 'customer' | 'agent' | 'staff_admin' | 'system';
  actorId: string;
  actorEmail?: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  createdAt: string;
}

export interface AuthenticatedMeResponse {
  user: VerifiedUserSummary;
  isStaffAdmin: boolean;
  adminRole: AdminRole | null;
  agentStatus: AgentReviewStatus | 'none';
  agentProfile: AgentProfileRecord | null;
}
