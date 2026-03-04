import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TenantAdminAssignmentDocument = TenantAdminAssignment & Document;

@Schema({ timestamps: true, collection: 'tenant_admin_assignments' })
export class TenantAdminAssignment {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, default: true, index: true })
  active: boolean;
}

export const TenantAdminAssignmentSchema = SchemaFactory.createForClass(TenantAdminAssignment);

TenantAdminAssignmentSchema.index(
  { tenantId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
