import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalEmailOutboxDocument =
  InstitutionalEmailOutbox & Document & { _id: Types.ObjectId };

export const institutionalEmailOutboxTypes = [
  'INSTITUTIONAL_VERIFY_EMAIL',
  'INSTITUTIONAL_PASSWORD_RESET',
] as const;
export type InstitutionalEmailOutboxType = typeof institutionalEmailOutboxTypes[number];

export const institutionalEmailOutboxStatuses = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'NEEDS_REVIEW',
] as const;
export type InstitutionalEmailOutboxStatus = typeof institutionalEmailOutboxStatuses[number];

@Schema({ timestamps: false, collection: 'institutional_email_outbox' })
export class InstitutionalEmailOutbox {
  @Prop({ required: true, enum: institutionalEmailOutboxTypes, index: true })
  type: InstitutionalEmailOutboxType;

  @Prop({ required: true, trim: true })
  recipient: string;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ required: true, trim: true })
  template: string;

  @Prop({ type: Object, default: {} })
  safePayload: Record<string, unknown>;

  @Prop({ required: true, trim: true })
  idempotencyKey: string;

  @Prop({ required: true, enum: institutionalEmailOutboxStatuses, default: 'PENDING', index: true })
  status: InstitutionalEmailOutboxStatus;

  @Prop({ type: Number, default: 0, min: 0 })
  attempts: number;

  @Prop({ type: Date, default: Date.now, index: true })
  nextAttemptAt: Date;

  @Prop({ type: Date, default: Date.now, immutable: true, index: true })
  createdAt: Date;

  @Prop({ type: Date, default: null })
  sentAt?: Date | null;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  lockedBy?: string | null;

  @Prop({ type: Date, default: null })
  processingStartedAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  lastErrorSanitized?: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  correlationId?: string | null;

  @Prop({ type: Types.ObjectId, default: null, index: true })
  targetId?: Types.ObjectId | null;
}

export const InstitutionalEmailOutboxSchema =
  SchemaFactory.createForClass(InstitutionalEmailOutbox);

InstitutionalEmailOutboxSchema.index({ status: 1, nextAttemptAt: 1, lockedAt: 1 });
InstitutionalEmailOutboxSchema.index({ type: 1, targetId: 1, createdAt: -1 });
InstitutionalEmailOutboxSchema.index({ idempotencyKey: 1 }, { unique: true });
