import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InstitutionalTenantDocument = InstitutionalTenant & Document;

@Schema({ timestamps: true, collection: 'institutional_tenants' })
export class InstitutionalTenant {
  @Prop({ required: true, trim: true, unique: true })
  name: string;

  @Prop({ required: true, trim: true, unique: true, index: true })
  nameNorm: string;

  @Prop({ required: false, trim: true })
  description?: string;

  @Prop({ required: true, default: true, index: true })
  active: boolean;
}

export const InstitutionalTenantSchema = SchemaFactory.createForClass(InstitutionalTenant);

InstitutionalTenantSchema.index({ active: 1, name: 1 });
