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
