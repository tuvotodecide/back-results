import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type CiMerkleNodeDocument = CiMerkleNode & Document;

@Schema({ timestamps: true, collection: 'ci-merkle-nodes' })
export class CiMerkleNode {
  @Prop({ type: Types.ObjectId, required: true })
  electionId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  level!: number;

  @Prop({ required: true, min: 0 })
  index!: number;

  @Prop({ required: true, trim: true })
  hash!: string;
}

export const CiMerkleNodeSchema = SchemaFactory.createForClass(
  CiMerkleNode,
);

CiMerkleNodeSchema.index({ electionId: 1, level: 1, index: 1 }, { unique: true });