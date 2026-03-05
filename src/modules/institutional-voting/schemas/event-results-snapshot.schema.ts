import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type EventResultsSnapshotDocument = EventResultsSnapshot & Document;

@Schema({ _id: false })
export class EventResultOption {
  @Prop({ required: true, trim: true })
  optionName: string;

  @Prop({ required: true })
  votes: number;

  @Prop({ required: true })
  percentage: number;
}

@Schema({ _id: false })
export class EventResultRole {
  @Prop({ required: true, trim: true })
  roleName: string;

  @Prop({ required: true })
  total: number;

  @Prop({ type: [EventResultOption], default: [] })
  ranking: EventResultOption[];

  @Prop({ type: [EventResultOption], default: [] })
  winners: EventResultOption[];
}

@Schema({ timestamps: true, collection: 'event_results_snapshots' })
export class EventResultsSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, unique: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, trim: true, default: 'BLOCKCHAIN' })
  source: string;

  @Prop({ required: false, trim: true })
  txHash?: string;

  @Prop({ required: false, trim: true })
  blockNumber?: string;

  @Prop({ type: [EventResultRole], default: [] })
  roles: EventResultRole[];
}

export const EventResultsSnapshotSchema =
  SchemaFactory.createForClass(EventResultsSnapshot);

EventResultsSnapshotSchema.index({ eventId: 1 }, { unique: true });
