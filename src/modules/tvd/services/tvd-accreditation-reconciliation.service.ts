import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import { PaymentTransaction } from '@/modules/payments/schemas/payment-transaction.schema';
import { TvdBlockchainError } from '../errors/tvd-blockchain.error';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import { TokenAccreditationFailureCategory } from '../tvd.constants';
import { TvdBlockchainService } from './tvd-blockchain.service';

@Injectable()
export class TvdAccreditationReconciliationService {
  private readonly logger = new Logger(TvdAccreditationReconciliationService.name);
  private readonly defaultOwnerId = `tvd-accreditation-reconciliation:${process.pid}:${randomUUID()}`;

  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    @InjectModel(PaymentTransaction.name)
    private readonly paymentModel: Model<any>,
    private readonly blockchain: TvdBlockchainService,
    private readonly auditService: InstitutionalAuditService,
    private readonly configService: ConfigService,
  ) {}

  async reconcileSubmittedBatch(limit = this.getBatchSize(), ownerId = this.defaultOwnerId) {
    const results: any[] = [];
    for (let index = 0; index < limit; index += 1) {
      const claimed = await this.claimNextSubmitted(ownerId);
      if (!claimed) break;
      results.push(await this.reconcileClaimed(claimed, ownerId));
    }
    return results;
  }

  async reconcileSubmittedAccreditation(
    accreditationId: Types.ObjectId | string,
    ownerId = this.defaultOwnerId,
  ) {
    const claimed = await this.claimSubmittedById(accreditationId, ownerId);
    if (!claimed) {
      return this.accreditationModel.findById(accreditationId).lean();
    }
    return this.reconcileClaimed(claimed, ownerId);
  }

  private claimNextSubmitted(ownerId: string) {
    const now = new Date();
    return this.accreditationModel
      .findOneAndUpdate(
        {
          status: 'SUBMITTED',
          txHash: { $nin: [null, ''] },
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
        },
        {
          $set: {
            processingOwner: ownerId,
            processingLockedAt: now,
            processingLockExpiresAt: new Date(
              now.getTime() + this.getAccreditationLockTtlMs(),
            ),
          },
        },
        {
          sort: { nextAttemptAt: 1, submittedAt: 1, createdAt: 1, _id: 1 },
          returnDocument: 'after',
        },
      )
      .select('+serializedTransaction');
  }

  private claimSubmittedById(accreditationId: Types.ObjectId | string, ownerId: string) {
    const now = new Date();
    return this.accreditationModel
      .findOneAndUpdate(
        {
          _id: this.toObjectId(accreditationId),
          status: 'SUBMITTED',
          txHash: { $nin: [null, ''] },
          $or: [
            { processingLockExpiresAt: null },
            { processingLockExpiresAt: { $exists: false } },
            { processingLockExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            processingOwner: ownerId,
            processingLockedAt: now,
            processingLockExpiresAt: new Date(
              now.getTime() + this.getAccreditationLockTtlMs(),
            ),
          },
        },
        { returnDocument: 'after' },
      )
      .select('+serializedTransaction');
  }

  private async reconcileClaimed(
    accreditation: TokenAccreditationDocument,
    ownerId: string,
  ) {
    if (!accreditation.txHash) {
      return this.markTerminal(
        accreditation,
        ownerId,
        'NEEDS_REVIEW',
        'TVD_RECEIPT_NOT_FOUND',
        'AMBIGUOUS',
      );
    }

    try {
      const receipt = await this.blockchain.getTransactionReceipt(accreditation.txHash);
      const validation = await this.blockchain.validateSubmittedAssignReceipt({
        receipt,
        expectedInstitutionWallet: accreditation.targetWallet,
        expectedAmountSmallestUnit: accreditation.tokenAmountSmallestUnit as string,
      });
      const confirmed = await this.accreditationModel.findOneAndUpdate(
        {
          _id: accreditation._id,
          status: 'SUBMITTED',
          processingOwner: ownerId,
        },
        {
          $set: {
            status: 'CONFIRMED',
            blockNumber: validation.blockNumber,
            confirmedAt: new Date(),
            lastReceiptCheckAt: new Date(),
            lastErrorCode: null,
            failureCategory: null,
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
      await this.updateQrPaymentSummary(confirmed ?? accreditation);
      await this.recordAuditSafely('TVD_ACCREDITATION_CONFIRMED', confirmed ?? accreditation);
      return confirmed;
    } catch (error) {
      const code = this.sanitizeErrorCode(error);
      if (code === 'TVD_RECEIPT_NOT_FOUND') {
        await this.rebroadcastSameTransactionSafely(accreditation);
        return this.keepSubmitted(accreditation, ownerId, code);
      }
      const category = this.classifyReceiptError(code);
      const status = category === 'FINAL' ? 'FAILED' : 'NEEDS_REVIEW';
      return this.markTerminal(accreditation, ownerId, status, code, category);
    }
  }

  private async rebroadcastSameTransactionSafely(accreditation: TokenAccreditationDocument) {
    if (!accreditation.serializedTransaction) return;
    try {
      await this.blockchain.broadcastSignedTransaction(
        accreditation.serializedTransaction as `0x${string}`,
      );
      this.logger.log(
        JSON.stringify({
          event: 'tvd_accreditation_rebroadcast_same_transaction',
          accreditationId: String(accreditation._id),
          sourceType: accreditation.sourceType,
          tenantId: String(accreditation.tenantId),
          txHash: accreditation.txHash,
          nonce: accreditation.nonce,
        }),
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'tvd_accreditation_rebroadcast_deferred',
          accreditationId: String(accreditation._id),
          sourceType: accreditation.sourceType,
          tenantId: String(accreditation.tenantId),
          txHash: accreditation.txHash,
          nonce: accreditation.nonce,
          errorCode: this.sanitizeErrorCode(error),
        }),
      );
    }
  }

  private keepSubmitted(
    accreditation: TokenAccreditationDocument,
    ownerId: string,
    errorCode: string,
  ) {
    const now = new Date();
    return this.accreditationModel.findOneAndUpdate(
      {
        _id: accreditation._id,
        status: 'SUBMITTED',
        processingOwner: ownerId,
      },
      {
        $set: {
          lastReceiptCheckAt: now,
          nextAttemptAt: new Date(now.getTime() + this.getReconcileAfterMs()),
          lastErrorCode: errorCode,
          lastErrorAt: now,
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
  }

  private async markTerminal(
    accreditation: TokenAccreditationDocument,
    ownerId: string,
    status: 'FAILED' | 'NEEDS_REVIEW',
    errorCode: string,
    category: TokenAccreditationFailureCategory,
  ) {
    const updated = await this.accreditationModel.findOneAndUpdate(
      {
        _id: accreditation._id,
        processingOwner: ownerId,
      },
      {
        $set: {
          status,
          lastReceiptCheckAt: new Date(),
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
    await this.updateQrPaymentSummary(updated ?? accreditation);
    await this.recordAuditSafely(
      status === 'NEEDS_REVIEW'
        ? 'TVD_ACCREDITATION_NEEDS_REVIEW'
        : 'TVD_ACCREDITATION_FAILED',
      updated ?? accreditation,
      { errorCode },
    );
    return updated;
  }

  private async recordAuditSafely(
    action:
      | 'TVD_ACCREDITATION_CONFIRMED'
      | 'TVD_ACCREDITATION_FAILED'
      | 'TVD_ACCREDITATION_NEEDS_REVIEW',
    accreditation: any,
    extra: { errorCode?: string | null } = {},
  ) {
    if (!accreditation?._id) return;
    try {
      await this.auditService.record({
        tenantId: accreditation.tenantId,
        actor: {
          sub: String(accreditation.createdBy),
          role: 'TVD_RECONCILIATION',
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
          txHash: accreditation.txHash ?? null,
          nonce: accreditation.nonce ?? null,
          attempts: accreditation.attempts,
          errorCode: extra.errorCode ?? accreditation.lastErrorCode ?? null,
        },
      });
    } catch {
      // On-chain state and accreditation status must remain recoverable if audit fails.
    }
  }

  private async updateQrPaymentSummary(accreditation: any) {
    if (accreditation?.sourceType !== 'QR_PAYMENT' || !accreditation.sourceId) {
      return;
    }
    if (!Types.ObjectId.isValid(String(accreditation.sourceId))) {
      return;
    }
    await this.paymentModel.updateOne(
      { _id: new Types.ObjectId(String(accreditation.sourceId)) },
      {
        $set: {
          tokenAccreditationId: accreditation._id,
          tokenAccreditationStatus: accreditation.status,
          tokenAccreditationErrorCode: accreditation.lastErrorCode ?? null,
        },
      },
    );
  }

  private classifyReceiptError(errorCode: string): TokenAccreditationFailureCategory {
    if (errorCode === 'TVD_RECEIPT_FAILED' || errorCode === 'TVD_ASSIGN_REVERTED') {
      return 'FINAL';
    }
    return 'AMBIGUOUS';
  }

  private sanitizeErrorCode(error: unknown) {
    if (error instanceof TvdBlockchainError) return error.code;
    const code = (error as any)?.code;
    if (typeof code === 'string' && code.startsWith('TVD_')) return code.slice(0, 80);
    return 'TVD_ACCREDITATION_RECONCILIATION_FAILED';
  }

  private getBatchSize() {
    return this.getPositiveConfigNumber('app.tvd.accreditationBatchSize', 10);
  }

  private getAccreditationLockTtlMs() {
    return this.getPositiveConfigNumber('app.tvd.accreditationLockTtlMs', 60000);
  }

  private getReconcileAfterMs() {
    return this.getPositiveConfigNumber('app.tvd.accreditationReconcileAfterMs', 15000);
  }

  private getPositiveConfigNumber(key: string, fallback: number) {
    const value = Number(this.configService.get<string | number>(key) ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private toObjectId(value: Types.ObjectId | string) {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }
}
