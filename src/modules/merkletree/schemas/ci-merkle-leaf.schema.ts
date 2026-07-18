import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";

export type CiMerkleLeafDocument = CiMerkleLeaf & Document;

@Schema({ timestamps: true, collection: 'ci-merkle-leafs' })
export class CiMerkleLeaf {
  @Prop({ type: Types.ObjectId, required: true })
  electionId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  index!: number;

  @Prop({ required: true, trim: true })
  value!: string;
}

export const CiMerkleLeafSchema = SchemaFactory.createForClass(
  CiMerkleLeaf,
);

CiMerkleLeafSchema.index({ electionId: 1, index: 1 }, { unique: true });
CiMerkleLeafSchema.index({ electionId: 1, hash: 1 });