import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectoralTableDocument = ElectoralTable & Document;

@Schema({
  timestamps: true,
  collection: 'electoral_tables',
})
export class ElectoralTable {
  @Prop({ required: true, trim: true })
  tableNumber: string;

  @Prop({ required: true, trim: true })
  tableCode: string;

  @Prop({ type: Types.ObjectId, ref: 'ElectoralLocation', required: true })
  electoralLocationId: Types.ObjectId;

  @Prop({ default: false })
  observed: boolean;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ElectoralTableSchema =
  SchemaFactory.createForClass(ElectoralTable);

ElectoralTableSchema.index({ electoralLocationId: 1 });
ElectoralTableSchema.index({ tableCode: 1 }, { unique: true });
ElectoralTableSchema.index(
  {
    electoralLocationId: 1,
    tableNumber: 1,
  },
  { unique: true },
);
ElectoralTableSchema.index({ active: 1 });
