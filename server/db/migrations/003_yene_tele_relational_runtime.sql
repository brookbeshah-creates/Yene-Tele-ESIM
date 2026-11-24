-- ============================================================================
-- YENE TELE (የእኔ ቴሌኮም) — POSTGRESQL RELATIONAL RUNTIME MIGRATION (003)
-- Closes schema gaps so PostgreSQL relational tables act as the true runtime
-- source of truth across restarts and multiple instances without yene_runtime_state.
-- ============================================================================

-- Pre-provisioned staff invites (avoids FK failure before invited user signs in)
CREATE TABLE IF NOT EXISTS staff_admin_invites (
  email VARCHAR(255) PRIMARY KEY,
  display_name VARCHAR(160),
  role VARCHAR(64) NOT NULL CHECK (
    role IN ('super_admin', 'operations_staff', 'finance_staff', 'support_staff', 'agent_supervisor', 'read_only_auditor')
  ),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  granted_by VARCHAR(128),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow operators integration_mode to store 'coming_soon' and 'live'
ALTER TABLE operators
  DROP CONSTRAINT IF EXISTS operators_integration_mode_check;
ALTER TABLE operators
  ADD CONSTRAINT operators_integration_mode_check CHECK (
    integration_mode IN ('not_configured', 'demo', 'sandbox', 'coming_soon', 'stock_based', 'direct_api', 'manual_processing', 'live', 'production')
  );

-- Align esim_products with runtime fields
ALTER TABLE esim_products
  ADD COLUMN IF NOT EXISTS requires_fayda_kyc BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Align esim_stock_batches & esim_stock_items
ALTER TABLE esim_stock_batches
  ADD COLUMN IF NOT EXISTS batch_name VARCHAR(200);
UPDATE esim_stock_batches SET batch_name = batch_code WHERE batch_name IS NULL;

ALTER TABLE esim_stock_items
  ALTER COLUMN msisdn DROP NOT NULL;

-- Order pricing currency snapshot + multi-instance active MSISDN uniqueness
ALTER TABLE esim_orders
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'ETB',
  ADD COLUMN IF NOT EXISTS pricing_snapshot_note TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_order_msisdn
  ON esim_orders (operator_code, selected_msisdn)
  WHERE selected_msisdn IS NOT NULL
    AND status NOT IN ('cancelled', 'expired', 'failed', 'refunded');

-- Align kyc_verifications status constraint with KycStatus
ALTER TABLE kyc_verifications
  DROP CONSTRAINT IF EXISTS kyc_verifications_status_check;
ALTER TABLE kyc_verifications
  ADD CONSTRAINT kyc_verifications_status_check CHECK (
    status IN ('not_started', 'pending', 'verified', 'verified_sandbox', 'verified_live', 'failed')
  );
ALTER TABLE kyc_verifications
  ADD COLUMN IF NOT EXISTS consent_given BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Payments: currency, checkout URL, refund reference tracking, single verified payment per order
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8) NOT NULL DEFAULT 'ETB',
  ADD COLUMN IF NOT EXISTS checkout_url TEXT,
  ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS refund_status_checked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_verified_payment
  ON payments (order_id)
  WHERE status IN ('verified', 'refund_pending', 'refunded');

-- Align agent_applications, agents, agent_commissions, agent_payouts
ALTER TABLE agent_applications
  ALTER COLUMN business_or_individual SET DEFAULT 'individual',
  ALTER COLUMN document_reference SET DEFAULT '';
ALTER TABLE agent_applications
  ADD COLUMN IF NOT EXISTS business_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS applicant_type VARCHAR(48) NOT NULL DEFAULT 'individual_agent',
  ADD COLUMN IF NOT EXISTS experience_summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_notes TEXT;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS application_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ethio_telecom_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS safaricom_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_attributed_orders INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_earned_commission_etb NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid_out_etb NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE agent_commissions
  DROP CONSTRAINT IF EXISTS agent_commissions_status_check;
ALTER TABLE agent_commissions
  ADD CONSTRAINT agent_commissions_status_check CHECK (
    status IN ('pending_commercial_terms', 'pending_commercial_schedule', 'eligible', 'payable', 'paid', 'voided')
  );
ALTER TABLE agent_commissions
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pricing_status VARCHAR(48) NOT NULL DEFAULT 'pending_commercial_rate';

ALTER TABLE agent_payouts
  DROP CONSTRAINT IF EXISTS agent_payouts_status_check;
ALTER TABLE agent_payouts
  ADD CONSTRAINT agent_payouts_status_check CHECK (
    status IN ('pending', 'processed', 'scheduled', 'paid')
  );

-- Align phone_products, phone_orders & support_tickets
ALTER TABLE phone_products
  ADD COLUMN IF NOT EXISTS condition VARCHAR(120) NOT NULL DEFAULT 'Brand New · Sealed',
  ADD COLUMN IF NOT EXISTS esim_capable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sandbox_preview_price_etb NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS pricing_status VARCHAR(48) NOT NULL DEFAULT 'pending_commercial_quote',
  ADD COLUMN IF NOT EXISTS bulk_minimum_qty INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE phone_orders
  DROP CONSTRAINT IF EXISTS phone_orders_delivery_status_check;
ALTER TABLE phone_orders
  ADD CONSTRAINT phone_orders_delivery_status_check CHECK (
    delivery_status IN ('awaiting_confirmation', 'dispatched_via_klick', 'pending_confirmation', 'awaiting_klick_dispatch', 'delivered', 'cancelled')
  );
ALTER TABLE phone_orders
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS phone_model VARCHAR(160),
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS delivery_city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS estimated_total_etb NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_sandbox_estimate BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS klick_delivery_partner_status VARCHAR(64) NOT NULL DEFAULT 'klick_boundary_pending_onboarding',
  ADD COLUMN IF NOT EXISTS attributed_agent_id VARCHAR(64);

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS category VARCHAR(48) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS admin_response TEXT;

-- Automated scheduled jobs history & observability ledger
CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  id VARCHAR(64) PRIMARY KEY,
  job_name VARCHAR(64) NOT NULL,
  instance_id VARCHAR(120) NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  details JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_job_runs_name_started
  ON scheduled_job_runs (job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_expiry_scan
  ON payments (status, created_at)
  WHERE status = 'initialized';
