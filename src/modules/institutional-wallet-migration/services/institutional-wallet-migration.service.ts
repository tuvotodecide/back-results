import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getAddress, Hex, isAddress } from 'viem';
import { executeCoinbaseOp } from '@/api/account';
import { VoteContractCalls, VoteContractReads } from '@/api/vote';
import { HistoryService } from '@/modules/history/services/history.service';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalWalletsService } from '@/modules/institutional-wallets/services/institutional-wallets.service';
import {
  InstitutionalWalletMigration,
  InstitutionalWalletMigrationDocument,
  InstitutionalWalletMigrationStatus,
  institutionalWalletMigrationProcessableStatuses,
} from '../schemas/institutional-wallet-migration.schema';

export type InstitutionalWalletMigrationSummary = {
  tenantId: string;
  status: InstitutionalWalletMigrationStatus;
  newAdminWallet: string | null;
  pendingAuthorizedAddressRevocations: number;
  message: string | null;
};

type SignInUser = { _id: Types.ObjectId | string; dni?: string | null };

/**
 * Motivo por el que la institución no puede crear ni publicar votaciones todavía:
 * - PRIMARY_LOGIN_PENDING: la admin principal aún no inició sesión tras el despliegue.
 * - WALLET_NOT_FOUND: Identity todavía no tiene billetera nueva para el CI de la admin principal.
 * - IN_PROGRESS: la re-asignación on-chain está enviándose o reintentándose.
 * - NEEDS_REVIEW: la re-asignación requiere revisión manual del equipo.
 * - SECONDARY_REAUTHORIZATION_REQUIRED: la institución ya migró, pero la billetera de esta
 *   persona (administradora secundaria) es una de las perdidas y debe volver a autorizarse.
 */
export type InstitutionalWalletMigrationGateReason =
  | 'NONE'
  | 'PRIMARY_LOGIN_PENDING'
  | 'WALLET_NOT_FOUND'
  | 'IN_PROGRESS'
  | 'NEEDS_REVIEW'
  | 'SECONDARY_REAUTHORIZATION_REQUIRED';

export type InstitutionalWalletMigrationGate = {
  tenantId: string;
  blocking: boolean;
  reason: InstitutionalWalletMigrationGateReason;
  status: InstitutionalWalletMigrationStatus | null;
  institutionalRole: 'PRIMARY' | 'SECONDARY' | null;
  message: string | null;
};

type GateRequester = { sub?: string; dni?: string | null; tenantId?: string | null };

const MAX_ATTEMPTS = 6;
// executeCoinbaseOp espera el recibo hasta 15 minutos; el lock debe cubrir ese tiempo.
const LOCK_MS = 20 * 60 * 1000;

/**
 * Re-asigna la admin on-chain de las instituciones cuyas billeteras se perdieron en la
 * migración del sistema de billeteras, sin actualizar el contrato:
 *
 *   deleteInstitution(id) + createInstitution(id, nuevaWallet)
 *
 * en una sola user operation del `authorizedCaller` (atómica). El id on-chain
 * (`stableInstitutionId`) se mantiene, así que las votaciones existentes —que guardan ese
 * id— quedan administradas por la nueva billetera y Mongo no necesita renombrar nada.
 *
 * Se dispara en el primer inicio de sesión de la admin principal después del despliegue
 * (`INSTITUTIONAL_WALLET_MIGRATION_CUTOFF`), resolviendo la billetera nueva por CI en
 * Identity igual que el registro.
 */
@Injectable()
export class InstitutionalWalletMigrationService {
  private readonly logger = new Logger(InstitutionalWalletMigrationService.name);
  private readonly chain: string;
  private readonly pk: string;

  constructor(
    @InjectModel(InstitutionalWalletMigration.name)
    private readonly migrationModel: Model<InstitutionalWalletMigrationDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    private readonly walletsService: InstitutionalWalletsService,
    private readonly auditService: InstitutionalAuditService,
    private readonly historyService: HistoryService,
    private readonly configService: ConfigService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    this.pk = this.configService.get<string>('app.blockchain.privateKey')!;
  }

