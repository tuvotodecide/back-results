import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronCertificateDocument = PadronCertificate & Document & { _id: Types.ObjectId };

export type PadronCertificateGenerationMode =
  | 'ON_CONFIRMATION'
  | 'ON_DEMAND'
  | 'REGENERATED';

@Schema({ timestamps: true, collection: 'padron_certificates' })
export class PadronCertificate {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PadronVersion', required: true, index: true, unique: true })
  padronVersionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  generatedBy?: Types.ObjectId | null;

  @Prop({ required: true, enum: ['ON_CONFIRMATION', 'ON_DEMAND', 'REGENERATED'] })
  generationMode!: PadronCertificateGenerationMode;

  @Prop({ required: true, default: 'application/pdf', trim: true })
  mimeType!: string;

  @Prop({ required: true, trim: true })
  fileName!: string;

  @Prop({ required: true, trim: true })
  fileSha256!: string;

  @Prop({ required: true })
  fileSize!: number;

  @Prop({ required: true, enum: ['CSV_LEGACY', 'PDF_IMPORT', 'IMAGE_IMPORT'] })
  sourceType!: 'CSV_LEGACY' | 'PDF_IMPORT' | 'IMAGE_IMPORT';

  @Prop({ required: true })
  totalCount!: number;

  @Prop({ required: true })
  enabledCount!: number;

  @Prop({ required: true })
  disabledCount!: number;

  @Prop({ type: Date, required: true, default: Date.now })
  generatedAt!: Date;

  @Prop({ required: true, default: 'INLINE_BASE64' })
  storageKind!: 'INLINE_BASE64';

  @Prop({ type: String, required: true, select: false })
  pdfContentBase64!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PadronCertificateSchema = SchemaFactory.createForClass(PadronCertificate);

PadronCertificateSchema.index({ eventId: 1, generatedAt: -1 });
