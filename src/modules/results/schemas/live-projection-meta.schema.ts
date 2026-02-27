import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LiveProjectionMetaDocument = LiveProjectionMeta & Document;

@Schema({
  timestamps: true,
  collection: 'live_projection_meta',
})
export class LiveProjectionMeta {
  @Prop({ type: Types.ObjectId, ref: 'ElectionConfig', required: true })
  electionId: Types.ObjectId;

  @Prop({ required: true })
  totalTables: number;

  @Prop({ required: true })
  projectionVersion: number;

  @Prop({ required: true })
  projectionUpdatedAt: Date;
}

export const LiveProjectionMetaSchema =
  SchemaFactory.createForClass(LiveProjectionMeta);

LiveProjectionMetaSchema.index({ electionId: 1 }, { unique: true });
