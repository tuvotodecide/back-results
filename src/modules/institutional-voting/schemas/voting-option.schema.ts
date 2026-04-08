import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type VotingOptionDocument = VotingOption & Document;

@Schema({ _id: false })
export class OptionCandidate {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: false, trim: true })
  photoUrl?: string;

  @Prop({ required: true, trim: true })
  roleName!: string;
}

@Schema({ timestamps: true, collection: 'voting_options' })
export class VotingOption {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
  eventId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true })
  normalizedName!: string;

  @Prop({ required: true, trim: true })
  color!: string;

  @Prop({ type: [String], default: [] })
  colors?: string[];

  @Prop({ required: false, trim: true })
  logoUrl?: string;

  @Prop({ type: [OptionCandidate], default: [] })
  candidates!: OptionCandidate[];

  @Prop({ default: true, index: true })
  active!: boolean;
}

export const VotingOptionSchema = SchemaFactory.createForClass(VotingOption);

VotingOptionSchema.index({ eventId: 1, normalizedName: 1 }, { unique: true });
VotingOptionSchema.index({ tenantId: 1, active: 1 });
