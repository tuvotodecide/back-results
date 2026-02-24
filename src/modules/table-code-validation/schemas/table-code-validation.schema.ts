import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TableCodeValidationDocument = TableCodeValidation & Document;

export enum TableCodeValidationStatus {
  PENDING_OEP = 'PENDING_OEP',
  VERIFIED_OEP = 'VERIFIED_OEP',
  NOT_FOUND_OEP = 'NOT_FOUND_OEP',
  CONFLICT_OEP = 'CONFLICT_OEP',
}

@Schema({
  timestamps: true,
  collection: 'table_code_validations',
})
export class TableCodeValidation {
  @Prop({ type: Types.ObjectId, ref: 'ElectionConfig', required: true, index: true })
  electionId: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  tableCode: string;

  @Prop({
    required: true,
    enum: Object.values(TableCodeValidationStatus),
    default: TableCodeValidationStatus.PENDING_OEP,
    index: true,
  })
  status: TableCodeValidationStatus;

  @Prop({ required: false, trim: true })
  oepMatchedTableCode?: string;

  @Prop({ required: false })
  lastCheckedAt?: Date;

  @Prop({ type: Object, required: false })
  oepData?: Record<string, unknown>;

  createdAt: Date;
  updatedAt: Date;
}

export const TableCodeValidationSchema =
  SchemaFactory.createForClass(TableCodeValidation);

TableCodeValidationSchema.index({ electionId: 1, tableCode: 1 }, { unique: true });
TableCodeValidationSchema.index({ electionId: 1, status: 1 });
