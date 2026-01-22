import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectionPartyDocument = ElectionParty & Document;

@Schema({ timestamps: true, collection: 'election_parties' })
export class ElectionParty {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  electionId: Types.ObjectId;

  @Prop({ required: true })
  partyId: string;

  // Campos territoriales para filtrado granular
  // Si ambos son null = partido aplica a nivel nacional
  // Si departmentId está presente = partido solo aplica a ese departamento
  // Si municipalityId está presente = partido solo aplica a ese municipio
  @Prop({ type: Types.ObjectId, ref: 'Department', default: null, index: true })
  departmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Municipality', default: null, index: true })
  municipalityId?: Types.ObjectId | null;

  // Nombres denormalizados para facilitar consultas
  @Prop({ type: String, default: null })
  departmentName?: string | null;

  @Prop({ type: String, default: null })
  municipalityName?: string | null;

  @Prop({ default: true })
  active: boolean;

  @Prop() ballotNumber?: number;
  @Prop() allianceName?: string;
  @Prop() color?: string;
}

export const ElectionPartySchema = SchemaFactory.createForClass(ElectionParty);

// Índice único compuesto: un partido puede estar múltiples veces en una elección
// PERO solo una vez por territorio específico
ElectionPartySchema.index(
  { electionId: 1, partyId: 1, departmentId: 1, municipalityId: 1 },
  { unique: true },
);
ElectionPartySchema.index({ electionId: 1, active: 1 });
ElectionPartySchema.index({ electionId: 1, departmentId: 1 });
ElectionPartySchema.index({ electionId: 1, municipalityId: 1 });
