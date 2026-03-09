import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalAdminApplicationDocument = InstitutionalAdminApplication & Document;

export type InstitutionalAdminApplicationStatus =
  | 'PENDING_EMAIL_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED';

@Schema({ timestamps: true, collection: 'institutional_admin_applications' })
export class InstitutionalAdminApplication {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  institutionName: string;

  @Prop({ required: true, trim: true })
  institutionNameNorm: string;

  @Prop({
    required: true,
    enum: ['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    default: 'PENDING_EMAIL_VERIFICATION',
    index: true,
  })
  status: InstitutionalAdminApplicationStatus;

  @Prop({ required: false, trim: true })
  verificationToken?: string;

  @Prop({ type: Date, required: false })
  verificationTokenExpiresAt?: Date;

  @Prop({ type: Date, required: false })
  emailVerifiedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: false })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Date, required: false })
  approvedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: false })
  tenantId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: false })
  userId?: Types.ObjectId;
}

export const InstitutionalAdminApplicationSchema = SchemaFactory.createForClass(
  InstitutionalAdminApplication,
);

InstitutionalAdminApplicationSchema.index({ email: 1, status: 1 });
InstitutionalAdminApplicationSchema.index({ dni: 1, status: 1 });
InstitutionalAdminApplicationSchema.index({ verificationToken: 1 });
InstitutionalAdminApplicationSchema.index({ institutionNameNorm: 1 });
