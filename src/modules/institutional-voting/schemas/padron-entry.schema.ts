import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronEntryDocument = PadronEntry & Document;

@Schema({ timestamps: true, collection: 'padron_entries' })
export class PadronEntry {
  @Prop({ type: Types.ObjectId, ref: 'PadronVersion', required: true, index: true })
  padronVersionId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  carnetNorm: string;
}

export const PadronEntrySchema = SchemaFactory.createForClass(PadronEntry);

PadronEntrySchema.index({ padronVersionId: 1, carnetNorm: 1 }, { unique: true });
PadronEntrySchema.index({ eventId: 1, carnetNorm: 1 });
