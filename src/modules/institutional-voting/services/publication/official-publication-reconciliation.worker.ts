import { randomUUID } from 'crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OfficialPublicationRequestDocument,
  OfficialPublicationRequestStatus,
} from '../../schemas/official-publication-request.schema';
import { OfficialPublicationChainVerificationService } from './official-publication-chain-verification.service';
import { OfficialPublicationFinalizationService } from './official-publication-finalization.service';
import { OfficialPublicationRequestService } from './official-publication-request.service';

const WORKER_ACTOR = 'official-publication-reconciliation-worker';

@Injectable()
export class OfficialPublicationReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OfficialPublicationReconciliationWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly requestService: OfficialPublicationRequestService,
    private readonly verificationService: OfficialPublicationChainVerificationService,
    private readonly finalizationService: OfficialPublicationFinalizationService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) return;
    const intervalMs = this.getNumber('reconciliationIntervalMs', 10_000);
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => {
        this.logger.warn({
          message: 'Official publication reconciliation cycle failed',
          errorCode: this.safeErrorCode(error),
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

  async runOnce(options: { force?: boolean } = {}) {
    if (!options.force && !this.isEnabled()) return { processed: 0 };

    const requests = await this.requestService.findReconciliationBatch({
      statuses: [
        'SUBMITTED',
        'CHAIN_PENDING',
        'CHAIN_CONFIRMED',
        'FAILED_RETRYABLE',
        'FINALIZING',
      ],
      limit: this.getNumber('reconciliationBatchSize', 10),
    });

    let processed = 0;
    for (const request of requests) {
      if (!this.shouldProcess(request)) continue;
      const lockId = randomUUID();
      const locked = await this.requestService.acquireProcessingLock({
        requestId: request.requestId,
        lockId,
        lockMs: this.getNumber('reconciliationLockMs', 60_000),
      });
      if (!locked) continue;
      try {
        await this.processRequest(locked, lockId);
        processed += 1;
      } finally {
        await this.requestService.releaseProcessingLock(locked.requestId, lockId);
      }
    }
    return { processed };
  }

  async processRequest(request: OfficialPublicationRequestDocument, lockId: string) {
    const current = await this.requestService.getRequestById(request.requestId);
    if (current.processingLockId !== lockId) return;

    if (current.status === 'CHAIN_CONFIRMED' || current.status === 'FINALIZING') {
      await this.finalizationService.finalizeOfficialPublication(
        current.requestId,
        WORKER_ACTOR,
      );
      return;
    }

    if (current.status === 'FAILED_RETRYABLE') {
      if (current.resumeFromStatus === 'FINALIZING') {
        await this.finalizationService.finalizeOfficialPublication(
          current.requestId,
          WORKER_ACTOR,
        );
        return;
      }
      if (current.resumeFromStatus !== 'CHAIN_PENDING') return;
      await this.requestService.transition({
        requestId: current.requestId,
        action: 'RETRY_CHAIN_CHECK',
        actor: WORKER_ACTOR,
        expectedStatus: current.status,
        expectedVersion: current.version,
      });
    }

    const refreshed = await this.requestService.getRequestById(current.requestId);
    if (!['SUBMITTED', 'CHAIN_PENDING'].includes(refreshed.status)) return;

    const result = await this.verificationService.verifySubmittedRequest(refreshed);
    if (result.status === 'PENDING') {
      let pending = refreshed;
      if (refreshed.status === 'SUBMITTED') {
        pending = await this.requestService.markChainPending(
          refreshed.requestId,
          WORKER_ACTOR,
        );
      }
      await this.requestService.recordChainCheck({
        requestId: pending.requestId,
        retryCount: pending.retryCount ?? 0,
        nextRetryAt: result.nextRetryAt ?? this.nextRetryAt(pending),
      });
      return;
    }

    if (result.status === 'CONFIRMED') {
      const confirmed = await this.requestService.markChainConfirmed(
        refreshed.requestId,
        WORKER_ACTOR,
        {
          txHash: result.txHash,
          confirmationBlock: result.confirmedBlockNumber.toString(),
          confirmations: result.confirmations,
        },
      );
      await this.finalizationService.finalizeOfficialPublication(
        confirmed.requestId,
        WORKER_ACTOR,
      );
      return;
    }

    if (result.status === 'REVERTED') {
      await this.requestService.markFailedFinal(
        refreshed.requestId,
        WORKER_ACTOR,
        result.code,
        result.safeMessage,
        undefined,
        'CHAIN_VERIFICATION',
      );
      return;
    }

    if (result.status === 'MISMATCH') {
      await this.requestService.markNeedsReview(
        refreshed.requestId,
        WORKER_ACTOR,
        result.code,
        result.safeMessage,
        refreshed.status,
        undefined,
        'CHAIN_VERIFICATION',
      );
      return;
    }

    const retryCount = (refreshed.retryCount ?? 0) + 1;
    await this.requestService.markFailedRetryable(
      refreshed.requestId,
      WORKER_ACTOR,
      result.code,
      result.safeMessage,
      'CHAIN_PENDING',
      undefined,
      'CHAIN_VERIFICATION',
      retryCount,
    );
    await this.requestService.recordChainCheck({
      requestId: refreshed.requestId,
      retryCount,
      nextRetryAt: result.nextRetryAt,
    });
  }

  private shouldProcess(request: OfficialPublicationRequestDocument) {
    if (request.status === 'FAILED_RETRYABLE') {
      return ['CHAIN_PENDING', 'FINALIZING'].includes(
        request.resumeFromStatus ?? '',
      );
    }
    const statuses: OfficialPublicationRequestStatus[] = [
      'SUBMITTED',
      'CHAIN_PENDING',
      'CHAIN_CONFIRMED',
      'FINALIZING',
    ];
    return statuses.includes(request.status);
  }

  private isEnabled() {
    return this.configService.get<string>(
      'app.officialPublication.reconciliationEnabled',
    ) === 'true';
  }

  private nextRetryAt(request: OfficialPublicationRequestDocument) {
    const retryCount = request.retryCount ?? 0;
    const delayMs = Math.min(30_000 * 2 ** retryCount, 15 * 60_000);
    return new Date(Date.now() + delayMs);
  }

  private getNumber(key: string, fallback: number) {
    return Math.max(
      1,
      Number(
        this.configService.get<string>(`app.officialPublication.${key}`) ||
          fallback,
      ),
    );
  }

  private safeErrorCode(error: unknown) {
    const code = (error as any)?.response?.code ?? (error as any)?.code;
    return typeof code === 'string' && code.trim()
      ? code.trim()
      : 'OFFICIAL_PUBLICATION_RECONCILIATION_FAILED';
  }
}
