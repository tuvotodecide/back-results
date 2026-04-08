import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronVersionDocument = PadronVersion & Document & { _id: Types.ObjectId };

@Schema({ _id: false })
export class PadronTotals {
  @Prop({ required: true })
  validCount!: number;

  @Prop({ required: true })
  duplicateCount!: number;

  @Prop({ required: true })
  invalidCount!: number;
}

@Schema({ timestamps: true, collection: 'padron_versions' })
export class PadronVersion {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fileDigest!: string;

  @Prop({
    required: false,
    enum: ['CSV_LEGACY', 'PDF_IMPORT', 'IMAGE_IMPORT'],
    default: 'CSV_LEGACY',
  })
  sourceType?: 'CSV_LEGACY' | 'PDF_IMPORT' | 'IMAGE_IMPORT';

  @Prop({ type: Types.ObjectId, ref: 'PadronImportJob', default: null })
  importJobId?: Types.ObjectId | null;

  @Prop({ type: String, default: null, trim: true })
  sourceFileName?: string | null;

  @Prop({ type: String, default: null, trim: true })
  sourceFileMimeType?: string | null;

  @Prop({ type: String, default: null, trim: true })
  sourceFileSha256?: string | null;

  @Prop({ type: String, default: null, trim: true })
  parserProvider?: string | null;

  @Prop({ type: String, default: null, trim: true })
  parserModel?: string | null;

  @Prop({ type: PadronTotals, required: true })
  totals!: PadronTotals;

  @Prop({ default: false, index: true })
  isCurrent!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PadronVersionSchema = SchemaFactory.createForClass(PadronVersion);

PadronVersionSchema.index(
  { eventId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
