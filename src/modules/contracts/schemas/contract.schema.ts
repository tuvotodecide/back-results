import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractDocument = Contract & Document & { _id: Types.ObjectId };


@Schema({ timestamps: true, collection: 'contracts' })
export class Contract {
  @Prop({ required: true })
  active: boolean;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true })
  clientId: Types.ObjectId; // El Alcalde o Gobernador contratante

  @Prop({
    enum: ['MAYOR', 'GOVERNOR', 'USER', 'ADMIN', 'ACCESS_APPROVER'],
    required: true,
  })
  clientRole: 'MAYOR' | 'GOVERNOR' | 'USER' | 'ADMIN' | 'ACCESS_APPROVER';

  // Territorio cubierto - solo uno debe estar presente
  @Prop({ type: Types.ObjectId, ref: 'Department', default: null })
  departmentId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Municipality', default: null })
  municipalityId?: Types.ObjectId | null;

  // Nombres desnormalizados para facilitar consultas
  @Prop({ type: String })
  departmentName?: string;

  @Prop({ type: String })
  municipalityName?: string;

  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({ type: Date })
  endDate?: Date; // null = indefinido

  @Prop({ type: Types.ObjectId, ref: 'ElectionConfig', required: true })
  electionId: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export const ContractSchema = SchemaFactory.createForClass(Contract);

// Índices para consultas eficientes
ContractSchema.index({ clientId: 1, active: 1 });
ContractSchema.index({ electionId: 1, active: 1 });
ContractSchema.index({ departmentId: 1, active: 1 });
ContractSchema.index({ municipalityId: 1, active: 1 });
ContractSchema.index({ active: 1, startDate: 1, endDate: 1 });

// Índice único: un cliente solo puede tener un contrato activo por elección
ContractSchema.index(
  { clientId: 1, electionId: 1 },
  { 
    unique: true,
    partialFilterExpression: { active: true }
  }
);