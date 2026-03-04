import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventRoleDocument = EventRole & Document;

@Schema({ timestamps: true, collection: 'event_roles' })
export class EventRole {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  normalizedName: string;

  @Prop({ default: 1 })
  maxWinners: number;
}

export const EventRoleSchema = SchemaFactory.createForClass(EventRole);

EventRoleSchema.index({ eventId: 1, normalizedName: 1 }, { unique: true });
