import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OfficialPublicationArtifactDocument =
  OfficialPublicationArtifact &
  Document & {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
  };

@Schema({ _id: false })
export class OfficialPublicationEncryptedPayload {
  @Prop({ required: true, trim: true })
  algorithm!: string;

  @Prop({ required: true, trim: true })
  keyVersion!: string;

  @Prop({ required: true, trim: true })
  iv!: string;

  @Prop({ required: true, trim: true })
  authTag!: string;

  @Prop({ required: true, trim: true })
  ciphertext!: string;
}

@Schema({ timestamps: true, collection: 'official_publication_artifacts' })
export class OfficialPublicationArtifact {
  @Prop({ type: String, required: true, unique: true, trim: true, index: true })
  requestId!: string;

  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  institutionId!: string;

  @Prop({ required: true, trim: true, index: true })
  snapshotHash!: string;

  @Prop({ required: true, min: 1 })
  votersCount!: number;

  @Prop({ required: true, trim: true })
  votersDigest!: string;

  @Prop({ type: OfficialPublicationEncryptedPayload, required: true })
  encryptedPayload!: OfficialPublicationEncryptedPayload;

  @Prop({ required: true, trim: true })
  payloadDigest!: string;
}

export const OfficialPublicationArtifactSchema = SchemaFactory.createForClass(
  OfficialPublicationArtifact,
);

OfficialPublicationArtifactSchema.index({ eventId: 1, snapshotHash: 1 });