  getCutoff(): Date | null {
    const raw = this.configService.get<string>('app.institutionalWalletMigration.cutoff')?.trim();
    if (!raw) return null;
    const cutoff = new Date(raw);
    return Number.isNaN(cutoff.getTime()) ? null : cutoff;
  }

  isEnabled(): boolean {
    return this.getCutoff() !== null;
  }

  /**
   * Punto de entrada desde el login. Nunca lanza: un fallo aquí no debe impedir iniciar sesión.
   * Resuelve la billetera nueva y deja la operación on-chain en segundo plano.
   */
  async handleSignIn(user: SignInUser): Promise<InstitutionalWalletMigrationSummary[]> {
    if (!this.isEnabled() || !user?._id) return [];

    let primaries: any[] = [];
    try {
      primaries = await this.assignmentModel
        .find({
          userId: new Types.ObjectId(String(user._id)),
          institutionalRole: 'PRIMARY',
          status: 'APPROVED',
          active: true,
        })
        .lean();
    } catch (error) {
      this.logger.error({ event: 'WALLET_MIGRATION_SIGNIN_LOOKUP_FAILED', error: this.toSafeError(error) });
      return [];
    }

    const summaries: InstitutionalWalletMigrationSummary[] = [];
    for (const assignment of primaries) {
      try {
        const migration = await this.prepareForAssignment(assignment, user);
        if (!migration) continue;
        summaries.push(this.toSummary(migration));
        if (institutionalWalletMigrationProcessableStatuses.includes(migration.status)) {
          void this.processMigration(String(migration._id)).catch((error) =>
            this.logger.error({
              event: 'WALLET_MIGRATION_BACKGROUND_FAILED',
              migrationId: String(migration._id),
              error: this.toSafeError(error),
            }),
          );
        }
      } catch (error) {
        this.logger.error({
          event: 'WALLET_MIGRATION_SIGNIN_FAILED',
          tenantId: String(assignment.tenantId),
          error: this.toSafeError(error),
        });
      }
    }
    return summaries;
  }

  /**
   * Crea (si corresponde) el registro de migración del tenant y, si está esperando billetera,
   * la resuelve en Identity por el CI de la admin principal.
   */
  async prepareForAssignment(
    assignment: any,
    user: SignInUser,
  ): Promise<InstitutionalWalletMigrationDocument | null> {
    let migration = await this.migrationModel.findOne({ tenantId: assignment.tenantId });

    if (!migration) {
      if (!this.predatesCutoff(assignment)) return null;
      const tenant = await this.tenantModel.findById(assignment.tenantId).lean();
      const stableInstitutionId = tenant?.stableInstitutionId?.trim();
      if (!tenant || tenant.active !== true || !stableInstitutionId) return null;

      const previousAdminWallet = this.normalizeWallet(assignment.accountAddress);
      try {
        migration = await this.migrationModel.create({
          tenantId: tenant._id,
          stableInstitutionId,
          assignmentId: assignment._id,
          userId: assignment.userId,
          status: 'AWAITING_WALLET',
          previousAdminWallet,
          staleAuthorizedAddresses: await this.collectTenantWallets(tenant._id),
        });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        // Dos logins simultáneos: el otro ganó la creación.
        migration = await this.migrationModel.findOne({ tenantId: assignment.tenantId });
        if (!migration) throw error;
      }
    }

    // El registro pertenece a la admin principal que existía al desplegar.
    if (String(migration.userId) !== String(user._id)) return null;
    if (migration.status !== 'AWAITING_WALLET') return migration;

    const dni = String(user.dni ?? '').trim();
    if (!dni) {
      await this.migrationModel.updateOne(
        { _id: migration._id },
        { $set: { lastError: 'El usuario institucional no tiene CI registrado' } },
      );
      return this.migrationModel.findById(migration._id);
    }

    const resolution = await this.walletsService.resolveByDni(dni);
    const newAdminWallet = resolution.registered
      ? this.normalizeWallet(resolution.accountAddress)
      : null;
    if (!newAdminWallet) {
      await this.migrationModel.updateOne(
        { _id: migration._id },
        {
          $set: {
            lastError:
              resolution.message ??
              'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
          },
        },
      );
      return this.migrationModel.findById(migration._id);
    }

    const updated = await this.migrationModel.findOneAndUpdate(
      { _id: migration._id, status: 'AWAITING_WALLET' },
      {
        $set: {
          status: 'READY',
          newAdminWallet,
          walletResolvedAt: new Date(),
          lastError: null,
          nextRetryAt: null,
        },
        $pull: { staleAuthorizedAddresses: newAdminWallet },
      },
      { returnDocument: 'after' },
    );
    return updated ?? this.migrationModel.findById(migration._id);
  }

