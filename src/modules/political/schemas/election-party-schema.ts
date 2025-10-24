import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectionPartyDocument = ElectionParty & Document;

@Schema({ timestamps: true, collection: 'election_parties' })
export class ElectionParty {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  electionId: Types.ObjectId;

  @Prop({ required: true })
  partyId: string;

  @Prop({ default: true })
  active: boolean;

  @Prop() ballotNumber?: number;
  @Prop() allianceName?: string;
  @Prop() color?: string;
}

export const ElectionPartySchema = SchemaFactory.createForClass(ElectionParty);


ElectionPartySchema.index({ electionId: 1, partyId: 1 }, { unique: true });
ElectionPartySchema.index({ electionId: 1, active: 1 });
