import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserDocument = User & Document & { _id: Types.ObjectId };

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'ElectoralLocation', default: null })
  votingLocationId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'ElectoralTable', default: null })
  votingTableId?: Types.ObjectId | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ dni: 1 }, { unique: true });
UserSchema.index({ active: 1 });
UserSchema.index({ votingLocationId: 1 });
UserSchema.index({ votingTableId: 1 });
