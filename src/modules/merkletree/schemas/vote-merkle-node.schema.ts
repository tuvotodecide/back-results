import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type VoteMerkleNodeDocument = VoteMerkleNode & Document;

@Schema({ timestamps: true, collection: 'vote-merkle-nodes' })
export class VoteMerkleNode {
  @Prop({ type: Types.ObjectId, required: true })
  electionId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  level!: number;

  @Prop({ required: true, min: 0 })
  index!: number;

  @Prop({ required: true, trim: true })
  hash!: string;
}

export const VoteMerkleNodeSchema = SchemaFactory.createForClass(
  VoteMerkleNode,
);

VoteMerkleNodeSchema.index({ electionId: 1, level: 1, index: 1 }, { unique: true });