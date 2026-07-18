import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type VoteMerkleLeafDocument = VoteMerkleLeaf & Document;

@Schema({ timestamps: true, collection: 'ci-merkle-leafs' })
export class VoteMerkleLeaf {
  @Prop({ type: Types.ObjectId, required: true })
  electionId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  index!: number;

  @Prop({ required: true, trim: true })
  value!: string;
}

export const VoteMerkleLeafSchema = SchemaFactory.createForClass(
  VoteMerkleLeaf,
);

VoteMerkleLeafSchema.index({ electionId: 1, index: 1 }, { unique: true });
VoteMerkleLeafSchema.index({ electionId: 1, hash: 1 });