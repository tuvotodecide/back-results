import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AttestationDocument = Attestation & Document & { _id: Types.ObjectId };

@Schema({
  timestamps: true,
  collection: 'attestations',
})
export class Attestation {
  @Prop({ required: true })
  support: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Ballot', required: true })
  ballotId: Types.ObjectId;

  @Prop({ required: true })
  isJury: boolean; 

  
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const AttestationSchema = SchemaFactory.createForClass(Attestation);

AttestationSchema.index({ ballotId: 1 });
AttestationSchema.index({ isJury: 1 });
AttestationSchema.index({ support: 1 });
AttestationSchema.index({ createdAt: 1 });
AttestationSchema.index({ userId: 1 });
AttestationSchema.index({ userId: 1, ballotId: 1 }, { unique: true }); 
