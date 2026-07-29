import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  confirmationSources,
  ConfirmationSource,
  PAYMENT_PROVIDER_RED_ENLACE,
  paymentStatuses,
  PaymentStatus,
} from '../payments.constants';

export type PaymentTransactionDocument = PaymentTransaction &
  Document & { _id: Types.ObjectId };

export type PaymentTvdQuoteSnapshot = {
  fiatAmountMinor: string;
  fiatCurrency: 'BOB';
  bobPerToken: string;
  exchangeRateVersion: number;
  tokenAmount: string;
  tokenAmountSmallestUnit?: string | null;
  quotedAt: Date;
  expiresAt?: Date | null;
};

@Schema({ timestamps: true, collection: 'payment_transactions' })
export class PaymentTransaction {
  @Prop({
    type: Types.ObjectId,
    ref: 'InstitutionalTenant',
    required: true,
    index: true,
  })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  requestedByUserId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', default: null, index: true })
  targetAssignmentId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  targetWallet?: string | null;

  @Prop({ type: String, trim: true, lowercase: true, default: null, index: true })
  targetWalletNormalized?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'PaymentTransaction', default: null, index: true })
  previousPaymentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'PaymentTransaction', default: null, index: true })
  regeneratedToPaymentId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  regenerationReason?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null, index: true })
  regenerationLockOwner?: string | null;

  @Prop({ type: Date, default: null })
  regenerationLockedAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  regenerationLockExpiresAt?: Date | null;

  @Prop({
    type: String,
    required: true,
    enum: [PAYMENT_PROVIDER_RED_ENLACE],
    index: true,
  })
  provider: typeof PAYMENT_PROVIDER_RED_ENLACE;

  @Prop({ required: true, trim: true, unique: true, maxlength: 9 })
  merchantReference: string;

  @Prop({ type: String, trim: true, default: null })
  providerReference?: string | null;

  // Stored as minor units in string form to avoid floating point accounting.
  @Prop({ required: true, trim: true })
  amountMinor: string;

  @Prop({ type: String, required: true, enum: ['BOB'], default: 'BOB' })
  currency: 'BOB';

  @Prop({
    type: String,
    required: true,
    enum: paymentStatuses,
    default: 'CREATED',
    index: true,
  })
  status: PaymentStatus;

  @Prop({ type: String, trim: true, maxlength: 40, default: null })
  providerStatus?: string | null;

  @Prop({ type: String, trim: true, maxlength: 20, default: null })
  providerResponseCode?: string | null;

  @Prop({ type: String, trim: true, maxlength: 240, default: null })
  providerResponseDetail?: string | null;

  @Prop({ type: String, default: null })
  qrImage?: string | null;

  @Prop({ type: Date, default: null, index: true })
  qrExpiresAt?: Date | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  achReference?: string | null;

  @Prop({ type: Date, default: null })
  paymentDate?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  @Prop({ type: String, enum: confirmationSources, default: null })
  confirmationSource?: ConfirmationSource | null;

  @Prop({ type: String, trim: true, maxlength: 120, default: null })
  idempotencyKey?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  idempotencyRequestHash?: string | null;

  @Prop({
    type: {
      fiatAmountMinor: { type: String, required: true, trim: true },
      fiatCurrency: { type: String, required: true, enum: ['BOB'] },
      bobPerToken: { type: String, required: true, trim: true },
      exchangeRateVersion: { type: Number, required: true },
      tokenAmount: { type: String, required: true, trim: true },
      tokenAmountSmallestUnit: { type: String, trim: true, default: null },
      quotedAt: { type: Date, required: true },
      expiresAt: { type: Date, default: null },
    },
    default: null,
    immutable: true,
    _id: false,
  })
  tvdQuote?: PaymentTvdQuoteSnapshot | null;

  @Prop({ type: Types.ObjectId, ref: 'TokenAccreditation', default: null, index: true })
  tokenAccreditationId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: [
      'PENDING',
      'SUBMITTING',
      'SUBMITTED',
      'CONFIRMED',
      'FAILED',
      'FAILED_TERMINAL',
      'BLOCKED_CONFIGURATION',
      'NEEDS_REVIEW',
    ],
    default: null,
    index: true,
  })
  tokenAccreditationStatus?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  tokenAccreditationErrorCode?: string | null;

  @Prop({ type: Number, required: true, min: 0, default: 0 })
  reconciliationAttempts: number;

  @Prop({ type: Date, default: null, index: true })
  reconciliationLastAttemptAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  reconciliationNextAttemptAt?: Date | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  reconciliationLastProviderStatus?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  reconciliationLastErrorCode?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null, index: true })
  reconciliationLockOwner?: string | null;

  @Prop({ type: Date, default: null })
  reconciliationLockedAt?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  reconciliationLockExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  reconciliationExhaustedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const PaymentTransactionSchema =
  SchemaFactory.createForClass(PaymentTransaction);

PaymentTransactionSchema.index(
  { provider: 1, providerReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerReference: { $type: 'string' },
    },
  },
);

PaymentTransactionSchema.index(
  { tenantId: 1, requestedByUserId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      idempotencyKey: { $type: 'string' },
    },
  },
);

PaymentTransactionSchema.index({ tenantId: 1, createdAt: -1 });
PaymentTransactionSchema.index({ status: 1, updatedAt: -1 });
PaymentTransactionSchema.index({
  status: 1,
  reconciliationNextAttemptAt: 1,
  reconciliationLockExpiresAt: 1,
});

PaymentTransactionSchema.pre('validate', function normalizeTargetWalletBeforeValidate() {
  const wallet = this.targetWallet?.trim();
  this.targetWalletNormalized = wallet
    ? wallet.toLowerCase()
    : this.targetWalletNormalized;
});

PaymentTransactionSchema.pre(
  ['findOneAndUpdate', 'updateOne', 'updateMany'],
  function preventTvdQuoteOverwrite() {
    const update = this.getUpdate() as any;
    const directSet = update?.$set ?? update;
    const attemptsSnapshotOverwrite =
      Object.prototype.hasOwnProperty.call(directSet ?? {}, 'tvdQuote') ||
      Object.keys(directSet ?? {}).some((key) => key.startsWith('tvdQuote.'));

    if (attemptsSnapshotOverwrite) {
      throw new Error('TVD quote snapshot is immutable');
    }
  },
);
