import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaymentDomainError } from '../errors/payment-domain.error';
import {
  PAYMENT_PROVIDER_RED_ENLACE,
  PaymentStatus,
  QR_PAYMENT_PROVIDER,
} from '../payments.constants';
import { QrPaymentProvider } from '../providers/qr-payment-provider.interface';
import {
  PaymentTransaction,
  PaymentTransactionDocument,
} from '../schemas/payment-transaction.schema';
import { sanitizeProviderDetail } from '../utils/red-enlace-glosa.util';
import { PaymentTransactionsService } from './payment-transactions.service';

const WORKER_ACTOR_PREFIX = 'red-enlace-reconciliation';

const RECONCILIATION_STATUSES: PaymentStatus[] = [
  'QR_ACTIVE',
  'PROVIDER_ERROR',
  'PROVIDER_STATUS_UNRESOLVED',
  'RECONCILIATION_PENDING',
];

const RETRYABLE_PROVIDER_ERROR_CODES = new Set([
  'RED_ENLACE_TIMEOUT',
  'RED_ENLACE_UNAVAILABLE',
  'RED_ENLACE_INVALID_RESPONSE',
]);

const NON_RETRYABLE_PROVIDER_ERROR_CODES = new Set([
  'RED_ENLACE_AMOUNT_MISMATCH',
  'RED_ENLACE_CURRENCY_MISMATCH',
  'RED_ENLACE_REFERENCE_INVALID',
]);

export interface RedEnlaceReconciliationConfigStatus {
  enabled: boolean;
  configValid: boolean;
  lastSuccessfulRunAt: Date | null;
  lastRunAt: Date | null;
  lastErrorCode: string | null;
}

