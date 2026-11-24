-- ============================================================================
-- YENE TELE (የእኔ ቴሌኮም) — POSTGRESQL SCHEMA & INITIAL MIGRATION (001)
-- Status: Schema & migration ready for PostgreSQL provisioning phase.
-- Enforces atomic eSIM inventory uniqueness, order state decoupling,
-- encrypted activation vaulting, agent attribution, and isolated phone module.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  uid VARCHAR(128) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  phone_number VARCHAR(32),
  display_name VARCHAR(160),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff_admins (
  uid VARCHAR(128) PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(64) NOT NULL CHECK (
    role IN ('super_admin', 'operations_staff', 'finance_staff', 'support_staff', 'agent_supervisor', 'read_only_auditor')
  ),
  source VARCHAR(32) NOT NULL CHECK (source IN ('env_allowlist', 'first_run_claim', 'admin_grant')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operators (
  code VARCHAR(64) PRIMARY KEY CHECK (code IN ('ethio_telecom', 'safaricom_ethiopia')),
  display_name VARCHAR(120) NOT NULL,
  amharic_name VARCHAR(120) NOT NULL,
  number_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  supply_method VARCHAR(32) NOT NULL CHECK (supply_method IN ('stock_based', 'direct_api', 'manual_processing')),
  integration_mode VARCHAR(32) NOT NULL CHECK (
    integration_mode IN ('not_configured', 'demo', 'sandbox', 'stock_based', 'direct_api', 'manual_processing', 'production')
  ),
  new_esim_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sim_conversion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  number_selection_mode VARCHAR(32) NOT NULL CHECK (number_selection_mode IN ('stock_pool', 'live_api', 'assigned_by_operator')),
  pricing_model_note TEXT NOT NULL DEFAULT '',
  configured_price_etb NUMERIC(12, 2),
  identity_requirement TEXT NOT NULL DEFAULT '',
  settlement_model VARCHAR(64) NOT NULL DEFAULT 'unassigned',
  live_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS esim_products (
  id VARCHAR(64) PRIMARY KEY,
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  name VARCHAR(160) NOT NULL,
  service_type VARCHAR(32) NOT NULL CHECK (service_type IN ('new_esim', 'sim_conversion')),
  summary TEXT NOT NULL,
  price_etb NUMERIC(12, 2),
  price_label VARCHAR(120) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_device_check BOOLEAN NOT NULL DEFAULT TRUE,
  is_sandbox_catalog BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS esim_stock_batches (
  id VARCHAR(64) PRIMARY KEY,
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  batch_code VARCHAR(120) NOT NULL UNIQUE,
  supply_format VARCHAR(48) NOT NULL CHECK (supply_format IN ('number_allocation', 'activation_voucher', 'profile_identifier', 'other_approved')),
  total_count INTEGER NOT NULL CHECK (total_count >= 0),
  imported_by VARCHAR(255) NOT NULL,
  notes TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS esim_stock_items (
  id VARCHAR(64) PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL REFERENCES esim_stock_batches(id),
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  stock_identifier VARCHAR(160) NOT NULL,
  msisdn VARCHAR(32) NOT NULL,
  tier VARCHAR(32) NOT NULL DEFAULT 'Standard',
  supply_format VARCHAR(48) NOT NULL,
  encrypted_credential_payload TEXT,
  status VARCHAR(32) NOT NULL CHECK (status IN ('imported', 'available', 'reserved', 'assigned', 'sold', 'expired', 'invalid', 'reconciliation_required')),
  reserved_by_order_id VARCHAR(64),
  reserved_until TIMESTAMPTZ,
  assigned_to_order_id VARCHAR(64),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_operator_stock_identifier UNIQUE (operator_code, stock_identifier)
);

-- Prevent duplicate active assignments or concurrent reservations of the same phone number per operator
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_msisdn_stock
  ON esim_stock_items (operator_code, msisdn)
  WHERE status IN ('reserved', 'assigned', 'sold');

CREATE TABLE IF NOT EXISTS agent_applications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  applicant_name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  business_or_individual VARCHAR(32) NOT NULL CHECK (business_or_individual IN ('individual', 'registered_business')),
  city_region VARCHAR(120) NOT NULL,
  document_reference TEXT NOT NULL,
  experience_note TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected', 'suspended')),
  operator_authorization_status VARCHAR(48) NOT NULL DEFAULT 'pending',
  reviewed_by VARCHAR(128),
  review_note TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL UNIQUE REFERENCES users(uid),
  display_name VARCHAR(160) NOT NULL,
  referral_code VARCHAR(48) NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL CHECK (status IN ('approved', 'suspended')),
  operator_authorization_status VARCHAR(48) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS esim_orders (
  id VARCHAR(64) PRIMARY KEY,
  order_number VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  product_id VARCHAR(64) NOT NULL REFERENCES esim_products(id),
  service_type VARCHAR(32) NOT NULL CHECK (service_type IN ('new_esim', 'sim_conversion')),
  selected_msisdn VARCHAR(32),
  device_model VARCHAR(160) NOT NULL,
  device_esim_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  subscriber_full_name VARCHAR(160) NOT NULL,
  subscriber_contact_phone VARCHAR(32) NOT NULL,
  payer_differs_from_subscriber BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(40) NOT NULL CHECK (
    status IN (
      'draft', 'awaiting_identity_verification', 'identity_pending', 'identity_verified',
      'number_reserved', 'awaiting_payment', 'payment_verified', 'provisioning_in_progress',
      'stock_reserved', 'submitted_to_operator', 'operator_pending', 'awaiting_manual_fulfillment',
      'provisioned', 'delivered', 'ready_for_installation', 'installed', 'activated',
      'failed', 'expired', 'cancelled', 'refund_pending', 'refunded'
    )
  ),
  identity_status VARCHAR(32) NOT NULL DEFAULT 'unverified',
  payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  amount_etb NUMERIC(12, 2),
  fulfillment_method VARCHAR(32) NOT NULL,
  stock_item_id VARCHAR(64) REFERENCES esim_stock_items(id),
  operator_order_ref VARCHAR(160),
  attributed_agent_id VARCHAR(64) REFERENCES agents(id),
  failure_reason TEXT,
  is_sandbox_order BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kyc_verifications (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES esim_orders(id),
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  provider VARCHAR(48) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'verified', 'failed')),
  verification_reference VARCHAR(160),
  consent_recorded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES esim_orders(id),
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  provider VARCHAR(32) NOT NULL DEFAULT 'chapa',
  tx_ref VARCHAR(120) NOT NULL UNIQUE,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  amount_etb NUMERIC(12, 2),
  status VARCHAR(32) NOT NULL CHECK (
    status IN ('pending', 'initialized', 'verified', 'failed', 'cancelled', 'reversal_pending', 'reversed', 'refund_pending', 'refunded')
  ),
  mode VARCHAR(24) NOT NULL CHECK (mode IN ('sandbox', 'production')),
  webhook_event_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS esim_activations (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL UNIQUE REFERENCES esim_orders(id),
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  msisdn VARCHAR(32) NOT NULL,
  iccid_masked VARCHAR(64) NOT NULL,
  encrypted_activation_payload TEXT NOT NULL,
  activation_status VARCHAR(32) NOT NULL CHECK (activation_status IN ('ready_to_install', 'ready_for_installation', 'installed', 'active', 'activated', 'revoked')),
  fulfillment_method VARCHAR(32) NOT NULL,
  is_sandbox_profile BOOLEAN NOT NULL DEFAULT TRUE,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_commissions (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
  order_id VARCHAR(64) NOT NULL UNIQUE REFERENCES esim_orders(id),
  operator_code VARCHAR(64) NOT NULL REFERENCES operators(code),
  commission_amount_etb NUMERIC(12, 2),
  commercial_term_note TEXT NOT NULL,
  status VARCHAR(40) NOT NULL CHECK (status IN ('pending_commercial_terms', 'eligible', 'paid', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_payouts (
  id VARCHAR(64) PRIMARY KEY,
  agent_id VARCHAR(64) NOT NULL REFERENCES agents(id),
  amount_etb NUMERIC(12, 2),
  reference VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'processed')),
  note TEXT NOT NULL DEFAULT '',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Secondary Phone Marketplace Module (Strictly Separate from eSIM Inventory)
CREATE TABLE IF NOT EXISTS phone_products (
  id VARCHAR(64) PRIMARY KEY,
  brand VARCHAR(80) NOT NULL,
  model VARCHAR(120) NOT NULL,
  storage VARCHAR(48) NOT NULL,
  esim_ready BOOLEAN NOT NULL DEFAULT TRUE,
  price_etb NUMERIC(12, 2),
  price_label VARCHAR(120) NOT NULL,
  stock_count INTEGER NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
  bulk_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  specs TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS phone_orders (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL REFERENCES users(uid),
  product_id VARCHAR(64) NOT NULL REFERENCES phone_products(id),
  order_kind VARCHAR(32) NOT NULL CHECK (order_kind IN ('individual', 'bulk_business')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  delivery_address_note TEXT NOT NULL,
  delivery_partner VARCHAR(64) NOT NULL DEFAULT 'klick_pending_agreement',
  delivery_status VARCHAR(48) NOT NULL CHECK (delivery_status IN ('pending_confirmation', 'awaiting_klick_dispatch', 'delivered', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(128) REFERENCES users(uid),
  contact_email VARCHAR(255) NOT NULL,
  related_order_id VARCHAR(64),
  subject VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_type VARCHAR(24) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  actor_email VARCHAR(255),
  action VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esim_orders_user_created ON esim_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esim_orders_status ON esim_orders (status);
CREATE INDEX IF NOT EXISTS idx_esim_stock_operator_status ON esim_stock_items (operator_code, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
