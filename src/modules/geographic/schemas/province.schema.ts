import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProvinceDocument = Province & Document;

@Schema({
  timestamps: true,
  collection: 'provinces',
})
export class Province {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Types.ObjectId, ref: 'Department', required: true })
  departmentId: Types.ObjectId;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ProvinceSchema = SchemaFactory.createForClass(Province);

ProvinceSchema.index({ departmentId: 1, name: 1 }, { unique: true });
ProvinceSchema.index({ departmentId: 1 });
ProvinceSchema.index({ active: 1 });
