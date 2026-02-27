import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LiveEffectiveBallotDocument = LiveEffectiveBallot & Document;

@Schema({
  timestamps: true,
  collection: 'live_effective_ballots',
})
export class LiveEffectiveBallot {
  @Prop({ type: Types.ObjectId, ref: 'ElectionConfig', required: true, index: true })
  electionId: Types.ObjectId;

  @Prop({ required: true, index: true })
  tableCode: string;

  @Prop({ type: Object, required: true })
  location: Record<string, any>;

  @Prop({ type: Object, required: true })
  votes: Record<string, any>;

  @Prop({ required: true })
  status: string;

  @Prop({ required: true, index: true })
  projectionVersion: number;

  @Prop({ required: true, index: true })
  projectionUpdatedAt: Date;
}

export const LiveEffectiveBallotSchema =
  SchemaFactory.createForClass(LiveEffectiveBallot);

LiveEffectiveBallotSchema.index({ electionId: 1, tableCode: 1 }, { unique: true });
LiveEffectiveBallotSchema.index({ electionId: 1, 'location.department': 1 });
LiveEffectiveBallotSchema.index({ electionId: 1, 'location.province': 1 });
LiveEffectiveBallotSchema.index({ electionId: 1, 'location.municipality': 1 });
LiveEffectiveBallotSchema.index({ electionId: 1, status: 1, tableCode: 1 });
LiveEffectiveBallotSchema.index({
  electionId: 1,
  'location.department': 1,
  'location.province': 1,
  'location.municipality': 1,
  'location.electoralSeat': 1,
  tableCode: 1,
});
