-- ============================================================================
-- YENE TELE (የእኔ ቴሌኮም) — PHONE MARKETPLACE ENRICHMENT MIGRATION (004)
-- Adds curated eSIM compatibility metadata, model numbers, warranty,
-- network-unlocked status, product photography keys, and phone order
-- delivery contact + Chapa payment tracking fields.
-- ============================================================================

ALTER TABLE phone_products
  ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS exact_model_number VARCHAR(64) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS regional_variant VARCHAR(120) NOT NULL DEFAULT 'Global Variant',
  ADD COLUMN IF NOT EXISTS warranty_summary VARCHAR(160) NOT NULL DEFAULT 'Standard Seller Warranty',
  ADD COLUMN IF NOT EXISTS esim_compatibility_status VARCHAR(32) NOT NULL DEFAULT 'needs_verification',
  ADD COLUMN IF NOT EXISTS network_unlock_status VARCHAR(32) NOT NULL DEFAULT 'needs_verification',
  ADD COLUMN IF NOT EXISTS ethio_telecom_compatibility VARCHAR(32) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS safaricom_compatibility VARCHAR(32) NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS compatibility_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS compatibility_evidence TEXT,
  ADD COLUMN IF NOT EXISTS image_key VARCHAR(64),
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE phone_products
  DROP CONSTRAINT IF EXISTS phone_products_esim_compat_check;
ALTER TABLE phone_products
  ADD CONSTRAINT phone_products_esim_compat_check CHECK (
    esim_compatibility_status IN ('verified_compatible', 'not_compatible', 'needs_verification')
  );

ALTER TABLE phone_products
  DROP CONSTRAINT IF EXISTS phone_products_unlock_check;
ALTER TABLE phone_products
  ADD CONSTRAINT phone_products_unlock_check CHECK (
    network_unlock_status IN ('verified_unlocked', 'carrier_locked', 'needs_verification')
  );

ALTER TABLE phone_orders
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS paired_esim_operator VARCHAR(48),
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120),
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;
