import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ElectoralLocationDocument = ElectoralLocation & Document;

@Schema({ _id: false })
export class Circunscripcion {
  @Prop({ required: true })
  number: number; // 4, 42

  @Prop({ required: true, enum: ['Especial', 'Uninominal'] })
  type: string; // "Especial", "Uninominal"

  @Prop({ required: true })
  name: string; // "Especial Indígena-Tarija", "Cuadragésimo Segunda-Tarija"
}

@Schema({ _id: false })
export class Coordinates {
  @Prop({ required: true })
  latitude: number; // -21.357303

  @Prop({ required: true })
  longitude: number; // -63.87766
}

@Schema({ _id: false })
export class GeoPoint {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type: 'Point';

  @Prop({ type: [Number], required: true })
  coordinates: [number, number];
}

@Schema({
  timestamps: true,
  collection: 'electoral_locations',
})
export class ElectoralLocation {
  @Prop({ required: true, trim: true })
  fid: string; // "4144", "4145" identificador del sistema original

  @Prop({ required: true, trim: true })
  code: string; // "25527", "32319" (campo Reci)

  @Prop({ required: true, trim: true })
  name: string; // "U.E. Alto Ipaguazu", "U.E. Alto los Zarzos"

  @Prop({ type: Types.ObjectId, ref: 'ElectoralSeat', required: true })
  electoralSeatId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  address: string; // "Alto Ipaguazu", "Comunidad Alto los Sarzos"

  @Prop({ required: true, trim: true })
  district: string; // "DISTRITO 6"

  @Prop({ required: true, trim: true })
  zone: string; // "Zona 5286"

  @Prop({ type: Circunscripcion, required: true })
  circunscripcion: Circunscripcion;

  @Prop({ type: Coordinates, required: true })
  coordinates: Coordinates;

  @Prop({ type: GeoPoint, required: true })
  geo: GeoPoint;

  @Prop({ default: true })
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ElectoralLocationSchema =
  SchemaFactory.createForClass(ElectoralLocation);

//ElectoralLocationSchema.index({ code: 1 }, { unique: true });
ElectoralLocationSchema.index({ electoralSeatId: 1 });
ElectoralLocationSchema.index({ fid: 1 });
ElectoralLocationSchema.index({ 'circunscripcion.type': 1 });
ElectoralLocationSchema.index({ 'circunscripcion.number': 1 });
ElectoralLocationSchema.index({ geo: '2dsphere' });
ElectoralLocationSchema.index({ active: 1 });
