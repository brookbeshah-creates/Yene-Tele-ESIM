-- ============================================================================
-- YENE TELE (የእኔ ቴሌኮም) — POSTGRESQL PRODUCTION HARDENING MIGRATION (002)
-- Adds migration tracking, idempotent webhook ledger, user account lifecycle,
-- Business Customer Accounts & bulk eSIM preparation, full domain columns,
-- and production indexes. Safe & idempotent across clean or migrated DBs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(128) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extend users for language preference and account suspension lifecycle
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(8) NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS account_status VARCHAR(24) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Extend staff_admins for display name and active flag
ALTER TABLE staff_admins
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- Align operators columns with runtime domain model
ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS kyc_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS supports_pre_payment_reservation BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(48) NOT NULL DEFAULT 'operational_sandbox',
  ADD COLUMN IF NOT EXISTS customer_visible_note TEXT NOT NULL DEFAULT '';

-- Align esim_products with bilingual and pricing status fields
ALTER TABLE esim_products
  ADD COLUMN IF NOT EXISTS name_am VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_am TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS sandbox_preview_amount_etb NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS pricing_status VARCHAR(48) NOT NULL DEFAULT 'pending_operator_agreement';

-- Extend stock batches & items with source_environment & audit columns
ALTER TABLE esim_stock_batches
  ADD COLUMN IF NOT EXISTS source_environment VARCHAR(32) NOT NULL DEFAULT 'operator_partner_batch',
  ADD COLUMN IF NOT EXISTS supplier_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS available_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE esim_stock_items
  ADD COLUMN IF NOT EXISTS eid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS external_inventory_ref VARCHAR(160),
  ADD COLUMN IF NOT EXISTS inventory_type VARCHAR(48) NOT NULL DEFAULT 'msisdn_profile_bundle',
  ADD COLUMN IF NOT EXISTS source_environment VARCHAR(32) NOT NULL DEFAULT 'operator_partner_batch',
  ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS audit_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Extend esim_orders to match full runtime order lifecycle
ALTER TABLE esim_orders
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS device_os VARCHAR(16),
  ADD COLUMN IF NOT EXISTS selected_number_tier VARCHAR(32) NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS existing_msisdn VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS number_reservation_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provisioning_status VARCHAR(48) NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_sandbox_pricing BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS agent_referral_code VARCHAR(48),
  ADD COLUMN IF NOT EXISTS update_history JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_esim_orders_user_idempotency
  ON esim_orders (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Extend kyc_verifications & payments & activations
ALTER TABLE kyc_verifications
  ADD COLUMN IF NOT EXISTS operator_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS verification_mode VARCHAR(48) NOT NULL DEFAULT 'fayda_sandbox_boundary',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS order_type VARCHAR(32) NOT NULL DEFAULT 'esim_order',
  ADD COLUMN IF NOT EXISTS chapa_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS verified_via VARCHAR(32),
  ADD COLUMN IF NOT EXISTS failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE esim_activations
  ADD COLUMN IF NOT EXISTS device_model VARCHAR(160),
  ADD COLUMN IF NOT EXISTS eid VARCHAR(64),
  ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS installed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

-- Webhook deduplication ledger (prevents replay across server restarts)
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id VARCHAR(190) PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  tx_ref VARCHAR(120) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  event_status VARCHAR(48) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Business Customer Accounts & Bulk eSIM Preparation Foundation
CREATE TABLE IF NOT EXISTS business_accounts (
  id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(128) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  company_name VARCHAR(200) NOT NULL,
  tin_number VARCHAR(64) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  city VARCHAR(120) NOT NULL,
  verification_status VARCHAR(32) NOT NULL CHECK (verification_status IN ('pending_review', 'verified', 'suspended')),
  pricing_terms_status VARCHAR(48) NOT NULL DEFAULT 'pending_commercial_agreement' CHECK (
    pricing_terms_status IN ('pending_commercial_agreement', 'approved_custom_terms')
  ),
  commercial_notes TEXT,
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_members (
  id VARCHAR(64) PRIMARY KEY,
  business_id VARCHAR(64) NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('owner', 'buyer', 'viewer')),
  status VARCHAR(24) NOT NULL CHECK (status IN ('active', 'invited', 'revoked')),
  added_by_user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_business_member_email UNIQUE (business_id, email)
);

CREATE TABLE IF NOT EXISTS business_bulk_orders (
  id VARCHAR(64) PRIMARY KEY,
  request_number VARCHAR(64) NOT NULL UNIQUE,
  business_id VARCHAR(64) NOT NULL REFERENCES business_accounts(id) ON DELETE CASCADE,
  requested_by_user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  service_type VARCHAR(32) NOT NULL CHECK (service_type IN ('new_esim_line', 'sim_to_esim_conversion')),
  quantity INTEGER NOT NULL CHECK (quantity >= 2 AND quantity <= 500),
  preferred_tier VARCHAR(32) NOT NULL DEFAULT 'standard',
  department_note TEXT,
  estimated_amount_etb NUMERIC(12, 2),
  pricing_note TEXT NOT NULL,
  status VARCHAR(48) NOT NULL CHECK (
    status IN ('pending_commercial_review', 'quoted_awaiting_approval', 'ready_for_batch_fulfillment', 'cancelled')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Full state snapshot fallback table for seamless runtime parity across migrations
CREATE TABLE IF NOT EXISTS yene_runtime_state (
  id VARCHAR(64) PRIMARY KEY,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tx_ref ON payments (tx_ref);
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments (order_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_items_reserved_until ON esim_stock_items (status, reserved_until) WHERE status = 'reserved';
CREATE INDEX IF NOT EXISTS idx_business_owner ON business_accounts (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_business_bulk_business ON business_bulk_orders (business_id, created_at DESC);
