import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type InstitutionalWalletMigrationDocument =
  InstitutionalWalletMigration & Document & { _id: Types.ObjectId };

/**
 * Estados de la re-asignación de la admin on-chain de una institución:
 * - AWAITING_WALLET: Identity todavía no devuelve una billetera para el CI de la admin.
 * - READY: billetera nueva resuelta, falta enviar la operación.
 * - RETRY_PENDING: falló un envío con un error recuperable; se reintenta en `nextRetryAt`.
 * - CONFIRMED: la red ya tiene a la billetera nueva como admin y Mongo quedó sincronizado.
 * - NOT_REQUIRED: la billetera resuelta ya era la admin on-chain; no hubo que hacer nada.
 * - NEEDS_REVIEW: estado inesperado (otra admin on-chain, error no recuperable); requiere revisión manual.
 */
export const institutionalWalletMigrationStatuses = [
  'AWAITING_WALLET',
  'READY',
  'RETRY_PENDING',
  'CONFIRMED',
  'NOT_REQUIRED',
  'NEEDS_REVIEW',
] as const;
export type InstitutionalWalletMigrationStatus =
  typeof institutionalWalletMigrationStatuses[number];

export const institutionalWalletMigrationProcessableStatuses: InstitutionalWalletMigrationStatus[] = [
  'READY',
  'RETRY_PENDING',
];

@Schema({ timestamps: true, collection: 'institutional_wallet_migrations' })
export class InstitutionalWalletMigration {
  @Prop({ type: Types.ObjectId, ref: 'InstitutionalTenant', required: true, unique: true })
  tenantId!: Types.ObjectId;

  /** Id on-chain de la institución. Se reutiliza: no cambia con la migración. */
  @Prop({ required: true, trim: true })
  stableInstitutionId!: string;

  @Prop({ type: Types.ObjectId, ref: 'TenantAdminAssignment', required: true })
  assignmentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'RoledUser', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: institutionalWalletMigrationStatuses, index: true })
  status!: InstitutionalWalletMigrationStatus;

  /** Billetera (perdida) que la admin principal tenía en Mongo antes de la migración. */
  @Prop({ type: String, trim: true, default: null })
  previousAdminWallet?: string | null;

  /** Billetera resuelta en Identity a partir del CI de la admin principal. */
  @Prop({ type: String, trim: true, default: null })
  newAdminWallet?: string | null;

  /**
   * Billeteras perdidas que siguen como `authorizedAddresses` en el contrato
   * (`deleteInstitution` no limpia ese mapping). La nueva admin debe revocarlas con
   * `removeAuthorizedAddress` firmando desde su billetera.
   */
  @Prop({ type: [String], default: [] })
  staleAuthorizedAddresses!: string[];

  @Prop({ type: String, trim: true, default: null })
  txHash?: string | null;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: null })
  nextRetryAt?: Date | null;

  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  lastError?: string | null;

  @Prop({ type: Date, default: null })
  walletResolvedAt?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;
}

export const InstitutionalWalletMigrationSchema = SchemaFactory.createForClass(
  InstitutionalWalletMigration,
);

InstitutionalWalletMigrationSchema.index({ status: 1, nextRetryAt: 1 });
InstitutionalWalletMigrationSchema.index({ userId: 1 });
