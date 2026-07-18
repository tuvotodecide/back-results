import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TvdOperatorTransactionLockDocument = TvdOperatorTransactionLock &
  Document & { _id: Types.ObjectId };

@Schema({ timestamps: true, collection: 'tvd_operator_transaction_locks' })
export class TvdOperatorTransactionLock {
  @Prop({ type: String, required: true, trim: true, unique: true, index: true })
  lockKey: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  ownerId: string;

  @Prop({ type: Date, required: true })
  acquiredAt: Date;

  @Prop({ type: Date, required: true, index: true })
  expiresAt: Date;
}

export const TvdOperatorTransactionLockSchema =
  SchemaFactory.createForClass(TvdOperatorTransactionLock);
