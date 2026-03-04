import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ParticipationDocument = Participation & Document;

@Schema({ timestamps: true, collection: 'participations' })
export class Participation {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  carnetNorm: string;

  @Prop({ required: false, trim: true })
  idempotencyKey?: string;

  @Prop({ required: true, default: Date.now })
  participatedAt: Date;
}

export const ParticipationSchema = SchemaFactory.createForClass(Participation);

ParticipationSchema.index({ eventId: 1, carnetNorm: 1 }, { unique: true });
ParticipationSchema.index(
  { eventId: 1, carnetNorm: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true, $type: 'string' } } },
);