  /**
   * Ejecuta (o reconcilia) la operación on-chain de una migración. Idempotente: siempre lee
   * primero la admin actual del contrato, así un reintento tras una caída no duplica nada.
   */
  async processMigration(migrationId: string) {
    const now = new Date();
    const migration = await this.migrationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(migrationId),
        status: { $in: institutionalWalletMigrationProcessableStatuses },
        $and: [
          { $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
          { $or: [{ nextRetryAt: null }, { nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
        ],
      },
      {
        $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!migration) return { processed: false as const, reason: 'NO_CLAIMABLE_MIGRATION' };

    const institutionId = migration.stableInstitutionId;
    const newAdminWallet = migration.newAdminWallet!;
    let txHash: string | null = migration.txHash ?? null;

    try {
      const currentAdmin = await this.readOnChainAdmin(institutionId);

      if (this.sameWallet(currentAdmin, newAdminWallet)) {
        // Si la billetera cambió, la red ya refleja un envío anterior (p. ej. el proceso se
        // cayó antes de guardar el hash): se confirma. Si no cambió, no había nada que hacer.
        const status = this.sameWallet(migration.previousAdminWallet, newAdminWallet)
          ? 'NOT_REQUIRED'
          : 'CONFIRMED';
        await this.finalize(migration, status, txHash);
        return { processed: true as const, status };
      }

      if (currentAdmin && !this.sameWallet(currentAdmin, migration.previousAdminWallet)) {
        // No reemplazamos una admin que no es la que Mongo conocía: podría ser legítima.
        await this.markNeedsReview(
          migration,
          `La admin on-chain (${currentAdmin}) no coincide con la billetera registrada de la institución`,
        );
        return { processed: true as const, status: 'NEEDS_REVIEW' };
      }

      const createCall = VoteContractCalls.createInstitution(
        this.chain,
        institutionId,
        newAdminWallet as Hex,
      );
      const calls = currentAdmin
        ? [VoteContractCalls.deleteInstitution(this.chain, institutionId), createCall]
        : [createCall];

      // Una sola user operation (executeBatch de la smart account): si createInstitution
      // revierte, deleteInstitution también, y la institución nunca queda borrada.
      const response = await executeCoinbaseOp(this.pk as Hex, this.chain, { calls }, undefined, undefined);
      txHash = response?.txHash ? String(response.txHash) : null;
      await this.migrationModel.updateOne({ _id: migration._id }, { $set: { txHash } });

      if (String(response?.receipt?.status ?? '').toLowerCase() === 'reverted') {
        throw new Error(`Transaction ${txHash} reverted`);
      }

      const adminAfter = await this.readOnChainAdmin(institutionId);
      if (!this.sameWallet(adminAfter, newAdminWallet)) {
        throw new Error('La red todavía no refleja a la nueva admin de la institución');
      }

      await this.finalize(migration, 'CONFIRMED', txHash);
      return { processed: true as const, status: 'CONFIRMED', txHash };
    } catch (error) {
      const attempts = migration.attempts ?? 1;
      this.logger.error({
        event: 'WALLET_MIGRATION_CHAIN_FAILED',
        migrationId: String(migration._id),
        institutionId,
        attempts,
        error: this.toSafeError(error),
      });
      if (attempts >= MAX_ATTEMPTS) {
        await this.markNeedsReview(migration, this.toSafeError(error));
        return { processed: true as const, status: 'NEEDS_REVIEW' };
      }
      const nextRetryAt = this.calculateNextRetryAt(attempts);
      await this.migrationModel.updateOne(
        { _id: migration._id },
        {
          $set: {
            status: 'RETRY_PENDING',
            lastError: this.toSafeError(error),
            nextRetryAt,
            lockedUntil: null,
          },
        },
      );
      return { processed: true as const, status: 'RETRY_PENDING', nextRetryAt };
    }
  }

  /**
   * Estado de bloqueo de la institución para la persona autenticada. Lo consulta el frontend
   * al cargar las pantallas de votaciones. Si quien consulta es la admin principal y todavía
   * no se encontró su billetera, vuelve a buscarla en Identity: basta con recargar la página.
   */
  async getGateForUser(
    requester: GateRequester,
    tenantIdArg?: string | null,
  ): Promise<InstitutionalWalletMigrationGate> {
    const rawTenantId = String(tenantIdArg || requester?.tenantId || '').trim();
    if (!Types.ObjectId.isValid(rawTenantId)) {
      throw new BadRequestException('tenantId invalido');
    }
    const requesterId = String(requester?.sub || '');
    if (!Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado');
    }
    const tenantId = new Types.ObjectId(rawTenantId);
    const gate = (
      reason: InstitutionalWalletMigrationGateReason,
      status: InstitutionalWalletMigrationStatus | null,
      institutionalRole: 'PRIMARY' | 'SECONDARY' | null,
      message: string | null = null,
    ): InstitutionalWalletMigrationGate => ({
      tenantId: rawTenantId,
      blocking: reason !== 'NONE',
      reason,
      status,
      institutionalRole,
      message,
    });

    const assignment: any = await this.assignmentModel
      .findOne({
        tenantId,
        userId: new Types.ObjectId(requesterId),
        status: 'APPROVED',
        active: true,
      })
      .lean();
    if (!assignment) {
      throw new ForbiddenException('No autorizado para consultar esta institución');
    }
    const role: 'PRIMARY' | 'SECONDARY' | null = assignment.institutionalRole ?? null;

    if (!this.isEnabled()) return gate('NONE', null, role);

    let migration: InstitutionalWalletMigrationDocument | null = await this.migrationModel.findOne({
      tenantId,
    });

    if (role === 'PRIMARY' && (!migration || migration.status === 'AWAITING_WALLET')) {
      try {
        const prepared = await this.prepareForAssignment(assignment, {
          _id: requesterId,
          dni: requester.dni,
        });
        if (prepared) {
          migration = prepared;
          if (institutionalWalletMigrationProcessableStatuses.includes(prepared.status)) {
            void this.processMigration(String(prepared._id)).catch((error) =>
              this.logger.error({
                event: 'WALLET_MIGRATION_BACKGROUND_FAILED',
                migrationId: String(prepared._id),
                error: this.toSafeError(error),
              }),
            );
          }
        }
      } catch (error) {
        // Identity caído: se informa el último estado conocido.
        this.logger.warn({
          event: 'WALLET_MIGRATION_GATE_RESOLVE_FAILED',
          tenantId: rawTenantId,
          error: this.toSafeError(error),
        });
        migration = await this.migrationModel.findOne({ tenantId });
      }
    }

    if (!migration) {
      const primary = await this.assignmentModel
        .findOne({ tenantId, institutionalRole: 'PRIMARY', status: 'APPROVED', active: true })
        .lean();
      return primary && this.predatesCutoff(primary)
        ? gate('PRIMARY_LOGIN_PENDING', null, role)
        : gate('NONE', null, role);
    }

    switch (migration.status) {
      case 'AWAITING_WALLET':
        return gate('WALLET_NOT_FOUND', migration.status, role, migration.lastError ?? null);
      case 'READY':
      case 'RETRY_PENDING':
        return gate('IN_PROGRESS', migration.status, role);
      case 'NEEDS_REVIEW':
        return gate('NEEDS_REVIEW', migration.status, role);
      default: {
        const ownWallet = this.normalizeWallet(assignment.accountAddress)?.toLowerCase();
        const isStale =
          role !== 'PRIMARY' &&
          Boolean(ownWallet) &&
          (migration.staleAuthorizedAddresses ?? []).some(
            (wallet) => wallet.toLowerCase() === ownWallet,
          );
        return isStale
          ? gate('SECONDARY_REAUTHORIZATION_REQUIRED', migration.status, role)
          : gate('NONE', migration.status, role);
      }
    }
  }

  /** Procesa las migraciones listas o con reintento vencido. Lo usa el worker. */
  async processDue(limit = 10) {
    if (!this.isEnabled()) return [];
    const now = new Date();
    const due = await this.migrationModel
      .find(
        {
          status: { $in: institutionalWalletMigrationProcessableStatuses },
          $and: [
            { $or: [{ lockedUntil: null }, { lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }] },
            { $or: [{ nextRetryAt: null }, { nextRetryAt: { $exists: false } }, { nextRetryAt: { $lte: now } }] },
          ],
        },
        { _id: 1 },
      )
      .limit(limit)
      .lean();

    const results: any[] = [];
    for (const item of due) {
      results.push(await this.processMigration(String(item._id)));
    }
    return results;
  }

  private async finalize(
    migration: InstitutionalWalletMigrationDocument,
    status: 'CONFIRMED' | 'NOT_REQUIRED',
    txHash: string | null,
  ) {
    const newAdminWallet = migration.newAdminWallet!;
    const session = await this.migrationModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        const assignment = await this.assignmentModel
          .findOne({ _id: migration.assignmentId, tenantId: migration.tenantId })
          .session(session)
          .lean();
        const now = new Date();

        if (assignment) {
          await this.assignmentModel.updateOne(
            { _id: assignment._id },
            {
              $set: {
                accountAddress: newAdminWallet,
                accountAddressNormalized: newAdminWallet.toLowerCase(),
                walletVerifiedAt: now,
                walletVerificationSource: 'IDENTITY',
              },
            },
            { session },
          );
          // institutional-voting-access exige que la wallet de la solicitud coincida con la
          // de la asignación.
          if (assignment.applicationId) {
            await this.applicationModel.updateOne(
              { _id: assignment.applicationId, tenantId: migration.tenantId },
              { $set: { accountAddress: newAdminWallet } },
              { session },
            );
          }
        }

        await this.migrationModel.updateOne(
          { _id: migration._id },
          {
            $set: {
              status,
              txHash,
              confirmedAt: now,
              lockedUntil: null,
              nextRetryAt: null,
              lastError: null,
            },
          },
          { session },
        );

        await this.auditService.record({
          tenantId: migration.tenantId,
          actor: { sub: String(migration.userId) },
          actorInstitutionalRole: 'PRIMARY',
          action: 'INSTITUTIONAL_WALLET_MIGRATED',
          targetType: 'TenantAdminAssignment',
          targetId: migration.assignmentId,
          targetUserId: migration.userId,
          assignmentId: migration.assignmentId,
          applicationId: assignment?.applicationId ?? null,
          previousState: {
            accountAddress: migration.previousAdminWallet ?? null,
          },
          newState: {
            accountAddress: newAdminWallet,
            stableInstitutionId: migration.stableInstitutionId,
            txHash,
            migrationStatus: status,
          },
          reason: 'Re-asignación de admin on-chain tras la migración de billeteras',
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    if (txHash) {
      try {
        await this.historyService.create({
          txHash,
          operationName: HistoryOperationKey.institutionAdminSet,
          type: HistoryType.AUTOMATED,
          registerDate: new Date().toISOString(),
          institutionId: migration.stableInstitutionId,
        } as any);
      } catch (error) {
        this.logger.warn({
          event: 'WALLET_MIGRATION_HISTORY_FAILED',
          migrationId: String(migration._id),
          error: this.toSafeError(error),
        });
      }
    }
  }

  private async markNeedsReview(migration: InstitutionalWalletMigrationDocument, reason: string) {
    await this.migrationModel.updateOne(
      { _id: migration._id },
      { $set: { status: 'NEEDS_REVIEW', lastError: reason, lockedUntil: null, nextRetryAt: null } },
    );
  }

  /** Admin on-chain actual, o null si la institución no existe en el contrato. */
  private async readOnChainAdmin(institutionId: string): Promise<string | null> {
    try {
      const admin = await VoteContractReads.getInstitutionAdmin(this.chain, institutionId);
      return this.normalizeWallet(admin as string);
    } catch (error) {
      if (this.isInstitutionNotFoundRevert(error)) return null;
      throw error;
    }
  }

  private async collectTenantWallets(tenantId: Types.ObjectId): Promise<string[]> {
    const assignments = await this.assignmentModel
      .find(
        { tenantId, status: { $in: ['APPROVED', 'SUSPENDED'] } },
        { accountAddress: 1 },
      )
      .lean();
    const unique = new Map<string, string>();
    for (const item of assignments) {
      const wallet = this.normalizeWallet(item.accountAddress);
      if (wallet) unique.set(wallet.toLowerCase(), wallet);
    }
    return [...unique.values()];
  }

  private predatesCutoff(assignment: any): boolean {
    const cutoff = this.getCutoff();
    if (!cutoff) return false;
    const createdAt: Date | null =
      assignment.createdAt instanceof Date
        ? assignment.createdAt
        : assignment.createdAt
          ? new Date(assignment.createdAt)
          : assignment._id instanceof Types.ObjectId
            ? assignment._id.getTimestamp()
            : null;
    return Boolean(createdAt && createdAt.getTime() < cutoff.getTime());
  }

  private toSummary(migration: InstitutionalWalletMigrationDocument): InstitutionalWalletMigrationSummary {
    return {
      tenantId: String(migration.tenantId),
      status: migration.status,
      newAdminWallet: migration.newAdminWallet ?? null,
      pendingAuthorizedAddressRevocations: migration.staleAuthorizedAddresses?.length ?? 0,
      message: migration.lastError ?? null,
    };
  }

  private normalizeWallet(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || !isAddress(trimmed, { strict: false })) return null;
    if (/^0x0{40}$/i.test(trimmed)) return null;
    return getAddress(trimmed);
  }

  private sameWallet(a?: string | null, b?: string | null): boolean {
    return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
  }

  private calculateNextRetryAt(attempts: number): Date {
    const delayMs = Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 60 * 60 * 1000);
    return new Date(Date.now() + delayMs);
  }

  private isInstitutionNotFoundRevert(error: any, depth = 0): boolean {
    if (!error || depth > 4) return false;
    for (const key of ['message', 'shortMessage', 'details', 'reason']) {
      const value = error?.[key];
      if (typeof value === 'string' && value.toLowerCase().includes('institution does not exist')) {
        return true;
      }
    }
    return this.isInstitutionNotFoundRevert(error?.cause, depth + 1);
  }

  private toSafeError(error: any): string {
    const message = String(error?.shortMessage ?? error?.message ?? error ?? 'Error desconocido');
    return message.slice(0, 500);
  }
}
