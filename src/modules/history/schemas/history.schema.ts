import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { HistoryOperationKey, HistoryType } from "../dto/create-history.dto";

export type HistoryDocument = History & Document;

@Schema({ timestamps: true, collection: 'histories' })
export class History {
  @Prop({ required: true, trim: true, index: true })
  txHash!: string;

  @Prop({ type: String, enum: HistoryOperationKey, required: true, index: true })
  operationName!: HistoryOperationKey;

  @Prop({ default: null, trim: true })
  description?: string;

  @Prop({ type: String, enum: HistoryType, required: true, index: true })
  type!: HistoryType;

  @Prop({ type: Date, required: true, index: true })
  registerDate!: Date;

  @Prop({ type: Types.ObjectId, index: true })
  roledUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  institutionId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, index: true })
  electionId?: Types.ObjectId;
}

export const HistorySchema = SchemaFactory.createForClass(
  History,
);
