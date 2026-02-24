import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectoralTableDocument = ElectoralTable & Document;

@Schema({
  timestamps: true,
  collection: 'electoral_tables',
})
export class ElectoralTable {
  @Prop({ required: true, trim: true })
  tableNumber: string;

  /** Código de mesa ingresado por el usuario (del acta física) - puede estar vacío hasta que un usuario lo registre */
  @Prop({ trim: true, sparse: true })
  tableCode: string;

  /** Código de mesa legacy (precargado anteriormente en el sistema) */
  @Prop({ trim: true })
  legacyTableCode: string;

  @Prop({ type: Types.ObjectId, ref: 'ElectoralLocation', required: true })
  electoralLocationId: Types.ObjectId;

  @Prop({ default: false })
  observed: boolean;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
  
  @Prop({ type: Object, default: {} })
  observedByElection?: Record<string, boolean>;
}

export const ElectoralTableSchema =
  SchemaFactory.createForClass(ElectoralTable);

ElectoralTableSchema.index({ electoralLocationId: 1 });
// tableCode ahora es sparse: único solo cuando tiene valor (permite múltiples vacíos/null)
ElectoralTableSchema.index({ tableCode: 1 }, { unique: true, sparse: true });
// legacyTableCode para búsquedas de compatibilidad
ElectoralTableSchema.index({ legacyTableCode: 1 }, { sparse: true });
ElectoralTableSchema.index(
  {
    electoralLocationId: 1,
    tableNumber: 1,
  },
  { unique: true },
);
ElectoralTableSchema.index({ active: 1 });
