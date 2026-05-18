import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorksheetDocument = Worksheet & Document;

export enum WorksheetStatus {
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  UPLOADED = 'UPLOADED',
}

@Schema({ _id: false })
export class WorksheetPartyVote {
  @Prop({ required: true, trim: true })
  partyId: string;

  @Prop({ required: true, min: 0 })
  votes: number;
}

@Schema({ _id: false })
export class WorksheetVotingCategory {
  @Prop({ required: true, min: 0 })
  validVotes: number;

  @Prop({ required: true, min: 0 })
  nullVotes: number;

  @Prop({ required: true, min: 0 })
  blankVotes: number;

  @Prop({ type: [WorksheetPartyVote], required: true })
  partyVotes: WorksheetPartyVote[];

  @Prop({ min: 0 })
  totalVotes?: number;
}

@Schema({ _id: false })
export class WorksheetVotes {
  @Prop({ type: WorksheetVotingCategory, required: false })
  parties?: WorksheetVotingCategory;

  @Prop({ type: WorksheetVotingCategory, required: false })
  deputies?: WorksheetVotingCategory;
}

@Schema({
  timestamps: true,
  collection: 'worksheets',
})
export class Worksheet {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  dni: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'ElectionConfig',
    required: true,
    index: true,
  })
  electionId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  tableCode: string;

  @Prop({ required: false, trim: true })
  tableNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'ElectoralLocation', required: false })
  electoralLocationId?: Types.ObjectId;

  @Prop({ type: WorksheetVotes, required: false })
  votes?: WorksheetVotes;

  @Prop({ required: false, trim: true })
  image?: string;

  @Prop({ required: true, trim: true })
  ipfsUri: string;

  @Prop({ required: false, trim: true })
  ipfsCid?: string;

  @Prop({ required: false, trim: true })
  recordId?: string;

  @Prop({ required: false, trim: true })
  tableIdIpfs?: string;

  @Prop({ required: false, trim: true })
  nftLink?: string;

  @Prop({
    required: true,
    enum: Object.values(WorksheetStatus),
    default: WorksheetStatus.PENDING,
    index: true,
  })
  status: WorksheetStatus;

  @Prop({ required: false, trim: true })
  errorMessage?: string;

  @Prop({ default: 0, min: 0 })
  retryCount: number;

  @Prop({ required: false })
  lastAttemptAt?: Date;

  @Prop({ required: false })
  uploadedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const WorksheetSchema = SchemaFactory.createForClass(Worksheet);

WorksheetSchema.index({ dni: 1, electionId: 1, tableCode: 1 }, { unique: true });
WorksheetSchema.index({ userId: 1, electionId: 1, createdAt: -1 });
WorksheetSchema.index({ electionId: 1, tableCode: 1, status: 1 });

WorksheetSchema.pre('save', function () {
  if (this.votes?.parties) {
    this.votes.parties.totalVotes =
      this.votes.parties.validVotes +
      this.votes.parties.nullVotes +
      this.votes.parties.blankVotes;
  }

  if (this.votes?.deputies) {
    this.votes.deputies.totalVotes =
      this.votes.deputies.validVotes +
      this.votes.deputies.nullVotes +
      this.votes.deputies.blankVotes;
  }
});
