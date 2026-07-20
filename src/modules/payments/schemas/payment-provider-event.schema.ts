import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  PAYMENT_PROVIDER_RED_ENLACE,
  providerEventProcessingStatuses,
  ProviderEventProcessingStatus,
} from '../payments.constants';

export type PaymentProviderEventDocument = PaymentProviderEvent &
  Document & { _id: Types.ObjectId };

@Schema({ timestamps: true, collection: 'payment_provider_events' })
export class PaymentProviderEvent {
  @Prop({
    type: String,
    required: true,
    enum: [PAYMENT_PROVIDER_RED_ENLACE],
    index: true,
  })
  provider: typeof PAYMENT_PROVIDER_RED_ENLACE;

  @Prop({ required: true, trim: true, index: true })
  providerReference: string;

  @Prop({ required: true, trim: true })
  eventFingerprint: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  providerStatus: string;

  @Prop({ type: String, trim: true, default: null })
  amountMinor?: string | null;

  @Prop({ type: String, trim: true, maxlength: 3, default: null })
  currency?: string | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  achReference?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'PaymentTransaction', default: null, index: true })
  paymentId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  paymentDate?: Date | null;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  processingResult?: string | null;

  @Prop({
    required: true,
    enum: providerEventProcessingStatuses,
    default: 'RECEIVED',
    index: true,
  })
  processingStatus: ProviderEventProcessingStatus;

  @Prop({ required: true, trim: true, maxlength: 40 })
  authenticationMode: string;

  @Prop({ type: Date, default: Date.now, index: true })
  receivedAt: Date;

  @Prop({ type: Date, default: null })
  processedAt?: Date | null;

  @Prop({ required: true, default: 0 })
  attemptCount: number;

  @Prop({ type: String, trim: true, maxlength: 80, default: null })
  lastErrorCode?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const PaymentProviderEventSchema =
  SchemaFactory.createForClass(PaymentProviderEvent);

PaymentProviderEventSchema.index({ eventFingerprint: 1 }, { unique: true });
PaymentProviderEventSchema.index({ providerReference: 1, processingStatus: 1 });
PaymentProviderEventSchema.index(
  { provider: 1, achReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      achReference: { $type: 'string', $gt: '' },
    },
  },
);
