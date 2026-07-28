import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalAdminInvitationDocument =
  InstitutionalAdminInvitation & Document & { _id: Types.ObjectId };

export type InstitutionalAdminInvitationStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED';

@Schema({ timestamps: true, collection: 'institutional_admin_invitations' })
export class InstitutionalAdminInvitation {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  invitedBy!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  dni!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  accountAddress!: string;

  @Prop({ required: true, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'], default: 'PENDING', index: true })
  status!: InstitutionalAdminInvitationStatus;

  @Prop({ required: true, trim: true, unique: true, index: true })
  invitationToken!: string;

  @Prop({ type: Date, required: true, index: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  acceptedAt?: Date | null;

  @Prop({ type: Date, default: null })
  rejectedAt?: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminApplication', default: null })
  applicationId?: Types.ObjectId | null;

  @Prop({ type: Number, default: 1, min: 0 })
  noticeCount?: number;

  @Prop({ type: Date, default: null })
  lastNoticeAt?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  reason?: string | null;
}

export const InstitutionalAdminInvitationSchema =
  SchemaFactory.createForClass(InstitutionalAdminInvitation);

InstitutionalAdminInvitationSchema.index(
  { tenantId: 1, dni: 1, status: 1 },
);
