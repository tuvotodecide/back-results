import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DepartmentDocument = Department & Document;

@Schema({
  timestamps: true,
  collection: 'departments',
})
export class Department {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const DepartmentSchema = SchemaFactory.createForClass(Department);

DepartmentSchema.index({ name: 1 }, { unique: true });
DepartmentSchema.index({ active: 1 });
