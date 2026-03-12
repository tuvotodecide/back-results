import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BallotComparisonDocument = BallotComparison &
  Document & { _id: Types.ObjectId };

@Schema({ _id: false })
class ComparisonMismatch {
  @Prop({ required: true })
  field: string;

  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  local: number;

  @Prop({ required: true })
  tse: number;

  @Prop({ enum: ['party', 'metric'], required: true })
  kind: 'party' | 'metric';
}

@Schema({
  timestamps: true,
  collection: 'ballot_comparisons',
})
export class BallotComparison {
  @Prop({ type: Types.ObjectId, ref: 'Ballot', required: true, unique: true })
  ballotId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'ElectionConfig', required: true, index: true })
  electionId: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  tableCode: string;

  @Prop({
    required: true,
    enum: ['MATCH', 'MISMATCH', 'NO_TSE_DATA', 'ERROR', 'PENDING'],
    index: true,
  })
  status: 'MATCH' | 'MISMATCH' | 'NO_TSE_DATA' | 'ERROR' | 'PENDING';

  @Prop({ type: [ComparisonMismatch], default: [] })
  mismatches: ComparisonMismatch[];

  @Prop({ type: Object, default: null })
  normalizedLocalVotes?: Record<string, any> | null;

  @Prop({ type: Object, default: null })
  normalizedTseVotes?: Record<string, any> | null;

  @Prop({ type: Date, default: null })
  comparedAt?: Date | null;

  @Prop({ type: Date, default: null })
  tseFetchedAt?: Date | null;

  @Prop({ default: 0 })
  comparedFields?: number;

  @Prop({ default: 0 })
  matchedFields?: number;

  @Prop({ default: false })
  exactMatch?: boolean;

  @Prop({ type: String, default: null })
  errorMessage?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export const BallotComparisonSchema =
  SchemaFactory.createForClass(BallotComparison);

BallotComparisonSchema.index({ electionId: 1, tableCode: 1 });
BallotComparisonSchema.index({ electionId: 1, status: 1 });
