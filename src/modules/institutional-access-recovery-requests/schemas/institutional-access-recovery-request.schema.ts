import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalAccessRecoveryRequestDocument =
  InstitutionalAccessRecoveryRequest & Document & { _id: Types.ObjectId };

export const institutionalAccessRecoveryStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;
export type InstitutionalAccessRecoveryStatus =
  typeof institutionalAccessRecoveryStatuses[number];

export const institutionalAccessRecoveryTypes = [
  'ACCESS_RECOVERY',
  'ADMIN_EMAIL_CHANGE',
] as const;
export type InstitutionalAccessRecoveryType =
  typeof institutionalAccessRecoveryTypes[number];

@Schema({ timestamps: true, collection: 'institutional_access_recovery_requests' })
export class InstitutionalAccessRecoveryRequest {
  @Prop({ enum: institutionalAccessRecoveryTypes, default: 'ACCESS_RECOVERY', index: true })
  requestType?: InstitutionalAccessRecoveryType;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  institutionName!: string;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true, trim: true })
  phoneNumber!: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  newEmail!: string;

  @Prop({ required: true, trim: true })
  supervisorPhoneNumber!: string;

  @Prop({ enum: institutionalAccessRecoveryStatuses, default: 'PENDING', index: true })
  status!: InstitutionalAccessRecoveryStatus;

  @Prop({ type: Date, default: Date.now })
  requestedAt!: Date;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  resolvedBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  resolutionReason?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  candidateUserId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', default: null })
  candidateAssignmentId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  currentEmail?: string | null;

  @Prop({ type: String, trim: true, default: null })
  accountAddress?: string | null;

  @Prop({ type: String, trim: true, default: null })
  institutionalRole?: string | null;

  @Prop({ type: [String], default: [] })
  warnings?: string[];
}

export const InstitutionalAccessRecoveryRequestSchema =
  SchemaFactory.createForClass(InstitutionalAccessRecoveryRequest);

InstitutionalAccessRecoveryRequestSchema.index(
  { tenantId: 1, newEmail: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PENDING' },
  },
);
InstitutionalAccessRecoveryRequestSchema.index(
  { candidateUserId: 1, requestType: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      requestType: 'ADMIN_EMAIL_CHANGE',
      status: 'PENDING',
    },
  },
);
