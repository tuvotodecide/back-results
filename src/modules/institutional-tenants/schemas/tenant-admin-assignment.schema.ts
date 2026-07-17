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
export const tenantAdminRoles = ['PRIMARY', 'SECONDARY'] as const;
export type TenantAdminRole = typeof tenantAdminRoles[number];

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

  @Prop({ type: String, trim: true, default: null, index: true })
  accountAddress?: string | null;

  @Prop({ type: String, trim: true, lowercase: true, default: null })
  accountAddressNormalized?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminApplication', default: null })
  applicationId?: Types.ObjectId | null;

  @Prop({ type: String, enum: tenantAdminRoles, default: null, index: true })
  institutionalRole?: TenantAdminRole | null;

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

  @Prop({ type: Date, default: null })
  walletVerifiedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null })
  walletVerifiedBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  walletVerificationSource?: string | null;
}

export const TenantAdminAssignmentSchema = SchemaFactory.createForClass(TenantAdminAssignment);

function normalizeAccountAddressForIndex(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

TenantAdminAssignmentSchema.pre('save', function normalizeWalletBeforeSave() {
  this.accountAddressNormalized = normalizeAccountAddressForIndex(this.accountAddress);
});

TenantAdminAssignmentSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function normalizeWalletBeforeUpdate() {
  const update = this.getUpdate() as any;
  const set = update?.$set ?? update;
  if (set && Object.prototype.hasOwnProperty.call(set, 'accountAddress')) {
    set.accountAddressNormalized = normalizeAccountAddressForIndex(set.accountAddress);
    if (update?.$set) {
      update.$set = set;
    }
  }
});

TenantAdminAssignmentSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true },
);
if (process.env.INSTITUTIONAL_WALLET_UNIQUE_INDEX_AUTO_CREATE === 'true') {
  TenantAdminAssignmentSchema.index(
    { accountAddressNormalized: 1 },
    {
      unique: true,
      partialFilterExpression: {
        accountAddressNormalized: { $exists: true, $type: 'string' },
      },
    },
  );
}
TenantAdminAssignmentSchema.index(
  { tenantId: 1, institutionalRole: 1 },
  {
    unique: true,
    partialFilterExpression: {
      institutionalRole: 'PRIMARY',
      active: true,
    },
  },
);
