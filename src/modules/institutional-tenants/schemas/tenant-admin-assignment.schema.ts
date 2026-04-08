import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TenantAdminAssignmentDocument =
  TenantAdminAssignment & Document & { _id: Types.ObjectId };
export const tenantMembershipStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REVOKED',
] as const;
export type TenantMembershipStatus = typeof tenantMembershipStatuses[number];

@Schema({ timestamps: true, collection: 'tenant_admin_assignments' })
export class TenantAdminAssignment {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    required: true,
    enum: tenantMembershipStatuses,
    default: 'APPROVED',
    index: true,
  })
  status: TenantMembershipStatus;

  @Prop({ required: true, default: true, index: true })
  active: boolean;

  @Prop({ type: Date, default: null })
  requestedAt?: Date | null;

  @Prop({ type: Date, default: null })
  approvedAt?: Date | null;

  @Prop({ type: Date, default: null })
  rejectedAt?: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  approvedBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  reason?: string | null;
}

export const TenantAdminAssignmentSchema = SchemaFactory.createForClass(TenantAdminAssignment);

TenantAdminAssignmentSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true },
);
