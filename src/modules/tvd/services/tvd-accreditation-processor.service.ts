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
import { TokenAccreditationFailureCategory } from '../tvd.constants';
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
        $or: [
          { txHash: null },
          { txHash: { $exists: false } },
          { serializedTransaction: null },
          { serializedTransaction: { $exists: false } },
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
        txHash: { $nin: [null, ''] },
        serializedTransaction: { $nin: [null, ''] },
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
    const validationError = this.validateAccreditation(accreditation);
    await this.recordAuditSafely('TVD_ACCREDITATION_CLAIMED', accreditation);
    if (validationError) {
      return this.markFailed(accreditation, validationError, 'FINAL', ownerId);
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
        return this.scheduleRetry(accreditation, 'TVD_OPERATOR_LOCK_BUSY', ownerId);
      }

      Logger.debug('start assignment')
      const prepared = await this.prepareIfNeeded(accreditation, ownerId);
      let resolvedTxHash: string | null = null;
      try {
        Logger.debug('start transaction')
        const broadcast = await this.blockchain.broadcastSignedTransaction(
          prepared.serializedTransaction as `0x${string}`,
        );
        resolvedTxHash = broadcast.txHash;
        Logger.debug('success')
      } catch (error) {
        Logger.error(error);
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

      return this.markSubmitted(accreditation._id, ownerId, resolvedTxHash);
    } catch (error) {
      const code = this.sanitizeErrorCode(error);
      const classification = this.classifyPreBroadcastError(
        code,
        Boolean(accreditation.txHash || accreditation.serializedTransaction),
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
    if (
      accreditation.txHash &&
      accreditation.nonce &&
      accreditation.serializedTransaction
    ) {
      return {
        userOpHash: accreditation.txHash,
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
          // Pre-broadcast tracking hash (ERC-4337 UserOperation hash). Overwritten with
          // the real bundle transaction hash once broadcastSignedTransaction resolves it.
          txHash: prepared.userOpHash,
          serializedTransaction: prepared.serializedTransaction,
          chainId: prepared.chainId,
          contractAddress: prepared.contractAddress,
          preparedAt: new Date(),
          lastErrorCode: null,
        },
      },
    );
    accreditation.nonce = prepared.nonce;
    accreditation.txHash = prepared.userOpHash;
    accreditation.serializedTransaction = prepared.serializedTransaction;
    accreditation.chainId = prepared.chainId;
    accreditation.contractAddress = prepared.contractAddress;
    await this.recordAuditSafely('TVD_ACCREDITATION_PREPARED', accreditation, {
      txHash: prepared.userOpHash,
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
    return updated;
  }

  private async markFailed(
    accreditation: TokenAccreditationDocument,
    errorCode: string,
    category: TokenAccreditationFailureCategory,
    ownerId: string,
  ) {
    const status = category === 'AMBIGUOUS' ? 'NEEDS_REVIEW' : 'FAILED';
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
      status === 'NEEDS_REVIEW'
        ? 'TVD_ACCREDITATION_NEEDS_REVIEW'
        : 'TVD_ACCREDITATION_FAILED',
      updated,
      { errorCode },
    );
    return updated;
  }

  private async recordAuditSafely(
    action:
      | 'TVD_ACCREDITATION_CLAIMED'
      | 'TVD_ACCREDITATION_PREPARED'
      | 'TVD_ACCREDITATION_SUBMITTED'
      | 'TVD_ACCREDITATION_RETRY_SCHEDULED'
      | 'TVD_ACCREDITATION_FAILED'
      | 'TVD_ACCREDITATION_NEEDS_REVIEW',
    accreditation: any,
    extra: { txHash?: string | null; nonce?: string | null; errorCode?: string | null } = {},
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
    if (accreditation.status === 'NEEDS_REVIEW') return 'TVD_ACCREDITATION_NEEDS_REVIEW';
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
        'TVD_RPC_UNAVAILABLE',
        'TVD_RECEIPT_NOT_FOUND',
        'TVD_OPERATOR_LOCK_BUSY',
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
    return Math.min(base * 2 ** Math.max(attempts - 1, 0), 15 * 60 * 1000);
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

  private toObjectId(value: Types.ObjectId | string) {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }
}
