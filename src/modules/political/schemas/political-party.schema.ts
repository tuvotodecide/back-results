import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PoliticalPartyDocument = PoliticalParty & Document;

@Schema({
  timestamps: true,
  collection: 'political_parties',
})
export class PoliticalParty {
  @Prop({ required: true, unique: true, trim: true })
  partyId!: string; // "Libre", "alianza", "sumate"

  @Prop({ required: true, trim: true })
  fullName!: string; // "Alianza Libre"

  @Prop({ required: true, trim: true })
  shortName!: string; // "MAS"

  @Prop({ trim: true })
  logoUrl?: string;

  @Prop({ required: true, trim: true })
  color!: string; // Compatibilidad legacy / color principal derivado

  @Prop({ type: [String], default: [] })
  colors?: string[];

  @Prop({ default: true })
  active!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PoliticalPartySchema =
  SchemaFactory.createForClass(PoliticalParty);

// Índices
PoliticalPartySchema.index({ active: 1 });
PoliticalPartySchema.index({ shortName: 1 });
