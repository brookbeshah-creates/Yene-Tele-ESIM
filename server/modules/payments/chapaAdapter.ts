import crypto from 'node:crypto';
import type { PaymentRecord } from '../../../src/types/domain.ts';

export class ChapaGatewayError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ChapaAdapterOptions {
  allowSandbox?: boolean;
  appUrl?: string | null;
  callbackUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function toLocalTenDigitPhone(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 10 && (digits.startsWith('09') || digits.startsWith('07'))) {
    return digits;
  }
  return undefined;
}

function splitName(fullName?: string | null): { firstName?: string; lastName?: string } {
  const clean = fullName?.trim();
  if (!clean) return {};
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function resolveAbsoluteUrl(returnUrl: string, appUrl: string | null): string | undefined {
  const trimmed = returnUrl.trim();
  if (!trimmed) return undefined;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).toString();
    }
    if (appUrl && /^https?:\/\//i.test(appUrl)) {
      return new URL(trimmed, appUrl).toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export class ChapaPaymentAdapter {
  private readonly secretKey: string | null;
  private readonly webhookSecret: string | null;
  private readonly liveConfigured: boolean;
  private readonly allowSandbox: boolean;
  private readonly appUrl: string | null;
  private readonly callbackUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    secretKey: string | null = null,
    webhookSecret: string | null = null,
    options?: ChapaAdapterOptions,
  ) {
    this.secretKey = secretKey;
    this.webhookSecret = webhookSecret;
    this.liveConfigured = Boolean(secretKey && secretKey.trim().length > 0);
    this.allowSandbox = options?.allowSandbox ?? !this.liveConfigured;
    this.appUrl = options?.appUrl ?? null;
    this.callbackUrl = options?.callbackUrl ?? null;
    this.timeoutMs = options?.timeoutMs ?? 15_000;
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  public isLiveConfigured(): boolean {
    return this.liveConfigured;
  }

  public async initializeCheckout(input: {
    orderType: 'esim_order' | 'phone_order';
    orderId: string;
    userId: string;
    amountEtb: number;
    customerEmail: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    returnUrl: string;
    idempotencyKey?: string;
  }): Promise<{ payment: PaymentRecord; checkoutUrl: string }> {
    if (!this.liveConfigured && !this.allowSandbox) {
      throw new ChapaGatewayError(
        503,
        'PAYMENT_PROVIDER_UNCONFIGURED',
        'CHAPA_SECRET_KEY is required in production mode.',
      );
    }
    if (!Number.isFinite(input.amountEtb) || input.amountEtb <= 0) {
      if (this.liveConfigured || !this.allowSandbox) {
        throw new ChapaGatewayError(
          409,
          'INVALID_PAYMENT_AMOUNT',
          'Checkout amount must be a positive ETB total.',
        );
      }
    }

    const now = new Date().toISOString();
    const txRef = `YN-CHAPA-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const idempotencyKey = input.idempotencyKey?.trim() || `IDEMP-${input.orderId}-${txRef}`;

    if (!this.liveConfigured) {
      const checkoutUrl = `${input.returnUrl}?chapa_sandbox_tx=${encodeURIComponent(txRef)}`;
      const payment: PaymentRecord = {
        id: `pay-${crypto.randomUUID().slice(0, 12)}`,
        orderType: input.orderType,
        orderId: input.orderId,
        userId: input.userId,
        provider: 'chapa',
        txRef,
        idempotencyKey,
        chapaReference: null,
        amountEtb: Number(input.amountEtb.toFixed(2)),
        currency: 'ETB',
        checkoutUrl,
        status: 'initialized',
        verifiedVia: null,
        webhookEventCount: 0,
        isSandbox: true,
        failureReason: null,
        refundReason: null,
        refundReference: null,
        refundStatusCheckedAt: null,
        reconciledAt: null,
        createdAt: now,
        updatedAt: now,
      };
      return { payment, checkoutUrl };
    }

    if (!input.customerEmail?.trim()) {
      throw new ChapaGatewayError(
        400,
        'CUSTOMER_EMAIL_REQUIRED',
        'A verified customer email address is required by Chapa to initialize checkout.',
      );
    }

    const resolvedReturnUrl = resolveAbsoluteUrl(input.returnUrl, this.appUrl);
    const resolvedCallbackUrl =
      this.callbackUrl ??
      (this.appUrl && /^https?:\/\//i.test(this.appUrl)
        ? new URL('/api/v1/payments/chapa/webhook', this.appUrl).toString()
        : undefined);
    const { firstName, lastName } = splitName(input.customerName);
    const localPhone = toLocalTenDigitPhone(input.customerPhone);

    const requestPayload: Record<string, unknown> = {
      amount: input.amountEtb.toFixed(2),
      currency: 'ETB',
      email: input.customerEmail.trim(),
      tx_ref: txRef,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(localPhone ? { phone_number: localPhone } : {}),
      ...(resolvedCallbackUrl ? { callback_url: resolvedCallbackUrl } : {}),
      ...(resolvedReturnUrl ? { return_url: resolvedReturnUrl } : {}),
      customization: {
        title: 'Yene Tele eSIM',
        description: 'Official eSIM provisioning payment',
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl('https://api.chapa.co/v1/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new ChapaGatewayError(
        isTimeout ? 504 : 502,
        isTimeout ? 'CHAPA_TIMEOUT' : 'CHAPA_NETWORK_ERROR',
        isTimeout
          ? 'Timed out waiting for Chapa checkout initialization.'
          : 'Unable to reach Chapa payment initialization service.',
      );
    }

    const body = (await response.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: { checkout_url?: string };
    };

    const checkoutUrl = body.data?.checkout_url;
    if (
      !response.ok ||
      body.status !== 'success' ||
      typeof checkoutUrl !== 'string' ||
      !/^https:\/\//i.test(checkoutUrl)
    ) {
      throw new ChapaGatewayError(
        response.status >= 500 ? 502 : 400,
        'CHAPA_INIT_REJECTED',
        typeof body.message === 'string' && body.message.trim()
          ? `Chapa checkout initialization failed: ${body.message}`
          : 'Chapa checkout initialization failed.',
      );
    }

    const payment: PaymentRecord = {
      id: `pay-${crypto.randomUUID().slice(0, 12)}`,
      orderType: input.orderType,
      orderId: input.orderId,
      userId: input.userId,
      provider: 'chapa',
      txRef,
      idempotencyKey,
      chapaReference: null,
      amountEtb: Number(input.amountEtb.toFixed(2)),
      currency: 'ETB',
      checkoutUrl,
      status: 'initialized',
      verifiedVia: null,
      webhookEventCount: 0,
      isSandbox: false,
      failureReason: null,
      refundReason: null,
      refundReference: null,
      refundStatusCheckedAt: null,
      reconciledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    return { payment, checkoutUrl };
  }

  public verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!this.liveConfigured && this.allowSandbox && !this.webhookSecret) {
      return true;
    }
    if (!this.webhookSecret || !signatureHeader) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody, 'utf8')
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signatureHeader.trim().toLowerCase(), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  public async verifyTransactionServerSide(
    txRef: string,
    expectedAmountEtb: number,
    options?: { simulateFailure?: boolean; sandboxBehavior?: 'success' | 'pending' | 'failure' | 'unavailable_on_recheck' },
  ): Promise<{
    verified: boolean;
    outcome: 'verified' | 'failed' | 'pending' | 'uncertain';
    chapaReference: string | null;
    reason: string | null;
  }> {
    if (!this.liveConfigured) {
      if (!this.allowSandbox) {
        return {
          verified: false,
          outcome: 'failed',
          chapaReference: null,
          reason: 'Chapa live credentials are not configured.',
        };
      }
      if (options?.simulateFailure || txRef.includes('FAIL')) {
        return {
          verified: false,
          outcome: 'failed',
          chapaReference: null,
          reason: 'Chapa sandbox verification reported failed or unpaid transaction.',
        };
      }
      return {
        verified: true,
        outcome: 'verified',
        chapaReference: `CHAPA-SBX-${txRef.slice(-6)}`,
        reason: null,
      };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        verified: false,
        outcome: 'uncertain',
        chapaReference: null,
        reason: isTimeout
          ? 'Timed out reaching Chapa verification endpoint. Transaction status uncertain; retry verification.'
          : 'Network error reaching Chapa verification endpoint. Transaction status uncertain; retry verification.',
      };
    }

    if (response.status >= 500 || response.status === 429) {
      return {
        verified: false,
        outcome: 'uncertain',
        chapaReference: null,
        reason: `Chapa verification returned transient HTTP ${response.status}; retry verification.`,
      };
    }

    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: {
        status?: string;
        amount?: number | string;
        reference?: string;
        currency?: string;
        tx_ref?: string;
      };
    };

    if (!response.ok) {
      return {
        verified: false,
        outcome: 'failed',
        chapaReference: null,
        reason: data.message || `Chapa verification rejected (${response.status}).`,
      };
    }

    const innerStatus = data.data?.status?.toLowerCase();
    if (innerStatus === 'pending' || innerStatus === 'initiated') {
      return {
        verified: false,
        outcome: 'pending',
        chapaReference: data.data?.reference ?? null,
        reason: 'Payment is still pending confirmation at Chapa.',
      };
    }
    if (innerStatus === 'failed' || innerStatus === 'cancelled') {
      return {
        verified: false,
        outcome: 'failed',
        chapaReference: data.data?.reference ?? null,
        reason: `Chapa reported transaction status "${innerStatus}".`,
      };
    }

    const currencyOk = Boolean(data.data?.currency && data.data.currency.toUpperCase() === 'ETB');
    const txRefOk = Boolean(data.data?.tx_ref && data.data.tx_ref === txRef);
    const paidAmount = Number(data.data?.amount ?? 0);
    const amountOk = Number.isFinite(paidAmount) && paidAmount + 0.001 >= expectedAmountEtb;

    if (
      data.status === 'success' &&
      (!innerStatus || innerStatus === 'success') &&
      currencyOk &&
      txRefOk &&
      amountOk
    ) {
      return {
        verified: true,
        outcome: 'verified',
        chapaReference: data.data?.reference ?? txRef,
        reason: null,
      };
    }

    return {
      verified: false,
      outcome: 'failed',
      chapaReference: data.data?.reference ?? null,
      reason: !currencyOk
        ? 'Chapa verification currency mismatch (expected ETB).'
        : !txRefOk
          ? 'Chapa verification tx_ref mismatch.'
          : !amountOk
            ? `Chapa paid amount (${paidAmount}) is below expected ${expectedAmountEtb.toFixed(2)} ETB.`
            : 'Chapa server-side verification did not confirm payment.',
    };
  }

  public async initiateRefund(
    txRef: string,
    amountEtb: number,
    reason: string,
    options?: { refundReference?: string; idempotencyKey?: string },
  ): Promise<{
    accepted: boolean;
    outcome: 'refunded' | 'refund_pending' | 'failed' | 'uncertain';
    refundStatus: 'refunded' | 'refund_pending' | 'verified';
    refundReference: string | null;
    note: string;
  }> {
    const refundRef =
      options?.refundReference ?? `YREF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    if (!this.liveConfigured) {
      if (!this.allowSandbox) {
        return {
          accepted: false,
          outcome: 'failed',
          refundStatus: 'verified',
          refundReference: null,
          note: 'Chapa live credentials are not configured.',
        };
      }
      return {
        accepted: true,
        outcome: 'refunded',
        refundStatus: 'refunded',
        refundReference: `SBX-${refundRef}`,
        note: `Sandbox refund completed for ${txRef} (${amountEtb.toFixed(2)} ETB): ${reason}`,
      };
    }

    const form = new URLSearchParams({
      reason,
      reference: refundRef,
      amount: amountEtb.toFixed(2),
    });

    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.chapa.co/v1/refund/${encodeURIComponent(txRef)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': options?.idempotencyKey ?? refundRef,
          },
          body: form.toString(),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (err) {
      const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        accepted: false,
        outcome: 'uncertain',
        refundStatus: 'refund_pending',
        refundReference: null,
        note: isTimeout
          ? `Refund request timed out for ${txRef}; kept in refund_pending for reconciliation.`
          : `Network error reaching Chapa refund endpoint for ${txRef}; kept in refund_pending.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: { ref_id?: string; status?: string };
    };

    if (response.status >= 500 || response.status === 429) {
      return {
        accepted: false,
        outcome: 'uncertain',
        refundStatus: 'refund_pending',
        refundReference: null,
        note: `Chapa refund endpoint returned HTTP ${response.status}; kept in refund_pending for reconciliation.`,
      };
    }

    if (!response.ok || body.status !== 'success') {
      return {
        accepted: false,
        outcome: 'failed',
        refundStatus: 'verified',
        refundReference: null,
        note: body.message || `Chapa rejected refund request (HTTP ${response.status}).`,
      };
    }

    const returnedRef = body.data?.ref_id ?? refundRef;
    const innerStatus = body.data?.status?.toLowerCase();
    const isImmediatelyRefunded = innerStatus === 'refunded' || innerStatus === 'reversed';

    return {
      accepted: true,
      outcome: isImmediatelyRefunded ? 'refunded' : 'refund_pending',
      refundStatus: isImmediatelyRefunded ? 'refunded' : 'refund_pending',
      refundReference: returnedRef,
      note: isImmediatelyRefunded
        ? `Chapa confirmed refund ${returnedRef} for ${txRef}.`
        : `Chapa accepted refund request ${returnedRef}; awaiting settlement confirmation.`,
    };
  }

  public async verifyRefundStatus(
    txRef: string,
    refundReference: string | null,
  ): Promise<{
    outcome: 'refunded' | 'refund_pending' | 'failed' | 'uncertain';
    refundStatus: 'refunded' | 'refund_pending';
    note: string;
  }> {
    if (!this.liveConfigured) {
      if (!refundReference) {
        return {
          outcome: 'refund_pending',
          refundStatus: 'refund_pending',
          note: `Sandbox refund has not been initiated yet for ${txRef}; awaiting refund execution.`,
        };
      }
      return {
        outcome: 'refunded',
        refundStatus: 'refunded',
        note: `Sandbox refund status confirmed for ${txRef} (${refundReference}).`,
      };
    }

    const endpoint = refundReference
      ? `https://api.chapa.global/v2/refunds/${encodeURIComponent(refundReference)}/verify`
      : `https://api.chapa.co/v1/transaction/verify/${encodeURIComponent(txRef)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return {
        outcome: 'uncertain',
        refundStatus: 'refund_pending',
        note: 'Network/timeout error checking Chapa refund status.',
      };
    }

    if (response.status >= 500 || response.status === 429) {
      return {
        outcome: 'uncertain',
        refundStatus: 'refund_pending',
        note: `Transient HTTP ${response.status} checking Chapa refund status.`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: { status?: string };
    };

    if (!response.ok) {
      return {
        outcome: 'failed',
        refundStatus: 'refund_pending',
        note: body.message || `Chapa refund verify returned HTTP ${response.status}.`,
      };
    }

    const st = body.data?.status?.toLowerCase();
    if (st === 'success' || st === 'refunded' || st === 'reversed') {
      return {
        outcome: 'refunded',
        refundStatus: 'refunded',
        note: `Chapa confirmed refund completed (${refundReference ?? txRef}).`,
      };
    }
    if (st === 'failed') {
      return {
        outcome: 'failed',
        refundStatus: 'refund_pending',
        note: `Chapa reported refund failure (${refundReference ?? txRef}).`,
      };
    }

    return {
      outcome: 'refund_pending',
      refundStatus: 'refund_pending',
      note: `Chapa refund remains pending (${st ?? 'processing'}).`,
    };
  }
}
