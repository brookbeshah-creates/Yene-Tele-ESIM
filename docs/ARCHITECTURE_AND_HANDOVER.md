# Yene Tele (የእኔ ቴሌኮም) — Architecture, Production Readiness & Operational Handover

**Project:** Yene Tele (`0c4e4817-516c-4091-aa09-ecfc14df62db`)  
**Scope:** Ethiopia-focused eSIM Reseller & Management Platform (Primary) + Secondary Phone Marketplace & Klick Boundary  
**Environment Boundary:** Verified locally against in-memory and mocked relational PostgreSQL test pools plus mocked Chapa HTTP responses. Real PostgreSQL engine verification requires `DATABASE_URL` / `TEST_DATABASE_URL`, and live partner integrations (Chapa merchant keys, Ethio telecom, Safaricom Ethiopia, Fayda Relying Party, Klick courier) require commercial onboarding before production launch.

---

## 1. Platform Architecture Overview

| Layer | Technology & Key Modules | Responsibility |
| :--- | :--- | :--- |
| **Frontend SPA** | React 19, Vite, TypeScript, Tailwind CSS (`src/`) | Public storefront, minimal mobile web app workspace, 6-step eSIM Checkout (`/buy-esim`), Customer eSIM Portal (`/app`, `/app/business`), Agent Portal (`/agent`), Staff Admin Portal (`/admin`). |
| **Authentication** | Firebase Auth (`firebase` client + `firebase-admin` server verifier) | Email/password, Google sign-in, password reset, strict Bearer ID token verification on every authenticated API route (`server/modules/auth/firebaseVerifier.ts`). |
| **API & Domain Server** | Express (`server.ts`, `server/app.ts`, `server/modules/*`) | Async customer, agent, and staff admin routers, RBAC guards, rate limiting, strict production CORS allowlist, structured PII/secret-redacting JSON logs, `/api/health`, `/api/ready`, observability counters, and `503 DATABASE_UNAVAILABLE` handling. |
| **Domain & Adapters** | `YeneTeleStore`, `operatorAdapter.ts`, `chapaAdapter.ts`, `faydaAdapter.ts`, `esimVault.ts`, `PaymentExpiryScheduler` | Operator-aware supply (`stock_based`, `manual_processing` fallback, `direct_api`), strict production ETB pricing, AES-256-GCM activation vault, Chapa v1/v2 checkout/verify/refund + HMAC webhooks, automated expiry scheduler, CSV formula sanitization. |
| **PostgreSQL Persistence** | `pg` Pool, `server/db/pool.ts`, `server/db/migrate.ts`, `server/db/postgresRepository.ts`, `migrations/001–003` | Normalized relational tables as sole source of truth (`FOR UPDATE SKIP LOCKED` atomic stock locking, `processed_webhook_events` DB deduplication, `pg_try_advisory_xact_lock` multi-instance scheduler coordination, parameterized SQL). Zero `yene_runtime_state` JSONB dependency in runtime. |

---

## 2. Database & Migration Architecture (Normalized Relational PostgreSQL)

