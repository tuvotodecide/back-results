import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  tokenAccreditationSourceTypes,
  TokenAccreditationSourceType,
  tokenAccreditationStatuses,
  TokenAccreditationStatus,
  tokenAccreditationFailureCategories,
  TokenAccreditationFailureCategory,
} from '../tvd.constants';

export type TokenAccreditationDocument = TokenAccreditation &
  Document & { _id: Types.ObjectId };

@Schema({ timestamps: true, collection: 'token_accreditations' })
export class TokenAccreditation {
  @Prop({
    type: String,
    required: true,
    enum: tokenAccreditationSourceTypes,
    index: true,
  })
  sourceType: TokenAccreditationSourceType;

  @Prop({ type: String, required: true, trim: true, index: true })
  sourceId: string;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  idempotencyRequestHash?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', required: true, index: true })
  targetAssignmentId: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  targetWallet: string;

  @Prop({ type: String, required: true, trim: true, lowercase: true, index: true })
  targetWalletNormalized: string;

  @Prop({ type: String, trim: true, default: null })
  fiatAmountMinor?: string | null;

  @Prop({ type: String, enum: ['BOB'], default: null })
  fiatCurrency?: 'BOB' | null;

  @Prop({ type: String, trim: true, default: null })
  bobPerToken?: string | null;

  @Prop({ type: Number, default: null })
  exchangeRateVersion?: number | null;

  @Prop({ type: String, required: true, trim: true })
  tokenAmount: string;

  @Prop({ type: String, trim: true, default: null })
  tokenAmountSmallestUnit?: string | null;

  @Prop({ type: String, trim: true, maxlength: 240, default: null })
  reason?: string | null;

  @Prop({ type: String, trim: true, maxlength: 40, default: null })
  requestedByRole?: string | null;

  @Prop({
    type: String,
    required: true,
    enum: tokenAccreditationStatuses,
    default: 'PENDING',
    index: true,
  })
  status: TokenAccreditationStatus;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  attempts: number;

  @Prop({ type: String, trim: true, default: null, index: true })
  processingOwner?: string | null;

  @Prop({ type: Date, default: null })
  processingLockedAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  processingLockExpiresAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  nextAttemptAt?: Date | null;

  @Prop({ type: Number, min: 1, default: null })
  maxAttempts?: number | null;

  @Prop({ type: Boolean, default: true })
  retryable?: boolean;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  lastErrorCode?: string | null;

  @Prop({ type: Date, default: null })
  lastErrorAt?: Date | null;

  @Prop({
    type: String,
    enum: tokenAccreditationFailureCategories,
    default: null,
    index: true,
  })
  failureCategory?: TokenAccreditationFailureCategory | null;

  @Prop({ type: String, trim: true, default: null })
  txHash?: string | null;

  @Prop({ type: String, trim: true, default: null })
  userOpHash?: string | null;

  @Prop({ type: String, trim: true, default: null })
  nonce?: string | null;

  @Prop({ type: String, trim: true, default: null })
  operatorAddress?: string | null;

  @Prop({ type: String, trim: true, default: null, select: false })
  serializedTransaction?: string | null;

  @Prop({ type: Date, default: null })
  preparedAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastBroadcastAt?: Date | null;

  @Prop({ type: Date, default: null })
  lastReceiptCheckAt?: Date | null;

  @Prop({ type: Number, default: null })
  chainId?: number | null;

  @Prop({ type: String, trim: true, default: null })
  contractAddress?: string | null;

  @Prop({ type: String, trim: true, default: null })
  blockNumber?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const TokenAccreditationSchema =
  SchemaFactory.createForClass(TokenAccreditation);

TokenAccreditationSchema.pre('validate', function normalizeWalletBeforeValidate() {
  const wallet = this.targetWallet?.trim();
  this.targetWalletNormalized = wallet ? wallet.toLowerCase() : this.targetWalletNormalized;
});

TokenAccreditationSchema.index({ sourceType: 1, sourceId: 1 }, { unique: true });
TokenAccreditationSchema.index({ tenantId: 1, createdAt: -1 });
TokenAccreditationSchema.index({ targetAssignmentId: 1, createdAt: -1 });
TokenAccreditationSchema.index({ targetWalletNormalized: 1, createdAt: -1 });
TokenAccreditationSchema.index({ status: 1, createdAt: 1 });
TokenAccreditationSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
TokenAccreditationSchema.index({ status: 1, processingLockExpiresAt: 1 });
TokenAccreditationSchema.index({ txHash: 1 }, { sparse: true });
TokenAccreditationSchema.index({ userOpHash: 1 }, { sparse: true });
