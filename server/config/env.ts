import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EnvironmentMode } from '../../src/types/domain.ts';
import type { LogLevel } from '../lib/logger.ts';

export interface FirebasePublicConfig {
  projectId: string;
  appId?: string;
  apiKey?: string;
  authDomain?: string;
}

export function loadFirebaseProjectId(): string {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '../../firebase-applet-config.json'),
  ];
  const configPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (configPath) {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as FirebasePublicConfig;
    if (parsed.projectId && parsed.projectId !== 'remixed-project-id') {
      return parsed.projectId;
    }
  }
  const envProjectId = (process.env.FIREBASE_PROJECT_ID ?? '').trim();
  if (envProjectId) {
    return envProjectId;
  }
  throw new Error('firebase-applet-config.json not found in project root.');
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  envMode: EnvironmentMode;
  logLevel: LogLevel;
  adminEmails: Set<string>;
  firebaseProjectId: string;
  esimEncryptionKey: Buffer;
  encryptionKeyPersistent: boolean;
  chapaSecretKey: string | null;
  chapaConfigured: boolean;
  chapaWebhookSecret: string;
  chapaCallbackUrl: string | null;
  faydaConfigured: boolean;
  klickConfigured: boolean;
  ethioTelecomApiUrl: string | null;
  ethioTelecomConfigured: boolean;
  safaricomApiUrl: string | null;
  safaricomConfigured: boolean;
  operatorWebhookSecret: string | null;
  databaseUrl: string | null;
  databaseConfigured: boolean;
  databaseSsl: boolean;
  appUrl: string | null;
  allowedOrigins: string[];
  explicitAllowedOrigins: string[];
  invalidAllowedOrigins: string[];
  paymentExpiryIntervalMs: number;
  paymentTimeoutMinutes: number;
}

export function parseOriginAllowlist(rawOrigins: string): {
  validOrigins: string[];
  invalidOrigins: string[];
} {
  const validOrigins = new Set<string>();
  const invalidOrigins: string[] = [];

  for (const rawItem of rawOrigins.split(',')) {
    const trimmed = rawItem.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.pathname !== '/' && parsed.pathname !== '')
      ) {
        invalidOrigins.push(trimmed);
        continue;
      }
      validOrigins.add(parsed.origin);
    } catch {
      invalidOrigins.push(trimmed);
    }
  }

  return {
    validOrigins: Array.from(validOrigins),
    invalidOrigins,
  };
}

function resolveEncryptionKey(env: NodeJS.ProcessEnv = process.env): {
  key: Buffer;
  persistent: boolean;
} {
  const raw = (env.ESIM_ENCRYPTION_KEY ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return { key: Buffer.from(raw, 'hex'), persistent: true };
  }
  if (raw.length >= 32) {
    return { key: crypto.createHash('sha256').update(raw).digest(), persistent: true };
  }
  return { key: crypto.randomBytes(32), persistent: false };
}

const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32);

