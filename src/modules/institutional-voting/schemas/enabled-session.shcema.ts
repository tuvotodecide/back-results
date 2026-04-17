import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Types } from "mongoose";


export type EnabledSessionDocument = EnabledSession & Document;

@Schema({ timestamps: true, collection: 'enabled_sessions' })
export class EnabledSession {
  @Prop({ type: Types.ObjectId, ref: 'VotingEvent', required: true, index: true })
	eventId!: Types.ObjectId;

	@Prop({ required: true, trim: true })
	dni!: string;

	@Prop({ required: true, trim: true })
	sessionToken!: string;
}

export const EnabledSessionSchema = SchemaFactory.createForClass(EnabledSession);

EnabledSessionSchema.index({ eventId: 1, dni: 1 }, { unique: true });