@Injectable()
export class PaymentReconciliationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private readonly workerId = `${WORKER_ACTOR_PREFIX}-${process.pid}-${randomUUID()}`;
  private timer?: NodeJS.Timeout;
  private lastSuccessfulRunAt: Date | null = null;
  private lastRunAt: Date | null = null;
  private lastErrorCode: string | null = null;

  constructor(
    @InjectModel(PaymentTransaction.name)
    private readonly paymentModel: Model<PaymentTransactionDocument>,
    @Inject(QR_PAYMENT_PROVIDER)
    private readonly provider: QrPaymentProvider,
    private readonly payments: PaymentTransactionsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;
    const intervalMs = this.getPositiveNumber('intervalMs', 10_000);
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.lastErrorCode = this.safeErrorCode(error);
        this.logger.warn({
          event: 'payments_reconciliation_worker_failed',
          code: this.lastErrorCode,
        });
      });
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getStatus(): RedEnlaceReconciliationConfigStatus {
    return {
      enabled: this.isEnabled(),
      configValid: this.isConfigValid(),
      lastSuccessfulRunAt: this.lastSuccessfulRunAt,
      lastRunAt: this.lastRunAt,
      lastErrorCode: this.lastErrorCode,
    };
  }

  async runOnce(options: { force?: boolean } = {}) {
    if (!options.force && !this.isEnabled()) {
      return { processed: 0, claimed: 0, skipped: true };
    }
    if (!this.isConfigValid()) {
      this.lastErrorCode = 'RED_ENLACE_RECONCILIATION_CONFIG_INVALID';
      return { processed: 0, claimed: 0, skipped: true };
    }

    this.lastRunAt = new Date();
    const batchSize = this.getPositiveNumber('batchSize', 10);
    let claimed = 0;
    let processed = 0;

    for (let index = 0; index < batchSize; index += 1) {
      const payment = await this.claimNextPayment();
      if (!payment) break;
      claimed += 1;
      this.logEvent('payments_reconciliation_claimed', payment);
      await this.processClaimedPayment(payment).catch((error) =>
        this.recordProcessingError(payment, error),
      );
      processed += 1;
    }

    this.lastSuccessfulRunAt = new Date();
    this.lastErrorCode = null;
    return { processed, claimed, skipped: false };
  }

  async processClaimedPayment(payment: PaymentTransactionDocument) {
    const current = await this.paymentModel
      .findOne({
        _id: payment._id,
        reconciliationLockOwner: this.workerId,
      })
      .exec();
    if (!current) {
      this.logEvent('payments_reconciliation_lock_conflict', payment);
      return;
    }

    if (current.status === 'PAYMENT_CONFIRMED') {
      const updated = await this.payments.ensureAccreditationForConfirmedPayment(
        current,
        'RECONCILIATION',
      );
      await this.finishWithoutRetry(updated ?? current, 'PAYMENT_CONFIRMED');
      return;
    }

    if (!current.providerReference) {
      await this.finishWithoutRetry(
        current,
        'PAYMENT_RECONCILIATION_PROVIDER_REFERENCE_MISSING',
      );
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await this.provider.verifyQr({
        providerReference: current.providerReference,
      });
      const updated = await this.payments.applyReconciliationResult(
        current,
        result,
      );
      await this.recordProviderResult(current, updated ?? current, {
        providerStatus: result.providerStatus,
        errorCode: null,
        startedAt,
      });
    } catch (error) {
      if (this.isNonRetryableProviderError(error)) {
        await this.finishWithoutRetry(current, this.safeErrorCode(error));
        return;
      }
      if (this.isRetryableProviderError(error)) {
        await this.scheduleRetry(current, {
          providerStatus: null,
          errorCode: this.safeErrorCode(error),
          targetStatus: this.statusForProviderError(error),
        });
        return;
      }
      throw error;
    }
  }

  private async claimNextPayment() {
    const now = new Date();
    const lockExpiresAt = new Date(
      now.getTime() + this.getPositiveNumber('leaseDurationMs', 60_000),
    );
    const maxAttempts = this.getPositiveNumber('maxAttempts', 8);

    return this.paymentModel
      .findOneAndUpdate(
        {
          provider: PAYMENT_PROVIDER_RED_ENLACE,
          providerReference: { $type: 'string' },
          reconciliationAttempts: { $lt: maxAttempts },
          $and: [
            {
              $or: [
                { reconciliationNextAttemptAt: null },
                { reconciliationNextAttemptAt: { $lte: now } },
                { reconciliationNextAttemptAt: { $exists: false } },
              ],
            },
            {
              $or: [
                { reconciliationLockExpiresAt: null },
                { reconciliationLockExpiresAt: { $lte: now } },
                { reconciliationLockExpiresAt: { $exists: false } },
              ],
            },
            {
              $or: [
                { status: { $in: RECONCILIATION_STATUSES } },
                {
                  status: 'PAYMENT_CONFIRMED',
                  tokenAccreditationId: null,
                  tokenAccreditationStatus: null,
                },
              ],
            },
          ],
        },
        {
          $set: {
            reconciliationLockOwner: this.workerId,
            reconciliationLockedAt: now,
            reconciliationLockExpiresAt: lockExpiresAt,
          },
        },
        {
          new: true,
          sort: {
            reconciliationNextAttemptAt: 1,
            updatedAt: 1,
          },
        },
      )
      .exec();
  }

  private async recordProviderResult(
    original: PaymentTransactionDocument,
    updated: PaymentTransactionDocument,
    input: {
      providerStatus: string | null;
      errorCode: string | null;
      startedAt: number;
    },
  ) {
    const durationMs = Date.now() - input.startedAt;
    this.logger.log({
      event: 'payments_reconciliation_duration',
      paymentId: String(original._id),
      durationMs,
    });

    if (updated.status === 'PAYMENT_CONFIRMED') {
      this.logEvent('payments_reconciliation_success', updated);
      await this.finishWithoutRetry(updated, input.providerStatus ?? 'SUCCESS');
      return;
    }

    if (['EXPIRED', 'CANCELLED', 'MISMATCH', 'FAILED'].includes(updated.status)) {
      await this.finishWithoutRetry(
        updated,
        input.providerStatus ?? updated.status,
      );
      return;
    }

    await this.scheduleRetry(updated, {
      providerStatus: input.providerStatus,
      errorCode: input.errorCode,
      targetStatus: updated.status,
    });
  }

  private async scheduleRetry(
    payment: PaymentTransactionDocument,
    input: {
      providerStatus: string | null;
      errorCode: string | null;
      targetStatus: PaymentStatus;
    },
  ) {
    const now = new Date();
    const attempts = (payment.reconciliationAttempts ?? 0) + 1;
    const maxAttempts = this.getPositiveNumber('maxAttempts', 8);
    if (attempts >= maxAttempts) {
      await this.paymentModel.updateOne(
        {
          _id: payment._id,
          reconciliationLockOwner: this.workerId,
        },
        {
          $set: {
            status:
              input.targetStatus === 'PROVIDER_ERROR'
                ? 'PROVIDER_ERROR'
                : 'PROVIDER_STATUS_UNRESOLVED',
            reconciliationAttempts: attempts,
            reconciliationLastAttemptAt: now,
            reconciliationNextAttemptAt: null,
            reconciliationLastProviderStatus: input.providerStatus,
            reconciliationLastErrorCode:
              input.errorCode ?? 'PAYMENT_RECONCILIATION_EXHAUSTED',
            reconciliationExhaustedAt: now,
            reconciliationLockOwner: null,
            reconciliationLockedAt: null,
            reconciliationLockExpiresAt: null,
          },
        },
      );
      this.logEvent('payments_reconciliation_exhausted', payment, {
        attempts,
      });
      return;
    }

    const nextAttemptAt = this.nextAttemptAt(attempts);
    await this.paymentModel.updateOne(
      {
        _id: payment._id,
        reconciliationLockOwner: this.workerId,
      },
      {
        $set: {
          status: input.targetStatus,
          reconciliationAttempts: attempts,
          reconciliationLastAttemptAt: now,
          reconciliationNextAttemptAt: nextAttemptAt,
          reconciliationLastProviderStatus: input.providerStatus,
          reconciliationLastErrorCode: input.errorCode,
          reconciliationLockOwner: null,
          reconciliationLockedAt: null,
          reconciliationLockExpiresAt: null,
        },
      },
    );
    this.logEvent('payments_reconciliation_retry', payment, {
      attempts,
      nextAttemptAt: nextAttemptAt.toISOString(),
      status: input.targetStatus,
    });
  }

  private async finishWithoutRetry(
    payment: PaymentTransactionDocument,
    reason: string,
  ) {
    await this.paymentModel.updateOne(
      {
        _id: payment._id,
        reconciliationLockOwner: this.workerId,
      },
      {
        $set: {
          reconciliationLastAttemptAt: new Date(),
          reconciliationNextAttemptAt: null,
          reconciliationLastProviderStatus:
            payment.providerStatus ?? sanitizeProviderDetail(reason),
          reconciliationLastErrorCode: sanitizeProviderDetail(reason),
          reconciliationLockOwner: null,
          reconciliationLockedAt: null,
          reconciliationLockExpiresAt: null,
        },
      },
    );
    if (payment.status === 'PROVIDER_STATUS_UNRESOLVED') {
      this.logEvent('payments_reconciliation_unresolved', payment);
    }
  }

  private async recordProcessingError(
    payment: PaymentTransactionDocument,
    error: unknown,
  ) {
    await this.scheduleRetry(payment, {
      providerStatus: null,
      errorCode: this.safeErrorCode(error),
      targetStatus: 'PROVIDER_ERROR',
    });
  }

  private nextAttemptAt(attempts: number) {
    const baseBackoff = this.getPositiveNumber('baseBackoffMs', 30_000);
    const maxBackoff = this.getPositiveNumber('maxBackoffMs', 900_000);
    const delay = Math.min(baseBackoff * 2 ** Math.max(0, attempts - 1), maxBackoff);
    return new Date(Date.now() + delay);
  }

  private isRetryableProviderError(error: unknown) {
    return (
      error instanceof PaymentDomainError &&
      RETRYABLE_PROVIDER_ERROR_CODES.has(error.code)
    );
  }

  private isNonRetryableProviderError(error: unknown) {
    return (
      error instanceof PaymentDomainError &&
      NON_RETRYABLE_PROVIDER_ERROR_CODES.has(error.code)
    );
  }

  private statusForProviderError(error: unknown): PaymentStatus {
    if (
      error instanceof PaymentDomainError &&
      error.code === 'RED_ENLACE_UNAVAILABLE'
    ) {
      return 'PROVIDER_ERROR';
    }
    return 'PROVIDER_STATUS_UNRESOLVED';
  }

  private isEnabled() {
    return (
      this.configService.get<string>(
        'app.redEnlace.reconciliation.enabled',
      ) === 'true'
    );
  }

  private isConfigValid() {
    return [
      this.readPositiveNumber('intervalMs', 10_000),
      this.readPositiveNumber('batchSize', 10),
      this.readPositiveNumber('leaseDurationMs', 60_000),
      this.readPositiveNumber('maxAttempts', 8),
      this.readPositiveNumber('baseBackoffMs', 30_000),
      this.readPositiveNumber('maxBackoffMs', 900_000),
    ].every((entry) => entry.valid);
  }

  private getPositiveNumber(key: string, fallback: number) {
    return this.readPositiveNumber(key, fallback).value;
  }

  private readPositiveNumber(key: string, fallback: number) {
    const raw = this.configService.get<string | number>(
      `app.redEnlace.reconciliation.${key}`,
    );
    if (raw == null || raw === '') return { value: fallback, valid: true };
    const parsed = Number(raw ?? fallback);
    return Number.isFinite(parsed) && parsed > 0
      ? { value: parsed, valid: true }
      : { value: fallback, valid: false };
  }

  private safeErrorCode(error: unknown) {
    const code = (error as any)?.response?.code ?? (error as any)?.code;
    return typeof code === 'string' && code.trim()
      ? sanitizeProviderDetail(code) ?? 'PAYMENT_RECONCILIATION_FAILED'
      : 'PAYMENT_RECONCILIATION_FAILED';
  }

  private logEvent(
    event: string,
    payment: Pick<
      PaymentTransactionDocument,
      '_id' | 'tenantId' | 'merchantReference' | 'providerReference' | 'status'
    >,
    extra: Record<string, unknown> = {},
  ) {
    this.logger.log({
      event,
      paymentId: String(payment._id),
      tenantId: String(payment.tenantId),
      merchantReference: payment.merchantReference,
      providerReference: payment.providerReference,
      status: payment.status,
      ...extra,
    });
  }
}
