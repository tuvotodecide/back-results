import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OfficialPublicationNotificationOutboxDocument =
  OfficialPublicationNotificationOutbox &
  Document & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

export const OFFICIAL_PUBLICATION_NOTIFICATION_OUTBOX_STATUSES = [
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED_RETRYABLE',
  'FAILED_FINAL',
  'CANCELLED',
] as const;

export type OfficialPublicationNotificationOutboxStatus =
  (typeof OFFICIAL_PUBLICATION_NOTIFICATION_OUTBOX_STATUSES)[number];

@Schema({ timestamps: true, collection: 'official_publication_notification_outbox' })
export class OfficialPublicationNotificationOutbox {
  @Prop({ required: true, unique: true, trim: true, index: true })
  notificationId!: string;

  @Prop({ required: true, trim: true })
  deduplicationKey!: string;

  @Prop({ required: true, trim: true, default: 'OFFICIAL_PUBLICATION_REQUEST' })
  type!:
    | 'OFFICIAL_PUBLICATION_REQUEST'
    | 'MOBILE_AUTHORIZATION_REQUESTED'
    | 'INSTITUTIONAL_ADMIN_INVITATION';

  @Prop({ required: false, trim: true, index: true })
  requestId?: string;

  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: false, index: true })
  eventId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminApplication', required: false, index: true })
  applicationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalAdminInvitation', required: false, index: true })
  invitationId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: false, index: true })
  tenantId?: Types.ObjectId;

  /**
   * User-requested delivery generation. This is intentionally separate from
   * attemptCount, which tracks technical Firebase retries of one delivery.
   */
  @Prop({ required: false, min: 1, default: 1, index: true })
  deliveryAttempt?: number;

  // Invitation recipients can be mobile identities before they create a
  // RoledUser administrative account. Other notification types still set it.
  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: false, index: true })
  recipientUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  recipientMobileUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  recipientIdentityId!: string;

  @Prop({ required: true, trim: true })
  recipientTopic!: string;

  @Prop({ required: false, trim: true, lowercase: true })
  smartAccountAddress?: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  body!: string;

  @Prop({ type: Object, required: true })
  data!: Record<string, string>;

  @Prop({
    required: true,
    enum: OFFICIAL_PUBLICATION_NOTIFICATION_OUTBOX_STATUSES,
    default: 'PENDING',
    index: true,
  })
  status!: OfficialPublicationNotificationOutboxStatus;

  @Prop({ required: true, default: 0, min: 0 })
  attemptCount!: number;

  @Prop({ type: Date, default: () => new Date(), index: true })
  nextAttemptAt!: Date;

  @Prop({ type: Date, default: null })
  sentAt?: Date | null;

  @Prop({ type: String, default: null, trim: true })
  messageId?: string | null;

  @Prop({ type: String, default: null, trim: true })
  lastErrorCode?: string | null;

  @Prop({ type: String, default: null, trim: true })
  lockId?: string | null;

  @Prop({ type: Date, default: null, index: true })
  lockedUntil?: Date | null;
}

export const OfficialPublicationNotificationOutboxSchema =
  SchemaFactory.createForClass(OfficialPublicationNotificationOutbox);

OfficialPublicationNotificationOutboxSchema.index(
  { deduplicationKey: 1 },
  { unique: true },
);
OfficialPublicationNotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
OfficialPublicationNotificationOutboxSchema.index({ requestId: 1, type: 1 });
