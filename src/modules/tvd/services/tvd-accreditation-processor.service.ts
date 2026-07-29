import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import { TvdBlockchainError } from '../errors/tvd-blockchain.error';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import {
  TokenAccreditationFailureCategory,
  TokenAccreditationStatus,
} from '../tvd.constants';
import { TvdBlockchainService } from './tvd-blockchain.service';
import { TvdOperatorTransactionLockService } from './tvd-operator-transaction-lock.service';

const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

@Injectable()
export class TvdAccreditationProcessorService {
  private readonly logger = new Logger(TvdAccreditationProcessorService.name);
  private readonly defaultOwnerId = `tvd-accreditation-processor:${process.pid}:${randomUUID()}`;

  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    private readonly blockchain: TvdBlockchainService,
    private readonly operatorLocks: TvdOperatorTransactionLockService,
    private readonly auditService: InstitutionalAuditService,
    private readonly configService: ConfigService,
  ) {}

  async processNextPending(ownerId = this.defaultOwnerId) {
    const claimed = await this.claimNextPending(ownerId);
    if (!claimed) return null;
    return this.processClaimedAccreditation(claimed as any, ownerId);
  }

  async processAccreditationById(
    accreditationId: Types.ObjectId | string,
    options: { ownerId?: string } = {},
  ) {
    const ownerId = options.ownerId ?? this.defaultOwnerId;
    const claimed = await this.claimPendingById(accreditationId, ownerId);
    if (!claimed) {
      return this.accreditationModel
        .findById(accreditationId)
        .select('+serializedTransaction')
        .lean();
    }
    return this.processClaimedAccreditation(claimed as any, ownerId);
  }

  async recoverExpiredClaims(now = new Date()) {
    const noTransaction = await this.accreditationModel.updateMany(
      {
        status: 'SUBMITTING',
        processingLockExpiresAt: { $lte: now },
        $and: [
          { $or: [{ txHash: null }, { txHash: { $exists: false } }] },
          { $or: [{ userOpHash: null }, { userOpHash: { $exists: false } }] },
          {
            $or: [
              { serializedTransaction: null },
              { serializedTransaction: { $exists: false } },
            ],
          },
        ],
      },
      {
        $set: {
          status: 'PENDING',
          nextAttemptAt: now,
          lastErrorCode: 'TVD_SUBMITTING_CLAIM_EXPIRED',
          failureCategory: 'RETRYABLE',
          retryable: true,
        },
        $unset: {
          processingOwner: '',
          processingLockedAt: '',
          processingLockExpiresAt: '',
        },
      },
    );

    const prepared = await this.accreditationModel.updateMany(
      {
        status: 'SUBMITTING',
        processingLockExpiresAt: { $lte: now },
        serializedTransaction: { $nin: [null, ''] },
        $or: [
          { txHash: { $nin: [null, ''] } },
          { userOpHash: { $nin: [null, ''] } },
        ],
      },
      {
        $set: {
          status: 'SUBMITTED',
          nextAttemptAt: now,
          lastErrorCode: 'TVD_SUBMITTING_PREPARED_CLAIM_EXPIRED',
          failureCategory: 'AMBIGUOUS',
          retryable: false,
        },
        $unset: {
          processingOwner: '',
          processingLockedAt: '',
          processingLockExpiresAt: '',
        },
      },
    );

    return {
      recoveredPending: noTransaction.modifiedCount ?? 0,
      recoveredSubmitted: prepared.modifiedCount ?? 0,
    };
  }

  private async claimNextPending(ownerId: string) {
    const now = new Date();
    return this.accreditationModel
      .findOneAndUpdate(
        this.buildPendingClaimFilter(now) as any,
        this.buildClaimUpdate(ownerId, now) as any,
        {
          sort: { nextAttemptAt: 1, createdAt: 1, _id: 1 },
          returnDocument: 'after',
        },
      )
      .select('+serializedTransaction');
  }

  private async claimPendingById(
    accreditationId: Types.ObjectId | string,
    ownerId: string,
  ) {
    const now = new Date();
    return this.accreditationModel
      .findOneAndUpdate(
        {
          _id: this.toObjectId(accreditationId),
          ...this.buildPendingClaimFilter(now),
        } as any,
        this.buildClaimUpdate(ownerId, now) as any,
        { returnDocument: 'after' },
      )
      .select('+serializedTransaction');
  }

  private buildPendingClaimFilter(now: Date) {
    const maxAttempts = this.getMaxAttempts();
    return {
      status: 'PENDING',
      attempts: { $lt: maxAttempts },
      $and: [
        {
          $or: [
            { nextAttemptAt: null },
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { processingLockExpiresAt: null },
            { processingLockExpiresAt: { $exists: false } },
            { processingLockExpiresAt: { $lte: now } },
          ],
        },
      ],
    };
  }

  private buildClaimUpdate(ownerId: string, now: Date) {
    return {
      $set: {
        status: 'SUBMITTING',
        processingOwner: ownerId,
        processingLockedAt: now,
        processingLockExpiresAt: new Date(now.getTime() + this.getAccreditationLockTtlMs()),
        retryable: true,
        failureCategory: null,
        lastErrorCode: null,
      },
      $inc: { attempts: 1 },
    };
  }

  private async processClaimedAccreditation(
    accreditation: TokenAccreditationDocument,
    ownerId: string,
  ) {
    const startedAt = Date.now();
    const validationError = this.validateAccreditation(accreditation);
    await this.recordAuditSafely('TVD_ACCREDITATION_CLAIMED', accreditation);
    this.logMetric('tvd_accreditation_claimed', accreditation, ownerId);
    if (validationError) {
      return this.markFailed(accreditation, validationError, 'CONFIGURATION', ownerId);
    }

    let lockKey: string | null = null;
    try {
      const context = await this.blockchain.getOperatorContext();
      lockKey = this.operatorLocks.buildLockKey({
        chainId: context.chainId,
        operatorAddress: context.operatorAddress,
      });
      const lock = await this.operatorLocks.acquire({
        lockKey,
        ownerId,
        ttlMs: this.getOperatorLockTtlMs(),
      });
      if (!lock) {
        this.logMetric('tvd_accreditation_lock_conflict', accreditation, ownerId);
        return this.scheduleRetry(accreditation, 'TVD_OPERATOR_LOCK_BUSY', ownerId);
      }

      const prepared = await this.prepareIfNeeded(accreditation, ownerId);
      let resolvedTxHash: string | null = null;
      try {
        const broadcast = await this.blockchain.broadcastSignedTransaction(
          prepared.serializedTransaction as `0x${string}`,
        );
        resolvedTxHash = broadcast.txHash;
        if (broadcast.userOpHash) {
          await this.accreditationModel.updateOne(
            { _id: accreditation._id, status: 'SUBMITTING', processingOwner: ownerId },
            { $set: { userOpHash: broadcast.userOpHash } },
          );
        }
      } catch (error) {
        const code = this.sanitizeErrorCode(error);
        this.logger.warn(
          JSON.stringify({
            event: 'tvd_accreditation_broadcast_ambiguous',
            accreditationId: String(accreditation._id),
            sourceType: accreditation.sourceType,
            tenantId: String(accreditation.tenantId),
            userOpHash: prepared.userOpHash,
            nonce: prepared.nonce,
            errorCode: code,
            workerId: ownerId,
          }),
        );
      }

      const submitted = await this.markSubmitted(accreditation._id, ownerId, resolvedTxHash);
      this.logMetric('tvd_accreditation_duration', accreditation, ownerId, {
        durationMs: Date.now() - startedAt,
      });
      return submitted;
    } catch (error) {
      const code = this.sanitizeErrorCode(error);
      const classification = this.classifyPreBroadcastError(
        code,
        Boolean(accreditation.txHash || accreditation.userOpHash || accreditation.serializedTransaction),
      );
      if (classification === 'RETRYABLE') {
        return this.scheduleRetry(accreditation, code, ownerId);
      }
      return this.markFailed(accreditation, code, classification, ownerId);
    } finally {
      if (lockKey) {
        await this.operatorLocks.release({ lockKey, ownerId });
      }
    }
  }

  private async prepareIfNeeded(
    accreditation: TokenAccreditationDocument,
    ownerId: string,
  ) {
    const existingUserOpHash = accreditation.userOpHash ?? accreditation.txHash;
    if (
      existingUserOpHash &&
      accreditation.nonce &&
      accreditation.serializedTransaction
    ) {
      return {
        userOpHash: existingUserOpHash,
        nonce: accreditation.nonce,
        serializedTransaction: accreditation.serializedTransaction,
      };
    }

    await this.blockchain.validateAssignReadiness({
      institutionWallet: accreditation.targetWallet,
      amountSmallestUnit: accreditation.tokenAmountSmallestUnit as string,
    });
    const prepared = await this.blockchain.prepareSignedAssignTransaction({
      institutionWallet: accreditation.targetWallet,
      amountSmallestUnit: accreditation.tokenAmountSmallestUnit as string,
    });
    await this.accreditationModel.updateOne(
      {
        _id: accreditation._id,
        status: 'SUBMITTING',
        processingOwner: ownerId,
      },
      {
        $set: {
          nonce: prepared.nonce,
          userOpHash: prepared.userOpHash,
          serializedTransaction: prepared.serializedTransaction,
          chainId: prepared.chainId,
          contractAddress: prepared.contractAddress,
          operatorAddress: prepared.operatorAddress,
          preparedAt: new Date(),
          lastErrorCode: null,
        },
      },
    );
    accreditation.nonce = prepared.nonce;
    accreditation.userOpHash = prepared.userOpHash;
    accreditation.serializedTransaction = prepared.serializedTransaction;
    accreditation.chainId = prepared.chainId;
    accreditation.contractAddress = prepared.contractAddress;
    accreditation.operatorAddress = prepared.operatorAddress;
    await this.recordAuditSafely('TVD_ACCREDITATION_PREPARED', accreditation, {
      userOpHash: prepared.userOpHash,
      nonce: prepared.nonce,
    });
    return {
      userOpHash: prepared.userOpHash,
      nonce: prepared.nonce,
      serializedTransaction: prepared.serializedTransaction,
    };
  }

  private async markSubmitted(
    accreditationId: Types.ObjectId,
    ownerId: string,
    resolvedTxHash: string | null,
  ) {
    const now = new Date();
    const setFields: Record<string, unknown> = {
      status: 'SUBMITTED',
      submittedAt: now,
      lastBroadcastAt: now,
      lastErrorCode: null,
      failureCategory: null,
      retryable: true,
    };
    if (resolvedTxHash) {
      setFields.txHash = resolvedTxHash;
    }
    const updated = await this.accreditationModel
      .findOneAndUpdate(
        {
          _id: accreditationId,
          status: 'SUBMITTING',
          processingOwner: ownerId,
        },
        {
          $set: setFields,
          $unset: {
            processingOwner: '',
            processingLockedAt: '',
            processingLockExpiresAt: '',
          },
        },
        { returnDocument: 'after' },
      )
      .select('+serializedTransaction');
    await this.recordAuditSafely('TVD_ACCREDITATION_SUBMITTED', updated);
    this.logMetric('tvd_accreditation_submitted', updated ?? { _id: accreditationId }, ownerId);
    return updated;
  }

  private async scheduleRetry(
    accreditation: TokenAccreditationDocument,
    errorCode: string,
    ownerId: string,
  ) {
    const attempts = accreditation.attempts ?? 1;
    if (attempts >= this.getMaxAttempts()) {
      return this.markFailed(accreditation, errorCode, 'AMBIGUOUS', ownerId);
    }
    const updated = await this.accreditationModel.findOneAndUpdate(
      {
        _id: accreditation._id,
        processingOwner: ownerId,
      },
      {
        $set: {
          status: 'PENDING',
          nextAttemptAt: new Date(Date.now() + this.retryDelayMs(attempts)),
          lastErrorCode: errorCode,
          lastErrorAt: new Date(),
          failureCategory: 'RETRYABLE',
          retryable: true,
        },
        $unset: {
          processingOwner: '',
          processingLockedAt: '',
          processingLockExpiresAt: '',
        },
      },
      { returnDocument: 'after' },
    );
    await this.recordAuditSafely('TVD_ACCREDITATION_RETRY_SCHEDULED', updated, {
      errorCode,
    });
    this.logMetric('tvd_accreditation_retry', updated ?? accreditation, ownerId, {
      errorCode,
      nextAttemptAt: (updated as any)?.nextAttemptAt ?? null,
    });
    return updated;
  }

  private async markFailed(
    accreditation: TokenAccreditationDocument,
    errorCode: string,
    category: TokenAccreditationFailureCategory,
    ownerId: string,
  ) {
    const status = this.statusForFailureCategory(category);
    const updated = await this.accreditationModel.findOneAndUpdate(
      {
        _id: accreditation._id,
        processingOwner: ownerId,
      },
      {
        $set: {
          status,
          lastErrorCode: errorCode,
          lastErrorAt: new Date(),
          failureCategory: category,
          retryable: false,
        },
        $unset: {
          processingOwner: '',
          processingLockedAt: '',
          processingLockExpiresAt: '',
        },
      },
      { returnDocument: 'after' },
    );
    await this.recordAuditSafely(
      status === 'BLOCKED_CONFIGURATION'
        ? 'TVD_ACCREDITATION_BLOCKED'
        : 'TVD_ACCREDITATION_FAILED',
      updated,
      { errorCode },
    );
    this.logMetric(
      status === 'BLOCKED_CONFIGURATION'
        ? 'tvd_accreditation_blocked'
        : 'tvd_accreditation_receipt_mismatch',
      updated ?? accreditation,
      ownerId,
      { errorCode, failureCategory: category },
    );
    return updated;
  }

  private statusForFailureCategory(
    category: TokenAccreditationFailureCategory,
  ): TokenAccreditationStatus {
    if (category === 'FINAL') return 'FAILED_TERMINAL';
    return 'BLOCKED_CONFIGURATION';
  }

  private async recordAuditSafely(
    action:
      | 'TVD_ACCREDITATION_CLAIMED'
      | 'TVD_ACCREDITATION_PREPARED'
      | 'TVD_ACCREDITATION_SUBMITTED'
      | 'TVD_ACCREDITATION_RETRY_SCHEDULED'
      | 'TVD_ACCREDITATION_FAILED'
      | 'TVD_ACCREDITATION_NEEDS_REVIEW'
      | 'TVD_ACCREDITATION_BLOCKED',
    accreditation: any,
    extra: {
      txHash?: string | null;
      userOpHash?: string | null;
      nonce?: string | null;
      errorCode?: string | null;
    } = {},
  ) {
    if (!accreditation?._id) return;
    try {
      await this.auditService.record({
        tenantId: accreditation.tenantId,
        actor: {
          sub: String(accreditation.createdBy),
          role: 'TVD_PROCESSOR',
          active: true,
        },
        action,
        targetType: 'TokenAccreditation',
        targetId: accreditation._id,
        assignmentId: accreditation.targetAssignmentId,
        correlationId: accreditation.sourceId,
        newState: {
          accreditationId: String(accreditation._id),
          sourceType: accreditation.sourceType,
          sourceId: accreditation.sourceId,
          status: accreditation.status,
          targetWallet: accreditation.targetWallet,
          tokenAmount: accreditation.tokenAmount,
          txHash: extra.txHash ?? accreditation.txHash ?? null,
          userOpHash: extra.userOpHash ?? accreditation.userOpHash ?? null,
          nonce: extra.nonce ?? accreditation.nonce ?? null,
          attempts: accreditation.attempts,
          errorCode: extra.errorCode ?? accreditation.lastErrorCode ?? null,
        },
      });
    } catch {
      // Processing must not create another on-chain assignment because audit failed.
    }
  }

  private validateAccreditation(accreditation: TokenAccreditationDocument) {
    if (accreditation.status === 'NEEDS_REVIEW') return 'TVD_ACCREDITATION_LEGACY_NEEDS_REVIEW';
    if (accreditation.status === 'BLOCKED_CONFIGURATION') return 'TVD_ACCREDITATION_BLOCKED_CONFIGURATION';
    if (!accreditation.targetWallet) return 'TVD_WALLET_MISSING';
    if (!POSITIVE_INTEGER_REGEX.test(String(accreditation.tokenAmountSmallestUnit ?? ''))) {
      return 'TVD_INVALID_AMOUNT';
    }
    if (!['QR_PAYMENT', 'MANUAL_GRANT'].includes(accreditation.sourceType)) {
      return 'TVD_INVALID_SOURCE_TYPE';
    }
    return null;
  }

  private classifyPreBroadcastError(
    errorCode: string,
    hasPreparedTransaction: boolean,
  ): TokenAccreditationFailureCategory {
    if (hasPreparedTransaction) return 'AMBIGUOUS';
    if (
      [
        'TVD_CONFIG_INCOMPLETE',
        'TVD_CHAIN_MISMATCH',
        'TVD_OPERATOR_MISMATCH',
        'TVD_TOKEN_ADDRESS_MISMATCH',
        'TVD_DECIMALS_MISMATCH',
        'TVD_INSUFFICIENT_CONTRACT_BALANCE',
        'TVD_WALLET_MISSING',
        'TVD_INVALID_AMOUNT',
        'TVD_INVALID_SOURCE_TYPE',
        'TVD_ACCREDITATION_LEGACY_NEEDS_REVIEW',
        'TVD_ACCREDITATION_BLOCKED_CONFIGURATION',
      ].includes(errorCode)
    ) {
      return 'CONFIGURATION';
    }
    if (
      [
        'TVD_RPC_UNAVAILABLE',
        'TVD_RECEIPT_NOT_FOUND',
        'TVD_OPERATOR_LOCK_BUSY',
        'TVD_ACCREDITATION_PROCESSING_FAILED',
      ].includes(errorCode)
    ) {
      return 'RETRYABLE';
    }
    return 'FINAL';
  }

  private sanitizeErrorCode(error: unknown) {
    if (error instanceof TvdBlockchainError) return error.code;
    const code = (error as any)?.code;
    if (typeof code === 'string' && code.startsWith('TVD_')) return code.slice(0, 80);
    return 'TVD_ACCREDITATION_PROCESSING_FAILED';
  }

  private retryDelayMs(attempts: number) {
    const base = this.getPositiveConfigNumber('app.tvd.accreditationRetryBaseMs', 5000);
    return Math.min(
      base * 2 ** Math.max(attempts - 1, 0),
      this.getPositiveConfigNumber('app.tvd.accreditationRetryMaxMs', 15 * 60 * 1000),
    );
  }

  private getAccreditationLockTtlMs() {
    return this.getPositiveConfigNumber('app.tvd.accreditationLockTtlMs', 60000);
  }

  private getOperatorLockTtlMs() {
    return this.getPositiveConfigNumber('app.tvd.operatorLockTtlMs', 60000);
  }

  private getMaxAttempts() {
    return this.getPositiveConfigNumber('app.tvd.accreditationMaxAttempts', 5);
  }

  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string | number>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private logMetric(
    event: string,
    accreditation: any,
    workerId: string,
    extra: Record<string, unknown> = {},
  ) {
    this.logger.log(
      JSON.stringify({
        event,
        accreditationId: accreditation?._id ? String(accreditation._id) : null,
        sourceType: accreditation?.sourceType ?? null,
        tenantId: accreditation?.tenantId ? String(accreditation.tenantId) : null,
        status: accreditation?.status ?? null,
        workerId,
        ...extra,
      }),
    );
  }

  private toObjectId(value: Types.ObjectId | string) {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }
}
