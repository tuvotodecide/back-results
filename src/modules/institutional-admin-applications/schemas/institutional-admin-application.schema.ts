import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalAdminApplicationDocument =
  InstitutionalAdminApplication & Document & { _id: Types.ObjectId };

export type InstitutionalAdminApplicationStatus =
  | 'PENDING_EMAIL_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'PENDING_MOBILE_AUTHORIZATION'
  | 'MOBILE_AUTHORIZATION_EXPIRED'
  | 'PENDING_CHAIN_CONFIRMATION'
  | 'CHAIN_RETRY_PENDING'
  | 'RECONCILIATION_PENDING'
  | 'CHAIN_FAILED'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVOKED';

export type InstitutionalCreationChainStatus =
  | 'PENDING_SEND'
  | 'SENT'
  | 'RETRY_PENDING'
  | 'CONFIRMED'
  | 'FAILED';

export type InstitutionalMobileAuthorizationAction =
  | 'ADD_AUTHORIZED_ADDRESS'
  | 'REMOVE_AUTHORIZED_ADDRESS'
  | 'CHANGE_INSTITUTION_ADMIN';

@Schema({ timestamps: true, collection: 'institutional_admin_applications' })
export class InstitutionalAdminApplication {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  institutionName: string;

  @Prop({ required: true, trim: true })
  institutionNameNorm: string;

  @Prop({ required: true, trim: true })
  accountAddress: string;

  @Prop({
    required: true,
    enum: [
      'PENDING_EMAIL_VERIFICATION',
      'PENDING_APPROVAL',
      'PENDING_MOBILE_AUTHORIZATION',
      'MOBILE_AUTHORIZATION_EXPIRED',
      'PENDING_CHAIN_CONFIRMATION',
      'CHAIN_RETRY_PENDING',
      'RECONCILIATION_PENDING',
      'CHAIN_FAILED',
      'APPROVED',
      'REJECTED',
      'REVOKED',
    ],
    default: 'PENDING_EMAIL_VERIFICATION',
    index: true,
  })
  status: InstitutionalAdminApplicationStatus;

  @Prop({ required: false, trim: true, index: true })
  stableInstitutionId?: string;

  @Prop({
    required: false,
    enum: ['PENDING_SEND', 'SENT', 'RETRY_PENDING', 'CONFIRMED', 'FAILED'],
    index: true,
  })
  chainStatus?: InstitutionalCreationChainStatus;

  @Prop({ required: false, default: 0 })
  chainAttempts?: number;

  @Prop({ type: Date, required: false })
  chainNextRetryAt?: Date | null;

  @Prop({ type: String, required: false, trim: true })
  chainLastError?: string | null;

  @Prop({ type: String, required: false, trim: true })
  chainTxHash?: string | null;

  @Prop({ type: Date, required: false })
  chainLockedAt?: Date | null;

  @Prop({ type: Date, required: false })
  chainLockedUntil?: Date | null;

  @Prop({ type: Date, required: false })
  chainConfirmedAt?: Date | null;

  @Prop({ required: false, trim: true })
  verificationToken?: string;

  @Prop({ type: Date, required: false })
  verificationTokenExpiresAt?: Date;

  @Prop({ type: Date, required: false })
  emailVerifiedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: false })
  approvedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', required: false })
  initiatedByAssignmentId?: Types.ObjectId | null;

  @Prop({ type: String, required: false, trim: true })
  initiatedByWallet?: string | null;

  @Prop({ type: Date, required: false })
  approvedAt?: Date;

  @Prop({ type: Date, required: false })
  mobileAuthorizationRequestedAt?: Date | null;

  @Prop({
    required: false,
    enum: ['ADD_AUTHORIZED_ADDRESS', 'REMOVE_AUTHORIZED_ADDRESS', 'CHANGE_INSTITUTION_ADMIN'],
    default: 'ADD_AUTHORIZED_ADDRESS',
    index: true,
  })
  mobileAuthorizationAction?: InstitutionalMobileAuthorizationAction;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', required: false })
  targetAssignmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'NotificationLog', required: false })
  mobileAuthorizationNotificationId?: Types.ObjectId | null;

  @Prop({ type: Date, required: false })
  mobileAuthorizationExpiresAt?: Date | null;

  @Prop({ type: String, required: false, trim: true })
  mobileAuthorizationDeviceId?: string | null;

  @Prop({ type: Date, required: false })
  mobileAuthorizationClaimedAt?: Date | null;

  @Prop({ type: Date, required: false })
  mobileAuthorizationSignedAt?: Date | null;

  @Prop({ type: Number, required: false, default: 0 })
  mobileAuthorizationDeliveryAttempts?: number;

  @Prop({ type: Date, required: false })
  mobileAuthorizationDeliveryNextRetryAt?: Date | null;

  @Prop({ type: String, required: false, trim: true })
  mobileAuthorizationDeliveryLastError?: string | null;

  @Prop({ type: Date, required: false })
  mobileAuthorizationDeliveryLockedUntil?: Date | null;

  @Prop({ type: String, required: false, trim: true, lowercase: true })
  mobileAuthorizationUserOpHash?: string | null;

  @Prop({ type: String, required: false, trim: true, lowercase: true })
  mobileAuthorizationTxHash?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: false })
  tenantId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: false })
  userId?: Types.ObjectId;

  @Prop({ type: Date, required: false })
  rejectedAt?: Date;

  @Prop({ type: Date, required: false })
  revokedAt?: Date;

  @Prop({ required: false, trim: true })
  reason?: string;
}

export const InstitutionalAdminApplicationSchema = SchemaFactory.createForClass(
  InstitutionalAdminApplication,
);

InstitutionalAdminApplicationSchema.index({ email: 1, status: 1 });
InstitutionalAdminApplicationSchema.index({ dni: 1, status: 1 });
InstitutionalAdminApplicationSchema.index({ accountAddress: 1, status: 1 });
InstitutionalAdminApplicationSchema.index({ verificationToken: 1 });
InstitutionalAdminApplicationSchema.index({ institutionNameNorm: 1 });
InstitutionalAdminApplicationSchema.index({ chainStatus: 1, chainNextRetryAt: 1 });
InstitutionalAdminApplicationSchema.index({ mobileAuthorizationUserOpHash: 1 });
InstitutionalAdminApplicationSchema.index({ status: 1, mobileAuthorizationDeliveryNextRetryAt: 1 });
InstitutionalAdminApplicationSchema.index(
  { tenantId: 1, mobileAuthorizationAction: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      status: {
        $in: [
          'PENDING_MOBILE_AUTHORIZATION',
          'PENDING_CHAIN_CONFIRMATION',
          'CHAIN_RETRY_PENDING',
          'RECONCILIATION_PENDING',
          'CHAIN_FAILED',
        ],
      },
    },
  },
);