export function getServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawAdmins = env.YENE_ADMIN_EMAILS ?? env.YEGNA_ADMIN_EMAILS ?? '';
  const adminEmails = new Set(
    rawAdmins
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );

  const rawMode = (env.YENE_ENV_MODE ?? 'sandbox').trim();
  const envMode: EnvironmentMode =
    rawMode === 'local_dev' ||
    rawMode === 'demo' ||
    rawMode === 'sandbox' ||
    rawMode === 'production'
      ? rawMode
      : 'sandbox';

  const rawLogLevel = (env.LOG_LEVEL ?? 'info').trim().toLowerCase();
  const logLevel: LogLevel =
    rawLogLevel === 'debug' ||
    rawLogLevel === 'info' ||
    rawLogLevel === 'warn' ||
    rawLogLevel === 'error'
      ? rawLogLevel
      : 'info';

  const resolvedKey =
    env === process.env
      ? (() => {
          const parsed = resolveEncryptionKey(env);
          return parsed.persistent
            ? parsed
            : { key: EPHEMERAL_FALLBACK_KEY, persistent: false };
        })()
      : resolveEncryptionKey(env);

  const chapaSecret = (env.CHAPA_SECRET_KEY ?? '').trim();
  const chapaWebhookSecret = (env.CHAPA_WEBHOOK_SECRET ?? '').trim();
  const chapaCallbackUrl = (env.CHAPA_CALLBACK_URL ?? '').trim() || null;
  const faydaId = (env.FAYDA_RELYING_PARTY_ID ?? '').trim();
  const klickKey = (env.KLICK_API_KEY ?? '').trim();
  const ethioUrl = (env.ETHIO_TELECOM_API_URL ?? '').trim();
  const ethioKey = (env.ETHIO_TELECOM_API_KEY ?? '').trim();
  const safariUrl = (env.SAFARICOM_API_URL ?? '').trim();
  const safariKey = (env.SAFARICOM_API_KEY ?? '').trim();
  const operatorWebhookSecret = (env.OPERATOR_WEBHOOK_SECRET ?? '').trim();
  const dbUrl = (env.DATABASE_URL ?? '').trim();
  const databaseSsl =
    (env.DATABASE_SSL ?? '').trim().toLowerCase() === 'true' ||
    dbUrl.includes('sslmode=require');

  const appUrlRaw = (env.APP_URL ?? '').trim();
  const appUrl = appUrlRaw && appUrlRaw !== 'MY_APP_URL' ? appUrlRaw : null;

  const rawOrigins = (env.ALLOWED_ORIGINS ?? '').trim();
  const { validOrigins: explicitAllowedOrigins, invalidOrigins: invalidAllowedOrigins } =
    parseOriginAllowlist(rawOrigins);

  const appOriginSet = new Set<string>(explicitAllowedOrigins);
  if (appUrl) {
    const parsedApp = parseOriginAllowlist(appUrl);
    for (const o of parsedApp.validOrigins) {
      appOriginSet.add(o);
    }
  }

  const parsedInterval = Number(env.PAYMENT_EXPIRY_INTERVAL_MS ?? 60_000);
  const paymentExpiryIntervalMs =
    Number.isFinite(parsedInterval) && parsedInterval >= 5_000 ? parsedInterval : 60_000;

  const parsedTimeout = Number(env.PAYMENT_TIMEOUT_MINUTES ?? 30);
  const paymentTimeoutMinutes =
    Number.isFinite(parsedTimeout) && parsedTimeout >= 1 ? parsedTimeout : 30;

  return {
    port: Number(env.PORT ?? 3000),
    nodeEnv: env.NODE_ENV ?? 'development',
    envMode,
    logLevel,
    adminEmails,
    firebaseProjectId: loadFirebaseProjectId(),
    esimEncryptionKey: resolvedKey.key,
    encryptionKeyPersistent: resolvedKey.persistent,
    chapaSecretKey: chapaSecret || null,
    chapaConfigured: chapaSecret.length > 0,
    chapaWebhookSecret,
    chapaCallbackUrl,
    faydaConfigured: faydaId.length > 0,
    klickConfigured: klickKey.length > 0,
    ethioTelecomApiUrl: ethioUrl || null,
    ethioTelecomConfigured: Boolean(ethioUrl && ethioKey),
    safaricomApiUrl: safariUrl || null,
    safaricomConfigured: Boolean(safariUrl && safariKey),
    operatorWebhookSecret: operatorWebhookSecret || null,
    databaseUrl: dbUrl || null,
    databaseConfigured: dbUrl.length > 0,
    databaseSsl,
    appUrl,
    allowedOrigins: Array.from(appOriginSet),
    explicitAllowedOrigins,
    invalidAllowedOrigins,
    paymentExpiryIntervalMs,
    paymentTimeoutMinutes,
  };
}

export function validateProductionConfig(config: ServerConfig): string[] {
  const issues: string[] = [];
  if (config.envMode !== 'production') {
    return issues;
  }

  if (!config.databaseConfigured || !config.databaseUrl) {
    issues.push('DATABASE_URL must be configured in production (in-memory store is disabled).');
  }
  if (!config.encryptionKeyPersistent) {
    issues.push(
      'ESIM_ENCRYPTION_KEY (64-char hex or >=32-char secret) is required in production so QR credentials remain decryptable across restarts.',
    );
  }
  if (!config.chapaConfigured) {
    issues.push('CHAPA_SECRET_KEY is required in production.');
  }
  if (!config.chapaWebhookSecret) {
    issues.push('CHAPA_WEBHOOK_SECRET is required in production to verify Chapa webhooks.');
  }
  if (config.adminEmails.size === 0) {
    issues.push('YENE_ADMIN_EMAILS must contain at least one verified Staff Super Admin email.');
  }
  if (config.explicitAllowedOrigins.length === 0) {
    issues.push(
      'ALLOWED_ORIGINS must contain at least one valid origin (e.g. https://yenetele.et) in production.',
    );
  } else if (config.invalidAllowedOrigins.length > 0) {
    issues.push(
      `ALLOWED_ORIGINS contains invalid origin(s): ${config.invalidAllowedOrigins.join(', ')}. Use exact http(s) origins without paths.`,
    );
  }

  return issues;
}

export function assertProductionConfigValid(config: ServerConfig): void {
  const issues = validateProductionConfig(config);
  if (issues.length > 0) {
    throw new Error(
      `Production startup aborted — missing or invalid configuration:\n- ${issues.join('\n- ')}`,
    );
  }
}
