import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalAuditEventDocument =
  InstitutionalAuditEvent & Document & { _id: Types.ObjectId };

export const institutionalAuditActions = [
  'INSTITUTIONAL_APPLICATION_CREATED',
  'INSTITUTIONAL_EMAIL_VERIFIED',
  'INSTITUTIONAL_VERIFICATION_EMAIL_RESENT',
  'INSTITUTIONAL_APPLICATION_APPROVED',
  'INSTITUTIONAL_APPLICATION_REJECTED',
  'INSTITUTIONAL_APPLICATION_REVOKED',
  'INSTITUTIONAL_APPLICATION_REOPENED',
  'TENANT_ADMIN_ASSIGNMENT_CREATED',
  'TENANT_ADMIN_SECONDARY_DISABLED',
  'TENANT_ADMIN_SECONDARY_REHABILITATED',
  'TENANT_PRIMARY_ASSIGNED',
  'TENANT_PRIMARY_TRANSFER_REQUESTED',
  'TENANT_PRIMARY_TRANSFERRED',
  'INSTITUTIONAL_RECOVERY_REQUEST_CREATED',
  'INSTITUTIONAL_RECOVERY_APPROVED',
  'INSTITUTIONAL_RECOVERY_REJECTED',
  'ADMIN_EMAIL_CHANGE_REQUESTED',
  'ADMIN_EMAIL_CHANGE_APPROVED',
  'ADMIN_EMAIL_CHANGE_REJECTED',
  'INSTITUTIONAL_WALLET_REGULARIZED',
  'TVD_MANUAL_ASSIGNMENT_REQUESTED',
  'TVD_MANUAL_ASSIGNMENT_CONFIRMED',
  'TVD_MANUAL_ASSIGNMENT_FAILED',
  'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW',
  'TVD_QR_ACCREDITATION_CREATED',
  'TVD_QR_ACCREDITATION_REUSED',
  'TVD_QR_ACCREDITATION_NEEDS_REVIEW',
  'TVD_QR_ACCREDITATION_BLOCKED',
  'TVD_ACCREDITATION_CLAIMED',
  'TVD_ACCREDITATION_PREPARED',
  'TVD_ACCREDITATION_SUBMITTED',
  'TVD_ACCREDITATION_CONFIRMED',
  'TVD_ACCREDITATION_RETRY_SCHEDULED',
  'TVD_ACCREDITATION_FAILED',
  'TVD_ACCREDITATION_NEEDS_REVIEW',
  'TVD_ACCREDITATION_BLOCKED',
  'TVD_EXCHANGE_RATE_CREATED',
] as const;

export type InstitutionalAuditAction = typeof institutionalAuditActions[number];
export type InstitutionalAuditTargetType =
  | 'InstitutionalAdminApplication'
  | 'TenantAdminAssignment'
  | 'InstitutionalAccessRecoveryRequest'
  | 'TokenAccreditation'
  | 'TvdExchangeRate';

@Schema({ collection: 'institutional_audit_events', versionKey: false })
export class InstitutionalAuditEvent {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', default: null, index: true })
  tenantId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null, index: true })
  actorUserId?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  actorGlobalRole?: string | null;

  @Prop({ type: String, enum: ['PRIMARY', 'SECONDARY'], default: null })
  actorInstitutionalRole?: 'PRIMARY' | 'SECONDARY' | null;

  @Prop({ type: String, enum: institutionalAuditActions, required: true, index: true })
  action!: InstitutionalAuditAction;

  @Prop({ type: String, required: true, trim: true })
  targetType!: InstitutionalAuditTargetType;

  @Prop({ type: String, default: null, index: true })
  targetId?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', default: null, index: true })
  targetUserId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminApplication', default: null })
  applicationId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', default: null })
  assignmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAccessRecoveryRequest', default: null })
  recoveryRequestId?: Types.ObjectId | null;

  @Prop({ type: Object, default: null })
  previousState?: Record<string, unknown> | null;

  @Prop({ type: Object, default: null })
  newState?: Record<string, unknown> | null;

  @Prop({ type: String, trim: true, default: null })
  reason?: string | null;

  @Prop({ type: String, trim: true, default: null, index: true })
  correlationId?: string | null;

  @Prop({ type: Date, default: Date.now, immutable: true, index: true })
  createdAt!: Date;
}

export const InstitutionalAuditEventSchema =
  SchemaFactory.createForClass(InstitutionalAuditEvent);

InstitutionalAuditEventSchema.index({ tenantId: 1, createdAt: -1 });
InstitutionalAuditEventSchema.index({ action: 1, createdAt: -1 });
InstitutionalAuditEventSchema.index({ actorUserId: 1, createdAt: -1 });
InstitutionalAuditEventSchema.index({ targetUserId: 1, createdAt: -1 });
