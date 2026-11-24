import crypto from 'node:crypto';
import type { KycVerificationRecord, OperatorCode } from '../../../src/types/domain.ts';

export interface FaydaConsentInput {
  orderId: string;
  userId: string;
  operatorCode: OperatorCode;
  fullName: string;
  faydaFanReference: string;
  contactPhone: string;
  consentGiven: boolean;
  actorUserId: string;
}

export interface FaydaConsentResult {
  verified: boolean;
  verificationRecord: KycVerificationRecord;
  errorCode: string | null;
  errorMessage: string | null;
}

function maskFaydaFan(fan: string): string {
  const trimmed = fan.trim();
  if (trimmed.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export class FaydaIdentityAdapter {
  private readonly liveConfigured: boolean;

  constructor(liveConfigured = false) {
    this.liveConfigured = liveConfigured;
  }

  public verifySubscriberConsent(input: FaydaConsentInput): FaydaConsentResult {
    const now = new Date().toISOString();
    const cleanedRef = input.faydaFanReference.trim();

    if (input.actorUserId !== input.userId) {
      return {
        verified: false,
        verificationRecord: {
          id: `kyc-${crypto.randomUUID().slice(0, 12)}`,
          orderId: input.orderId,
          userId: input.userId,
          operatorCode: input.operatorCode,
          fullName: input.fullName.trim() || 'Unknown',
          faydaFanMasked: maskFaydaFan(cleanedRef),
          contactPhone: input.contactPhone.trim(),
          consentGiven: false,
          verificationMode: this.liveConfigured ? 'fayda_official' : 'fayda_sandbox_boundary',
          status: 'failed',
          failureReason: 'Subscriber self-consent required; proxy/agent submission rejected.',
          verifiedAt: now,
        },
        errorCode: 'KYC_SELF_CONSENT_REQUIRED',
        errorMessage: 'Subscribers must submit Fayda identity consent personally.',
      };
    }

    if (!input.consentGiven) {
      return {
        verified: false,
        verificationRecord: {
          id: `kyc-${crypto.randomUUID().slice(0, 12)}`,
          orderId: input.orderId,
          userId: input.userId,
          operatorCode: input.operatorCode,
          fullName: input.fullName.trim() || 'Unknown',
          faydaFanMasked: maskFaydaFan(cleanedRef),
          contactPhone: input.contactPhone.trim(),
          consentGiven: false,
          verificationMode: this.liveConfigured ? 'fayda_official' : 'fayda_sandbox_boundary',
          status: 'failed',
          failureReason: 'Explicit subscriber consent checkbox was not accepted.',
          verifiedAt: now,
        },
        errorCode: 'CONSENT_REQUIRED',
        errorMessage: 'Explicit subscriber consent is required prior to Fayda KYC verification.',
      };
    }

    if (!input.fullName.trim()) {
      return {
        verified: false,
        verificationRecord: {
          id: `kyc-${crypto.randomUUID().slice(0, 12)}`,
          orderId: input.orderId,
          userId: input.userId,
          operatorCode: input.operatorCode,
          fullName: '',
          faydaFanMasked: maskFaydaFan(cleanedRef),
          contactPhone: input.contactPhone.trim(),
          consentGiven: true,
          verificationMode: this.liveConfigured ? 'fayda_official' : 'fayda_sandbox_boundary',
          status: 'failed',
          failureReason: 'Missing subscriber full legal name.',
          verifiedAt: now,
        },
        errorCode: 'FULL_NAME_REQUIRED',
        errorMessage: 'Subscriber full legal name is required.',
      };
    }

    if (cleanedRef.length < 4 || cleanedRef.length > 32 || !/^[A-Za-z0-9-]+$/.test(cleanedRef)) {
      return {
        verified: false,
        verificationRecord: {
          id: `kyc-${crypto.randomUUID().slice(0, 12)}`,
          orderId: input.orderId,
          userId: input.userId,
          operatorCode: input.operatorCode,
          fullName: input.fullName.trim(),
          faydaFanMasked: maskFaydaFan(cleanedRef),
          contactPhone: input.contactPhone.trim(),
          consentGiven: true,
          verificationMode: this.liveConfigured ? 'fayda_official' : 'fayda_sandbox_boundary',
          status: 'failed',
          failureReason: 'Invalid Fayda FAN reference format.',
          verifiedAt: now,
        },
        errorCode: 'INVALID_FAYDA_REFERENCE',
        errorMessage: 'Provide a valid alphanumeric Fayda FAN reference (4–32 characters).',
      };
    }

    const record: KycVerificationRecord = {
      id: `kyc-${crypto.randomUUID().slice(0, 12)}`,
      orderId: input.orderId,
      userId: input.userId,
      operatorCode: input.operatorCode,
      fullName: input.fullName.trim(),
      faydaFanMasked: maskFaydaFan(cleanedRef),
      contactPhone: input.contactPhone.trim(),
      consentGiven: true,
      verificationMode: this.liveConfigured ? 'fayda_official' : 'fayda_sandbox_boundary',
      status: this.liveConfigured ? 'verified_live' : 'verified_sandbox',
      failureReason: null,
      verifiedAt: now,
    };

    return {
      verified: true,
      verificationRecord: record,
      errorCode: null,
      errorMessage: null,
    };
  }
}
