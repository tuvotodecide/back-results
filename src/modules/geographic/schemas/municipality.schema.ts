import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MunicipalityDocument = Municipality & Document;

@Schema({
  timestamps: true,
  collection: 'municipalities',
})
export class Municipality {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Province', required: true })
  provinceId: Types.ObjectId;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const MunicipalitySchema = SchemaFactory.createForClass(Municipality);

MunicipalitySchema.index({ provinceId: 1, name: 1 }, { unique: true });
MunicipalitySchema.index({ provinceId: 1 });
MunicipalitySchema.index({ active: 1 });
