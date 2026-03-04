import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PadronVersionDocument = PadronVersion & Document;

@Schema({ _id: false })
export class PadronTotals {
  @Prop({ required: true })
  validCount: number;

  @Prop({ required: true })
  duplicateCount: number;

  @Prop({ required: true })
  invalidCount: number;
}

@Schema({ timestamps: true, collection: 'padron_versions' })
export class PadronVersion {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fileDigest: string;

  @Prop({ type: PadronTotals, required: true })
  totals: PadronTotals;

  @Prop({ default: false, index: true })
  isCurrent: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const PadronVersionSchema = SchemaFactory.createForClass(PadronVersion);

PadronVersionSchema.index(
  { eventId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
