import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VotingEventDocument = VotingEvent & Document;

export type VotingEventState =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'CLOSED'
  | 'RESULTS_PUBLISHED';

@Schema({ timestamps: true, collection: 'voting_events' })
export class VotingEvent {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  objective: string;

  @Prop({ type: Date, required: false })
  votingStart?: Date;

  @Prop({ type: Date, required: false })
  votingEnd?: Date;

  @Prop({ type: Date, required: false })
  resultsPublishAt?: Date;

  @Prop({
    required: true,
    enum: ['DRAFT', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'],
    default: 'DRAFT',
    index: true,
  })
  state: VotingEventState;

  @Prop({ default: false })
  publicEligibilityEnabled: boolean;
}

export const VotingEventSchema = SchemaFactory.createForClass(VotingEvent);

VotingEventSchema.index({ tenantId: 1, state: 1, votingStart: 1, votingEnd: 1 });
