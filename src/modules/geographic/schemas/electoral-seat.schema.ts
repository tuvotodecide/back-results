import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectoralSeatDocument = ElectoralSeat & Document;

@Schema({
  timestamps: true,
  collection: 'electoral_seats',
})
export class ElectoralSeat {
  @Prop({ required: true, trim: true })
  idLoc: string; // "4116", "4590" del JSON original

  @Prop({ required: true, trim: true })
  name: string; // "Alto Ipaguazu", "Alto los Sarzos"

  @Prop({ type: Types.ObjectId, ref: 'Municipality', required: true })
  municipalityId: Types.ObjectId;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ElectoralSeatSchema = SchemaFactory.createForClass(ElectoralSeat);

ElectoralSeatSchema.index({ municipalityId: 1, idLoc: 1 }, { unique: true });
ElectoralSeatSchema.index({ municipalityId: 1 });
ElectoralSeatSchema.index({ idLoc: 1 });
ElectoralSeatSchema.index({ active: 1 });
