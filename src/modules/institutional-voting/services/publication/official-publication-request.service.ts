import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES,
  OfficialPublicationRequest,
  OfficialPublicationRequestDocument,
  OfficialPublicationRequestStatus,
} from '../../schemas/official-publication-request.schema';
import {
  OfficialPublicationRequestStateService,
  OfficialPublicationStateAction,
} from './official-publication-request-state.service';

export type CreateOfficialPublicationRequestInput = {
  eventId: Types.ObjectId | string;
  tenantId: Types.ObjectId | string;
  institutionId: string;
  applicationId: Types.ObjectId | string;
  requestedByUserId: Types.ObjectId | string;
  signerUserId: Types.ObjectId | string;
  assignmentId: Types.ObjectId | string;
  signerWallet: string;
  smartAccountAddress: string;
  ownerWalletAddress?: string | null;
  chainId: number;
  entryPoint?: string | null;
  entryPointAddress?: string | null;
  entryPointVersion?: string | null;
  onChainElectionId: string;
  expiresAt: Date;
  callData: {
    to: string;
    value: string;
    data: string;
  };
  callDataHash: string;
  executionCalls?: Array<{
    target: string;
    value: string;
    callData: string;
    purpose: 'TVD_APPROVAL' | 'CREATE_VOTE';
  }>;
  executionMode?: 'SINGLE' | 'BATCH';
  callsHash?: string;
  callsCount?: number;
  executionPackageVersion?: number;
  approveRequired?: boolean;
  allowanceBefore?: string;
  walletDebitRequired?: string;
  snapshotHash: string;
  preparedArtifactId?: Types.ObjectId | string | null;
  proxyAddress: string;
  implementationAddress: string;
  abiVersion: string;
  padronVersionId?: Types.ObjectId | string | null;
  isOpenVoting?: boolean;
  enabledVotersCount: number;
  optionsHash: string;
  merkleRoots: {
    ciMerkleRoot: string;
  };
  nullifiersRef: {
    storage: string;
    ref: string;
    digest: string;
    count: number;
  };
  creditsRequired: string;
  tvdRequired: string;
  tvdPerCredit: string;
  tokenSource: string;
  spender: string;
};

export type CreateOrGetActiveRequestResult = {
  request: OfficialPublicationRequestDocument;
  created: boolean;
};

@Injectable()
export class OfficialPublicationRequestService {
  constructor(
    @InjectModel(OfficialPublicationRequest.name)
    private readonly requestModel: Model<OfficialPublicationRequestDocument>,
    private readonly stateService: OfficialPublicationRequestStateService,
  ) {}

  buildActiveKey(eventId: Types.ObjectId | string) {
    return `official-publication:${String(eventId)}`;
  }

