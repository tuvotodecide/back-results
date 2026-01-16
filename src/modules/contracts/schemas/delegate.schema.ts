
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DelegateDocument = Delegate & Document & { _id: Types.ObjectId };


@Schema({ timestamps: true, collection: 'delegates' })
export class Delegate {
  @Prop({ required: true, trim: true })
  dni: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // Array de contratos para los que este delegado está autorizado
  // Permite multi-contrato: mismo delegado puede trabajar para varios clientes
  @Prop({
    type: [
      {
        contractId: { type: Types.ObjectId, ref: 'Contract', required: true },
        clientId: { type: Types.ObjectId, ref: 'RoledUser', required: true },
        clientRole: { type: String, enum: ['MAYOR', 'GOVERNOR'], required: true },
        addedAt: { type: Date, default: Date.now },
        addedBy: { type: Types.ObjectId, ref: 'RoledUser' }, // Superadmin que lo agregó
      },
    ],
    default: [],
  })
  authorizedContracts: Array<{
    contractId: Types.ObjectId;
    clientId: Types.ObjectId;
    clientRole: 'MAYOR' | 'GOVERNOR';
    addedAt: Date;
    addedBy?: Types.ObjectId;
  }>;

  @Prop({ default: true })
  active: boolean;

  // Metadata adicional
  @Prop({ type: String, trim: true })
  name?: string;

  @Prop({ type: String, trim: true })
  phone?: string;

  @Prop({ type: String, trim: true })
  email?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const DelegateSchema = SchemaFactory.createForClass(Delegate);

// Índices
DelegateSchema.index({ dni: 1 }, { unique: true });
DelegateSchema.index({ userId: 1 });
DelegateSchema.index({ 'authorizedContracts.contractId': 1 });
DelegateSchema.index({ 'authorizedContracts.clientId': 1 });
DelegateSchema.index({ active: 1 });