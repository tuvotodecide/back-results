import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VotingEventDocument = VotingEvent & Document & { _id: Types.ObjectId };

export type VotingEventState =
  | 'DRAFT'
  | 'READY_FOR_REVIEW'
  | 'OFFICIALLY_PUBLISHED'
  | 'PUBLICATION_EXPIRED'
  | 'PUBLISHED'
  | 'CLOSED'
  | 'RESULTS_PUBLISHED'
  | 'DISABLED';

@Schema({ timestamps: true, collection: 'voting_events' })
export class VotingEvent {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  objective: string;

  @Prop({ type: Boolean, default: false })
  isReferendum?: boolean;

  @Prop({ type: Date, required: false })
  votingStart?: Date;

  @Prop({ type: Date, required: false })
  votingEnd?: Date;

  @Prop({ type: Date, required: false })
  resultsPublishAt?: Date;

  @Prop({
    required: true,
    enum: [
      'DRAFT',
      'READY_FOR_REVIEW',
      'OFFICIALLY_PUBLISHED',
      'PUBLICATION_EXPIRED',
      'PUBLISHED',
      'CLOSED',
      'RESULTS_PUBLISHED',
      'DISABLED'
    ],
    default: 'DRAFT',
    index: true,
  })
  state: VotingEventState;

  @Prop({ default: true })
  publicEligibilityEnabled: boolean;

  @Prop({ type: Date, required: false })
  convocationNotifiedAt?: Date;

  @Prop({ type: Date, required: false })
  readyForReviewAt?: Date;

  @Prop({ type: Date, required: false, index: true })
  publishDeadline?: Date;

  @Prop({ type: Date, required: false })
  officialPublishedAt?: Date;

  @Prop({ type: Date, required: false })
  disabledAt?: Date;

  @Prop({ type: Date, required: false })
  publicationExpiredAt?: Date;

  @Prop({ type: Date, required: false })
  officialPublicationReminderSentAt?: Date;

  @Prop({ type: Boolean, default: false })
  publicationConfirmed?: boolean;

  @Prop({ type: String, required: false, trim: true })
  officialPublicationTxHash?: string;

  @Prop({ type: String, required: false, trim: true })
  officialPublicationWallet?: string;

  @Prop({ type: String, required: false, trim: true })
  officialPublicationChainId?: string;

  @Prop({ type: Date, required: false })
  resultsNotifiedAt?: Date;

  @Prop({ type: Date, required: false })
  resultsNotificationFailedAt?: Date;

  @Prop({ type: String, required: false })
  resultsNotificationError?: string;

  @Prop({ type: Boolean, default: false })
  presentialKioskEnabled?: boolean;

  @Prop({ type: Boolean, default: true })
  allowPostPublicationPadronEnable?: boolean;

  @Prop({ type: String, required: false, trim: true })
  presentialKioskTokenHash?: string;

  @Prop({ type: Date, required: false })
  presentialKioskIssuedAt?: Date;

  @Prop({ type: Date, required: false })
  presentialKioskLastUsedAt?: Date;
}

export const VotingEventSchema = SchemaFactory.createForClass(VotingEvent);

VotingEventSchema.index({ tenantId: 1, state: 1, votingStart: 1, votingEnd: 1 });
VotingEventSchema.index({ state: 1, publishDeadline: 1 });
