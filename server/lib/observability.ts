import type { StructuredLogger } from './logger.ts';

export interface ObservabilityEventSummary {
  count: number;
  lastOccurredAt: string | null;
  lastErrorCode: string | null;
}

export interface ScheduledJobRunRecord {
  id: string;
  jobName: string;
  instanceId: string;
  status: 'running' | 'succeeded' | 'failed';
  processedCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ObservabilitySnapshot {
  databaseHealth: {
    status: 'connected' | 'not_configured' | 'error';
    lastCheckedAt: string | null;
    lastLatencyMs: number | null;
    failureCount: number;
    lastErrorAt: string | null;
  };
  counters: {
    paymentInitFailures: ObservabilityEventSummary;
    paymentVerifyFailures: ObservabilityEventSummary;
    webhookProcessingFailures: ObservabilityEventSummary;
    stockReservationFailures: ObservabilityEventSummary;
    provisioningFailures: ObservabilityEventSummary;
    expiredOrdersTotal: number;
    scheduledJobFailures: ObservabilityEventSummary;
  };
}

function emptyCounter(): ObservabilityEventSummary {
  return { count: 0, lastOccurredAt: null, lastErrorCode: null };
}

export class ObservabilityTracker {
  private readonly logger: StructuredLogger | null;
  private dbStatus: 'connected' | 'not_configured' | 'error' = 'not_configured';
  private dbLastCheckedAt: string | null = null;
  private dbLastLatencyMs: number | null = null;
  private dbFailureCount = 0;
  private dbLastErrorAt: string | null = null;

  private readonly paymentInitFailures = emptyCounter();
  private readonly paymentVerifyFailures = emptyCounter();
  private readonly webhookProcessingFailures = emptyCounter();
  private readonly stockReservationFailures = emptyCounter();
  private readonly provisioningFailures = emptyCounter();
  private readonly scheduledJobFailures = emptyCounter();
  private expiredOrdersTotal = 0;

  constructor(logger: StructuredLogger | null = null) {
    this.logger = logger;
  }

  public recordDbHealth(ok: boolean, latencyMs: number | null, configured = true, errorCode?: string): void {
    const now = new Date().toISOString();
    this.dbLastCheckedAt = now;
    this.dbLastLatencyMs = latencyMs;
    if (!configured) {
      this.dbStatus = 'not_configured';
      return;
    }
    if (ok) {
      this.dbStatus = 'connected';
      return;
    }
    this.dbStatus = 'error';
    this.dbFailureCount += 1;
    this.dbLastErrorAt = now;
    this.logger?.error('db_health_error', {
      errorCode: errorCode ?? 'DATABASE_UNAVAILABLE',
      failureCount: this.dbFailureCount,
    });
  }

  public recordPaymentInitFailure(errorCode: string, context?: { orderId?: string }): void {
    this.bump(this.paymentInitFailures, errorCode);
    this.logger?.warn('payment_init_failed', { errorCode, orderId: context?.orderId ?? null });
  }

  public recordPaymentVerifyFailure(errorCode: string, context?: { orderId?: string; txRef?: string }): void {
    this.bump(this.paymentVerifyFailures, errorCode);
    this.logger?.warn('payment_verify_failed', {
      errorCode,
      orderId: context?.orderId ?? null,
      txRef: context?.txRef ?? null,
    });
  }

  public recordWebhookFailure(errorCode: string, context?: { txRef?: string }): void {
    this.bump(this.webhookProcessingFailures, errorCode);
    this.logger?.warn('webhook_processing_failed', { errorCode, txRef: context?.txRef ?? null });
  }

  public recordStockReservationFailure(errorCode: string, context?: { operatorCode?: string }): void {
    this.bump(this.stockReservationFailures, errorCode);
    this.logger?.warn('stock_reservation_failed', {
      errorCode,
      operatorCode: context?.operatorCode ?? null,
    });
  }

  public recordProvisioningFailure(errorCode: string, context?: { orderId?: string; operatorCode?: string }): void {
    this.bump(this.provisioningFailures, errorCode);
    this.logger?.warn('provisioning_failed', {
      errorCode,
      orderId: context?.orderId ?? null,
      operatorCode: context?.operatorCode ?? null,
    });
  }

  public recordExpiredOrders(count: number): void {
    if (count <= 0) return;
    this.expiredOrdersTotal += count;
    this.logger?.info('orders_expired', { count, totalExpiredSinceBoot: this.expiredOrdersTotal });
  }

  public recordScheduledJobFailure(jobName: string, errorCode: string): void {
    this.bump(this.scheduledJobFailures, errorCode);
    this.logger?.error('scheduled_job_failed', { jobName, errorCode });
  }

  public getSnapshot(): ObservabilitySnapshot {
    return {
      databaseHealth: {
        status: this.dbStatus,
        lastCheckedAt: this.dbLastCheckedAt,
        lastLatencyMs: this.dbLastLatencyMs,
        failureCount: this.dbFailureCount,
        lastErrorAt: this.dbLastErrorAt,
      },
      counters: {
        paymentInitFailures: { ...this.paymentInitFailures },
        paymentVerifyFailures: { ...this.paymentVerifyFailures },
        webhookProcessingFailures: { ...this.webhookProcessingFailures },
        stockReservationFailures: { ...this.stockReservationFailures },
        provisioningFailures: { ...this.provisioningFailures },
        expiredOrdersTotal: this.expiredOrdersTotal,
        scheduledJobFailures: { ...this.scheduledJobFailures },
      },
    };
  }

  private bump(target: ObservabilityEventSummary, errorCode: string): void {
    target.count += 1;
    target.lastOccurredAt = new Date().toISOString();
    target.lastErrorCode = errorCode;
  }
}
