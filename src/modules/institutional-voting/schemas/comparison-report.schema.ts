import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ComparisonReportDocument = ComparisonReport & Document & { _id: Types.ObjectId };

export type ComparisonStatus = 'PENDING' | 'OK' | 'FAILED';

@Schema({ timestamps: true, collection: 'comparison_reports' })
export class ComparisonReport {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PadronVersion', required: true })
  padronVersionId: Types.ObjectId;

  @Prop({ required: true, enum: ['PENDING', 'OK', 'FAILED'], default: 'PENDING', index: true })
  status: ComparisonStatus;
}

export const ComparisonReportSchema = SchemaFactory.createForClass(ComparisonReport);

ComparisonReportSchema.index({ padronVersionId: 1 }, { unique: true });
ComparisonReportSchema.index({ eventId: 1, status: 1 });