  async createOrGetActiveRequest(
    input: CreateOfficialPublicationRequestInput,
  ): Promise<CreateOrGetActiveRequestResult> {
    const activeKey = this.buildActiveKey(input.eventId);
    const padronVersionId = input.padronVersionId
      ? this.toObjectId(input.padronVersionId)
      : null;
    await this.releasePreSubmissionRetryableActiveKey(input.eventId);
    const existing = await this.getActiveRequestByEventId(input.eventId);
    if (existing) {
      return { request: existing, created: false };
    }

    try {
      const request = await this.requestModel.create({
        ...input,
        activeKey,
        eventId: this.toObjectId(input.eventId),
        tenantId: this.toObjectId(input.tenantId),
        applicationId: this.toObjectId(input.applicationId),
        requestedByUserId: this.toObjectId(input.requestedByUserId),
        signerUserId: this.toObjectId(input.signerUserId),
        assignmentId: this.toObjectId(input.assignmentId),
        padronVersionId,
        preparedArtifactId: input.preparedArtifactId
          ? this.toObjectId(input.preparedArtifactId)
          : null,
        signerWallet: input.signerWallet.toLowerCase(),
        smartAccountAddress: input.smartAccountAddress.toLowerCase(),
        ownerWalletAddress: input.ownerWalletAddress?.toLowerCase() ?? null,
        entryPoint: input.entryPoint?.toLowerCase() ?? null,
        entryPointAddress: input.entryPointAddress?.toLowerCase() ?? null,
        entryPointVersion: input.entryPointVersion ?? null,
        proxyAddress: input.proxyAddress.toLowerCase(),
        implementationAddress: input.implementationAddress.toLowerCase(),
        spender: input.spender.toLowerCase(),
        status: 'PREPARING',
        version: 0,
        finalizationProgress: {},
      });
      return { request, created: true };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        const request =
          (await this.getActiveRequestByEventId(input.eventId)) ??
          (await this.getActiveRequestByActiveKey(activeKey));
        if (request) {
          return { request, created: false };
        }
      }
      throw error;
    }
  }

  async getActiveRequestByEventId(eventId: Types.ObjectId | string) {
    return this.requestModel.findOne({
      activeKey: this.buildActiveKey(eventId),
      status: { $in: OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES },
    });
  }

  async getLatestAttemptByEventId(eventId: Types.ObjectId | string) {
    return this.requestModel
      .findOne({ eventId: this.toObjectId(eventId) })
      .sort({ createdAt: -1, _id: -1 });
  }

  private async getActiveRequestByActiveKey(activeKey: string) {
    const request = await this.requestModel.findOne({ activeKey });
    return request && OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES.includes(request.status as any)
      ? request
      : null;
  }

  async releasePreSubmissionRetryableActiveKey(eventId: Types.ObjectId | string) {
    await this.requestModel.updateMany(
      {
        activeKey: this.buildActiveKey(eventId),
        status: { $in: ['FAILED_RETRYABLE', 'EXPIRED'] },
        userOpHash: { $in: [null, undefined] },
        txHash: { $in: [null, undefined] },
        $or: [
          { resumeFromStatus: { $in: [null, undefined, 'PREPARING', 'PENDING_APPROVAL', 'CLAIMED', 'SIGNING'] } },
          { resumeFromStatus: { $exists: false } },
        ],
      } as any,
      {
        $set: {
          activeKey: null,
          updatedAt: new Date(),
        },
      },
    );
  }

  async getRequestById(requestId: string) {
    const request = await this.requestModel.findOne({ requestId });
    if (!request) {
      throw new NotFoundException({
        code: 'OFFICIAL_PUBLICATION_REQUEST_NOT_FOUND',
        message: 'Solicitud de publicacion oficial no encontrada',
      });
    }
    return request;
  }

  async transition(input: {
    requestId: string;
    action: OfficialPublicationStateAction;
    actor: string;
    expectedStatus?: OfficialPublicationRequestStatus;
    expectedVersion?: number;
    at?: Date;
    errorCode?: string | null;
    errorStage?: string | null;
    safeMessage?: string | null;
    set?: Record<string, unknown>;
    unset?: Record<string, '' | 1>;
    resumeFromStatus?: OfficialPublicationRequestStatus | null;
  }) {
    const current = await this.getRequestById(input.requestId);
    const from = input.expectedStatus ?? current.status;
    const version = input.expectedVersion ?? current.version;
    const transition = this.stateService.transition(from, input.action);

    if (transition.changed && current.status !== from) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_VERSION_CONFLICT',
        message: 'La solicitud cambio de estado antes de aplicar la transicion',
      });
    }

    const update = this.stateService.buildTransitionUpdate({
      transition,
      actor: input.actor,
      at: input.at,
      errorCode: input.errorCode,
      errorStage: input.errorStage,
      safeMessage: input.safeMessage,
    }) as any;

    update.$set = {
      ...update.$set,
      ...(input.set ?? {}),
    };

    if (input.resumeFromStatus !== undefined) {
      update.$set.resumeFromStatus = input.resumeFromStatus;
    }

    if (transition.terminal) {
      update.$set.activeKey = null;
    }

    if (input.unset) {
      update.$unset = {
        ...(update.$unset ?? {}),
        ...input.unset,
      };
    }

    const filter = transition.changed
      ? this.stateService.buildOptimisticTransitionFilter({
          requestId: input.requestId,
          from,
          version,
        })
      : { requestId: input.requestId };

    const updated = await this.requestModel.findOneAndUpdate(filter, update, {
      new: true,
    });

    if (!updated) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_VERSION_CONFLICT',
        message: 'No se pudo aplicar la transicion atomica de la solicitud',
      });
    }

    return updated;
  }

  async markPrepared(requestId: string, actor: string, at = new Date()) {
    return this.transition({
      requestId,
      action: 'MARK_PREPARED',
      actor,
      at,
      set: { preparedAt: at },
    });
  }

  async attachPreparedArtifact(requestId: string, artifactId: Types.ObjectId | string) {
    const request = await this.requestModel.findOneAndUpdate(
      {
        requestId,
        preparedArtifactId: { $in: [null, undefined] },
      } as any,
      {
        $set: {
          preparedArtifactId: this.toObjectId(artifactId),
          updatedAt: new Date(),
        },
      },
      { new: true },
    );
    return request ?? this.getRequestById(requestId);
  }

  async claimRequest(input: {
    requestId: string;
    deviceId: string;
    actor: string;
    lockMs: number;
    at?: Date;
  }) {
    const at = input.at ?? new Date();
    const request = await this.getRequestById(input.requestId);
    if (
      request.claimedByDeviceId &&
      request.claimedByDeviceId !== input.deviceId &&
      request.lockedUntil &&
      request.lockedUntil > at
    ) {
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_REQUEST_CLAIMED',
        message: 'La solicitud ya fue reclamada por otro dispositivo',
      });
    }

    if (request.claimedByDeviceId === input.deviceId && request.status === 'CLAIMED') {
      return request;
    }

    return this.transition({
      requestId: input.requestId,
      action: 'CLAIM',
      actor: input.actor,
      expectedStatus: request.status,
      expectedVersion: request.version,
      at,
      set: {
        deviceId: input.deviceId,
        claimedByDeviceId: input.deviceId,
        claimedAt: at,
        lockedBy: input.actor,
        lockedUntil: new Date(at.getTime() + input.lockMs),
      },
    });
  }

  async releaseExpiredClaim(requestId: string, actor: string, at = new Date()) {
    const request = await this.getRequestById(requestId);
    if (!['CLAIMED', 'SIGNING'].includes(request.status)) {
      return request;
    }
    if (request.userOpHash) {
      return request;
    }
    if (!request.lockedUntil || request.lockedUntil > at) {
      return request;
    }

    return this.transition({
      requestId,
      action: 'RELEASE_CLAIM',
      actor,
      expectedStatus: request.status,
      expectedVersion: request.version,
      at,
      set: {
        deviceId: null,
        claimedByDeviceId: null,
        claimedAt: null,
        lockedBy: null,
        lockedUntil: null,
      },
    });
  }

  async rejectRequest(requestId: string, actor: string, at = new Date()) {
    return this.transition({ requestId, action: 'REJECT', actor, at });
  }

  async startSigning(requestId: string, actor: string, at = new Date()) {
    return this.transition({ requestId, action: 'START_SIGNING', actor, at });
  }

  async registerSubmission(input: {
    requestId: string;
    userOpHash: string;
    txHash?: string | null;
    actor: string;
    at?: Date;
  }): Promise<OfficialPublicationRequestDocument> {
    const userOpHash = input.userOpHash.trim().toLowerCase();
    const txHash = input.txHash?.trim().toLowerCase() || null;
    const request = await this.getRequestById(input.requestId);

    if (request.userOpHash) {
      if (request.userOpHash === userOpHash) {
        if (txHash && request.txHash && request.txHash !== txHash) {
          throw new ConflictException({
            code: 'OFFICIAL_PUBLICATION_TX_HASH_MISMATCH',
            message: 'La solicitud ya tiene una transaccion distinta registrada',
          });
        }
        if (txHash && !request.txHash) {
          const updated = await this.requestModel.findOneAndUpdate(
            {
              requestId: input.requestId,
              userOpHash,
              txHash: { $in: [null, undefined] },
            } as any,
            {
              $set: {
                txHash,
                updatedAt: input.at ?? new Date(),
              },
            } as any,
            { new: true },
          );
          return (updated as unknown as OfficialPublicationRequestDocument | null) ?? request;
        }
        return request;
      }
      throw new ConflictException({
        code: 'OFFICIAL_PUBLICATION_USER_OP_HASH_MISMATCH',
        message: 'La solicitud ya tiene una operacion registrada',
      });
    }

    try {
      return await this.transition({
        requestId: input.requestId,
        action: 'SUBMIT_USER_OPERATION',
        actor: input.actor,
        expectedStatus: request.status,
        expectedVersion: request.version,
        at: input.at,
        set: {
          userOpHash,
          ...(txHash ? { txHash } : {}),
          submittedAt: input.at ?? new Date(),
        },
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'OFFICIAL_PUBLICATION_USER_OP_HASH_DUPLICATED',
          message: 'La operacion ya esta asociada a otra solicitud',
        });
      }
      throw error;
    }
  }

  async markChainPending(requestId: string, actor: string, at = new Date()) {
    return this.transition({
      requestId,
      action: 'MARK_CHAIN_PENDING',
      actor,
      at,
      set: {
        lastCheckedAt: at,
      },
    });
  }

  async markChainConfirmed(
    requestId: string,
    actor: string,
    evidence: {
      txHash: string;
      confirmationBlock?: string | null;
      confirmations?: number;
      at?: Date;
    },
  ) {
    const at = evidence.at ?? new Date();
    return this.transition({
      requestId,
      action: 'CONFIRM_CHAIN',
      actor,
      at,
      set: {
        txHash: evidence.txHash.trim().toLowerCase(),
        confirmationBlock: evidence.confirmationBlock ?? null,
        receiptBlockNumber: evidence.confirmationBlock ?? null,
        confirmedBlockNumber: evidence.confirmationBlock ?? null,
        confirmations: evidence.confirmations ?? 0,
        chainConfirmedAt: at,
        lastCheckedAt: at,
        nextRetryAt: null,
      },
    });
  }

  async startFinalization(requestId: string, actor: string, at = new Date()) {
    return this.transition({
      requestId,
      action: 'START_FINALIZING',
      actor,
      at,
      set: { resumeFromStatus: null },
    });
  }

  async retryFinalization(requestId: string, actor: string, at = new Date()) {
    return this.transition({
      requestId,
      action: 'RETRY_FINALIZATION',
      actor,
      at,
      set: { resumeFromStatus: null },
    });
  }

  async markCompleted(requestId: string, actor: string, at = new Date()) {
    return this.transition({
      requestId,
      action: 'COMPLETE',
      actor,
      at,
      set: {
        finalizedAt: at,
        activeKey: null,
        resumeFromStatus: null,
      },
    });
  }

  async markExpired(requestId: string, actor: string, at = new Date()) {
    return this.transition({ requestId, action: 'EXPIRE', actor, at });
  }

  async cancelRequest(requestId: string, actor: string, at = new Date()) {
    return this.transition({ requestId, action: 'CANCEL', actor, at });
  }

  async markFailedRetryable(
    requestId: string,
    actor: string,
    errorCode: string,
    safeMessage: string,
    resumeFromStatus?: OfficialPublicationRequestStatus,
    at = new Date(),
    errorStage?: string | null,
    retryCount?: number,
  ) {
    const preSubmissionFailure =
      !resumeFromStatus ||
      ['PREPARING', 'PENDING_APPROVAL', 'CLAIMED', 'SIGNING'].includes(resumeFromStatus);
    return this.transition({
      requestId,
      action: 'FAIL_RETRYABLE',
      actor,
      errorCode,
      errorStage: errorStage ?? null,
      safeMessage,
      resumeFromStatus: resumeFromStatus ?? null,
      at,
      set: {
        ...(preSubmissionFailure ? { activeKey: null } : {}),
        ...(typeof retryCount === 'number' ? { retryCount } : {}),
      },
    });
  }

  async markFailedFinal(
    requestId: string,
    actor: string,
    errorCode: string,
    safeMessage: string,
    at = new Date(),
    errorStage?: string | null,
  ) {
    return this.transition({
      requestId,
      action: 'FAIL_FINAL',
      actor,
      errorCode,
      errorStage: errorStage ?? null,
      safeMessage,
      at,
    });
  }

  async markNeedsReview(
    requestId: string,
    actor: string,
    errorCode: string,
    safeMessage: string,
    resumeFromStatus?: OfficialPublicationRequestStatus,
    at = new Date(),
    errorStage?: string | null,
  ) {
    return this.transition({
      requestId,
      action: 'MARK_NEEDS_REVIEW',
      actor,
      errorCode,
      errorStage: errorStage ?? null,
      safeMessage,
      resumeFromStatus: resumeFromStatus ?? null,
      at,
    });
  }

  async markProgress(
    requestId: string,
    progressKey:
      | 'treesPersistedAt'
      | 'credentialsIssuingAt'
      | 'credentialsIssuedAt'
      | 'sessionsCreatedAt'
      | 'eventPublishedAt',
    at = new Date(),
  ) {
    const request = await this.requestModel.findOneAndUpdate(
      {
        requestId,
        [`finalizationProgress.${progressKey}`]: { $in: [null, undefined] },
      },
      {
        $set: {
          [`finalizationProgress.${progressKey}`]: at,
          updatedAt: at,
        },
      },
      { new: true },
    );
    return request ?? this.getRequestById(requestId);
  }

  async recordChainCheck(input: {
    requestId: string;
    at?: Date;
    nextRetryAt?: Date | null;
    retryCount?: number;
    txHash?: string | null;
  }) {
    const at = input.at ?? new Date();
    const set: Record<string, unknown> = {
      lastCheckedAt: at,
      nextRetryAt: input.nextRetryAt ?? null,
      updatedAt: at,
    };
    if (typeof input.retryCount === 'number') {
      set.retryCount = input.retryCount;
    }
    if (input.txHash) {
      set.txHash = input.txHash.trim().toLowerCase();
    }
    const updated = await this.requestModel.findOneAndUpdate(
      { requestId: input.requestId },
      { $set: set },
      { new: true },
    );
    return updated ?? this.getRequestById(input.requestId);
  }

  async acquireProcessingLock(input: {
    requestId: string;
    lockId: string;
    lockMs: number;
    at?: Date;
  }) {
    const at = input.at ?? new Date();
    return this.requestModel.findOneAndUpdate(
      {
        requestId: input.requestId,
        $or: [
          { processingLockId: null },
          { processingLockId: { $exists: false } },
          { processingLockExpiresAt: { $lte: at } },
        ],
      } as any,
      {
        $set: {
          processingLockId: input.lockId,
          processingLockedAt: at,
          processingLockExpiresAt: new Date(at.getTime() + input.lockMs),
          updatedAt: at,
        },
      },
      { new: true },
    );
  }

  async releaseProcessingLock(requestId: string, lockId: string, at = new Date()) {
    const updated = await this.requestModel.findOneAndUpdate(
      { requestId, processingLockId: lockId },
      {
        $set: {
          processingLockId: null,
          processingLockedAt: null,
          processingLockExpiresAt: null,
          updatedAt: at,
        },
      },
      { new: true },
    );
    return updated ?? this.getRequestById(requestId);
  }

  async findReconciliationBatch(input: {
    statuses: OfficialPublicationRequestStatus[];
    limit: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.requestModel
      .find({
        status: { $in: input.statuses },
        $or: [
          { nextRetryAt: null },
          { nextRetryAt: { $exists: false } },
          { nextRetryAt: { $lte: now } },
          { status: { $in: ['CHAIN_CONFIRMED', 'FINALIZING'] } },
        ],
      } as any)
      .sort({ updatedAt: 1 })
      .limit(input.limit);
  }

  private toObjectId(value: Types.ObjectId | string) {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }

  private isDuplicateKeyError(error: any) {
    return error?.code === 11000 || error?.codeName === 'DuplicateKey';
  }
}
