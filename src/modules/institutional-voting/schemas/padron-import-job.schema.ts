import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronImportJobDocument = PadronImportJob & Document & { _id: Types.ObjectId };

export type PadronImportJobStatus =
  | 'PROCESSING'
  | 'PARSED'
  | 'PARSED_WITH_ERRORS'
  | 'FAILED'
  | 'CONFIRMED';

export type PadronImportSourceType = 'PDF' | 'IMAGE' | 'SYSTEM';

@Schema({ _id: false })
export class PadronImportSummary {
  @Prop({ required: true, default: 0 })
  parsedCount!: number;

  @Prop({ required: true, default: 0 })
  validCount!: number;

  @Prop({ required: true, default: 0 })
  duplicateCount!: number;

  @Prop({ required: true, default: 0 })
  invalidCount!: number;

  @Prop({ required: true, default: 0 })
  stagingCount!: number;

  @Prop({ required: true, default: 0 })
  enabledCount!: number;

  @Prop({ required: true, default: 0 })
  disabledCount!: number;

  @Prop({ required: true, default: 0 })
  missingIdentityCount!: number;
}

@Schema({ _id: false })
export class PadronImportError {
  @Prop({ required: true, trim: true })
  code!: string;

  @Prop({ required: true, trim: true })
  message!: string;

  @Prop({ type: Number, default: null })
  rowIndex?: number | null;

  @Prop({ type: String, default: null, trim: true })
  rawValue?: string | null;
}

@Schema({
  timestamps: true,
  collection: 'padron_import_jobs',
  suppressReservedKeysWarning: true,
})
export class PadronImportJob {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, enum: ['PDF', 'IMAGE', 'SYSTEM'], default: 'PDF' })
  sourceType!: PadronImportSourceType;

  @Prop({
    required: true,
    enum: ['PROCESSING', 'PARSED', 'PARSED_WITH_ERRORS', 'FAILED', 'CONFIRMED'],
    default: 'PROCESSING',
    index: true,
  })
  status!: PadronImportJobStatus;

  @Prop({ required: true, default: true, index: true })
  isActiveDraft!: boolean;

  @Prop({ required: true, trim: true })
  originalFileName!: string;

  @Prop({ required: true, trim: true })
  originalFileMimeType!: string;

  @Prop({ required: true })
  originalFileSize!: number;

  @Prop({ required: true, trim: true })
  originalFileSha256!: string;

  @Prop({ type: String, default: null, select: false })
  originalFileContentBase64?: string | null;

  @Prop({ required: true, trim: true, default: 'local-fallback' })
  parserProvider!: string;

  @Prop({ type: String, default: null, trim: true })
  parserModel?: string | null;

  @Prop({ required: true, default: true })
  parserUsedFallback!: boolean;

  @Prop({ type: PadronImportSummary, required: true, default: () => ({}) })
  summary!: PadronImportSummary;

  @Prop({ type: [PadronImportError], default: [] })
  importErrors!: PadronImportError[];

  @Prop({ type: Date, default: null })
  processedAt?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'PadronVersion', default: null })
  confirmedPadronVersionId?: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PadronImportJobSchema = SchemaFactory.createForClass(PadronImportJob);

PadronImportJobSchema.index({ eventId: 1, createdAt: -1 });
PadronImportJobSchema.index(
  { eventId: 1, isActiveDraft: 1 },
  { unique: true, partialFilterExpression: { isActiveDraft: true } },
);
