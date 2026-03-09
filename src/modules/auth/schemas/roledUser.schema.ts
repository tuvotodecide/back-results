import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoledUserDocument = RoledUser & Document & { _id: Types.ObjectId };
export const userRoles = ['MAYOR', 'GOVERNOR', 'ADMIN'] as const;
export type UserRole = typeof userRoles[number];

@Schema({ timestamps: true, collection: 'roled_users' })
export class RoledUser {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ default: false })
  active: boolean;

  @Prop({ default: null })
  verificationToken?: string;

  @Prop({ type: Date, default: null })
  verificationTokenExpiresAt?: Date;

  @Prop({ default: null })
  passwordResetToken?: string;

  @Prop({ type: Date, default: null })
  passwordResetTokenExpiresAt?: Date;

  createdAt: Date;
  updatedAt: Date;

  @Prop({ required: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  password: string;

  @Prop({
    enum: ['MAYOR', 'GOVERNOR', 'ADMIN'],
    required: true,
  })
  role: UserRole;

  @Prop({ type: Types.ObjectId, ref: 'Department', default: null })
  votingDepartmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Municipality', default: null })
  votingMunicipalityId?: Types.ObjectId | null;

  @Prop({ type: String, default: null, trim: true })
  institutionName?: string | null;

  @Prop({ type: String, default: null, trim: true, index: true })
  institutionNameNorm?: string | null;
}

export const RoledUserSchema = SchemaFactory.createForClass(RoledUser);

RoledUserSchema.index({ dni: 1 }, { unique: true });
RoledUserSchema.index({ email: 1 }, { unique: true });
RoledUserSchema.index({ active: 1 });
RoledUserSchema.index({ verificationToken: 1 });
RoledUserSchema.index({ passwordResetToken: 1 });
