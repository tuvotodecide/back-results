import { randomUUID } from 'crypto';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const OFFICIAL_PUBLICATION_REQUEST_STATUSES = [
  'PREPARING',
  'PENDING_APPROVAL',
  'CLAIMED',
  'SIGNING',
  'SUBMITTED',
  'CHAIN_PENDING',
  'CHAIN_CONFIRMED',
  'FINALIZING',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'NEEDS_REVIEW',
] as const;

export type OfficialPublicationRequestStatus =
  (typeof OFFICIAL_PUBLICATION_REQUEST_STATUSES)[number];

export const OFFICIAL_PUBLICATION_TERMINAL_STATUSES: readonly OfficialPublicationRequestStatus[] = [
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'FAILED_FINAL',
];

export const OFFICIAL_PUBLICATION_ADMIN_ACTIVE_STATUSES: readonly OfficialPublicationRequestStatus[] = [
  'PREPARING',
  'PENDING_APPROVAL',
  'CLAIMED',
  'SIGNING',
  'SUBMITTED',
  'CHAIN_PENDING',
  'CHAIN_CONFIRMED',
  'FINALIZING',
];

export const OFFICIAL_PUBLICATION_MOBILE_ACTIVE_STATUSES: readonly OfficialPublicationRequestStatus[] = [
  'PENDING_APPROVAL',
  'CLAIMED',
  'SIGNING',
];

export const OFFICIAL_PUBLICATION_RETRYABLE_PRE_SUBMISSION_STATUSES: readonly OfficialPublicationRequestStatus[] = [
  'FAILED_RETRYABLE',
  'EXPIRED',
];

export const OFFICIAL_PUBLICATION_RECOVERABLE_STATUSES: readonly OfficialPublicationRequestStatus[] = [
  'SUBMITTED',
  'CHAIN_PENDING',
  'CHAIN_CONFIRMED',
  'FINALIZING',
  'FAILED_RETRYABLE',
  'NEEDS_REVIEW',
];

export const OFFICIAL_PUBLICATION_ACTIVE_STATUSES =
  OFFICIAL_PUBLICATION_REQUEST_STATUSES.filter(
    (status) => !OFFICIAL_PUBLICATION_TERMINAL_STATUSES.includes(status),
  );

export type OfficialPublicationRequestDocument =
  OfficialPublicationRequest &
  Document & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ _id: false })
export class OfficialPublicationCallData {
  @Prop({ required: true, trim: true })
  to!: string;

  @Prop({ required: true, trim: true })
  value!: string;

  @Prop({ required: true, trim: true })
  data!: string;
}

@Schema({ _id: false })
export class OfficialPublicationExecutionCall {
  @Prop({ required: true, trim: true, lowercase: true })
  target!: string;

  @Prop({ required: true, trim: true })
  value!: string;

  @Prop({ required: true, trim: true })
  callData!: string;

  @Prop({ required: true, enum: ['TVD_APPROVAL', 'CREATE_VOTE'] })
  purpose!: 'TVD_APPROVAL' | 'CREATE_VOTE';
}

@Schema({ _id: false })
export class OfficialPublicationMerkleRoots {
  @Prop({ required: true, trim: true })
  ciMerkleRoot!: string;

  @Prop({ required: true, trim: true })
  voteMerkleRoot!: string;
}

@Schema({ _id: false })
export class OfficialPublicationNullifiersRef {
  @Prop({ required: true, trim: true })
  storage!: string;

  @Prop({ required: true, trim: true })
  ref!: string;

  @Prop({ required: true, trim: true })
  digest!: string;

  @Prop({ required: true, min: 0 })
  count!: number;
}

@Schema({ _id: false })
export class OfficialPublicationFinalizationProgress {
  @Prop({ type: Date, required: false, default: null })
  treesPersistedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  credentialsIssuingAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  credentialsIssuedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  sessionsCreatedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  eventPublishedAt?: Date | null;
}

@Schema({ _id: false })
export class OfficialPublicationStatusHistoryEntry {
  @Prop({
    required: true,
    enum: OFFICIAL_PUBLICATION_REQUEST_STATUSES,
  })
  from!: OfficialPublicationRequestStatus;

  @Prop({
    required: true,
    enum: OFFICIAL_PUBLICATION_REQUEST_STATUSES,
  })
  to!: OfficialPublicationRequestStatus;

  @Prop({ required: true, trim: true })
  action!: string;

  @Prop({ required: true, trim: true })
  actor!: string;

  @Prop({ type: Date, required: true })
  at!: Date;
}

