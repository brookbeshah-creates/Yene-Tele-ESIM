import os from 'node:os';
import type { StructuredLogger } from '../../lib/logger.ts';
import type { ScheduledJobRunRecord } from '../../lib/observability.ts';
import type { YeneTeleStore } from '../store/yeneStore.ts';

export interface PaymentExpirySchedulerStatus {
  running: boolean;
  intervalMs: number;
  instanceId: string;
  lastRunAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
  lastResult: {
    acquiredLock: boolean;
    releasedReservations: number;
    expiredPayments: number;
    runRecord: ScheduledJobRunRecord | null;
  } | null;
}

export class PaymentExpiryScheduler {
  private readonly store: YeneTeleStore;
  private readonly logger: StructuredLogger;
  private readonly intervalMs: number;
  private readonly instanceId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private lastRunAt: string | null = null;
  private lastSucceededAt: string | null = null;
  private lastError: string | null = null;
  private lastResult: PaymentExpirySchedulerStatus['lastResult'] = null;

  constructor(options: {
    store: YeneTeleStore;
    logger: StructuredLogger;
    intervalMs: number;
    instanceId?: string;
  }) {
    this.store = options.store;
    this.logger = options.logger;
    this.intervalMs = Math.max(5_000, options.intervalMs);
    this.instanceId = options.instanceId ?? `${os.hostname()}-${process.pid}`;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref?.();
    this.logger.info('payment_expiry_scheduler_started', {
      intervalMs: this.intervalMs,
      instanceId: this.instanceId,
    });
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.info('payment_expiry_scheduler_stopped', {
      instanceId: this.instanceId,
    });
  }

  public async runOnce(nowMs = Date.now()): Promise<PaymentExpirySchedulerStatus['lastResult']> {
    if (this.inFlight) {
      return this.lastResult;
    }
    this.inFlight = true;
    this.lastRunAt = new Date().toISOString();
    try {
      const result = await this.store.runScheduledPaymentExpirySweep(this.instanceId, nowMs);
      this.lastResult = result;
      this.lastSucceededAt = new Date().toISOString();
      this.lastError = null;
      if (result.releasedReservations > 0 || result.expiredPayments > 0) {
        this.logger.info('payment_expiry_sweep_processed', {
          instanceId: this.instanceId,
          releasedReservations: result.releasedReservations,
          expiredPayments: result.expiredPayments,
        });
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scheduled payment expiry sweep failed.';
      this.lastError = msg;
      this.store.observability.recordScheduledJobFailure('payment_expiry_sweep', 'SWEEP_ERROR');
      this.logger.error('payment_expiry_sweep_error', {
        instanceId: this.instanceId,
        error: msg,
      });
      return null;
    } finally {
      this.inFlight = false;
    }
  }

  public getStatus(): PaymentExpirySchedulerStatus {
    return {
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      instanceId: this.instanceId,
      lastRunAt: this.lastRunAt,
      lastSucceededAt: this.lastSucceededAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }
}
