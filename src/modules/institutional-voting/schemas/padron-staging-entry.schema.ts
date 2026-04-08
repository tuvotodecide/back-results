import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronStagingEntryDocument =
  PadronStagingEntry & Document & { _id: Types.ObjectId };

@Schema({ timestamps: true, collection: 'padron_staging_entries' })
export class PadronStagingEntry {
  @Prop({ type: Types.ObjectId, ref: 'PadronImportJob', required: true, index: true })
  importJobId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  ciNorm!: string;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  @Prop({ required: true, enum: ['PARSED', 'MANUAL'], default: 'PARSED' })
  sourceKind!: 'PARSED' | 'MANUAL';

  @Prop({ type: Number, default: null })
  sourceRow?: number | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  lastEditedBy?: Types.ObjectId | null;
}

export const PadronStagingEntrySchema =
  SchemaFactory.createForClass(PadronStagingEntry);

PadronStagingEntrySchema.index({ importJobId: 1, ciNorm: 1 }, { unique: true });
PadronStagingEntrySchema.index({ eventId: 1, importJobId: 1, ciNorm: 1 });
