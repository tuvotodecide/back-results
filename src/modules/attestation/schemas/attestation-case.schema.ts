import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttestationCaseDocument = AttestationCase & Document;

@Schema({
  timestamps: true,
  collection: 'attestation_cases',
})
export class AttestationCase {
  @Prop({ required: true, trim: true })
  tableCode: string;

  @Prop({
    enum: ['VERIFYING', 'PENDING', 'CONSENSUAL', 'CLOSED'],
    required: true,
  })
  status: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED';

  @Prop({ type: Types.ObjectId, ref: 'Ballot' })
  winningBallotId?: Types.ObjectId;

  @Prop({ default: null })
  resolvedAt?: Date;

  @Prop({ type: Object })
  summary?: any;
}

export const AttestationCaseSchema =
  SchemaFactory.createForClass(AttestationCase);

AttestationCaseSchema.index({ tableCode: 1 }, { unique: true });
AttestationCaseSchema.index({ status: 1 });
