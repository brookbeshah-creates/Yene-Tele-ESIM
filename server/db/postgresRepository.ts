import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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
  SupplyMethod,
  SupportTicketRecord,
  UserAccountStatus,
  VerifiedUserSummary,
} from '../../src/types/domain.ts';
import { DomainRuleError } from '../lib/errors.ts';
import type { ScheduledJobRunRecord } from '../lib/observability.ts';
import type {
  InternalActivationVault,
  InternalStockCredential,
  StaffAdminRecord,
  YenePersistenceBackend,
} from '../modules/store/persistenceBackend.ts';
import { DatabaseConnectionError, withTransaction } from './pool.ts';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

interface PgErrorShape {
  code?: string;
  constraint?: string;
  message?: string;
}

const PAYMENT_EXPIRY_LOCK_KEY = 88421001;

function toIso(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.trim().length > 0) return new Date(val).toISOString();
  return new Date().toISOString();
}

function toIsoNullable(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.trim().length > 0) return new Date(val).toISOString();
  return null;
}

function toNum(val: unknown): number {
  const n = Number(val ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNumNullable(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function parseJsonArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapPgError(err: unknown): never {
  if (err instanceof DomainRuleError || err instanceof DatabaseConnectionError) {
    throw err;
  }
  const pgErr = err as PgErrorShape | undefined;
  const code = pgErr?.code ?? '';

  if (code === '23505') {
    const constraint = pgErr?.constraint ?? '';
    if (constraint === 'uq_operator_stock_identifier') {
      throw new DomainRuleError(409, 'DUPLICATE_ICCID', 'Duplicate ICCID in stock inventory.');
    }
    if (constraint === 'uq_active_msisdn_stock' || constraint === 'uq_active_order_msisdn') {
      throw new DomainRuleError(
        409,
        'NUMBER_ALREADY_RESERVED',
        'This mobile number is already reserved or assigned to another active order.',
      );
    }
    if (constraint === 'uq_order_verified_payment') {
      throw new DomainRuleError(
        409,
        'PAYMENT_ALREADY_VERIFIED',
        'A verified payment already exists for this order.',
      );
    }
    if (constraint === 'uq_business_member_email') {
      throw new DomainRuleError(409, 'MEMBER_EXISTS', 'This email is already registered on the business team.');
    }
    if (constraint === 'uq_esim_orders_user_idempotency') {
      throw new DomainRuleError(409, 'DUPLICATE_IDEMPOTENCY_KEY', 'An active order already exists for this idempotency key.');
    }
    throw new DomainRuleError(409, 'CONFLICT', 'A uniqueness constraint prevented duplicate persistence.');
  }

  if (
    code.startsWith('08') ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT'
  ) {
    throw new DatabaseConnectionError('PostgreSQL database connection failure.', err);
  }

  throw err;
}

export class PostgresPersistenceRepository implements YenePersistenceBackend {
  public readonly isPostgreSql = true;
  private readonly pool: Pick<Pool, 'query' | 'connect'>;

  constructor(pool: Pick<Pool, 'query' | 'connect'>) {
    this.pool = pool;
  }

  private async runQuery<T extends Record<string, unknown>>(
    q: Queryable,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    try {
      return await q.query<T>(sql, params);
    } catch (err) {
      mapPgError(err);
    }
  }

  private async runTx<T>(fn: (client: Pick<PoolClient, 'query'>) => Promise<T>): Promise<T> {
    try {
      return await withTransaction(this.pool, fn);
    } catch (err) {
      mapPgError(err);
    }
  }

  private async insertAudit(q: Queryable, entry: AuditLogRecord): Promise<void> {
    await this.runQuery(
      q,
      `INSERT INTO audit_logs (
         id, actor_type, actor_id, actor_email, action, target_type, target_id, reason, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.actorType,
        entry.actorId,
        entry.actorEmail ?? null,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.reason,
        entry.createdAt,
      ],
    );
  }

  private async recalculateBatchCounts(q: Queryable, batchId: string): Promise<void> {
    await this.runQuery(
      q,
      `UPDATE esim_stock_batches b
       SET total_count = sub.total_cnt,
           available_count = sub.avail_cnt
       FROM (
         SELECT
           COUNT(*)::int AS total_cnt,
           COUNT(*) FILTER (WHERE status = 'available')::int AS avail_cnt
         FROM esim_stock_items
         WHERE batch_id = $1
       ) sub
       WHERE b.id = $1`,
      [batchId],
    );
  }

  private mapUserRow(row: Record<string, unknown>): VerifiedUserSummary {
    return {
      uid: String(row.uid),
      email: (row.email as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      emailVerified: Boolean(row.email_verified),
      preferredLanguage: (row.preferred_language === 'am' ? 'am' : 'en'),
      phoneNumber: (row.phone_number as string | null) ?? null,
      accountStatus: (row.account_status as UserAccountStatus) ?? 'active',
      suspendedReason: (row.suspended_reason as string | null) ?? null,
      createdAt: toIso(row.created_at),
      lastLoginAt: toIso(row.last_seen_at),
    };
  }

  private mapOrderRow(row: Record<string, unknown>): EsimOrderRecord {
    const devModel = row.device_model as string | null;
    return {
      id: String(row.id),
      orderNumber: String(row.order_number),
      idempotencyKey: (row.idempotency_key as string | null) ?? null,
      userId: String(row.user_id),
      operatorCode: row.operator_code as OperatorCode,
      productId: String(row.product_id),
      productType: row.service_type === 'sim_conversion' ? 'sim_to_esim_conversion' : 'new_esim_line',
      supplyMethodUsed: row.fulfillment_method as SupplyMethod,
      deviceModel: devModel && devModel.trim().length > 0 ? devModel : null,
      deviceOs: (row.device_os as 'ios' | 'android' | null) ?? null,
      deviceVerified: Boolean(row.device_esim_confirmed),
      selectedNumberTier: (row.selected_number_tier as NumberTier) ?? 'standard',
      reservedMsisdn: (row.selected_msisdn as string | null) ?? null,
      existingMsisdn: (row.existing_msisdn as string | null) ?? null,
      assignedStockItemId: (row.stock_item_id as string | null) ?? null,
      reservedUntil: toIsoNullable(row.reserved_until),
      numberReservationConfirmed: Boolean(row.number_reservation_confirmed),
      kycStatus: row.identity_status as EsimOrderRecord['kycStatus'],
      paymentStatus: row.payment_status as EsimOrderRecord['paymentStatus'],
      provisioningStatus: row.provisioning_status as EsimOrderRecord['provisioningStatus'],
      deliveryStatus: row.delivery_status as EsimOrderRecord['deliveryStatus'],
      operatorTransactionRef: (row.operator_order_ref as string | null) ?? null,
      amountEtb: toNum(row.amount_etb),
      currency: 'ETB',
      isSandboxPricing: Boolean(row.is_sandbox_pricing),
      pricingSnapshotNote: (row.pricing_snapshot_note as string | null) ?? null,
      attributedAgentId: (row.attributed_agent_id as string | null) ?? null,
      agentReferralCode: (row.agent_referral_code as string | null) ?? null,
      status: row.status as OrderStatus,
      failureReason: (row.failure_reason as string | null) ?? null,
      updateHistory: parseJsonArray(row.update_history),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  private mapPaymentRow(row: Record<string, unknown>): PaymentRecord {
    return {
      id: String(row.id),
      orderType: (row.order_type as 'esim_order' | 'phone_order') ?? 'esim_order',
      orderId: String(row.order_id),
      userId: String(row.user_id),
      provider: 'chapa',
      txRef: String(row.tx_ref),
      idempotencyKey: String(row.idempotency_key),
      chapaReference: (row.chapa_reference as string | null) ?? null,
      amountEtb: toNum(row.amount_etb),
      currency: 'ETB',
      checkoutUrl: (row.checkout_url as string | null) ?? null,
      status: row.status as PaymentRecord['status'],
      verifiedVia: (row.verified_via as PaymentRecord['verifiedVia']) ?? null,
      webhookEventCount: Number(row.webhook_event_count ?? 0),
      isSandbox: row.mode !== 'production',
      failureReason: (row.failure_reason as string | null) ?? null,
      refundReason: (row.refund_reason as string | null) ?? null,
      refundReference: (row.refund_reference as string | null) ?? null,
      refundStatusCheckedAt: toIsoNullable(row.refund_status_checked_at),
      reconciledAt: toIsoNullable(row.reconciled_at),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  private mapStockItemRow(row: Record<string, unknown>): EsimStockItemRecord {
    return {
      id: String(row.id),
      batchId: String(row.batch_id),
      operatorCode: row.operator_code as OperatorCode,
      msisdn: (row.msisdn as string | null) ?? null,
      numberTier: (row.tier as NumberTier) ?? 'standard',
      iccid: String(row.stock_identifier),
      eid: (row.eid as string | null) ?? null,
      externalInventoryRef: (row.external_inventory_ref as string | null) ?? null,
      inventoryType: (row.inventory_type as EsimStockItemRecord['inventoryType']) ?? 'msisdn_profile_bundle',
      status: row.status as StockItemStatus,
      reservedOrderId: (row.reserved_by_order_id as string | null) ?? null,
      reservedUntil: toIsoNullable(row.reserved_until),
      soldOrderId: (row.assigned_to_order_id as string | null) ?? null,
      sourceEnvironment: (row.source_environment as EsimStockItemRecord['sourceEnvironment']) ?? 'operator_partner_batch',
      importedAt: toIso(row.imported_at),
      expiresAt: toIsoNullable(row.expires_at),
      auditHistory: parseJsonArray(row.audit_history),
      createdAt: toIso(row.created_at),
    };
  }

  private mapActivationToCustomerEsim(row: Record<string, unknown>, order?: EsimOrderRecord | null): CustomerEsimRecord {
    const actId = String(row.id);
    const esimId = actId.startsWith('act-') ? `esim-${actId.slice(4)}` : actId;
    const rawStatus = String(row.activation_status);
    const status: CustomerEsimRecord['status'] =
      rawStatus === 'installed'
        ? 'installed'
        : rawStatus === 'activated' || rawStatus === 'active'
          ? 'activated'
          : 'ready_for_installation';

    return {
      id: esimId,
      orderId: String(row.order_id),
      userId: String(row.user_id),
      operatorCode: row.operator_code as OperatorCode,
      assignedMsisdn: row.msisdn === 'N/A' ? null : (row.msisdn as string | null),
      iccid: (row.iccid_masked as string | null) ?? null,
      deviceModel: (row.device_model as string | null) ?? order?.deviceModel ?? null,
      status,
      supplyMethodUsed: (row.fulfillment_method as SupplyMethod) ?? order?.supplyMethodUsed ?? 'stock_based',
      isSandboxSimulation: Boolean(row.is_sandbox_profile),
      activationId: actId,
      createdAt: toIso(row.provisioned_at),
      installedAt: toIsoNullable(row.installed_at),
      activatedAt: toIsoNullable(row.activated_at),
    };
  }

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
    await this.runTx(async (client) => {
      for (const op of seed.operators) {
        await this.runQuery(
          client,
          `INSERT INTO operators (
             code, display_name, amharic_name, supply_method, integration_mode,
             new_esim_enabled, sim_conversion_enabled, number_selection_mode,
             is_enabled, kyc_required, supports_pre_payment_reservation,
             provisioning_status, customer_visible_note, live_authorized, updated_at
           )
           VALUES ($1, $2, $2, $3, $4, TRUE, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
           ON CONFLICT (code) DO NOTHING`,
          [
            op.operatorCode,
            op.displayName,
            op.activeSupplyMethod,
            op.integrationStatus,
            op.supportsSimConversion,
            op.activeSupplyMethod === 'stock_based'
              ? 'stock_pool'
              : op.activeSupplyMethod === 'direct_api'
                ? 'live_api'
                : 'assigned_by_operator',
            op.isEnabled,
            op.kycRequired,
            op.supportsPrePaymentReservation,
            op.provisioningStatus,
            op.customerVisibleNote,
            op.integrationStatus === 'live',
            op.updatedAt,
          ],
        );
      }

      for (const prod of seed.esimProducts) {
        await this.runQuery(
          client,
          `INSERT INTO esim_products (
             id, operator_code, name, name_am, service_type, summary, description_am,
             price_etb, sandbox_preview_amount_etb, price_label, pricing_status,
             enabled, requires_fayda_kyc, is_sandbox_catalog, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::timestamptz)
           ON CONFLICT (id) DO NOTHING`,
          [
            prod.id,
            prod.operatorCode,
            prod.name,
            prod.nameAm,
            prod.productType === 'new_esim_line' ? 'new_esim' : 'sim_conversion',
            prod.description,
            prod.descriptionAm,
            prod.priceEtb,
            prod.sandboxPreviewAmountEtb,
            prod.priceEtb !== null ? `${prod.priceEtb} ETB` : 'Pending Commercial Agreement',
            prod.pricingStatus,
            prod.isActive,
            prod.requiresFaydaKyc,
            prod.pricingStatus !== 'active',
            prod.updatedAt,
          ],
        );
      }

      for (const ph of seed.phoneProducts) {
        await this.runQuery(
          client,
          `INSERT INTO phone_products (
             id, brand, category, model, exact_model_number, regional_variant, storage, condition, warranty_summary,
             esim_ready, esim_capable, esim_compatibility_status, network_unlock_status,
             ethio_telecom_compatibility, safaricom_compatibility, compatibility_notes, compatibility_evidence,
             image_key, image_url, is_featured,
             price_etb, sandbox_preview_price_etb, price_label, pricing_status,
             stock_count, bulk_eligible, bulk_minimum_qty, specs, is_active, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $10, $11, $12,
             $13, $14, $15, $16,
             $17, $18, $19,
             $20, $21, $22, $23,
             $24, $25, $26, $27, $28, $29::timestamptz
           )
           ON CONFLICT (id) DO NOTHING`,
          [
            ph.id,
            ph.brand,
            ph.category,
            ph.model,
            ph.exactModelNumber,
            ph.regionalVariant,
            ph.storage,
            ph.condition,
            ph.warrantySummary,
            ph.esimCapable,
            ph.esimCompatibilityStatus,
            ph.networkUnlockStatus,
            ph.ethioTelecomCompatibility,
            ph.safaricomCompatibility,
            ph.compatibilityNotes,
            ph.compatibilityEvidence,
            ph.imageKey,
            ph.imageUrl,
            ph.isFeatured,
            ph.unitPriceEtb,
            ph.sandboxPreviewPriceEtb,
            ph.unitPriceEtb !== null ? `${ph.unitPriceEtb} ETB` : 'Pending Commercial Quote',
            ph.pricingStatus,
            ph.stockQty,
            ph.supportsBulkOrder,
            ph.bulkMinimumQty,
            `${ph.storage} · ${ph.condition}`,
            ph.isActive,
            ph.updatedAt,
          ],
        );
      }

      if (seed.sandboxBatches && seed.sandboxBatches.length > 0) {
        const countRes = await this.runQuery<{ cnt: number }>(
          client,
          'SELECT COUNT(*)::int AS cnt FROM esim_stock_batches',
        );
        if ((countRes.rows[0]?.cnt ?? 0) === 0) {
          for (const entry of seed.sandboxBatches) {
            const secretMap = new Map(entry.secrets.map((s) => [s.stockItemId, s]));
            await this.insertBatchAndItems(client, entry.batch, entry.items, secretMap);
          }
        }
      }
    });
  }

  private async insertBatchAndItems(
    client: Queryable,
    batch: EsimStockBatchRecord,
    items: EsimStockItemRecord[],
    secretMap: Map<string, InternalStockCredential>,
  ): Promise<void> {
    await this.runQuery(
      client,
      `INSERT INTO esim_stock_batches (
         id, operator_code, batch_code, batch_name, supply_format, total_count,
         available_count, source_environment, supplier_reference, imported_by, imported_at
       )
       VALUES ($1, $2, $3, $4, 'profile_identifier', $5, $6, $7, $8, $9, $10::timestamptz)
       ON CONFLICT (id) DO NOTHING`,
      [
        batch.id,
        batch.operatorCode,
        batch.id,
        batch.batchName,
        batch.totalCount,
        batch.availableCount,
        batch.sourceEnvironment,
        batch.supplierReference,
        batch.importedBy,
        batch.createdAt,
      ],
    );

    for (const item of items) {
      const secret = secretMap.get(item.id);
      await this.runQuery(
        client,
        `INSERT INTO esim_stock_items (
           id, batch_id, operator_code, stock_identifier, msisdn, tier,
           supply_format, encrypted_credential_payload, status, reserved_by_order_id, reserved_until,
           assigned_to_order_id, expires_at, eid, external_inventory_ref,
           inventory_type, source_environment, imported_at, audit_history, created_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           'profile_identifier', $7, $8, $9, $10::timestamptz,
           $11, $12::timestamptz, $13, $14,
           $15, $16, $17::timestamptz, $18::jsonb, $19::timestamptz
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          item.id,
          item.batchId,
          item.operatorCode,
          item.iccid,
          item.msisdn,
          item.numberTier,
          secret?.encryptedCredentials ?? null,
          item.status,
          item.reservedOrderId,
          item.reservedUntil,
          item.soldOrderId,
          item.expiresAt,
          item.eid,
          item.externalInventoryRef,
          item.inventoryType,
          item.sourceEnvironment,
          item.importedAt,
          JSON.stringify(item.auditHistory),
          item.createdAt,
        ],
      );
    }
  }

  /* --------------------------------------------------------------------------
   * USERS & STAFF ADMINS
   * -------------------------------------------------------------------------- */
  public async getUser(uid: string): Promise<VerifiedUserSummary | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM users WHERE uid = $1 LIMIT 1', [uid]);
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async findUserByEmail(email: string): Promise<VerifiedUserSummary | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email.trim()],
    );
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async listUsers(): Promise<VerifiedUserSummary[]> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM users ORDER BY last_seen_at DESC');
    return res.rows.map((r) => this.mapUserRow(r));
  }

  public async upsertAuthenticatedUserTx(input: {
    user: VerifiedUserSummary;
    autoGrantAdmin?: StaffAdminRecord | null;
    auditEntry?: AuditLogRecord | null;
  }): Promise<{ user: VerifiedUserSummary; promotedFromInvite: boolean }> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO users (
           uid, email, phone_number, display_name, email_verified,
           preferred_language, account_status, suspended_reason, created_at, last_seen_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
         ON CONFLICT (uid) DO UPDATE SET
           email = COALESCE(EXCLUDED.email, users.email),
           display_name = COALESCE(EXCLUDED.display_name, users.display_name),
           email_verified = EXCLUDED.email_verified,
           last_seen_at = EXCLUDED.last_seen_at
         RETURNING *`,
        [
          input.user.uid,
          input.user.email,
          input.user.phoneNumber,
          input.user.displayName,
          input.user.emailVerified,
          input.user.preferredLanguage,
          input.user.accountStatus,
          input.user.suspendedReason,
          input.user.createdAt,
          input.user.lastLoginAt,
        ],
      );
      const savedUser = this.mapUserRow(res.rows[0]);
      let promotedFromInvite = false;

      if (input.autoGrantAdmin) {
        await this.runQuery(
          client,
          `INSERT INTO staff_admins (uid, email, display_name, role, source, active, granted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
           ON CONFLICT (uid) DO NOTHING`,
          [
            input.autoGrantAdmin.uid,
            input.autoGrantAdmin.email,
            input.autoGrantAdmin.displayName,
            input.autoGrantAdmin.role,
            input.autoGrantAdmin.source ?? 'env_allowlist',
            input.autoGrantAdmin.active,
            input.autoGrantAdmin.grantedAt,
          ],
        );
      } else if (savedUser.emailVerified && savedUser.email) {
        const invRes = await this.runQuery(
          client,
          'SELECT * FROM staff_admin_invites WHERE LOWER(email) = LOWER($1) AND active = TRUE LIMIT 1',
          [savedUser.email],
        );
        const inv = invRes.rows[0];
        if (inv) {
          await this.runQuery(
            client,
            `INSERT INTO staff_admins (uid, email, display_name, role, source, active, granted_at)
             VALUES ($1, $2, $3, $4, 'admin_grant', TRUE, $5::timestamptz)
             ON CONFLICT (uid) DO NOTHING`,
            [
              savedUser.uid,
              String(inv.email),
              savedUser.displayName ?? (inv.display_name as string | null) ?? null,
              String(inv.role),
              toIso(inv.granted_at),
            ],
          );
          await this.runQuery(client, 'DELETE FROM staff_admin_invites WHERE LOWER(email) = LOWER($1)', [savedUser.email]);
          promotedFromInvite = true;
        }
      }

      if (input.auditEntry) {
        await this.insertAudit(client, input.auditEntry);
      }

      return { user: savedUser, promotedFromInvite };
    });
  }

  public async updateUserPreferences(
    uid: string,
    patch: { displayName?: string; preferredLanguage?: 'en' | 'am'; phoneNumber?: string | null },
  ): Promise<VerifiedUserSummary | null> {
    const existing = await this.getUser(uid);
    if (!existing) return null;
    const res = await this.runQuery(
      this.pool,
      `UPDATE users
       SET display_name = $2,
           preferred_language = $3,
           phone_number = $4
       WHERE uid = $1
       RETURNING *`,
      [
        uid,
        patch.displayName?.trim() || existing.displayName,
        patch.preferredLanguage ?? existing.preferredLanguage,
        patch.phoneNumber !== undefined ? patch.phoneNumber : existing.phoneNumber,
      ],
    );
    return res.rows[0] ? this.mapUserRow(res.rows[0]) : null;
  }

  public async updateCustomerAccountStatusTx(
    targetUid: string,
    status: UserAccountStatus,
    reason: string | null,
    auditEntry: AuditLogRecord,
  ): Promise<VerifiedUserSummary | null> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `UPDATE users
         SET account_status = $2,
             suspended_reason = $3
         WHERE uid = $1
         RETURNING *`,
        [targetUid, status, status === 'active' ? null : reason],
      );
      if (!res.rows[0]) return null;
      await this.insertAudit(client, auditEntry);
      return this.mapUserRow(res.rows[0]);
    });
  }

  public async getStaffAdmin(uid: string): Promise<StaffAdminRecord | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM staff_admins WHERE uid = $1 AND active = TRUE LIMIT 1',
      [uid],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      uid: String(row.uid),
      email: String(row.email),
      displayName: (row.display_name as string | null) ?? null,
      role: row.role as AdminRole,
      active: Boolean(row.active),
      source: row.source === 'env_allowlist' ? 'env_allowlist' : 'admin_grant',
      grantedAt: toIso(row.granted_at),
    };
  }

  public async listStaffAdmins(): Promise<StaffAdminSummary[]> {
    const [adminsRes, invitesRes] = await Promise.all([
      this.runQuery(this.pool, 'SELECT * FROM staff_admins ORDER BY email ASC'),
      this.runQuery(this.pool, 'SELECT * FROM staff_admin_invites ORDER BY email ASC'),
    ]);

    const admins: StaffAdminSummary[] = adminsRes.rows.map((r) => ({
      uid: String(r.uid),
      email: String(r.email),
      displayName: (r.display_name as string | null) ?? null,
      role: r.role as AdminRole,
      active: Boolean(r.active),
      source: r.source === 'env_allowlist' ? 'env_allowlist' : 'admin_grant',
      grantedAt: toIso(r.granted_at),
    }));

    const invites: StaffAdminSummary[] = invitesRes.rows.map((i) => ({
      uid: `invite:${String(i.email)}`,
      email: String(i.email),
      displayName: (i.display_name as string | null) ?? null,
      role: i.role as AdminRole,
      active: Boolean(i.active),
      source: 'admin_grant',
      grantedAt: toIso(i.granted_at),
    }));

    return [...admins, ...invites].sort((a, b) => a.email.localeCompare(b.email));
  }

  public async grantStaffAdminDirect(
    admin: StaffAdminRecord,
    source: 'env_allowlist' | 'admin_grant' = 'admin_grant',
  ): Promise<void> {
    await this.runQuery(
      this.pool,
      `INSERT INTO staff_admins (uid, email, display_name, role, source, active, granted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
       ON CONFLICT (uid) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         active = EXCLUDED.active`,
      [admin.uid, admin.email, admin.displayName, admin.role, source, admin.active, admin.grantedAt],
    );
  }

  public async grantStaffAdminByEmailTx(input: {
    email: string;
    role: AdminRole;
    displayName: string | null;
    grantedAt: string;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary> {
    return this.runTx(async (client) => {
      const userRes = await this.runQuery(
        client,
        'SELECT uid, email, display_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [input.email],
      );
      const matched = userRes.rows[0];
      if (matched) {
        const uid = String(matched.uid);
        const displayName = input.displayName ?? (matched.display_name as string | null) ?? null;
        await this.runQuery(
          client,
          `INSERT INTO staff_admins (uid, email, display_name, role, source, active, granted_at)
           VALUES ($1, $2, $3, $4, 'admin_grant', TRUE, $5::timestamptz)
           ON CONFLICT (uid) DO UPDATE SET
             email = EXCLUDED.email,
             display_name = COALESCE(EXCLUDED.display_name, staff_admins.display_name),
             role = EXCLUDED.role,
             active = TRUE`,
          [uid, input.email, displayName, input.role, input.grantedAt],
        );
        await this.insertAudit(client, { ...input.auditEntry, targetId: uid });
        return {
          uid,
          email: input.email,
          displayName,
          role: input.role,
          active: true,
          source: 'admin_grant',
          grantedAt: input.grantedAt,
        };
      }

      await this.runQuery(
        client,
        `INSERT INTO staff_admin_invites (email, display_name, role, active, granted_by, granted_at)
         VALUES ($1, $2, $3, TRUE, $4, $5::timestamptz)
         ON CONFLICT (email) DO UPDATE SET
           display_name = COALESCE(EXCLUDED.display_name, staff_admin_invites.display_name),
           role = EXCLUDED.role,
           active = TRUE`,
        [input.email, input.displayName, input.role, input.auditEntry.actorId, input.grantedAt],
      );
      const inviteUid = `invite:${input.email}`;
      await this.insertAudit(client, { ...input.auditEntry, targetId: inviteUid });
      return {
        uid: inviteUid,
        email: input.email,
        displayName: input.displayName,
        role: input.role,
        active: true,
        source: 'admin_grant',
        grantedAt: input.grantedAt,
      };
    });
  }

  public async updateStaffAdminRoleTx(input: {
    actorUid: string;
    targetUid: string;
    role?: AdminRole;
    active?: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<StaffAdminSummary> {
    return this.runTx(async (client) => {
      if (input.targetUid.startsWith('invite:')) {
        const email = input.targetUid.slice('invite:'.length);
        const res = await this.runQuery(
          client,
          'SELECT * FROM staff_admin_invites WHERE LOWER(email) = LOWER($1) FOR UPDATE',
          [email],
        );
        const inv = res.rows[0];
        if (!inv) {
          throw new DomainRuleError(404, 'STAFF_NOT_FOUND', 'Staff administrator record not found.');
        }
        const nextRole = input.role ?? (inv.role as AdminRole);
        const nextActive = typeof input.active === 'boolean' ? input.active : Boolean(inv.active);
        await this.runQuery(
          client,
          'UPDATE staff_admin_invites SET role = $2, active = $3 WHERE LOWER(email) = LOWER($1)',
          [email, nextRole, nextActive],
        );
        await this.insertAudit(client, input.auditEntry);
        return {
          uid: input.targetUid,
          email: String(inv.email),
          displayName: (inv.display_name as string | null) ?? null,
          role: nextRole,
          active: nextActive,
          source: 'admin_grant',
          grantedAt: toIso(inv.granted_at),
        };
      }

      const targetRes = await this.runQuery(
        client,
        'SELECT * FROM staff_admins WHERE uid = $1 FOR UPDATE',
        [input.targetUid],
      );
      const target = targetRes.rows[0];
      if (!target) {
        throw new DomainRuleError(404, 'STAFF_NOT_FOUND', 'Staff administrator record not found.');
      }

      const countRes = await this.runQuery<{ cnt: number }>(
        client,
        `SELECT COUNT(*)::int AS cnt FROM staff_admins WHERE active = TRUE AND role = 'super_admin'`,
      );
      const activeSupers = countRes.rows[0]?.cnt ?? 0;

      if (
        target.role === 'super_admin' &&
        Boolean(target.active) &&
        activeSupers <= 1 &&
        (input.active === false || (input.role && input.role !== 'super_admin'))
      ) {
        throw new DomainRuleError(409, 'LAST_SUPER_ADMIN', 'At least one active Super Admin must remain.');
      }

      const nextRole = input.role ?? (target.role as AdminRole);
      const nextActive = typeof input.active === 'boolean' ? input.active : Boolean(target.active);
      await this.runQuery(
        client,
        'UPDATE staff_admins SET role = $2, active = $3 WHERE uid = $1',
        [input.targetUid, nextRole, nextActive],
      );
      await this.insertAudit(client, input.auditEntry);

      return {
        uid: String(target.uid),
        email: String(target.email),
        displayName: (target.display_name as string | null) ?? null,
        role: nextRole,
        active: nextActive,
        source: target.source === 'env_allowlist' ? 'env_allowlist' : 'admin_grant',
        grantedAt: toIso(target.granted_at),
      };
    });
  }

  /* --------------------------------------------------------------------------
   * OPERATORS & PRODUCTS
   * -------------------------------------------------------------------------- */
  public async listOperators(): Promise<OperatorConfigRecord[]> {
    const [opsRes, statsRes] = await Promise.all([
      this.runQuery(this.pool, 'SELECT * FROM operators ORDER BY code ASC'),
      this.runQuery(
        this.pool,
        `SELECT
           operator_code,
           COUNT(*)::int AS total_orders,
           COUNT(*) FILTER (WHERE status IN ('provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated'))::int AS provisioned_orders,
           COUNT(*) FILTER (WHERE status IN ('operator_pending', 'submitted_to_operator', 'awaiting_manual_fulfillment'))::int AS pending_orders,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_orders
         FROM esim_orders
         GROUP BY operator_code`,
      ),
    ]);

    const statMap = new Map<string, Record<string, unknown>>();
    for (const s of statsRes.rows) {
      statMap.set(String(s.operator_code), s);
    }

    const now = new Date().toISOString();
    return opsRes.rows.map((row) => {
      const code = row.code as OperatorCode;
      const supply = row.supply_method as SupplyMethod;
      const rawMode = String(row.integration_mode);
      const integrationStatus: OperatorConfigRecord['integrationStatus'] =
        rawMode === 'production' || rawMode === 'live'
          ? 'live'
          : rawMode === 'coming_soon' || rawMode === 'not_configured'
            ? 'coming_soon'
            : 'sandbox';

      const s = statMap.get(code);
      const supportsConv = Boolean(row.sim_conversion_enabled);
      return {
        operatorCode: code,
        displayName: String(row.display_name),
        isEnabled: Boolean(row.is_enabled),
        integrationStatus,
        activeSupplyMethod: supply,
        supportedEsimTypes: supportsConv
          ? ['new_esim_line', 'sim_to_esim_conversion']
          : ['new_esim_line'],
        numberAvailabilityMode:
          supply === 'stock_based'
            ? 'stock_pool'
            : supply === 'direct_api'
              ? 'direct_api'
              : 'operator_assigned',
        supportsPrePaymentReservation:
          supply === 'stock_based'
            ? true
            : supply === 'direct_api'
              ? Boolean(row.supports_pre_payment_reservation)
              : false,
        provisioningStatus:
          (row.provisioning_status as OperatorConfigRecord['provisioningStatus']) ?? 'operational_sandbox',
        supportsNewNumber: Boolean(row.new_esim_enabled),
        supportsSimConversion: supportsConv,
        kycRequired: Boolean(row.kyc_required),
        customerVisibleNote: String(row.customer_visible_note ?? ''),
        healthSummary: {
          totalOrders: Number(s?.total_orders ?? 0),
          provisionedOrders: Number(s?.provisioned_orders ?? 0),
          pendingOrders: Number(s?.pending_orders ?? 0),
          failedOrders: Number(s?.failed_orders ?? 0),
          lastCheckedAt: now,
        },
        updatedAt: toIso(row.updated_at),
      };
    });
  }

  public async getOperator(code: OperatorCode): Promise<OperatorConfigRecord | null> {
    const all = await this.listOperators();
    return all.find((o) => o.operatorCode === code) ?? null;
  }

  public async updateOperatorTx(
    op: OperatorConfigRecord,
    auditEntry: AuditLogRecord,
  ): Promise<OperatorConfigRecord> {
    await this.runTx(async (client) => {
      await this.runQuery(
        client,
        `UPDATE operators
         SET is_enabled = $2,
             integration_mode = $3,
             supply_method = $4,
             sim_conversion_enabled = $5,
             supports_pre_payment_reservation = $6,
             number_selection_mode = $7,
             provisioning_status = $8,
             customer_visible_note = $9,
             live_authorized = $10,
             updated_at = $11::timestamptz,
             updated_by = $12
         WHERE code = $1`,
        [
          op.operatorCode,
          op.isEnabled,
          op.integrationStatus,
          op.activeSupplyMethod,
          op.supportsSimConversion,
          op.supportsPrePaymentReservation,
          op.activeSupplyMethod === 'stock_based'
            ? 'stock_pool'
            : op.activeSupplyMethod === 'direct_api'
              ? 'live_api'
              : 'assigned_by_operator',
          op.provisioningStatus,
          op.customerVisibleNote,
          op.integrationStatus === 'live',
          op.updatedAt,
          auditEntry.actorEmail ?? auditEntry.actorId,
        ],
      );

      await this.runQuery(
        client,
        `UPDATE esim_products
         SET enabled = $2, updated_at = NOW()
         WHERE operator_code = $1 AND service_type = 'sim_conversion'`,
        [op.operatorCode, op.supportsSimConversion],
      );

      await this.insertAudit(client, auditEntry);
    });

    const updated = await this.getOperator(op.operatorCode);
    if (!updated) throw new DomainRuleError(404, 'OPERATOR_NOT_FOUND', 'Operator not found.');
    return updated;
  }

  public async listEsimProducts(): Promise<EsimProductRecord[]> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM esim_products ORDER BY id ASC');
    return res.rows.map((r) => ({
      id: String(r.id),
      operatorCode: r.operator_code as OperatorCode,
      productType: r.service_type === 'sim_conversion' ? 'sim_to_esim_conversion' : 'new_esim_line',
      name: String(r.name),
      nameAm: String(r.name_am || r.name),
      description: String(r.summary),
      descriptionAm: String(r.description_am || r.summary),
      priceEtb: toNumNullable(r.price_etb),
      sandboxPreviewAmountEtb: toNumNullable(r.sandbox_preview_amount_etb),
      pricingStatus:
        (r.pricing_status as EsimProductRecord['pricingStatus']) ??
        (r.price_etb !== null ? 'active' : 'pending_operator_agreement'),
      isActive: Boolean(r.enabled),
      requiresFaydaKyc: Boolean(r.requires_fayda_kyc),
      updatedAt: toIso(r.updated_at ?? r.created_at),
    }));
  }

  public async getEsimProduct(id: string): Promise<EsimProductRecord | null> {
    const all = await this.listEsimProducts();
    return all.find((p) => p.id === id) ?? null;
  }

  public async updateEsimProductTx(
    product: EsimProductRecord,
    auditEntry: AuditLogRecord,
  ): Promise<EsimProductRecord> {
    await this.runTx(async (client) => {
      await this.runQuery(
        client,
        `UPDATE esim_products
         SET price_etb = $2,
             sandbox_preview_amount_etb = $3,
             price_label = $4,
             pricing_status = $5,
             enabled = $6,
             is_sandbox_catalog = $7,
             updated_at = $8::timestamptz
         WHERE id = $1`,
        [
          product.id,
          product.priceEtb,
          product.sandboxPreviewAmountEtb,
          product.priceEtb !== null ? `${product.priceEtb} ETB` : 'Pending Commercial Agreement',
          product.pricingStatus,
          product.isActive,
          product.pricingStatus !== 'active',
          product.updatedAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
    });
    return product;
  }

  /* --------------------------------------------------------------------------
   * STOCK INVENTORY & ATOMIC ROW LOCKING
   * -------------------------------------------------------------------------- */
  public async listStockBatches(): Promise<EsimStockBatchRecord[]> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM esim_stock_batches ORDER BY imported_at DESC',
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      operatorCode: r.operator_code as OperatorCode,
      batchName: String(r.batch_name || r.batch_code),
      sourceEnvironment: (r.source_environment as EsimStockBatchRecord['sourceEnvironment']) ?? 'operator_partner_batch',
      supplierReference: (r.supplier_reference as string | null) ?? null,
      totalCount: Number(r.total_count ?? 0),
      availableCount: Number(r.available_count ?? 0),
      importedBy: String(r.imported_by),
      createdAt: toIso(r.imported_at),
    }));
  }

  public async listStockItems(
    operatorCode?: OperatorCode,
    status?: StockItemStatus,
  ): Promise<EsimStockItemRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (operatorCode) {
      params.push(operatorCode);
      conditions.push(`operator_code = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const res = await this.runQuery(
      this.pool,
      `SELECT * FROM esim_stock_items ${where} ORDER BY created_at ASC`,
      params,
    );
    return res.rows.map((r) => this.mapStockItemRow(r));
  }

  public async checkStockConflicts(
    iccids: string[],
    msisdns: string[],
  ): Promise<{ existingIccids: Set<string>; activeMsisdns: Set<string> }> {
    const existingIccids = new Set<string>();
    const activeMsisdns = new Set<string>();

    if (iccids.length > 0) {
      const res = await this.runQuery<{ stock_identifier: string }>(
        this.pool,
        'SELECT stock_identifier FROM esim_stock_items WHERE stock_identifier = ANY($1)',
        [iccids],
      );
      for (const r of res.rows) existingIccids.add(r.stock_identifier);
    }

    if (msisdns.length > 0) {
      const res = await this.runQuery<{ msisdn: string }>(
        this.pool,
        `SELECT msisdn FROM esim_stock_items
         WHERE msisdn = ANY($1)
           AND status IN ('imported', 'available', 'reserved', 'assigned', 'sold')`,
        [msisdns],
      );
      for (const r of res.rows) {
        if (r.msisdn) activeMsisdns.add(r.msisdn);
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
    const secretMap = new Map(secrets.map((s) => [s.stockItemId, s]));
    await this.runTx(async (client) => {
      await this.insertBatchAndItems(client, batch, items, secretMap);
      await this.insertAudit(client, auditEntry);
    });
  }

  public async updateStockItemStatusTx(
    itemId: string,
    status: Extract<StockItemStatus, 'available' | 'invalid' | 'expired'>,
    auditHistoryEntry: { action: string; actor: string; note: string; at: string },
    auditEntry: AuditLogRecord,
  ): Promise<EsimStockItemRecord | null> {
    return this.runTx(async (client) => {
      const curRes = await this.runQuery(
        client,
        'SELECT * FROM esim_stock_items WHERE id = $1 FOR UPDATE',
        [itemId],
      );
      const row = curRes.rows[0];
      if (!row) return null;
      const item = this.mapStockItemRow(row);
      if (item.status === 'sold' || item.status === 'assigned') {
        throw new DomainRuleError(409, 'STOCK_ALREADY_ASSIGNED', 'Sold/assigned stock cannot be reverted directly.');
      }
      const nextHistory = [...item.auditHistory, auditHistoryEntry];
      const updRes = await this.runQuery(
        client,
        `UPDATE esim_stock_items
         SET status = $2,
             reserved_by_order_id = CASE WHEN $2 = 'available' THEN NULL ELSE reserved_by_order_id END,
             reserved_until = CASE WHEN $2 = 'available' THEN NULL ELSE reserved_until END,
             audit_history = $3::jsonb
         WHERE id = $1
         RETURNING *`,
        [itemId, status, JSON.stringify(nextHistory)],
      );
      await this.recalculateBatchCounts(client, item.batchId);
      await this.insertAudit(client, auditEntry);
      return this.mapStockItemRow(updRes.rows[0]);
    });
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
      instanceId: actorEmail ?? actorUid,
      recordJobRun: false,
    });

    return this.runTx(async (client) => {
      const nowIso = new Date(nowMs).toISOString();
      const expRes = await this.runQuery(
        client,
        `UPDATE esim_stock_items
         SET status = 'expired',
             audit_history = audit_history || $2::jsonb
         WHERE status IN ('available', 'imported')
           AND expires_at IS NOT NULL
           AND expires_at <= $1::timestamptz
         RETURNING id`,
        [
          nowIso,
          JSON.stringify([{ action: 'EXPIRED_ON_RECONCILE', actor: actorLabel, note: 'Validity expired', at: nowIso }]),
        ],
      );

      const orphanRes = await this.runQuery(
        client,
        `UPDATE esim_stock_items i
         SET status = 'reconciliation_required',
             audit_history = i.audit_history || $1::jsonb
         WHERE i.status = 'reserved'
           AND i.reserved_by_order_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM esim_orders o
             WHERE o.id = i.reserved_by_order_id
               AND o.status NOT IN ('cancelled', 'expired', 'failed', 'refunded')
           )
         RETURNING i.id`,
        [
          JSON.stringify([
            {
              action: 'FLAGGED_RECONCILIATION',
              actor: actorLabel,
              note: 'Reserved item linked to terminal or missing order',
              at: nowIso,
            },
          ]),
        ],
      );

      const brokenSoldRes = await this.runQuery(
        client,
        `UPDATE esim_stock_items i
         SET status = 'reconciliation_required',
             audit_history = i.audit_history || $1::jsonb
         WHERE i.status IN ('sold', 'assigned')
           AND (
             i.assigned_to_order_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM esim_orders o WHERE o.id = i.assigned_to_order_id)
           )
         RETURNING i.id`,
        [
          JSON.stringify([
            {
              action: 'FLAGGED_RECONCILIATION',
              actor: actorLabel,
              note: 'Assigned/sold item missing linked order reference',
              at: nowIso,
            },
          ]),
        ],
      );

      const batchesRes = await this.runQuery<{ id: string }>(client, 'SELECT id FROM esim_stock_batches');
      for (const b of batchesRes.rows) {
        await this.recalculateBatchCounts(client, b.id);
      }

      const expiredItems = expRes.rows.length;
      const flaggedReconciliation = orphanRes.rows.length + brokenSoldRes.rows.length;
      await this.insertAudit(client, {
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
        batchesRecalculated: batchesRes.rows.length,
      };
    });
  }

  public async getStockCredential(stockItemId: string): Promise<InternalStockCredential | null> {
    const res = await this.runQuery<{ encrypted_credential_payload: string | null }>(
      this.pool,
      'SELECT encrypted_credential_payload FROM esim_stock_items WHERE id = $1 LIMIT 1',
      [stockItemId],
    );
    const enc = res.rows[0]?.encrypted_credential_payload ?? null;
    if (!enc) return null;
    return {
      stockItemId,
      smdpAddress: '',
      activationCode: '',
      lpaUri: '',
      qrPayload: '',
      encryptedCredentials: enc,
    };
  }

  /**
   * Direct unit-level atomic reservation helper preserved for concurrency tests & repository reuse.
   */
  public async reserveStockItemAtomic(input: {
    operatorCode: string;
    stockItemId?: string | null;
    orderId: string;
    reservedUntil: string;
  }): Promise<{ stockItemId: string } | null> {
    return this.runTx(async (client) => {
      const selectRes = input.stockItemId
        ? await this.runQuery<{ id: string }>(
            client,
            `SELECT id FROM esim_stock_items
             WHERE id = $1 AND operator_code = $2 AND status = 'available'
             FOR UPDATE SKIP LOCKED`,
            [input.stockItemId, input.operatorCode],
          )
        : await this.runQuery<{ id: string }>(
            client,
            `SELECT id FROM esim_stock_items
             WHERE operator_code = $1 AND status = 'available'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [input.operatorCode],
          );

      const candidate = selectRes.rows[0];
      if (!candidate) return null;

      await this.runQuery(
        client,
        `UPDATE esim_stock_items
         SET status = 'reserved',
             reserved_by_order_id = $2,
             reserved_until = $3::timestamptz
         WHERE id = $1`,
        [candidate.id, input.orderId, input.reservedUntil],
      );
      return { stockItemId: candidate.id };
    });
  }

  /* --------------------------------------------------------------------------
   * ORDERS, NUMBER RESERVATION, KYC, PAYMENTS & PROVISIONING
   * -------------------------------------------------------------------------- */
  public async findActiveOrderByIdempotency(
    userId: string,
    key: string,
  ): Promise<EsimOrderRecord | null> {
    const res = await this.runQuery(
      this.pool,
      `SELECT * FROM esim_orders
       WHERE user_id = $1
         AND idempotency_key = $2
         AND status NOT IN ('cancelled', 'expired', 'failed', 'refunded')
       LIMIT 1`,
      [userId, key],
    );
    return res.rows[0] ? this.mapOrderRow(res.rows[0]) : null;
  }

  public async createOrderTx(
    order: EsimOrderRecord,
    auditEntry: AuditLogRecord,
  ): Promise<EsimOrderRecord> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO esim_orders (
           id, order_number, idempotency_key, user_id, operator_code, product_id,
           service_type, selected_msisdn, existing_msisdn, device_model, device_os,
           device_esim_confirmed, subscriber_full_name, subscriber_contact_phone,
           selected_number_tier, reserved_until, number_reservation_confirmed,
           status, identity_status, payment_status, provisioning_status, delivery_status,
           amount_etb, currency, pricing_snapshot_note, is_sandbox_pricing, fulfillment_method,
           stock_item_id, operator_order_ref, attributed_agent_id, agent_referral_code,
           failure_reason, update_history, created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14,
           $15, $16::timestamptz, $17,
           $18, $19, $20, $21, $22,
           $23, $24, $25, $26, $27,
           $28, $29, $30, $31,
           $32, $33::jsonb, $34::timestamptz, $35::timestamptz
         )
         RETURNING *`,
        [
          order.id,
          order.orderNumber,
          order.idempotencyKey,
          order.userId,
          order.operatorCode,
          order.productId,
          order.productType === 'new_esim_line' ? 'new_esim' : 'sim_conversion',
          order.reservedMsisdn,
          order.existingMsisdn,
          order.deviceModel ?? '',
          order.deviceOs,
          order.deviceVerified,
          order.userId,
          order.existingMsisdn ?? 'N/A',
          order.selectedNumberTier,
          order.reservedUntil,
          order.numberReservationConfirmed,
          order.status,
          order.kycStatus,
          order.paymentStatus,
          order.provisioningStatus,
          order.deliveryStatus,
          order.amountEtb,
          order.currency ?? 'ETB',
          order.pricingSnapshotNote ?? null,
          order.isSandboxPricing,
          order.supplyMethodUsed,
          order.assignedStockItemId,
          order.operatorTransactionRef,
          order.attributedAgentId,
          order.agentReferralCode,
          order.failureReason,
          JSON.stringify(order.updateHistory),
          order.createdAt,
          order.updatedAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapOrderRow(res.rows[0]);
    });
  }

  public async getOrder(orderId: string): Promise<EsimOrderRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM esim_orders WHERE id = $1 LIMIT 1', [orderId]);
    return res.rows[0] ? this.mapOrderRow(res.rows[0]) : null;
  }

  public async listOrders(userId?: string): Promise<EsimOrderRecord[]> {
    const res = userId
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM esim_orders WHERE user_id = $1 ORDER BY created_at DESC',
          [userId],
        )
      : await this.runQuery(this.pool, 'SELECT * FROM esim_orders ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapOrderRow(r));
  }

  public async listActiveReservedMsisdns(
    operatorCode: OperatorCode,
    excludeOrderId?: string,
  ): Promise<Set<string>> {
    const res = await this.runQuery<{ selected_msisdn: string }>(
      this.pool,
      `SELECT selected_msisdn
       FROM esim_orders
       WHERE operator_code = $1
         AND selected_msisdn IS NOT NULL
         AND ($2::text IS NULL OR id <> $2)
         AND status NOT IN ('cancelled', 'expired', 'failed', 'refunded')`,
      [operatorCode, excludeOrderId ?? null],
    );
    return new Set(res.rows.map((r) => r.selected_msisdn));
  }

  public async saveKycAttemptTx(
    order: EsimOrderRecord,
    kyc: KycVerificationRecord,
    auditEntry: AuditLogRecord,
  ): Promise<void> {
    await this.runTx(async (client) => {
      await this.runQuery(
        client,
        `INSERT INTO kyc_verifications (
           id, order_id, user_id, operator_code, provider, full_name, contact_phone,
           status, verification_mode, verification_reference, consent_given,
           failure_reason, verified_at, consent_recorded_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'fayda', $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $12::timestamptz, $12::timestamptz)`,
        [
          kyc.id,
          kyc.orderId,
          kyc.userId,
          kyc.operatorCode,
          kyc.fullName,
          kyc.contactPhone,
          kyc.status,
          kyc.verificationMode,
          kyc.faydaFanMasked,
          kyc.consentGiven,
          kyc.failureReason ?? null,
          kyc.verifiedAt,
        ],
      );

      await this.runQuery(
        client,
        `UPDATE esim_orders
         SET identity_status = $2,
             status = $3,
             failure_reason = $4,
             subscriber_full_name = $5,
             subscriber_contact_phone = $6,
             update_history = $7::jsonb,
             updated_at = $8::timestamptz
         WHERE id = $1`,
        [
          order.id,
          order.kycStatus,
          order.status,
          order.failureReason,
          kyc.fullName,
          kyc.contactPhone,
          JSON.stringify(order.updateHistory),
          order.updatedAt,
        ],
      );

      await this.insertAudit(client, auditEntry);
    });
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
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      const ordRow = ordRes.rows[0];
      if (!ordRow || String(ordRow.user_id) !== input.userId) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
      }
      const order = this.mapOrderRow(ordRow);
      if (!['identity_verified', 'number_reserved', 'awaiting_payment'].includes(order.status)) {
        throw new DomainRuleError(
          409,
          'KYC_REQUIRED_BEFORE_RESERVATION',
          'Complete Fayda identity verification before selecting or reserving a mobile number.',
        );
      }

      const now = new Date().toISOString();
      if (order.assignedStockItemId) {
        const prevRes = await this.runQuery(
          client,
          `UPDATE esim_stock_items
           SET status = 'available',
               reserved_by_order_id = NULL,
               reserved_until = NULL,
               audit_history = audit_history || $3::jsonb
           WHERE id = $1 AND reserved_by_order_id = $2 AND status = 'reserved'
           RETURNING batch_id`,
          [
            order.assignedStockItemId,
            order.id,
            JSON.stringify([
              {
                action: 'RESERVATION_SWAPPED',
                actor: input.actor,
                note: `Released during number re-selection on order ${order.orderNumber}`,
                at: now,
              },
            ]),
          ],
        );
        if (prevRes.rows[0]?.batch_id) {
          await this.recalculateBatchCounts(client, String(prevRes.rows[0].batch_id));
        }
      }

      let candidateRow: Record<string, unknown> | undefined;
      if (input.stockItemId) {
        const exactCheck = await this.runQuery(
          client,
          'SELECT id, operator_code, status FROM esim_stock_items WHERE id = $1',
          [input.stockItemId],
        );
        const existing = exactCheck.rows[0];
        if (!existing || String(existing.operator_code) !== order.operatorCode) {
          throw new DomainRuleError(404, 'STOCK_ITEM_NOT_FOUND', 'Selected stock number does not exist.');
        }
        const lockRes = await this.runQuery(
          client,
          `SELECT * FROM esim_stock_items
           WHERE id = $1 AND operator_code = $2 AND status = 'available'
           FOR UPDATE SKIP LOCKED`,
          [input.stockItemId, order.operatorCode],
        );
        if (!lockRes.rows[0]) {
          throw new DomainRuleError(
            409,
            'NUMBER_ALREADY_RESERVED',
            'This number is already reserved or sold. Please choose another available number.',
          );
        }
        candidateRow = lockRes.rows[0];
      } else {
        if (input.preferredTier) {
          const tierRes = await this.runQuery(
            client,
            `SELECT * FROM esim_stock_items
             WHERE operator_code = $1 AND status = 'available' AND tier = $2
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [order.operatorCode, input.preferredTier],
          );
          candidateRow = tierRes.rows[0];
        }
        if (!candidateRow) {
          const anyRes = await this.runQuery(
            client,
            `SELECT * FROM esim_stock_items
             WHERE operator_code = $1 AND status = 'available'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [order.operatorCode],
          );
          candidateRow = anyRes.rows[0];
        }
      }

      if (!candidateRow) {
        throw new DomainRuleError(
          409,
          'NO_AVAILABLE_STOCK',
          `No available ${order.operatorCode} stock eSIM profiles remain. Staff can import stock or switch to Manual Partner Processing.`,
        );
      }

      const item = this.mapStockItemRow(candidateRow);
      await this.runQuery(
        client,
        `UPDATE esim_stock_items
         SET status = 'reserved',
             reserved_by_order_id = $2,
             reserved_until = $3::timestamptz,
             audit_history = audit_history || $4::jsonb
         WHERE id = $1`,
        [
          item.id,
          order.id,
          input.holdUntil,
          JSON.stringify([
            {
              action: 'RESERVED',
              actor: input.actor,
              note: `Locked for order ${order.orderNumber} until ${input.holdUntil}`,
              at: now,
            },
          ]),
        ],
      );
      await this.recalculateBatchCounts(client, item.batchId);

      const nextHistory = [
        ...order.updateHistory,
        {
          status: 'number_reserved' as OrderStatus,
          actor: input.actor,
          note: `Stock number ${item.msisdn ?? item.iccid} reserved for 15 minutes.`,
          at: now,
        },
      ];

      const updOrder = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET fulfillment_method = 'stock_based',
             stock_item_id = $2,
             selected_msisdn = $3,
             selected_number_tier = $4,
             reserved_until = $5::timestamptz,
             number_reservation_confirmed = TRUE,
             status = 'number_reserved',
             update_history = $6::jsonb,
             updated_at = $7::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          order.id,
          item.id,
          item.msisdn,
          item.numberTier,
          input.holdUntil,
          JSON.stringify(nextHistory),
          now,
        ],
      );
      return this.mapOrderRow(updOrder.rows[0]);
    });
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
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      const ordRow = ordRes.rows[0];
      if (!ordRow || String(ordRow.user_id) !== input.userId) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
      }
      const order = this.mapOrderRow(ordRow);
      const now = new Date().toISOString();

      if (order.assignedStockItemId) {
        const prevRes = await this.runQuery(
          client,
          `UPDATE esim_stock_items
           SET status = 'available',
               reserved_by_order_id = NULL,
               reserved_until = NULL
           WHERE id = $1 AND reserved_by_order_id = $2 AND status = 'reserved'
           RETURNING batch_id`,
          [order.assignedStockItemId, order.id],
        );
        if (prevRes.rows[0]?.batch_id) {
          await this.recalculateBatchCounts(client, String(prevRes.rows[0].batch_id));
        }
      }

      const nextHistory = [
        ...order.updateHistory,
        {
          status: 'number_reserved' as OrderStatus,
          actor: input.actor,
          note: input.historyNote,
          at: now,
        },
      ];

      const updRes = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET stock_item_id = NULL,
             selected_number_tier = $2,
             selected_msisdn = $3,
             number_reservation_confirmed = $4,
             reserved_until = $5::timestamptz,
             status = 'number_reserved',
             update_history = $6::jsonb,
             updated_at = $7::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          order.id,
          input.selectedNumberTier,
          input.reservedMsisdn,
          input.numberReservationConfirmed,
          input.reservedUntil,
          JSON.stringify(nextHistory),
          now,
        ],
      );
      return this.mapOrderRow(updRes.rows[0]);
    });
  }

  public async findPaymentByIdempotency(
    orderId: string,
    idempotencyKey: string,
  ): Promise<PaymentRecord | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM payments WHERE order_id = $1 AND idempotency_key = $2 LIMIT 1',
      [orderId, idempotencyKey],
    );
    return res.rows[0] ? this.mapPaymentRow(res.rows[0]) : null;
  }

  public async findPaymentByTxRef(txRef: string, orderId?: string): Promise<PaymentRecord | null> {
    const res = orderId
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM payments WHERE tx_ref = $1 AND order_id = $2 LIMIT 1',
          [txRef, orderId],
        )
      : await this.runQuery(this.pool, 'SELECT * FROM payments WHERE tx_ref = $1 LIMIT 1', [txRef]);
    return res.rows[0] ? this.mapPaymentRow(res.rows[0]) : null;
  }

  public async findLatestPaymentForOrder(orderId: string): Promise<PaymentRecord | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
      [orderId],
    );
    return res.rows[0] ? this.mapPaymentRow(res.rows[0]) : null;
  }

  public async findVerifiedPaymentForOrder(orderId: string): Promise<PaymentRecord | null> {
    const res = await this.runQuery(
      this.pool,
      `SELECT * FROM payments WHERE order_id = $1 AND status = 'verified' ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    return res.rows[0] ? this.mapPaymentRow(res.rows[0]) : null;
  }

  public async getPaymentById(paymentId: string): Promise<PaymentRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM payments WHERE id = $1 LIMIT 1', [paymentId]);
    return res.rows[0] ? this.mapPaymentRow(res.rows[0]) : null;
  }

  public async listPayments(): Promise<PaymentRecord[]> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM payments ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapPaymentRow(r));
  }

  public async recordInitializedPaymentTx(
    order: EsimOrderRecord,
    payment: PaymentRecord,
  ): Promise<void> {
    await this.runTx(async (client) => {
      await this.runQuery(
        client,
        `INSERT INTO payments (
           id, order_type, order_id, user_id, provider, tx_ref, idempotency_key,
           chapa_reference, amount_etb, currency, checkout_url, status, mode,
           verified_via, webhook_event_count, failure_reason, refund_reason,
           refund_reference, refund_status_checked_at, reconciled_at, verified_at,
           created_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, 'chapa', $5, $6,
           $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16,
           $17, $18::timestamptz, $19::timestamptz, NULL,
           $20::timestamptz, $21::timestamptz
         )`,
        [
          payment.id,
          payment.orderType,
          payment.orderId,
          payment.userId,
          payment.txRef,
          payment.idempotencyKey,
          payment.chapaReference,
          payment.amountEtb,
          payment.currency ?? 'ETB',
          payment.checkoutUrl ?? null,
          payment.status,
          payment.isSandbox ? 'sandbox' : 'production',
          payment.verifiedVia,
          payment.webhookEventCount,
          payment.failureReason,
          payment.refundReason,
          payment.refundReference ?? null,
          payment.refundStatusCheckedAt ?? null,
          payment.reconciledAt,
          payment.createdAt,
          payment.updatedAt,
        ],
      );

      await this.runQuery(
        client,
        `UPDATE esim_orders
         SET payment_status = $2,
             status = $3,
             failure_reason = $4,
             update_history = $5::jsonb,
             updated_at = $6::timestamptz
         WHERE id = $1`,
        [
          order.id,
          order.paymentStatus,
          order.status,
          order.failureReason,
          JSON.stringify(order.updateHistory),
          order.updatedAt,
        ],
      );
    });
  }

  public async recordWebhookEventIdempotent(input: {
    eventId: string;
    provider: string;
    txRef: string;
    orderId: string;
    status: string;
  }): Promise<{ inserted: boolean }> {
    const res = await this.runQuery<{ event_id: string }>(
      this.pool,
      `INSERT INTO processed_webhook_events (event_id, provider, tx_ref, order_id, event_status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [input.eventId, input.provider, input.txRef, input.orderId, input.status],
    );
    return { inserted: res.rows.length > 0 };
  }

  public async hasProcessedWebhookEvent(eventId: string): Promise<boolean> {
    const res = await this.runQuery(
      this.pool,
      'SELECT 1 FROM processed_webhook_events WHERE event_id = $1 LIMIT 1',
      [eventId],
    );
    return res.rows.length > 0;
  }

  public async incrementWebhookCountForDeduplicated(paymentId: string): Promise<void> {
    await this.runQuery(
      this.pool,
      'UPDATE payments SET webhook_event_count = webhook_event_count + 1 WHERE id = $1',
      [paymentId],
    );
  }

  public async recordNonSuccessWebhookTx(input: {
    eventId: string;
    txRef: string;
    orderId: string;
    status: 'failed' | 'cancelled';
    failureReason: string;
  }): Promise<{
    deduplicated: boolean;
    orderStatus: OrderStatus;
    paymentStatus: PaymentRecord['status'];
  }> {
    return this.runTx(async (client) => {
      const payRes = await this.runQuery(
        client,
        'SELECT * FROM payments WHERE tx_ref = $1 AND order_id = $2 FOR UPDATE',
        [input.txRef, input.orderId],
      );
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      if (!payRes.rows[0] || !ordRes.rows[0]) {
        throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
      }

      const payment = this.mapPaymentRow(payRes.rows[0]);
      const order = this.mapOrderRow(ordRes.rows[0]);

      const insEvt = await this.runQuery<{ event_id: string }>(
        client,
        `INSERT INTO processed_webhook_events (event_id, provider, tx_ref, order_id, event_status)
         VALUES ($1, 'chapa', $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [input.eventId, input.txRef, input.orderId, input.status],
      );

      if (insEvt.rows.length === 0 || ['verified', 'refund_pending', 'refunded'].includes(payment.status)) {
        await this.runQuery(
          client,
          'UPDATE payments SET webhook_event_count = webhook_event_count + 1 WHERE id = $1',
          [payment.id],
        );
        return {
          deduplicated: true,
          orderStatus: order.status,
          paymentStatus: payment.status,
        };
      }

      const now = new Date().toISOString();
      const nextHistory = [
        ...order.updateHistory,
        {
          status: 'awaiting_payment' as OrderStatus,
          actor: 'chapa-webhook',
          note: input.failureReason,
          at: now,
        },
      ];

      await this.runQuery(
        client,
        `UPDATE payments
         SET status = $2,
             failure_reason = $3,
             webhook_event_count = webhook_event_count + 1,
             updated_at = $4::timestamptz
         WHERE id = $1`,
        [payment.id, input.status, input.failureReason, now],
      );
      await this.runQuery(
        client,
        `UPDATE esim_orders
         SET payment_status = $2,
             status = 'awaiting_payment',
             failure_reason = $3,
             update_history = $4::jsonb,
             updated_at = $5::timestamptz
         WHERE id = $1`,
        [order.id, input.status, input.failureReason, JSON.stringify(nextHistory), now],
      );

      return {
        deduplicated: false,
        orderStatus: 'awaiting_payment',
        paymentStatus: input.status,
      };
    });
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
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      if (!ordRes.rows[0]) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      const order = this.mapOrderRow(ordRes.rows[0]);

      const payRes = await this.runQuery(
        client,
        'SELECT * FROM payments WHERE order_id = $1 AND tx_ref = $2 FOR UPDATE',
        [input.orderId, input.txRef],
      );
      if (!payRes.rows[0]) {
        throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Matching Chapa payment transaction was not found.');
      }
      const payment = this.mapPaymentRow(payRes.rows[0]);

      let insertedEvent = true;
      if (input.eventId) {
        const evtRes = await this.runQuery<{ event_id: string }>(
          client,
          `INSERT INTO processed_webhook_events (event_id, provider, tx_ref, order_id, event_status)
           VALUES ($1, 'chapa', $2, $3, 'success')
           ON CONFLICT (event_id) DO NOTHING
           RETURNING event_id`,
          [input.eventId, input.txRef, input.orderId],
        );
        insertedEvent = evtRes.rows.length > 0;
      }

      const alreadyFulfilledOrQueued = [
        'submitted_to_operator',
        'operator_pending',
        'provisioned',
        'delivered',
        'ready_for_installation',
        'installed',
        'activated',
        'awaiting_manual_fulfillment',
      ].includes(order.status);

      if (!insertedEvent || (payment.status === 'verified' && alreadyFulfilledOrQueued)) {
        if (input.verifiedVia === 'webhook') {
          await this.runQuery(
            client,
            'UPDATE payments SET webhook_event_count = webhook_event_count + 1 WHERE id = $1',
            [payment.id],
          );
          payment.webhookEventCount += 1;
        }
        const actRes = await this.runQuery(
          client,
          'SELECT * FROM esim_activations WHERE order_id = $1 LIMIT 1',
          [order.id],
        );
        return {
          alreadySettled: true,
          deduplicated: true,
          order,
          payment,
          existingEsim: actRes.rows[0] ? this.mapActivationToCustomerEsim(actRes.rows[0], order) : null,
          reservedStockItem: null,
        };
      }

      const now = new Date().toISOString();
      const updPay = await this.runQuery(
        client,
        `UPDATE payments
         SET status = 'verified',
             chapa_reference = $2,
             verified_via = $3,
             webhook_event_count = webhook_event_count + $4,
             failure_reason = NULL,
             verified_at = COALESCE(verified_at, $5::timestamptz),
             updated_at = $5::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          payment.id,
          input.chapaReference,
          input.verifiedVia,
          input.verifiedVia === 'webhook' ? 1 : 0,
          now,
        ],
      );
      const savedPayment = this.mapPaymentRow(updPay.rows[0]);

      const nextHistory = [
        ...order.updateHistory,
        {
          status: 'payment_verified' as OrderStatus,
          actor: input.actor,
          note: `Payment verified server-side (${savedPayment.chapaReference ?? input.txRef})`,
          at: now,
        },
      ];

      const opRes = await this.runQuery<{ supply_method: string }>(
        client,
        'SELECT supply_method FROM operators WHERE code = $1',
        [order.operatorCode],
      );
      const activeMethod = (opRes.rows[0]?.supply_method as SupplyMethod) ?? order.supplyMethodUsed;

      let reservedStockItem: { item: EsimStockItemRecord; secret: InternalStockCredential } | null = null;
      let assignedStockId = order.assignedStockItemId;

      if (activeMethod === 'stock_based') {
        let lockedRow: Record<string, unknown> | undefined;
        if (assignedStockId) {
          const ownRes = await this.runQuery(
            client,
            `SELECT * FROM esim_stock_items
             WHERE id = $1 AND (status = 'available' OR (status = 'reserved' AND reserved_by_order_id = $2))
             FOR UPDATE`,
            [assignedStockId, order.id],
          );
          lockedRow = ownRes.rows[0];
        }
        if (!lockedRow) {
          const pickRes = await this.runQuery(
            client,
            `SELECT * FROM esim_stock_items
             WHERE operator_code = $1 AND status = 'available'
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [order.operatorCode],
          );
          lockedRow = pickRes.rows[0];
        }

        if (lockedRow) {
          if (lockedRow.status === 'available') {
            const updStock = await this.runQuery(
              client,
              `UPDATE esim_stock_items
               SET status = 'reserved',
                   reserved_by_order_id = $2
               WHERE id = $1
               RETURNING *`,
              [lockedRow.id, order.id],
            );
            lockedRow = updStock.rows[0];
            await this.recalculateBatchCounts(client, String(lockedRow.batch_id));
          }
          assignedStockId = String(lockedRow.id);
          const item = this.mapStockItemRow(lockedRow);
          const enc = lockedRow.encrypted_credential_payload as string | null;
          if (enc) {
            reservedStockItem = {
              item,
              secret: {
                stockItemId: item.id,
                smdpAddress: '',
                activationCode: '',
                lpaUri: '',
                qrPayload: '',
                encryptedCredentials: enc,
              },
            };
          }
        } else {
          assignedStockId = null;
        }
      }

      const updOrd = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET payment_status = 'verified',
             status = 'payment_verified',
             provisioning_status = 'submitted_to_operator',
             fulfillment_method = $2,
             stock_item_id = $3,
             failure_reason = NULL,
             update_history = $4::jsonb,
             updated_at = $5::timestamptz
         WHERE id = $1
         RETURNING *`,
        [order.id, activeMethod, assignedStockId, JSON.stringify(nextHistory), now],
      );

      return {
        alreadySettled: false,
        deduplicated: false,
        order: this.mapOrderRow(updOrd.rows[0]),
        payment: savedPayment,
        existingEsim: null,
        reservedStockItem,
      };
    });
  }

  public async recordPaymentVerificationFailureTx(input: {
    orderId: string;
    paymentId: string;
    failureReason: string;
    actor: string;
  }): Promise<void> {
    await this.runTx(async (client) => {
      const payRes = await this.runQuery(
        client,
        'SELECT status FROM payments WHERE id = $1 FOR UPDATE',
        [input.paymentId],
      );
      if (!payRes.rows[0] || payRes.rows[0].status === 'verified') return;

      const ordRes = await this.runQuery(
        client,
        'SELECT update_history FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      const now = new Date().toISOString();
      await this.runQuery(
        client,
        `UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = $3::timestamptz WHERE id = $1`,
        [input.paymentId, input.failureReason, now],
      );
      if (ordRes.rows[0]) {
        const hist = [
          ...parseJsonArray(ordRes.rows[0].update_history),
          { status: 'awaiting_payment', actor: input.actor, note: input.failureReason, at: now },
        ];
        await this.runQuery(
          client,
          `UPDATE esim_orders
           SET payment_status = 'failed',
               status = 'awaiting_payment',
               failure_reason = $2,
               update_history = $3::jsonb,
               updated_at = $4::timestamptz
           WHERE id = $1`,
          [input.orderId, input.failureReason, JSON.stringify(hist), now],
        );
      }
    });
  }

  public async completeProvisioningTx(input: {
    orderId: string;
    operatorTransactionRef: string | null;
    supplyMethodUsed: SupplyMethod;
    stockItemIdToAssign: string | null;
    esim: CustomerEsimRecord;
    activation: InternalActivationVault;
    iccidMasked: string;
    commissionCandidate: Omit<AgentCommissionRecord, 'id' | 'createdAt'> | null;
    historyNote: string;
    auditEntry?: AuditLogRecord | null;
  }): Promise<{ order: EsimOrderRecord; esim: CustomerEsimRecord }> {
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      if (!ordRes.rows[0]) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      const order = this.mapOrderRow(ordRes.rows[0]);

      const existingAct = await this.runQuery(
        client,
        'SELECT * FROM esim_activations WHERE order_id = $1 LIMIT 1',
        [order.id],
      );
      if (existingAct.rows[0]) {
        return { order, esim: this.mapActivationToCustomerEsim(existingAct.rows[0], order) };
      }

      const now = new Date().toISOString();
      if (input.stockItemIdToAssign) {
        const stkRes = await this.runQuery(
          client,
          `UPDATE esim_stock_items
           SET status = 'assigned',
               assigned_to_order_id = $2,
               reserved_until = NULL,
               audit_history = audit_history || $3::jsonb
           WHERE id = $1
           RETURNING batch_id`,
          [
            input.stockItemIdToAssign,
            order.id,
            JSON.stringify([
              {
                action: 'ASSIGNED_TO_ORDER',
                actor: 'system',
                note: `Assigned to order ${order.orderNumber}`,
                at: now,
              },
            ]),
          ],
        );
        if (stkRes.rows[0]?.batch_id) {
          await this.recalculateBatchCounts(client, String(stkRes.rows[0].batch_id));
        }
      }

      const actRes = await this.runQuery(
        client,
        `INSERT INTO esim_activations (
           id, order_id, user_id, operator_code, msisdn, iccid_masked,
           encrypted_activation_payload, activation_status, fulfillment_method,
           is_sandbox_profile, device_model, eid, provisioned_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
         ON CONFLICT (order_id) DO UPDATE SET
           activation_status = EXCLUDED.activation_status
         RETURNING *`,
        [
          input.activation.activationId,
          order.id,
          order.userId,
          order.operatorCode,
          input.esim.assignedMsisdn ?? 'N/A',
          input.iccidMasked,
          input.activation.encryptedCredentials ?? '{}',
          input.esim.status,
          input.supplyMethodUsed,
          input.activation.isSandboxSimulation,
          order.deviceModel,
          input.activation.eid,
          input.esim.createdAt,
        ],
      );

      const nextHistory = [
        ...order.updateHistory,
        { status: 'provisioned' as OrderStatus, actor: 'system', note: 'Operator provisioning succeeded', at: now },
        { status: 'ready_for_installation' as OrderStatus, actor: 'system', note: input.historyNote, at: now },
      ];

      const updOrder = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET selected_msisdn = COALESCE($2, selected_msisdn),
             fulfillment_method = $3,
             operator_order_ref = $4,
             provisioning_status = 'provisioned',
             delivery_status = 'delivered',
             status = 'ready_for_installation',
             failure_reason = NULL,
             update_history = $5::jsonb,
             updated_at = $6::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          order.id,
          input.esim.assignedMsisdn,
          input.supplyMethodUsed,
          input.operatorTransactionRef,
          JSON.stringify(nextHistory),
          now,
        ],
      );

      if (input.commissionCandidate) {
        const commId = `com-${crypto.randomUUID().slice(0, 10)}`;
        const insComm = await this.runQuery<{ id: string }>(
          client,
          `INSERT INTO agent_commissions (
             id, agent_id, order_id, order_number, operator_code,
             commission_amount_etb, pricing_status, commercial_term_note, status, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
           ON CONFLICT (order_id) DO NOTHING
           RETURNING id`,
          [
            commId,
            input.commissionCandidate.agentId,
            input.commissionCandidate.orderId,
            input.commissionCandidate.orderNumber,
            input.commissionCandidate.operatorCode,
            input.commissionCandidate.commissionAmountEtb,
            input.commissionCandidate.pricingStatus,
            'Pending approved partner commercial commission schedule',
            input.commissionCandidate.status,
            now,
          ],
        );
        if (insComm.rows.length > 0) {
          await this.runQuery(
            client,
            'UPDATE agents SET total_attributed_orders = total_attributed_orders + 1 WHERE id = $1',
            [input.commissionCandidate.agentId],
          );
        }
      }

      if (input.auditEntry) {
        await this.insertAudit(client, input.auditEntry);
      }

      const finalOrder = this.mapOrderRow(updOrder.rows[0]);
      return {
        order: finalOrder,
        esim: this.mapActivationToCustomerEsim(actRes.rows[0], finalOrder),
      };
    });
  }

  public async markProvisioningStateTx(input: {
    orderId: string;
    status: 'operator_pending' | 'awaiting_manual_fulfillment' | 'failed';
    provisioningStatus: EsimOrderRecord['provisioningStatus'];
    operatorTransactionRef: string | null;
    supplyMethodUsed: SupplyMethod;
    failureReason: string | null;
    releaseStockItemId?: string | null;
    markVerifiedPaymentRefundPending?: boolean;
    actor: string;
    note: string;
  }): Promise<EsimOrderRecord> {
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      if (!ordRes.rows[0]) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      const order = this.mapOrderRow(ordRes.rows[0]);
      const now = new Date().toISOString();

      if (input.releaseStockItemId) {
        const stkRes = await this.runQuery(
          client,
          `UPDATE esim_stock_items
           SET status = 'available',
               reserved_by_order_id = NULL,
               reserved_until = NULL
           WHERE id = $1 AND reserved_by_order_id = $2 AND status = 'reserved'
           RETURNING batch_id`,
          [input.releaseStockItemId, order.id],
        );
        if (stkRes.rows[0]?.batch_id) {
          await this.recalculateBatchCounts(client, String(stkRes.rows[0].batch_id));
        }
      }

      let nextPayStatus = order.paymentStatus;
      if (input.markVerifiedPaymentRefundPending) {
        const payUpd = await this.runQuery(
          client,
          `UPDATE payments
           SET status = 'refund_pending',
               refund_reason = $2,
               updated_at = $3::timestamptz
           WHERE order_id = $1 AND status = 'verified'
           RETURNING id`,
          [order.id, input.failureReason, now],
        );
        if (payUpd.rows.length > 0) nextPayStatus = 'refund_pending';
      }

      const nextHistory = [
        ...order.updateHistory,
        { status: input.status, actor: input.actor, note: input.note, at: now },
      ];

      const updRes = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET status = $2,
             provisioning_status = $3,
             operator_order_ref = COALESCE($4, operator_order_ref),
             fulfillment_method = $5,
             failure_reason = $6,
             stock_item_id = CASE WHEN $7::text IS NOT NULL THEN NULL ELSE stock_item_id END,
             payment_status = $8,
             update_history = $9::jsonb,
             updated_at = $10::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          order.id,
          input.status,
          input.provisioningStatus,
          input.operatorTransactionRef,
          input.supplyMethodUsed,
          input.failureReason,
          input.releaseStockItemId ?? null,
          nextPayStatus,
          JSON.stringify(nextHistory),
          now,
        ],
      );

      return this.mapOrderRow(updRes.rows[0]);
    });
  }

  public async cancelOrderTx(input: {
    orderId: string;
    userId: string;
    reason: string;
    isAdmin?: boolean;
    actorEmail?: string | null;
    auditEntry: AuditLogRecord;
  }): Promise<EsimOrderRecord> {
    return this.runTx(async (client) => {
      const ordRes = await this.runQuery(
        client,
        'SELECT * FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      const ordRow = ordRes.rows[0];
      if (!ordRow || (!input.isAdmin && String(ordRow.user_id) !== input.userId)) {
        throw new DomainRuleError(404, 'ORDER_NOT_FOUND', 'Order not found for your account.');
      }
      const order = this.mapOrderRow(ordRow);
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
        const stkRes = await this.runQuery(
          client,
          `UPDATE esim_stock_items
           SET status = 'available',
               reserved_by_order_id = NULL,
               reserved_until = NULL,
               audit_history = audit_history || $3::jsonb
           WHERE id = $1 AND reserved_by_order_id = $2 AND status = 'reserved'
           RETURNING batch_id`,
          [
            order.assignedStockItemId,
            order.id,
            JSON.stringify([
              {
                action: 'RELEASED_ON_CANCEL',
                actor: input.actorEmail ?? input.userId,
                note: `Released on cancellation of ${order.orderNumber}`,
                at: now,
              },
            ]),
          ],
        );
        if (stkRes.rows[0]?.batch_id) {
          await this.recalculateBatchCounts(client, String(stkRes.rows[0].batch_id));
        }
      }

      const payUpd = await this.runQuery(
        client,
        `UPDATE payments
         SET status = 'refund_pending',
             refund_reason = $2,
             updated_at = $3::timestamptz
         WHERE order_id = $1 AND status = 'verified'
         RETURNING id`,
        [order.id, input.reason, now],
      );
      const hasVerifiedPayment = payUpd.rows.length > 0;
      const targetStatus: OrderStatus = hasVerifiedPayment ? 'refund_pending' : 'cancelled';
      const nextPayStatus = hasVerifiedPayment ? 'refund_pending' : order.paymentStatus;
      const nextHistory = [
        ...order.updateHistory,
        {
          status: targetStatus,
          actor: input.actorEmail ?? input.userId,
          note: hasVerifiedPayment ? `Cancelled after verified payment: ${input.reason}` : input.reason,
          at: now,
        },
      ];

      const updOrder = await this.runQuery(
        client,
        `UPDATE esim_orders
         SET stock_item_id = NULL,
             payment_status = $2,
             status = $3,
             failure_reason = $4,
             update_history = $5::jsonb,
             updated_at = $6::timestamptz
         WHERE id = $1
         RETURNING *`,
        [order.id, nextPayStatus, targetStatus, input.reason, JSON.stringify(nextHistory), now],
      );

      await this.insertAudit(client, input.auditEntry);
      return this.mapOrderRow(updOrder.rows[0]);
    });
  }

  public async beginRefundTx(input: {
    paymentId: string;
    reason: string;
  }): Promise<{ payment: PaymentRecord; alreadyRefunded: boolean }> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [input.paymentId],
      );
      if (!res.rows[0]) {
        throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
      }
      const payment = this.mapPaymentRow(res.rows[0]);
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
    });
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
    return this.runTx(async (client) => {
      const now = new Date().toISOString();
      const payRes = await this.runQuery(
        client,
        `UPDATE payments
         SET status = $2,
             refund_reason = $3,
             refund_reference = COALESCE($4, refund_reference),
             refund_status_checked_at = $5::timestamptz,
             updated_at = $5::timestamptz
         WHERE id = $1
         RETURNING *`,
        [input.paymentId, input.refundStatus, input.refundReason, input.refundReference, now],
      );
      if (!payRes.rows[0]) {
        throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
      }

      const ordRes = await this.runQuery(
        client,
        'SELECT status, update_history FROM esim_orders WHERE id = $1 FOR UPDATE',
        [input.orderId],
      );
      if (ordRes.rows[0]) {
        const hist = parseJsonArray<{ status: OrderStatus; actor: string; note: string; at: string }>(
          ordRes.rows[0].update_history,
        );
        const nextStatus =
          input.refundStatus === 'refunded' || input.refundStatus === 'refund_pending'
            ? input.refundStatus
            : (ordRes.rows[0].status as OrderStatus);
        hist.push({ status: nextStatus, actor: input.actor, note: input.note, at: now });

        await this.runQuery(
          client,
          `UPDATE esim_orders
           SET payment_status = $2,
               status = $3,
               update_history = $4::jsonb,
               updated_at = $5::timestamptz
           WHERE id = $1`,
          [input.orderId, input.refundStatus, nextStatus, JSON.stringify(hist), now],
        );
      }

      await this.insertAudit(client, input.auditEntry);
      return this.mapPaymentRow(payRes.rows[0]);
    });
  }

  public async updatePaymentReconcileTx(input: {
    paymentId: string;
    patch: Partial<PaymentRecord>;
    verifyOrderIfVerified?: boolean;
    actorLabel: string;
    auditEntry: AuditLogRecord;
  }): Promise<PaymentRecord> {
    return this.runTx(async (client) => {
      const curRes = await this.runQuery(
        client,
        'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
        [input.paymentId],
      );
      if (!curRes.rows[0]) {
        throw new DomainRuleError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
      }
      const cur = this.mapPaymentRow(curRes.rows[0]);
      const now = new Date().toISOString();
      const nextStatus = input.patch.status ?? cur.status;
      const nextRef = input.patch.chapaReference !== undefined ? input.patch.chapaReference : cur.chapaReference;
      const nextVia = input.patch.verifiedVia !== undefined ? input.patch.verifiedVia : cur.verifiedVia;
      const nextReconciledAt = input.patch.reconciledAt ?? now;
      const nextCheckedAt = input.patch.refundStatusCheckedAt ?? cur.refundStatusCheckedAt ?? null;
      const nextRefundRef = input.patch.refundReference ?? cur.refundReference ?? null;

      const payUpd = await this.runQuery(
        client,
        `UPDATE payments
         SET status = $2,
             chapa_reference = $3,
             verified_via = $4,
             reconciled_at = $5::timestamptz,
             refund_status_checked_at = $6::timestamptz,
             refund_reference = $7,
             failure_reason = $8,
             updated_at = $9::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          cur.id,
          nextStatus,
          nextRef,
          nextVia,
          nextReconciledAt,
          nextCheckedAt,
          nextRefundRef,
          input.patch.failureReason ?? cur.failureReason,
          now,
        ],
      );

      if (input.verifyOrderIfVerified) {
        const ordRes = await this.runQuery(
          client,
          'SELECT payment_status, update_history FROM esim_orders WHERE id = $1 FOR UPDATE',
          [cur.orderId],
        );
        if (ordRes.rows[0] && ordRes.rows[0].payment_status !== 'verified') {
          const hist = [
            ...parseJsonArray(ordRes.rows[0].update_history),
            {
              status: 'payment_verified',
              actor: input.actorLabel,
              note: 'Reconciled via Chapa status verify',
              at: now,
            },
          ];
          await this.runQuery(
            client,
            `UPDATE esim_orders
             SET payment_status = 'verified',
                 status = 'payment_verified',
                 update_history = $2::jsonb,
                 updated_at = $3::timestamptz
             WHERE id = $1`,
            [cur.orderId, JSON.stringify(hist), now],
          );
        }
      } else if (nextStatus === 'refunded') {
        const ordRes = await this.runQuery(
          client,
          'SELECT status, update_history FROM esim_orders WHERE id = $1 FOR UPDATE',
          [cur.orderId],
        );
        if (ordRes.rows[0] && ordRes.rows[0].status !== 'refunded') {
          const hist = [
            ...parseJsonArray(ordRes.rows[0].update_history),
            {
              status: 'refunded',
              actor: input.actorLabel,
              note: 'Refund verified via Chapa reconciliation',
              at: now,
            },
          ];
          await this.runQuery(
            client,
            `UPDATE esim_orders
             SET payment_status = 'refunded',
                 status = 'refunded',
                 update_history = $2::jsonb,
                 updated_at = $3::timestamptz
             WHERE id = $1`,
            [cur.orderId, JSON.stringify(hist), now],
          );
        }
      }

      await this.insertAudit(client, input.auditEntry);
      return this.mapPaymentRow(payUpd.rows[0]);
    });
  }

  /* --------------------------------------------------------------------------
   * eSIMS & ACTIVATION VAULT
   * -------------------------------------------------------------------------- */
  public async getEsimById(esimId: string): Promise<CustomerEsimRecord | null> {
    const candidates = [esimId, esimId.startsWith('esim-') ? `act-${esimId.slice(5)}` : esimId];
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM esim_activations WHERE id = ANY($1) LIMIT 1',
      [candidates],
    );
    return res.rows[0] ? this.mapActivationToCustomerEsim(res.rows[0]) : null;
  }

  public async getEsimByOrderId(orderId: string): Promise<CustomerEsimRecord | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM esim_activations WHERE order_id = $1 LIMIT 1',
      [orderId],
    );
    return res.rows[0] ? this.mapActivationToCustomerEsim(res.rows[0]) : null;
  }

  public async listEsims(userId?: string): Promise<CustomerEsimRecord[]> {
    const res = userId
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM esim_activations WHERE user_id = $1 ORDER BY provisioned_at DESC',
          [userId],
        )
      : await this.runQuery(this.pool, 'SELECT * FROM esim_activations ORDER BY provisioned_at DESC');
    return res.rows.map((r) => this.mapActivationToCustomerEsim(r));
  }

  public async getActivationById(activationId: string): Promise<InternalActivationVault | null> {
    const candidates = [
      activationId,
      activationId.startsWith('esim-') ? `act-${activationId.slice(5)}` : activationId,
    ];
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM esim_activations WHERE id = ANY($1) LIMIT 1',
      [candidates],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      activationId: String(r.id),
      orderId: String(r.order_id),
      userId: String(r.user_id),
      operatorCode: r.operator_code as OperatorCode,
      smdpAddress: null,
      iccid: (r.iccid_masked as string | null) ?? null,
      eid: (r.eid as string | null) ?? null,
      assignedMsisdn: r.msisdn === 'N/A' ? null : (r.msisdn as string | null),
      encryptedCredentials: (r.encrypted_activation_payload as string | null) ?? null,
      isSandboxSimulation: Boolean(r.is_sandbox_profile),
      createdAt: toIso(r.provisioned_at),
      downloadedAt: toIsoNullable(r.downloaded_at),
      installedAt: toIsoNullable(r.installed_at),
      activatedAt: toIsoNullable(r.activated_at),
    };
  }

  public async markActivationDownloaded(activationId: string): Promise<void> {
    await this.runQuery(
      this.pool,
      'UPDATE esim_activations SET downloaded_at = COALESCE(downloaded_at, NOW()) WHERE id = $1',
      [activationId],
    );
  }

  public async updateEsimLifecycleTx(
    esimId: string,
    userId: string,
    target: 'installed' | 'activated',
  ): Promise<CustomerEsimRecord | null> {
    const candidates = [esimId, esimId.startsWith('esim-') ? `act-${esimId.slice(5)}` : esimId];
    return this.runTx(async (client) => {
      const actRes = await this.runQuery(
        client,
        'SELECT * FROM esim_activations WHERE id = ANY($1) AND user_id = $2 FOR UPDATE',
        [candidates, userId],
      );
      const row = actRes.rows[0];
      if (!row) return null;

      const now = new Date().toISOString();
      const nextStatus =
        target === 'activated'
          ? 'activated'
          : row.activation_status === 'ready_for_installation'
            ? 'installed'
            : String(row.activation_status);

      const updAct = await this.runQuery(
        client,
        `UPDATE esim_activations
         SET activation_status = $2,
             installed_at = COALESCE(installed_at, $3::timestamptz),
             activated_at = CASE WHEN $4 = 'activated' THEN $3::timestamptz ELSE activated_at END
         WHERE id = $1
         RETURNING *`,
        [row.id, nextStatus, now, target],
      );

      const ordRes = await this.runQuery(
        client,
        'SELECT update_history FROM esim_orders WHERE id = $1 FOR UPDATE',
        [row.order_id],
      );
      if (ordRes.rows[0]) {
        const hist = [
          ...parseJsonArray(ordRes.rows[0].update_history),
          {
            status: target,
            actor: userId,
            note:
              target === 'installed'
                ? 'Customer marked eSIM installed on device'
                : 'Subscriber confirmed active network registration',
            at: now,
          },
        ];
        await this.runQuery(
          client,
          `UPDATE esim_orders
           SET delivery_status = $2,
               status = $2,
               update_history = $3::jsonb,
               updated_at = $4::timestamptz
           WHERE id = $1`,
          [row.order_id, target, JSON.stringify(hist), now],
        );
      }

      return this.mapActivationToCustomerEsim(updAct.rows[0]);
    });
  }

  public async getOrderKycAndAudit(orderId: string): Promise<{
    kyc: KycVerificationRecord | null;
    auditEvents: AuditLogRecord[];
  }> {
    const [kycRes, auditRes] = await Promise.all([
      this.runQuery(
        this.pool,
        'SELECT * FROM kyc_verifications WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
        [orderId],
      ),
      this.runQuery(
        this.pool,
        'SELECT * FROM audit_logs WHERE target_id = $1 ORDER BY created_at DESC LIMIT 50',
        [orderId],
      ),
    ]);

    const kRow = kycRes.rows[0];
    const kyc: KycVerificationRecord | null = kRow
      ? {
          id: String(kRow.id),
          orderId: String(kRow.order_id),
          userId: String(kRow.user_id),
          operatorCode: (kRow.operator_code as OperatorCode) ?? 'ethio_telecom',
          fullName: String(kRow.full_name ?? ''),
          faydaFanMasked: String(kRow.verification_reference ?? ''),
          contactPhone: String(kRow.contact_phone ?? ''),
          consentGiven: Boolean(kRow.consent_given ?? true),
          verificationMode: (kRow.verification_mode as KycVerificationRecord['verificationMode']) ?? 'fayda_sandbox_boundary',
          status: kRow.status as KycVerificationRecord['status'],
          failureReason: (kRow.failure_reason as string | null) ?? null,
          verifiedAt: toIso(kRow.verified_at ?? kRow.created_at),
        }
      : null;

    const auditEvents: AuditLogRecord[] = auditRes.rows.map((a) => ({
      id: String(a.id),
      actorType: a.actor_type as AuditLogRecord['actorType'],
      actorId: String(a.actor_id),
      actorEmail: (a.actor_email as string | undefined) ?? undefined,
      action: String(a.action),
      targetType: String(a.target_type),
      targetId: String(a.target_id),
      reason: String(a.reason),
      createdAt: toIso(a.created_at),
    }));

    return { kyc, auditEvents };
  }

  /* --------------------------------------------------------------------------
   * SCHEDULED PAYMENT & RESERVATION EXPIRY WITH MULTI-INSTANCE ADVISORY LOCK
   * -------------------------------------------------------------------------- */
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
    return this.runTx(async (client) => {
      const lockRes = await this.runQuery<{ locked: boolean }>(
        client,
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [PAYMENT_EXPIRY_LOCK_KEY],
      );
      if (!lockRes.rows[0]?.locked) {
        return { acquiredLock: false, releasedReservations: 0, expiredPayments: 0, runRecord: null };
      }

      const startedAt = new Date().toISOString();
      const nowIso = new Date(input.nowMs).toISOString();
      const cutoffIso = new Date(input.nowMs - input.timeoutMinutes * 60 * 1000).toISOString();

      // 1. Release stale stock item reservations whose hold window elapsed
      const staleItems = await this.runQuery(
        client,
        `UPDATE esim_stock_items
         SET status = 'available',
             reserved_by_order_id = NULL,
             reserved_until = NULL,
             audit_history = audit_history || $2::jsonb
         WHERE status = 'reserved'
           AND reserved_until IS NOT NULL
           AND reserved_until <= $1::timestamptz
         RETURNING id, batch_id, reserved_by_order_id`,
        [
          nowIso,
          JSON.stringify([
            { action: 'RESERVATION_EXPIRED', actor: 'system', note: 'Released expired reservation', at: nowIso },
          ]),
        ],
      );

      const touchedBatches = new Set<string>();
      for (const itemRow of staleItems.rows) {
        if (itemRow.batch_id) touchedBatches.add(String(itemRow.batch_id));
      }

      const expiredItemIds = staleItems.rows.map((r) => String(r.id));
      let expiredResOrderIds: string[] = [];
      if (expiredItemIds.length > 0) {
        const resOrds = await this.runQuery<{ id: string }>(
          client,
          `UPDATE esim_orders
           SET stock_item_id = NULL,
               reserved_until = NULL,
               number_reservation_confirmed = FALSE,
               status = 'expired',
               failure_reason = 'Number reservation expired before checkout verification.',
               update_history = update_history || $2::jsonb,
               updated_at = $3::timestamptz
           WHERE stock_item_id = ANY($1)
             AND status NOT IN (
               'payment_verified', 'submitted_to_operator', 'operator_pending',
               'awaiting_manual_fulfillment', 'provisioned', 'delivered',
               'ready_for_installation', 'installed', 'activated', 'cancelled', 'expired', 'refunded'
             )
           RETURNING id`,
          [
            expiredItemIds,
            JSON.stringify([
              {
                status: 'expired',
                actor: 'system',
                note: 'Number reservation expired before checkout verification.',
                at: nowIso,
              },
            ]),
            nowIso,
          ],
        );
        expiredResOrderIds = resOrds.rows.map((r) => r.id);
        for (const oid of expiredResOrderIds) {
          await this.insertAudit(client, {
            id: `aud-${crypto.randomUUID().slice(0, 12)}`,
            actorType: 'system',
            actorId: input.instanceId,
            action: 'RESERVATION_EXPIRED',
            targetType: 'esim_order',
            targetId: oid,
            reason: 'Number reservation expired before checkout verification.',
            createdAt: nowIso,
          });
        }
      }

      // 2. Expire initialized Chapa payments past timeout window
      const expiryReason = `Chapa checkout expired after ${input.timeoutMinutes} minutes without payment confirmation.`;
      const stalePays = await this.runQuery<{ id: string; order_id: string }>(
        client,
        `UPDATE payments
         SET status = 'failed',
             failure_reason = $2,
             updated_at = $3::timestamptz
         WHERE status = 'initialized'
           AND created_at <= $1::timestamptz
         RETURNING id, order_id`,
        [cutoffIso, expiryReason, nowIso],
      );

      if (stalePays.rows.length > 0) {
        const payOrderIds = Array.from(new Set(stalePays.rows.map((p) => p.order_id)));
        const expOrds = await this.runQuery<{ id: string; stock_item_id: string | null }>(
          client,
          `UPDATE esim_orders
           SET payment_status = 'failed',
               status = 'expired',
               failure_reason = $2,
               reserved_until = NULL,
               number_reservation_confirmed = FALSE,
               update_history = update_history || $3::jsonb,
               updated_at = $4::timestamptz
           WHERE id = ANY($1)
             AND payment_status <> 'verified'
             AND status NOT IN ('cancelled', 'expired', 'refunded')
           RETURNING id, stock_item_id`,
          [
            payOrderIds,
            expiryReason,
            JSON.stringify([{ status: 'expired', actor: 'system', note: expiryReason, at: nowIso }]),
            nowIso,
          ],
        );

        for (const ord of expOrds.rows) {
          if (ord.stock_item_id) {
            const rel = await this.runQuery<{ batch_id: string }>(
              client,
              `UPDATE esim_stock_items
               SET status = 'available',
                   reserved_by_order_id = NULL,
                   reserved_until = NULL
               WHERE id = $1 AND reserved_by_order_id = $2 AND status = 'reserved'
               RETURNING batch_id`,
              [ord.stock_item_id, ord.id],
            );
            if (rel.rows[0]?.batch_id) touchedBatches.add(rel.rows[0].batch_id);
            await this.runQuery(client, 'UPDATE esim_orders SET stock_item_id = NULL WHERE id = $1', [ord.id]);
          }
          await this.insertAudit(client, {
            id: `aud-${crypto.randomUUID().slice(0, 12)}`,
            actorType: 'system',
            actorId: input.instanceId,
            action: 'ORDER_PAYMENT_EXPIRED',
            targetType: 'esim_order',
            targetId: ord.id,
            reason: expiryReason,
            createdAt: nowIso,
          });
        }
      }

      for (const batchId of touchedBatches) {
        await this.recalculateBatchCounts(client, batchId);
      }

      let runRecord: ScheduledJobRunRecord | null = null;
      if (input.recordJobRun) {
        const jobId = `job-${crypto.randomUUID().slice(0, 10)}`;
        const finishedAt = new Date().toISOString();
        const processed = staleItems.rows.length + stalePays.rows.length;
        await this.runQuery(
          client,
          `INSERT INTO scheduled_job_runs (
             id, job_name, instance_id, status, processed_count, details, started_at, finished_at
           )
           VALUES ($1, $2, $3, 'succeeded', $4, $5::jsonb, $6::timestamptz, $7::timestamptz)`,
          [
            jobId,
            input.jobName ?? 'payment_expiry_sweep',
            input.instanceId,
            processed,
            JSON.stringify({
              releasedReservations: staleItems.rows.length,
              expiredPayments: stalePays.rows.length,
            }),
            startedAt,
            finishedAt,
          ],
        );
        runRecord = {
          id: jobId,
          jobName: input.jobName ?? 'payment_expiry_sweep',
          instanceId: input.instanceId,
          status: 'succeeded',
          processedCount: processed,
          errorMessage: null,
          startedAt,
          finishedAt,
        };
      }

      return {
        acquiredLock: true,
        releasedReservations: staleItems.rows.length,
        expiredPayments: stalePays.rows.length,
        runRecord,
      };
    });
  }

  public async listScheduledJobRuns(jobName?: string, limit = 25): Promise<ScheduledJobRunRecord[]> {
    const res = jobName
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM scheduled_job_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2',
          [jobName, limit],
        )
      : await this.runQuery(
          this.pool,
          'SELECT * FROM scheduled_job_runs ORDER BY started_at DESC LIMIT $1',
          [limit],
        );
    return res.rows.map((r) => ({
      id: String(r.id),
      jobName: String(r.job_name),
      instanceId: String(r.instance_id),
      status: r.status as ScheduledJobRunRecord['status'],
      processedCount: Number(r.processed_count ?? 0),
      errorMessage: (r.error_message as string | null) ?? null,
      startedAt: toIso(r.started_at),
      finishedAt: toIsoNullable(r.finished_at),
    }));
  }

  /* --------------------------------------------------------------------------
   * AGENTS
   * -------------------------------------------------------------------------- */
  private mapAgentAppRow(r: Record<string, unknown>): AgentApplicationRecord {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      email: (r.email as string | null) ?? null,
      fullName: String(r.applicant_name),
      phone: String(r.contact_phone),
      city: String(r.city_region),
      businessName: (r.business_name as string | null) ?? null,
      applicantType: (r.applicant_type as AgentApplicationRecord['applicantType']) ?? 'individual_agent',
      experienceSummary: String(r.experience_summary || r.experience_note || ''),
      status: r.status as AgentApplicationRecord['status'],
      reviewNotes: (r.review_notes as string | null) ?? (r.review_note as string | null) ?? null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: toIsoNullable(r.reviewed_at),
      createdAt: toIso(r.submitted_at),
    };
  }

  private mapAgentRow(r: Record<string, unknown>): AgentProfileRecord {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      applicationId: String(r.application_id ?? ''),
      fullName: String(r.display_name),
      email: (r.email as string | null) ?? null,
      referralCode: String(r.referral_code),
      status: r.status === 'suspended' ? 'suspended' : 'approved',
      operatorAuthorizationStatus: {
        ethio_telecom: r.ethio_telecom_authorized ? 'authorized' : 'not_authorized',
        safaricom_ethiopia: r.safaricom_authorized ? 'authorized' : 'not_authorized',
      },
      totalAttributedOrders: Number(r.total_attributed_orders ?? 0),
      totalEarnedCommissionEtb: toNum(r.total_earned_commission_etb),
      totalPaidOutEtb: toNum(r.total_paid_out_etb),
      approvedAt: toIso(r.created_at),
    };
  }

  public async submitAgentApplicationTx(
    app: AgentApplicationRecord,
    auditEntry: AuditLogRecord,
  ): Promise<AgentApplicationRecord> {
    return this.runTx(async (client) => {
      const bizKind = app.applicantType === 'individual_agent' ? 'individual' : 'registered_business';
      const res = await this.runQuery(
        client,
        `INSERT INTO agent_applications (
           id, user_id, applicant_name, email, contact_phone, business_or_individual,
           business_name, applicant_type, city_region, document_reference,
           experience_note, experience_summary, status, submitted_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '', $10, $10, $11, $12::timestamptz)
         RETURNING *`,
        [
          app.id,
          app.userId,
          app.fullName,
          app.email ?? '',
          app.phone,
          bizKind,
          app.businessName,
          app.applicantType,
          app.city,
          app.experienceSummary,
          app.status,
          app.createdAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapAgentAppRow(res.rows[0]);
    });
  }

  public async getAgentApplicationForUser(userId: string): Promise<AgentApplicationRecord | null> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM agent_applications WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1',
      [userId],
    );
    return res.rows[0] ? this.mapAgentAppRow(res.rows[0]) : null;
  }

  public async listAgentApplications(): Promise<AgentApplicationRecord[]> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM agent_applications ORDER BY submitted_at DESC',
    );
    return res.rows.map((r) => this.mapAgentAppRow(r));
  }

  public async getApprovedAgentByUserId(userId: string): Promise<AgentProfileRecord | null> {
    const res = await this.runQuery(
      this.pool,
      `SELECT * FROM agents WHERE user_id = $1 AND status = 'approved' LIMIT 1`,
      [userId],
    );
    return res.rows[0] ? this.mapAgentRow(res.rows[0]) : null;
  }

  public async getAnyAgentProfileByUserId(userId: string): Promise<AgentProfileRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM agents WHERE user_id = $1 LIMIT 1', [userId]);
    return res.rows[0] ? this.mapAgentRow(res.rows[0]) : null;
  }

  public async getAgentByReferralCode(code: string): Promise<AgentProfileRecord | null> {
    const res = await this.runQuery(
      this.pool,
      `SELECT * FROM agents WHERE UPPER(referral_code) = UPPER($1) AND status = 'approved' LIMIT 1`,
      [code.trim()],
    );
    return res.rows[0] ? this.mapAgentRow(res.rows[0]) : null;
  }

  public async getAgentById(id: string): Promise<AgentProfileRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM agents WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? this.mapAgentRow(res.rows[0]) : null;
  }

  public async listAgents(): Promise<AgentProfileRecord[]> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM agents ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapAgentRow(r));
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
    return this.runTx(async (client) => {
      const appRes = await this.runQuery(
        client,
        'SELECT * FROM agent_applications WHERE id = $1 FOR UPDATE',
        [input.applicationId],
      );
      if (!appRes.rows[0]) {
        throw new DomainRuleError(404, 'APPLICATION_NOT_FOUND', 'Agent application not found.');
      }
      const updApp = await this.runQuery(
        client,
        `UPDATE agent_applications
         SET status = $2,
             review_notes = $3,
             review_note = $3,
             reviewed_by = $4,
             reviewed_at = $5::timestamptz
         WHERE id = $1
         RETURNING *`,
        [input.applicationId, input.decision, input.reviewNotes, input.reviewedBy, input.reviewedAt],
      );
      const application = this.mapAgentAppRow(updApp.rows[0]);

      const agRes = await this.runQuery(
        client,
        'SELECT * FROM agents WHERE user_id = $1 FOR UPDATE',
        [application.userId],
      );
      let agentProfile: AgentProfileRecord | null = agRes.rows[0] ? this.mapAgentRow(agRes.rows[0]) : null;

      if (input.decision === 'approved') {
        if (!agentProfile && input.newAgentIfApproved) {
          const insAg = await this.runQuery(
            client,
            `INSERT INTO agents (
               id, user_id, application_id, display_name, email, referral_code, status,
               ethio_telecom_authorized, safaricom_authorized, created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $8, $9::timestamptz)
             RETURNING *`,
            [
              input.newAgentIfApproved.id,
              input.newAgentIfApproved.userId,
              application.id,
              input.newAgentIfApproved.fullName,
              input.newAgentIfApproved.email,
              input.newAgentIfApproved.referralCode,
              Boolean(input.ethioTelecomAuthorized),
              Boolean(input.safaricomAuthorized),
              input.reviewedAt,
            ],
          );
          agentProfile = this.mapAgentRow(insAg.rows[0]);
        } else if (agentProfile) {
          const updAg = await this.runQuery(
            client,
            `UPDATE agents
             SET status = 'approved',
                 ethio_telecom_authorized = COALESCE($2, ethio_telecom_authorized),
                 safaricom_authorized = COALESCE($3, safaricom_authorized)
             WHERE id = $1
             RETURNING *`,
            [
              agentProfile.id,
              input.ethioTelecomAuthorized ? true : null,
              input.safaricomAuthorized ? true : null,
            ],
          );
          agentProfile = this.mapAgentRow(updAg.rows[0]);
        }
      } else if (agentProfile && input.decision === 'suspended') {
        const updAg = await this.runQuery(
          client,
          `UPDATE agents SET status = 'suspended' WHERE id = $1 RETURNING *`,
          [agentProfile.id],
        );
        agentProfile = this.mapAgentRow(updAg.rows[0]);
      }

      await this.insertAudit(client, input.auditEntry);
      return { application, agentProfile };
    });
  }

  public async getAgentDashboardData(agentId: string) {
    const agent = await this.getAgentById(agentId);
    if (!agent) return null;

    const [ordersRes, commRes, payRes] = await Promise.all([
      this.runQuery(
        this.pool,
        `SELECT id, order_number, operator_code, status, created_at
         FROM esim_orders WHERE attributed_agent_id = $1 ORDER BY created_at DESC`,
        [agentId],
      ),
      this.runQuery(
        this.pool,
        'SELECT * FROM agent_commissions WHERE agent_id = $1 ORDER BY created_at DESC',
        [agentId],
      ),
      this.runQuery(
        this.pool,
        'SELECT * FROM agent_payouts WHERE agent_id = $1 ORDER BY recorded_at DESC',
        [agentId],
      ),
    ]);

    return {
      agent,
      attributedOrders: ordersRes.rows.map((o) => ({
        id: String(o.id),
        orderNumber: String(o.order_number),
        operatorCode: o.operator_code as OperatorCode,
        status: o.status as OrderStatus,
        createdAt: toIso(o.created_at),
      })),
      commissions: commRes.rows.map((c) => ({
        id: String(c.id),
        agentId: String(c.agent_id),
        orderId: String(c.order_id),
        orderNumber: String(c.order_number ?? ''),
        operatorCode: c.operator_code as OperatorCode,
        commissionAmountEtb: toNumNullable(c.commission_amount_etb),
        pricingStatus: (c.pricing_status as AgentCommissionRecord['pricingStatus']) ?? 'pending_commercial_rate',
        status: c.status as AgentCommissionRecord['status'],
        createdAt: toIso(c.created_at),
      })),
      payouts: payRes.rows.map((p) => ({
        id: String(p.id),
        agentId: String(p.agent_id),
        amountEtb: toNum(p.amount_etb),
        paymentReference: String(p.reference),
        status: (p.status === 'paid' ? 'paid' : 'scheduled') as AgentPayoutRecord['status'],
        createdAt: toIso(p.recorded_at),
      })),
    };
  }

  public async recordAgentPayoutTx(
    payout: AgentPayoutRecord,
    auditEntry: AuditLogRecord,
  ): Promise<AgentPayoutRecord | null> {
    return this.runTx(async (client) => {
      const agRes = await this.runQuery(client, 'SELECT id FROM agents WHERE id = $1 FOR UPDATE', [payout.agentId]);
      if (!agRes.rows[0]) return null;

      await this.runQuery(
        client,
        `INSERT INTO agent_payouts (id, agent_id, amount_etb, reference, status, note, recorded_at)
         VALUES ($1, $2, $3, $4, $5, '', $6::timestamptz)`,
        [payout.id, payout.agentId, payout.amountEtb, payout.paymentReference, payout.status, payout.createdAt],
      );
      if (payout.status === 'paid') {
        await this.runQuery(
          client,
          'UPDATE agents SET total_paid_out_etb = total_paid_out_etb + $2 WHERE id = $1',
          [payout.agentId, payout.amountEtb],
        );
      }
      await this.insertAudit(client, auditEntry);
      return payout;
    });
  }

  /* --------------------------------------------------------------------------
   * BUSINESS ACCOUNTS & BULK REQUESTS
   * -------------------------------------------------------------------------- */
  private mapBusinessRow(r: Record<string, unknown>): BusinessAccountRecord {
    return {
      id: String(r.id),
      ownerUserId: String(r.owner_user_id),
      companyName: String(r.company_name),
      tinNumber: String(r.tin_number),
      contactEmail: String(r.contact_email),
      contactPhone: String(r.contact_phone),
      city: String(r.city),
      verificationStatus: r.verification_status as BusinessAccountRecord['verificationStatus'],
      pricingTermsStatus: r.pricing_terms_status as BusinessAccountRecord['pricingTermsStatus'],
      commercialNotes: (r.commercial_notes as string | null) ?? null,
      reviewedBy: (r.reviewed_by as string | null) ?? null,
      reviewedAt: toIsoNullable(r.reviewed_at),
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapBusinessMemberRow(r: Record<string, unknown>): BusinessMemberRecord {
    return {
      id: String(r.id),
      businessId: String(r.business_id),
      email: String(r.email),
      fullName: String(r.full_name),
      role: r.role as BusinessMemberRole,
      status: r.status as BusinessMemberRecord['status'],
      addedByUserId: String(r.added_by_user_id),
      createdAt: toIso(r.created_at),
    };
  }

  private mapBulkOrderRow(r: Record<string, unknown>): BusinessBulkOrderRecord {
    return {
      id: String(r.id),
      requestNumber: String(r.request_number),
      businessId: String(r.business_id),
      requestedByUserId: String(r.requested_by_user_id),
      operatorCode: r.operator_code as OperatorCode,
      serviceType: r.service_type as BusinessBulkOrderRecord['serviceType'],
      quantity: Number(r.quantity),
      preferredTier: (r.preferred_tier as NumberTier) ?? 'standard',
      departmentNote: (r.department_note as string | null) ?? null,
      estimatedAmountEtb: toNumNullable(r.estimated_amount_etb),
      pricingNote: String(r.pricing_note),
      status: r.status as BusinessBulkOrderRecord['status'],
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    };
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
    let account: BusinessAccountRecord | null = null;
    let role: BusinessMemberRole | null = null;

    const ownerRes = await this.runQuery(
      this.pool,
      'SELECT * FROM business_accounts WHERE owner_user_id = $1 LIMIT 1',
      [userId],
    );
    if (ownerRes.rows[0]) {
      account = this.mapBusinessRow(ownerRes.rows[0]);
      role = 'owner';
    } else if (userEmail && emailVerified) {
      const memRes = await this.runQuery(
        this.pool,
        `SELECT m.role, a.*
         FROM business_members m
         JOIN business_accounts a ON a.id = m.business_id
         WHERE LOWER(m.email) = LOWER($1) AND m.status <> 'revoked'
         LIMIT 1`,
        [userEmail.trim()],
      );
      if (memRes.rows[0]) {
        role = memRes.rows[0].role as BusinessMemberRole;
        account = this.mapBusinessRow(memRes.rows[0]);
      }
    }

    if (!account) {
      return { account: null, memberRole: null, members: [], bulkOrders: [] };
    }

    const [membersRes, bulkRes] = await Promise.all([
      this.runQuery(
        this.pool,
        `SELECT * FROM business_members WHERE business_id = $1 AND status <> 'revoked' ORDER BY created_at ASC`,
        [account.id],
      ),
      this.runQuery(
        this.pool,
        'SELECT * FROM business_bulk_orders WHERE business_id = $1 ORDER BY created_at DESC',
        [account.id],
      ),
    ]);

    return {
      account,
      memberRole: role,
      members: membersRes.rows.map((r) => this.mapBusinessMemberRow(r)),
      bulkOrders: bulkRes.rows.map((r) => this.mapBulkOrderRow(r)),
    };
  }

  public async upsertBusinessAccountTx(input: {
    userId: string;
    account: BusinessAccountRecord;
    ownerMemberIfNew: BusinessMemberRecord | null;
    isUpdate: boolean;
    auditEntry: AuditLogRecord;
  }): Promise<BusinessAccountRecord> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO business_accounts (
           id, owner_user_id, company_name, tin_number, contact_email, contact_phone,
           city, verification_status, pricing_terms_status, commercial_notes,
           reviewed_by, reviewed_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz, $13::timestamptz, $14::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           tin_number = EXCLUDED.tin_number,
           contact_email = EXCLUDED.contact_email,
           contact_phone = EXCLUDED.contact_phone,
           city = EXCLUDED.city,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          input.account.id,
          input.account.ownerUserId,
          input.account.companyName,
          input.account.tinNumber,
          input.account.contactEmail,
          input.account.contactPhone,
          input.account.city,
          input.account.verificationStatus,
          input.account.pricingTermsStatus,
          input.account.commercialNotes,
          input.account.reviewedBy,
          input.account.reviewedAt,
          input.account.createdAt,
          input.account.updatedAt,
        ],
      );

      if (!input.isUpdate && input.ownerMemberIfNew) {
        await this.runQuery(
          client,
          `INSERT INTO business_members (
             id, business_id, email, full_name, role, status, added_by_user_id, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
           ON CONFLICT (business_id, email) DO NOTHING`,
          [
            input.ownerMemberIfNew.id,
            input.ownerMemberIfNew.businessId,
            input.ownerMemberIfNew.email,
            input.ownerMemberIfNew.fullName,
            input.ownerMemberIfNew.role,
            input.ownerMemberIfNew.status,
            input.ownerMemberIfNew.addedByUserId,
            input.ownerMemberIfNew.createdAt,
          ],
        );
      }

      await this.insertAudit(client, input.auditEntry);
      return this.mapBusinessRow(res.rows[0]);
    });
  }

  public async addBusinessMemberTx(
    member: BusinessMemberRecord,
    auditEntry: AuditLogRecord,
  ): Promise<BusinessMemberRecord> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO business_members (
           id, business_id, email, full_name, role, status, added_by_user_id, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
         RETURNING *`,
        [
          member.id,
          member.businessId,
          member.email,
          member.fullName,
          member.role,
          member.status,
          member.addedByUserId,
          member.createdAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapBusinessMemberRow(res.rows[0]);
    });
  }

  public async createBusinessBulkOrderTx(
    bulk: BusinessBulkOrderRecord,
    auditEntry: AuditLogRecord,
  ): Promise<BusinessBulkOrderRecord> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO business_bulk_orders (
           id, request_number, business_id, requested_by_user_id, operator_code,
           service_type, quantity, preferred_tier, department_note,
           estimated_amount_etb, pricing_note, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::timestamptz)
         RETURNING *`,
        [
          bulk.id,
          bulk.requestNumber,
          bulk.businessId,
          bulk.requestedByUserId,
          bulk.operatorCode,
          bulk.serviceType,
          bulk.quantity,
          bulk.preferredTier,
          bulk.departmentNote,
          bulk.estimatedAmountEtb,
          bulk.pricingNote,
          bulk.status,
          bulk.createdAt,
          bulk.updatedAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapBulkOrderRow(res.rows[0]);
    });
  }

  public async listAllBusinesses() {
    const [accRes, bulkRes] = await Promise.all([
      this.runQuery(this.pool, 'SELECT * FROM business_accounts ORDER BY created_at DESC'),
      this.runQuery(this.pool, 'SELECT * FROM business_bulk_orders ORDER BY created_at DESC'),
    ]);
    return {
      accounts: accRes.rows.map((r) => this.mapBusinessRow(r)),
      bulkOrders: bulkRes.rows.map((r) => this.mapBulkOrderRow(r)),
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
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `UPDATE business_accounts
         SET verification_status = $2,
             pricing_terms_status = COALESCE($3, pricing_terms_status),
             commercial_notes = COALESCE($4, commercial_notes),
             reviewed_by = $5,
             reviewed_at = $6::timestamptz,
             updated_at = $6::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          businessId,
          patch.verificationStatus,
          patch.pricingTermsStatus ?? null,
          patch.commercialNotes !== undefined ? patch.commercialNotes : null,
          patch.reviewedBy,
          patch.reviewedAt,
        ],
      );
      if (!res.rows[0]) return null;
      await this.insertAudit(client, auditEntry);
      return this.mapBusinessRow(res.rows[0]);
    });
  }

  /* --------------------------------------------------------------------------
   * SECONDARY PHONES, SUPPORT, AUDIT & OVERVIEW METRICS
   * -------------------------------------------------------------------------- */
  private mapPhoneProductRow(r: Record<string, unknown>): PhoneProductRecord {
    const esimCapable = Boolean(r.esim_capable ?? r.esim_ready ?? true);
    const compatStatus =
      (r.esim_compatibility_status as PhoneProductRecord['esimCompatibilityStatus']) ??
      (esimCapable ? 'verified_compatible' : 'not_compatible');
    return {
      id: String(r.id),
      brand: String(r.brand),
      category: (r.category as PhoneProductRecord['category']) ?? 'other',
      model: String(r.model),
      exactModelNumber: String(r.exact_model_number ?? ''),
      regionalVariant: String(r.regional_variant ?? 'Global Variant'),
      storage: String(r.storage),
      condition: String(r.condition ?? 'Brand New · Sealed'),
      warrantySummary: String(r.warranty_summary ?? 'Standard Seller Warranty'),
      esimCapable,
      esimCompatibilityStatus: compatStatus,
      networkUnlockStatus:
        (r.network_unlock_status as PhoneProductRecord['networkUnlockStatus']) ?? 'needs_verification',
      ethioTelecomCompatibility:
        (r.ethio_telecom_compatibility as PhoneProductRecord['ethioTelecomCompatibility']) ?? 'unverified',
      safaricomCompatibility:
        (r.safaricom_compatibility as PhoneProductRecord['safaricomCompatibility']) ?? 'unverified',
      compatibilityNotes: String(r.compatibility_notes ?? ''),
      compatibilityEvidence: (r.compatibility_evidence as string | null) ?? null,
      imageKey: (r.image_key as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      isFeatured: Boolean(r.is_featured ?? false),
      unitPriceEtb: toNumNullable(r.price_etb),
      sandboxPreviewPriceEtb: toNumNullable(r.sandbox_preview_price_etb),
      pricingStatus: (r.pricing_status as PhoneProductRecord['pricingStatus']) ?? 'pending_commercial_quote',
      stockQty: Number(r.stock_count ?? 0),
      bulkMinimumQty: Number(r.bulk_minimum_qty ?? 5),
      supportsBulkOrder: Boolean(r.bulk_eligible ?? true),
      deliveryPartner: 'klick',
      isActive: Boolean(r.is_active ?? true),
      updatedAt: toIso(r.updated_at),
    };
  }

  private mapPhoneOrderRow(r: Record<string, unknown>): PhoneOrderRecord {
    return {
      id: String(r.id),
      orderNumber: String(r.order_number ?? r.id),
      userId: String(r.user_id),
      phoneProductId: String(r.product_id),
      phoneModel: String(r.phone_model ?? ''),
      orderKind: r.order_kind as PhoneOrderRecord['orderKind'],
      quantity: Number(r.quantity),
      companyName: (r.company_name as string | null) ?? null,
      contactPhone: (r.contact_phone as string | null) ?? null,
      deliveryCity: String(r.delivery_city ?? r.delivery_address_note ?? ''),
      deliveryAddress: (r.delivery_address as string | null) ?? null,
      deliveryNotes: (r.delivery_notes as string | null) ?? null,
      pairedEsimOperator: (r.paired_esim_operator as PhoneOrderRecord['pairedEsimOperator']) ?? null,
      estimatedTotalEtb: toNum(r.estimated_total_etb),
      isSandboxEstimate: Boolean(r.is_sandbox_estimate ?? true),
      paymentStatus: (r.payment_status as PhoneOrderRecord['paymentStatus']) ?? 'pending',
      paymentReference: (r.payment_reference as string | null) ?? null,
      checkoutUrl: (r.checkout_url as string | null) ?? null,
      fulfillmentStatus: r.delivery_status as PhoneOrderRecord['fulfillmentStatus'],
      klickDeliveryPartnerStatus:
        (r.klick_delivery_partner_status as PhoneOrderRecord['klickDeliveryPartnerStatus']) ??
        'klick_boundary_pending_onboarding',
      attributedAgentId: (r.attributed_agent_id as string | null) ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  public async listPhoneProducts(activeOnly = false): Promise<PhoneProductRecord[]> {
    const res = activeOnly
      ? await this.runQuery(this.pool, 'SELECT * FROM phone_products WHERE is_active = TRUE ORDER BY is_featured DESC, id ASC')
      : await this.runQuery(this.pool, 'SELECT * FROM phone_products ORDER BY is_featured DESC, id ASC');
    return res.rows.map((r) => this.mapPhoneProductRow(r));
  }

  public async getPhoneProduct(id: string): Promise<PhoneProductRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM phone_products WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? this.mapPhoneProductRow(res.rows[0]) : null;
  }

  public async upsertPhoneProductTx(
    product: PhoneProductRecord,
    _isNew: boolean,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneProductRecord> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `INSERT INTO phone_products (
           id, brand, category, model, exact_model_number, regional_variant, storage, condition, warranty_summary,
           esim_ready, esim_capable, esim_compatibility_status, network_unlock_status,
           ethio_telecom_compatibility, safaricom_compatibility, compatibility_notes, compatibility_evidence,
           image_key, image_url, is_featured,
           price_etb, sandbox_preview_price_etb, price_label, pricing_status,
           stock_count, bulk_eligible, bulk_minimum_qty, specs, is_active, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $10, $11, $12,
           $13, $14, $15, $16,
           $17, $18, $19,
           $20, $21, $22, $23,
           $24, $25, $26, $27, $28, $29::timestamptz
         )
         ON CONFLICT (id) DO UPDATE SET
           brand = EXCLUDED.brand,
           category = EXCLUDED.category,
           model = EXCLUDED.model,
           exact_model_number = EXCLUDED.exact_model_number,
           regional_variant = EXCLUDED.regional_variant,
           storage = EXCLUDED.storage,
           condition = EXCLUDED.condition,
           warranty_summary = EXCLUDED.warranty_summary,
           esim_ready = EXCLUDED.esim_ready,
           esim_capable = EXCLUDED.esim_capable,
           esim_compatibility_status = EXCLUDED.esim_compatibility_status,
           network_unlock_status = EXCLUDED.network_unlock_status,
           ethio_telecom_compatibility = EXCLUDED.ethio_telecom_compatibility,
           safaricom_compatibility = EXCLUDED.safaricom_compatibility,
           compatibility_notes = EXCLUDED.compatibility_notes,
           compatibility_evidence = EXCLUDED.compatibility_evidence,
           image_key = EXCLUDED.image_key,
           image_url = EXCLUDED.image_url,
           is_featured = EXCLUDED.is_featured,
           price_etb = EXCLUDED.price_etb,
           sandbox_preview_price_etb = EXCLUDED.sandbox_preview_price_etb,
           price_label = EXCLUDED.price_label,
           pricing_status = EXCLUDED.pricing_status,
           stock_count = EXCLUDED.stock_count,
           bulk_eligible = EXCLUDED.bulk_eligible,
           bulk_minimum_qty = EXCLUDED.bulk_minimum_qty,
           specs = EXCLUDED.specs,
           is_active = EXCLUDED.is_active,
           updated_at = EXCLUDED.updated_at
         RETURNING *`,
        [
          product.id,
          product.brand,
          product.category,
          product.model,
          product.exactModelNumber,
          product.regionalVariant,
          product.storage,
          product.condition,
          product.warrantySummary,
          product.esimCapable,
          product.esimCompatibilityStatus,
          product.networkUnlockStatus,
          product.ethioTelecomCompatibility,
          product.safaricomCompatibility,
          product.compatibilityNotes,
          product.compatibilityEvidence,
          product.imageKey,
          product.imageUrl,
          product.isFeatured,
          product.unitPriceEtb,
          product.sandboxPreviewPriceEtb,
          product.unitPriceEtb !== null ? `${product.unitPriceEtb} ETB` : 'Pending Commercial Quote',
          product.pricingStatus,
          product.stockQty,
          product.supportsBulkOrder,
          product.bulkMinimumQty,
          `${product.storage} · ${product.condition}`,
          product.isActive,
          product.updatedAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapPhoneProductRow(res.rows[0]);
    });
  }

  public async createPhoneOrderTx(
    order: PhoneOrderRecord,
    qtyToDecrement: number,
    auditEntry: AuditLogRecord,
  ): Promise<PhoneOrderRecord> {
    return this.runTx(async (client) => {
      const dec = await this.runQuery(
        client,
        `UPDATE phone_products
         SET stock_count = stock_count - $2,
             updated_at = NOW()
         WHERE id = $1 AND stock_count >= $2 AND is_active = TRUE
         RETURNING stock_count`,
        [order.phoneProductId, qtyToDecrement],
      );
      if (!dec.rows[0]) {
        throw new DomainRuleError(
          409,
          'INSUFFICIENT_PHONE_STOCK',
          'Insufficient secondary phone stock remaining for requested quantity.',
        );
      }

      const res = await this.runQuery(
        client,
        `INSERT INTO phone_orders (
           id, order_number, user_id, product_id, phone_model, order_kind,
           quantity, company_name, contact_phone, delivery_address_note, delivery_city, delivery_address, delivery_notes,
           paired_esim_operator, estimated_total_etb, is_sandbox_estimate, payment_status, payment_reference, checkout_url,
           delivery_partner, delivery_status, klick_delivery_partner_status,
           attributed_agent_id, created_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $10, $11, $12,
           $13, $14, $15, $16, $17, $18,
           'klick_pending_agreement', $19, $20,
           $21, $22::timestamptz
         )
         RETURNING *`,
        [
          order.id,
          order.orderNumber,
          order.userId,
          order.phoneProductId,
          order.phoneModel,
          order.orderKind,
          order.quantity,
          order.companyName,
          order.contactPhone,
          order.deliveryCity,
          order.deliveryAddress,
          order.deliveryNotes,
          order.pairedEsimOperator,
          order.estimatedTotalEtb,
          order.isSandboxEstimate,
          order.paymentStatus,
          order.paymentReference,
          order.checkoutUrl,
          order.fulfillmentStatus,
          order.klickDeliveryPartnerStatus,
          order.attributedAgentId,
          order.createdAt,
        ],
      );
      await this.insertAudit(client, auditEntry);
      return this.mapPhoneOrderRow(res.rows[0]);
    });
  }

  public async getPhoneOrder(phoneOrderId: string): Promise<PhoneOrderRecord | null> {
    const res = await this.runQuery(this.pool, 'SELECT * FROM phone_orders WHERE id = $1 LIMIT 1', [phoneOrderId]);
    return res.rows[0] ? this.mapPhoneOrderRow(res.rows[0]) : null;
  }

  public async listPhoneOrders(userId?: string): Promise<PhoneOrderRecord[]> {
    const res = userId
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM phone_orders WHERE user_id = $1 ORDER BY created_at DESC',
          [userId],
        )
      : await this.runQuery(this.pool, 'SELECT * FROM phone_orders ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapPhoneOrderRow(r));
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
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `UPDATE phone_orders
         SET payment_status = COALESCE($2, payment_status),
             payment_reference = COALESCE($3, payment_reference),
             checkout_url = COALESCE($4, checkout_url),
             delivery_status = COALESCE($5, delivery_status),
             klick_delivery_partner_status = COALESCE($6, klick_delivery_partner_status)
         WHERE id = $1
         RETURNING *`,
        [
          phoneOrderId,
          patch.paymentStatus ?? null,
          patch.paymentReference ?? null,
          patch.checkoutUrl ?? null,
          patch.fulfillmentStatus ?? null,
          patch.klickDeliveryPartnerStatus ?? null,
        ],
      );
      if (!res.rows[0]) return null;
      if (auditEntry) await this.insertAudit(client, auditEntry);
      return this.mapPhoneOrderRow(res.rows[0]);
    });
  }

  public async createSupportTicket(ticket: SupportTicketRecord): Promise<SupportTicketRecord> {
    const res = await this.runQuery(
      this.pool,
      `INSERT INTO support_tickets (
         id, user_id, contact_email, related_order_id, subject, category, message, status, admin_response, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
       RETURNING *`,
      [
        ticket.id,
        ticket.userId,
        ticket.email,
        ticket.orderId,
        ticket.subject,
        ticket.category,
        ticket.message,
        ticket.status,
        ticket.adminResponse,
        ticket.createdAt,
      ],
    );
    const r = res.rows[0];
    return {
      id: String(r.id),
      userId: (r.user_id as string | null) ?? null,
      email: String(r.contact_email),
      subject: String(r.subject),
      category: r.category as SupportTicketRecord['category'],
      orderId: (r.related_order_id as string | null) ?? null,
      message: String(r.message),
      status: r.status as SupportTicketRecord['status'],
      adminResponse: (r.admin_response as string | null) ?? null,
      createdAt: toIso(r.created_at),
    };
  }

  public async listSupportTickets(userId?: string): Promise<SupportTicketRecord[]> {
    const res = userId
      ? await this.runQuery(
          this.pool,
          'SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC',
          [userId],
        )
      : await this.runQuery(this.pool, 'SELECT * FROM support_tickets ORDER BY created_at DESC');
    return res.rows.map((r) => ({
      id: String(r.id),
      userId: (r.user_id as string | null) ?? null,
      email: String(r.contact_email),
      subject: String(r.subject),
      category: (r.category as SupportTicketRecord['category']) ?? 'general',
      orderId: (r.related_order_id as string | null) ?? null,
      message: String(r.message),
      status: r.status as SupportTicketRecord['status'],
      adminResponse: (r.admin_response as string | null) ?? null,
      createdAt: toIso(r.created_at),
    }));
  }

  public async updateSupportTicketTx(
    ticketId: string,
    status: SupportTicketRecord['status'],
    adminResponse: string,
    auditEntry: AuditLogRecord,
  ): Promise<SupportTicketRecord | null> {
    return this.runTx(async (client) => {
      const res = await this.runQuery(
        client,
        `UPDATE support_tickets
         SET status = $2,
             admin_response = $3
         WHERE id = $1
         RETURNING *`,
        [ticketId, status, adminResponse],
      );
      if (!res.rows[0]) return null;
      await this.insertAudit(client, auditEntry);
      const r = res.rows[0];
      return {
        id: String(r.id),
        userId: (r.user_id as string | null) ?? null,
        email: String(r.contact_email),
        subject: String(r.subject),
        category: (r.category as SupportTicketRecord['category']) ?? 'general',
        orderId: (r.related_order_id as string | null) ?? null,
        message: String(r.message),
        status: r.status as SupportTicketRecord['status'],
        adminResponse: (r.admin_response as string | null) ?? null,
        createdAt: toIso(r.created_at),
      };
    });
  }

  public async recordAudit(entry: AuditLogRecord): Promise<void> {
    await this.insertAudit(this.pool, entry);
  }

  public async listAuditLogs(limit: number): Promise<AuditLogRecord[]> {
    const res = await this.runQuery(
      this.pool,
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1',
      [limit],
    );
    return res.rows.map((a) => ({
      id: String(a.id),
      actorType: a.actor_type as AuditLogRecord['actorType'],
      actorId: String(a.actor_id),
      actorEmail: (a.actor_email as string | undefined) ?? undefined,
      action: String(a.action),
      targetType: String(a.target_type),
      targetId: String(a.target_id),
      reason: String(a.reason),
      createdAt: toIso(a.created_at),
    }));
  }

  public async getOverviewMetrics() {
    const res = await this.runQuery(
      this.pool,
      `SELECT
         (SELECT COUNT(*)::int FROM users) AS total_users,
         (SELECT COUNT(*)::int FROM esim_orders) AS total_esim_orders,
         (SELECT COUNT(*)::int FROM esim_orders WHERE status = 'awaiting_manual_fulfillment') AS awaiting_manual,
         (SELECT COUNT(*)::int FROM esim_activations) AS provisioned_esims,
         (SELECT COUNT(*)::int FROM esim_stock_items WHERE status = 'available') AS avail_stock,
         (SELECT COUNT(*)::int FROM esim_stock_items WHERE status = 'reserved') AS res_stock,
         (SELECT COUNT(*)::int FROM agent_applications WHERE status = 'pending_review') AS pending_ag_apps,
         (SELECT COUNT(*)::int FROM agents WHERE status = 'approved') AS approved_agents,
         (SELECT COALESCE(SUM(amount_etb), 0)::float8 FROM payments WHERE status = 'verified') AS verified_etb,
         (SELECT COUNT(*)::int FROM support_tickets WHERE status = 'open') AS open_tickets,
         (SELECT COUNT(*)::int FROM phone_orders) AS phone_orders,
         (SELECT COUNT(*)::int FROM business_accounts) AS biz_accounts,
         (SELECT COUNT(*)::int FROM business_bulk_orders WHERE status = 'pending_commercial_review') AS pending_bulk`,
    );
    const r = res.rows[0] ?? {};
    return {
      totalUsers: Number(r.total_users ?? 0),
      totalEsimOrders: Number(r.total_esim_orders ?? 0),
      awaitingManualFulfillment: Number(r.awaiting_manual ?? 0),
      provisionedEsims: Number(r.provisioned_esims ?? 0),
      availableStockCount: Number(r.avail_stock ?? 0),
      reservedStockCount: Number(r.res_stock ?? 0),
      pendingAgentApplications: Number(r.pending_ag_apps ?? 0),
      approvedAgentsCount: Number(r.approved_agents ?? 0),
      verifiedPaymentsEtb: Number(r.verified_etb ?? 0),
      openSupportTickets: Number(r.open_tickets ?? 0),
      phoneOrdersCount: Number(r.phone_orders ?? 0),
      businessAccountsCount: Number(r.biz_accounts ?? 0),
      pendingBulkEsimRequests: Number(r.pending_bulk ?? 0),
    };
  }
}
