import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PresentialSessionDocument = PresentialSession &
  Document & { _id: Types.ObjectId };

export type PresentialSessionStatus =
  | 'READY'
  | 'CLAIMED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED';

@Schema({ timestamps: true, collection: 'presential_qr_sessions' })
export class PresentialSession {
  @Prop({
    type: Types.ObjectId,
    ref: 'VotingEvent',
    required: true,
    index: true,
  })
  eventId: Types.ObjectId;

  @Prop({ required: true, trim: true, default: 'kiosco-principal', index: true })
  stationId: string;

  @Prop({ required: true, trim: true })
  tokenId: string;

  @Prop({ required: true, trim: true, unique: true })
  tokenHash: string;

  @Prop({
    required: true,
    enum: ['READY', 'CLAIMED', 'COMPLETED', 'EXPIRED', 'CANCELLED'],
    default: 'READY',
    index: true,
  })
  status: PresentialSessionStatus;

  @Prop({ required: true, index: true })
  expiresAt: Date;

  @Prop({ type: Date, required: false, default: null })
  claimedAt?: Date | null;

  @Prop({ type: Date, required: false, default: null })
  completedAt?: Date | null;

  @Prop({ type: String, required: false, default: null, trim: true })
  claimedByCarnetNorm?: string | null;

  @Prop({ type: Types.ObjectId, required: false, default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ required: true, default: 1 })
  rotationNumber: number;

  @Prop({ required: true, default: 300 })
  claimTtlSeconds: number;
}

export const PresentialSessionSchema =
  SchemaFactory.createForClass(PresentialSession);

PresentialSessionSchema.index(
  { eventId: 1, stationId: 1, status: 1, expiresAt: 1 },
  { name: 'presential_session_status_idx' },
);

PresentialSessionSchema.index(
  { eventId: 1, stationId: 1 },
  {
    name: 'presential_session_single_active_idx',
    unique: true,
    partialFilterExpression: {
      status: { $in: ['READY', 'CLAIMED'] },
    },
  },
);
