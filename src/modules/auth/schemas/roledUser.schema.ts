import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoledUserDocument = RoledUser & Document & { _id: Types.ObjectId };
export const userRoles = ['MAYOR', 'GOVERNOR'] as const;
export type UserRole = typeof userRoles[number];

@Schema({ timestamps: true, collection: 'roled_users' })
export class RoledUser {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ default: false })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;

  @Prop({ required: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  password: string;

  @Prop({
    enum: ['MAYOR', 'GOVERNOR'],
    required: true,
  })
  role: UserRole;

  @Prop({ type: Types.ObjectId, ref: 'Department', default: null })
  votingDepartmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Municipality', default: null })
  votingMunicipalityId?: Types.ObjectId | null;
}

export const RoledUserSchema = SchemaFactory.createForClass(RoledUser);

RoledUserSchema.index({ dni: 1 }, { unique: true });
RoledUserSchema.index({ email: 1 }, { unique: true });
RoledUserSchema.index({ active: 1 });
