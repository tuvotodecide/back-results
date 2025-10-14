import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ElectionConfigDocument = ElectionConfig & Document;

@Schema({
  timestamps: true,
  collection: 'election_configs',
})
export class ElectionConfig {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  votingStartDate: Date;

  @Prop({ required: true })
  votingEndDate: Date;

  @Prop({ required: true })
  resultsStartDate: Date;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: false })
  allowDataModification: boolean;

  @Prop({ default: 'America/La_Paz' })
  timezone: string;

  @Prop({
    enum: [
      'presidential',
      'departamental',
      'municipal',
      'referendum',
    ],
    required: false,
  })
  type?: string;

  @Prop({ enum: [1, 2], required: false })
  round?: number;

  createdAt: Date;
  updatedAt: Date;
}
export const ElectionConfigSchema =
  SchemaFactory.createForClass(ElectionConfig);

ElectionConfigSchema.index({ isActive: 1 });
ElectionConfigSchema.index({ votingStartDate: 1, votingEndDate: 1 });
ElectionConfigSchema.index({ resultsStartDate: 1 });
ElectionConfigSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