@Schema({ timestamps: true, collection: 'official_publication_requests' })
export class OfficialPublicationRequest {
  @Prop({ required: true, unique: true, default: () => randomUUID(), index: true })
  requestId!: string;

  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: String, required: false, default: null, trim: true, index: true })
  activeKey?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  institutionId!: string;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminApplication', required: true })
  applicationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  requestedByUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  signerUserId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', required: true })
  assignmentId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  signerWallet!: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  smartAccountAddress!: string;

  @Prop({ type: String, required: false, default: null, trim: true, lowercase: true })
  ownerWalletAddress?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  deviceId?: string | null;

  @Prop({ required: true, min: 1 })
  chainId!: number;

  @Prop({ type: String, required: false, default: null, trim: true, lowercase: true })
  entryPoint?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true, lowercase: true })
  entryPointAddress?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  entryPointVersion?: string | null;

  @Prop({ required: true, trim: true, index: true })
  onChainElectionId!: string;

  @Prop({
    required: true,
    enum: OFFICIAL_PUBLICATION_REQUEST_STATUSES,
    default: 'PREPARING',
    index: true,
  })
  status!: OfficialPublicationRequestStatus;

  @Prop({ required: true, default: 0, min: 0 })
  version!: number;

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Date, required: false, default: null })
  preparedAt?: Date | null;

  @Prop({ type: OfficialPublicationCallData, required: true })
  callData!: OfficialPublicationCallData;

  @Prop({ required: true, trim: true, index: true })
  callDataHash!: string;

  @Prop({ type: [OfficialPublicationExecutionCall], required: false, default: undefined })
  executionCalls?: OfficialPublicationExecutionCall[];

  @Prop({ required: false, enum: ['SINGLE', 'BATCH'], default: 'SINGLE', index: true })
  executionMode?: 'SINGLE' | 'BATCH';

  @Prop({ required: false, trim: true, index: true })
  callsHash?: string;

  @Prop({ required: false, default: 1, min: 1 })
  callsCount?: number;

  @Prop({ required: false, default: 1, min: 1 })
  executionPackageVersion?: number;

  @Prop({ required: false, default: false })
  approveRequired?: boolean;

  @Prop({ required: false, trim: true, default: '0' })
  allowanceBefore?: string;

  @Prop({ required: false, trim: true, default: '0' })
  walletDebitRequired?: string;

  @Prop({ required: true, trim: true, index: true })
  snapshotHash!: string;

  @Prop({ type: Types.ObjectId, ref: 'OfficialPublicationArtifact', required: false, default: null, index: true })
  preparedArtifactId?: Types.ObjectId | null;

  @Prop({ required: true, trim: true, lowercase: true })
  proxyAddress!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  implementationAddress!: string;

  @Prop({ required: true, trim: true })
  abiVersion!: string;

  @Prop({ type: Types.ObjectId, ref: 'PadronVersion', required: true, index: true })
  padronVersionId!: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  enabledVotersCount!: number;

  @Prop({ required: true, trim: true })
  optionsHash!: string;

  @Prop({ type: OfficialPublicationMerkleRoots, required: true })
  merkleRoots!: OfficialPublicationMerkleRoots;

  @Prop({ type: OfficialPublicationNullifiersRef, required: true })
  nullifiersRef!: OfficialPublicationNullifiersRef;

  @Prop({ required: true, trim: true })
  creditsRequired!: string;

  @Prop({ required: true, trim: true })
  tvdRequired!: string;

  @Prop({ required: true, trim: true })
  tvdPerCredit!: string;

  @Prop({ required: true, trim: true })
  tokenSource!: string;

  @Prop({ required: true, trim: true, lowercase: true })
  spender!: string;

  @Prop({ type: String, required: false, default: null, trim: true, lowercase: true, index: true })
  userOpHash?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true, lowercase: true, index: true })
  txHash?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  confirmationBlock?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  receiptBlockNumber?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  confirmedBlockNumber?: string | null;

  @Prop({ required: false, default: 0, min: 0 })
  confirmations!: number;

  @Prop({ type: Date, required: false, default: null, index: true })
  lastCheckedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null, index: true })
  nextRetryAt?: Date | null;

  @Prop({ required: false, default: 0, min: 0 })
  retryCount!: number;

  @Prop({ type: String, required: false, default: null, trim: true })
  errorCode?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true, index: true })
  errorStage?: string | null;

  @Prop({ type: Date, required: false, default: null, index: true })
  lastErrorAt?: Date | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  safeMessage?: string | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  resumeFromStatus?: OfficialPublicationRequestStatus | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  lockedBy?: string | null;

  @Prop({ type: Date, required: false, default: null, index: true })
  lockedUntil?: Date | null;

  @Prop({ type: String, required: false, default: null, trim: true, index: true })
  processingLockId?: string | null;

  @Prop({ type: Date, required: false, default: null })
  processingLockedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null, index: true })
  processingLockExpiresAt?: Date | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  claimedByDeviceId?: string | null;

  @Prop({ type: Date, required: false, default: null })
  claimedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  submittedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  chainConfirmedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  finalizedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  terminalAt?: Date | null;

  @Prop({ type: OfficialPublicationFinalizationProgress, default: () => ({}) })
  finalizationProgress!: OfficialPublicationFinalizationProgress;

  @Prop({ type: [OfficialPublicationStatusHistoryEntry], default: [] })
  statusHistory!: OfficialPublicationStatusHistoryEntry[];
}

export const OfficialPublicationRequestSchema = SchemaFactory.createForClass(
  OfficialPublicationRequest,
);

OfficialPublicationRequestSchema.index(
  { activeKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      activeKey: { $type: 'string' },
    },
    name: 'unique_active_official_publication_request_key',
  },
);

OfficialPublicationRequestSchema.index(
  { eventId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: OFFICIAL_PUBLICATION_ACTIVE_STATUSES },
    },
    name: 'unique_active_official_publication_request_per_event',
  },
);

OfficialPublicationRequestSchema.index(
  { userOpHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      userOpHash: { $type: 'string' },
    },
    name: 'unique_official_publication_user_op_hash',
  },
);

OfficialPublicationRequestSchema.index(
  { txHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      txHash: { $type: 'string' },
    },
    name: 'unique_official_publication_tx_hash',
  },
);

OfficialPublicationRequestSchema.index({ expiresAt: 1, status: 1 });
OfficialPublicationRequestSchema.index({ status: 1, updatedAt: 1 });
OfficialPublicationRequestSchema.index({ lockedUntil: 1, status: 1 });
OfficialPublicationRequestSchema.index({ processingLockExpiresAt: 1, status: 1 });
OfficialPublicationRequestSchema.index({ nextRetryAt: 1, status: 1 });