- **Migration Runner:** `npm run db:migrate` (`server/db/migrate.ts`) executes `001_yene_tele_core.sql`, `002_yene_tele_production_hardening.sql`, and `003_yene_tele_relational_runtime.sql` transactionally and records applied versions in `schema_migrations`.
- **Fail-Closed Production Rule:** When `YENE_ENV_MODE=production`, `server.ts` calls `assertProductionConfigValid(config)` and aborts startup unless `DATABASE_URL` connects and schema verification passes, and unless `ESIM_ENCRYPTION_KEY`, `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, `YENE_ADMIN_EMAILS`, and valid `ALLOWED_ORIGINS` are configured.
- **Database Unavailability Handling:** Runtime DB connection/pool errors throw `DatabaseConnectionError`, increment `ObservabilityTracker` database failure counters, and return HTTP `503 DATABASE_UNAVAILABLE` rather than silently falling back or issuing false `401`/`500` failures.
- **24 Normalized Runtime Tables:** `users`, `staff_admins`, `staff_admin_invites`, `operators`, `esim_products`, `esim_stock_batches`, `esim_stock_items` (`uq_active_msisdn_stock`), `esim_orders` (`uq_active_order_msisdn`), `kyc_verifications`, `payments` (`uq_order_verified_payment`), `processed_webhook_events`, `esim_activations`, `agent_applications`, `agents`, `agent_commissions`, `agent_payouts`, `phone_products`, `phone_orders`, `support_tickets`, `business_accounts`, `business_members`, `business_bulk_orders`, `audit_logs`, `scheduled_job_runs`.

---

## 3. Production Security, CORS & Strict Commercial Pricing

- **Strict CORS & `ALLOWED_ORIGINS`:** `parseOriginAllowlist()` validates exact `http(s)` origins (no wildcards/paths/credentials). Missing `ALLOWED_ORIGINS` or malformed entries block startup in `production`. Unapproved or malformed `Origin` headers on `/api/*` are logged (`cors_origin_blocked`) and rejected with HTTP `403 CORS_FORBIDDEN`; requests without `Origin` (server-to-server Chapa webhooks, CLI/health probes) are permitted.
- **Strict Production Pricing:** In `production`, eSIM and secondary phone orders require an admin-configured official `priceEtb > 0` (`unitPriceEtb > 0`). Products with `null`, missing, or `<= 0` price are rejected with `409 PRODUCTION_PRICE_NOT_CONFIGURED` / `409 PRODUCTION_PHONE_PRICE_NOT_CONFIGURED`. Public production catalogs omit `sandboxPreviewAmountEtb` / `sandboxPreviewPriceEtb`. Every price change logs `[priceEtb: prev -> next ETB]` in `audit_logs`, and orders persist `amountEtb`, `currency: 'ETB'`, and `pricingSnapshotNote`.
- **Automated Payment & Reservation Expiry Job:** `PaymentExpiryScheduler` (`server/modules/jobs/paymentExpiryJob.ts`) runs on `PAYMENT_EXPIRY_INTERVAL_MS` (default `60000` ms) using `pg_try_advisory_xact_lock(88421001)` so only one instance executes the sweep per interval across multi-instance deployments, recording execution history in `scheduled_job_runs` and surfacing status via `/api/v1/admin/jobs/payment-expiry` and manual trigger `POST /api/v1/admin/jobs/payment-expiry/run`.

---

## 4. Chapa Live Payment & Refund Lifecycle

- **Checkout Initialization (`POST /v1/transaction/initialize`):** Sends customer `amount`, `currency: 'ETB'`, `tx_ref`, `callback_url` (`CHAPA_CALLBACK_URL`), and `return_url` to Chapa; persists `checkoutUrl` and `initialized` status.
- **Webhook (`POST /api/v1/payments/chapa/webhook`) & Server Verification (`GET /v1/transaction/verify/{tx_ref}`):** Verifies raw-body HMAC-SHA256 signature (`X-Chapa-Signature` / `Chapa-Signature`), verifies transaction status server-side against `tx_ref`, `currency === 'ETB'`, and exact `amount`, and deduplicates via `processed_webhook_events` + `inFlightPaymentVerifications` single-flight guard. Network timeouts or 5xx responses leave verification in an `uncertain` state without releasing reserved stock or wrongly failing a settled payment.
- **Refunds (`POST /v1/refund/{tx_ref}` & `GET https://api.chapa.global/v2/refunds/{refundReference}/verify`):** Submits URL-encoded `reason` + `Idempotency-Key` header guarded by `inFlightRefunds` single-flight lock and transactional status check (`beginRefundTx` / `completeRefundTx`). Finance staff can reconcile in-flight refunds via `/api/v1/admin/payments/:paymentId/reconcile`.

---

## 5. Firebase Hosting & GCP Workload Identity Setup

1. **Client SPA Hosting:** `firebase-applet-config.json` contains only non-secret public web identifiers (`projectId`, `apiKey`, `authDomain`, `appId`) used by the browser Firebase Auth SDK (`src/lib/firebase.ts`). Never place Firebase Admin service account JSON files or backend secrets in `src/` or `VITE_*` variables.
2. **Backend Token Verification (`firebase-admin`):** `server/modules/auth/firebaseVerifier.ts` initializes `firebase-admin` using Application Default Credentials (ADC) scoped to `firebaseProjectId`.
   - **On Google Cloud Run / GKE / App Engine:** Attach a dedicated GCP IAM Service Account to the runtime with **Workload Identity** (minimal `Firebase Authentication Viewer` / token verification permissions) — no static JSON key file is needed.
   - **On Non-GCP Hosts (Fly.io, Railway, Render, VM):** Store a dedicated service account JSON strictly on the server via secret manager mount and set `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-admin-sa.json`.
   - **Role Isolation:** Firebase Auth proves user identity only (`uid`, `email`, `emailVerified`). Staff admin roles (`staff_admins`), approved agents (`agents`), and customer suspensions (`users.account_status`) are enforced authoritatively in backend PostgreSQL tables.

---

## 6. Key Management, Backup & Go-Live Checklist

- [ ] Provision managed PostgreSQL 15+ with TLS (`DATABASE_SSL=true`) and set `DATABASE_URL`.
- [ ] Run `npm run db:migrate` and confirm `GET /api/ready` returns HTTP `200 ready`.
- [ ] Set `YENE_ENV_MODE=production`, `ALLOWED_ORIGINS`, `APP_URL`, `YENE_ADMIN_EMAILS`, and persistent 64-hex `ESIM_ENCRYPTION_KEY`.
- [ ] Configure `CHAPA_SECRET_KEY`, `CHAPA_WEBHOOK_SECRET`, and `CHAPA_CALLBACK_URL`.
- [ ] Configure Google Cloud Workload Identity or `GOOGLE_APPLICATION_CREDENTIALS` for `firebase-admin`.
- [ ] Configure approved commercial `priceEtb` values via `/admin/operators` and load real `operator_partner_batch` inventory (or configure Manual Partner Processing fallback).
- [ ] Execute `npm run test:pg` against staging PostgreSQL before production traffic cutover.
