import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Hex, isAddress } from 'viem';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import { VoteContractReads } from '@/api/vote';
import {
  AssignTenantAdminDto,
  CreateInstitutionalTenantDto,
  InstitutionalTenantListQueryDto,
  RegularizeTenantAdminWalletDto,
  TransferTenantPrimaryDto,
  UpdateTenantAdminStatusDto,
} from '../dto/institutional-tenant.dto';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '../schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '../schemas/tenant-admin-assignment.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  NotificationLog,
  NotificationLogDocument,
} from '@/modules/notifications/schemas/notification-log.schema';
import {
  getTenantWalletVerificationState,
  normalizeTenantWalletAddress,
} from '../utils/tenant-wallet-verification.util';

@Injectable()
export class InstitutionalTenantsService {
  constructor(
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly auditService: InstitutionalAuditService,
  ) {}

  async createTenant(dto: CreateInstitutionalTenantDto) {
    const normalizedName = this.normalizeName(dto.name);
    const displayName = this.formatDisplayName(dto.name);

    const existing = await this.tenantModel.findOne({ nameNorm: normalizedName }).lean();
    if (existing) {
      throw new ConflictException('Ya existe un tenant con ese nombre');
    }

    try {
      const created = await this.tenantModel.create({
        name: displayName,
        nameNorm: normalizedName,
        description: dto.description?.trim(),
        active: true,
      });

      return {
        id: String(created._id),
        name: created.name,
        description: created.description ?? null,
        active: created.active,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Ya existe un tenant con ese nombre');
      }
      throw error;
    }
  }

  async listPublicTenants(query: InstitutionalTenantListQueryDto = {}) {
    const { filter, page, limit, skip } = this.buildTenantListQuery(query, true);
    const [tenants, total] = await Promise.all([
      this.tenantModel
        .find(filter, { _id: 1, name: 1 })
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.tenantModel.countDocuments(filter),
    ]);

    return {
      items: tenants.map((tenant) => ({
        institutionId: String(tenant._id),
        institutionName: tenant.name,
      })),
      total,
      page,
      limit,
    };
  }

  async listTenantsForAdmin(query: InstitutionalTenantListQueryDto = {}) {
    const { filter, page, limit, skip } = this.buildTenantListQuery(query, false);
    const [tenants, total] = await Promise.all([
      this.tenantModel
        .find(filter, { _id: 1, name: 1, active: 1 })
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.tenantModel.countDocuments(filter),
    ]);

    const tenantIds = tenants.map((tenant) => tenant._id);
    const assignments = tenantIds.length
      ? await this.assignmentModel
          .find(
            { tenantId: { $in: tenantIds } },
            {
              _id: 1,
              tenantId: 1,
              userId: 1,
              accountAddress: 1,
              accountAddressNormalized: 1,
              walletVerifiedAt: 1,
              walletVerificationSource: 1,
              institutionalRole: 1,
              status: 1,
              active: 1,
            },
          )
          .sort({ institutionalRole: 1, active: -1, createdAt: 1, _id: 1 })
          .lean()
      : [];
    const userIds = Array.from(new Set(assignments.map((assignment) => String(assignment.userId))));
    const users = userIds.length
      ? await this.roledUserModel
          .find(
            { _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } },
            { _id: 1, name: 1 },
          )
          .lean()
      : [];

    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const assignmentsByTenant = new Map<string, any[]>();
    for (const assignment of assignments) {
      const tenantKey = String(assignment.tenantId);
      const bucket = assignmentsByTenant.get(tenantKey) ?? [];
      bucket.push(assignment);
      assignmentsByTenant.set(tenantKey, bucket);
    }

    return {
      items: tenants.map((tenant) => {
        const tenantAssignments = assignmentsByTenant.get(String(tenant._id)) ?? [];
        const admins = tenantAssignments.map((assignment) =>
          this.toGlobalTenantAdminResponse(
            assignment,
            usersById.get(String(assignment.userId)),
          ),
        );
        return {
          tenantId: String(tenant._id),
          institutionName: tenant.name,
          active: tenant.active === true,
          hasPrimary: tenantAssignments.some(
            (assignment) =>
              assignment.institutionalRole === 'PRIMARY' &&
              assignment.active === true &&
              assignment.status === 'APPROVED',
          ),
          adminCount: tenantAssignments.length,
          walletCount: tenantAssignments.filter((assignment) =>
            Boolean(assignment.accountAddress?.trim()),
          ).length,
          admins,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async assignAdmin(tenantId: string, dto: AssignTenantAdminDto) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const session = await this.assignmentModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        response = await this.assignAdminInTransaction(tenantId, dto, session);
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async listAdmins(tenantId: string, requester: any) {
    const tenant = await this.getActiveTenantOrThrow(tenantId);
    await this.assertCanManageTenant(tenant._id, requester);

    const assignments = await this.assignmentModel
      .find({ tenantId: tenant._id })
      .sort({ institutionalRole: 1, active: -1, createdAt: 1, _id: 1 })
      .lean();

    const userIds = assignments.map((assignment) => assignment.userId);
    const users = userIds.length
      ? await this.roledUserModel
          .find(
            { _id: { $in: userIds } },
            { _id: 1, name: 1, email: 1, active: 1 },
          )
          .lean()
      : [];
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    return {
      tenantId: String(tenant._id),
      data: assignments.map((assignment) =>
        this.toAdminAssignmentResponse(assignment, usersById.get(String(assignment.userId))),
      ),
      total: assignments.length,
    };
  }

  async updateAdminStatus(
    tenantId: string,
    assignmentId: string,
    dto: UpdateTenantAdminStatusDto,
    requester: any,
  ) {
    const session = await this.assignmentModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const tenant = await this.getActiveTenantOrThrow(tenantId, session);
        await this.assertCanManageTenant(tenant._id, requester, session);
        const assignment = await this.getAssignmentForTenantOrThrow(
          tenant._id,
          assignmentId,
          session,
        );

        if (assignment.institutionalRole !== 'SECONDARY') {
          throw new ConflictException('Solo se puede cambiar el estado de administradores secundarios');
        }

        response = dto.active
          ? await this.rehabilitateSecondary(tenant._id, assignment, requester, dto.reason, session)
          : await this.disableSecondary(tenant._id, assignment, requester, dto.reason, session);
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async transferPrimary(
    tenantId: string,
    dto: TransferTenantPrimaryDto,
    requester: any,
  ) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(dto.assignmentId)) {
      throw new BadRequestException('tenantId o assignmentId invalido');
    }

    const session = await this.assignmentModel.db.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        result = await this.createPrimaryTransferAuthorizationInTransaction(
          new Types.ObjectId(tenantId),
          new Types.ObjectId(dto.assignmentId),
          requester,
          dto.reason,
          session,
        );
      });
      return result;
    } catch (error) {
      if (this.isPrimaryDuplicateError(error) || this.isTransactionConflict(error)) {
        throw new ConflictException(
          'Ya existe una transferencia de administrador principal pendiente',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  async regularizeOwnWallet(
    tenantId: string,
    dto: RegularizeTenantAdminWalletDto,
    requester: any,
  ) {
    const tenantObjectId = this.toObjectIdOrBadRequest(tenantId, 'tenantId invalido');
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para regularizar wallet institucional');
    }
    const providedDni = dto.dni.trim();
    if (dto.accountAddress?.trim()) {
      this.normalizeAccountAddress(dto.accountAddress);
    }

    const [tenant, user, assignments] = await Promise.all([
      this.tenantModel.findById(tenantObjectId).lean(),
      this.roledUserModel
        .findById(new Types.ObjectId(requesterId), { active: 1, dni: 1, email: 1, name: 1 })
        .lean(),
      this.assignmentModel
        .find({
          tenantId: tenantObjectId,
          userId: new Types.ObjectId(requesterId),
        })
        .lean(),
    ]);

    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    if (!user || user.active !== true) {
      throw new ForbiddenException('Usuario institucional inactivo');
    }
    if (!user.dni?.trim()) {
      throw new ConflictException('El usuario institucional no tiene DNI interno');
    }
    if (user.dni.trim() !== providedDni) {
      throw new BadRequestException('El DNI no corresponde al usuario autenticado');
    }
    if (assignments.length === 0) {
      throw new ForbiddenException('No autorizado para regularizar esta institución');
    }
    if (assignments.length > 1) {
      throw new ConflictException('Relacion institucional ambigua o inexistente');
    }

    const assignment = assignments[0];
    const status = assignment.status ?? (assignment.active ? 'APPROVED' : null);
    if (assignment.active !== true || status !== 'APPROVED') {
      throw new ForbiddenException('La relacion institucional no esta activa');
    }

    const resolvedWallet = await this.resolveAuthoritativeWalletByDni(providedDni);
    const accountAddress = this.normalizeAccountAddress(resolvedWallet);
    if (dto.accountAddress?.trim()) {
      const clientWallet = this.normalizeAccountAddress(dto.accountAddress);
      if (clientWallet.toLowerCase() !== accountAddress.toLowerCase()) {
        throw new BadRequestException(
          'La wallet enviada no coincide con la billetera registrada para el DNI',
        );
      }
    }

    const existingWallet = assignment.accountAddress?.trim();
    const existingWalletState = getTenantWalletVerificationState(assignment);
    if (existingWallet) {
      if (existingWallet.toLowerCase() === accountAddress.toLowerCase()) {
        if (existingWalletState.isWalletVerified) {
          await this.ensureHistoricalRegularizationOperation(
            tenant,
            user,
            assignment,
            accountAddress,
          );
          return this.toWalletRegularizationResponse(assignment, existingWallet, false);
        }
        await this.assertWalletCompatibleForAssignment(assignment);
      } else {
        throw new ConflictException('La relacion institucional ya tiene una wallet distinta');
      }
    } else {
      await this.assertWalletCompatibleForAssignment({
        ...assignment,
        accountAddress,
      });
    }

    const session = await this.assignmentModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const verifiedAt = new Date();
        const verifiedBy = new Types.ObjectId(requesterId);
        const accountAddressNormalized = normalizeTenantWalletAddress(accountAddress)?.toLowerCase();
        if (!accountAddressNormalized) {
          throw new BadRequestException('accountAddress debe ser una direccion EVM valida');
        }
        const updateFilter: Record<string, any> = {
          _id: assignment._id,
          tenantId: tenantObjectId,
          userId: new Types.ObjectId(requesterId),
          active: true,
          status: 'APPROVED',
        };
        if (existingWallet) {
          updateFilter.accountAddress = this.buildAccountAddressRegex(accountAddress);
          updateFilter.$or = [
            { accountAddressNormalized: { $ne: accountAddressNormalized } },
            { walletVerifiedAt: null },
            { walletVerifiedAt: { $exists: false } },
            { walletVerificationSource: null },
            { walletVerificationSource: '' },
            { walletVerificationSource: { $exists: false } },
          ];
        } else {
          updateFilter.$or = [
            { accountAddress: null },
            { accountAddress: '' },
            { accountAddress: { $exists: false } },
          ];
        }

        const updatedResult: any = await this.assignmentModel.findOneAndUpdate(
        updateFilter,
        {
          $set: {
            accountAddress,
            accountAddressNormalized,
            walletVerifiedAt: verifiedAt,
            walletVerifiedBy: verifiedBy,
            walletVerificationSource: 'LEGACY_REGULARIZATION',
          },
        },
        { returnDocument: 'after', session },
        );

        if (!updatedResult) {
          const current = await this.assignmentModel.findById(assignment._id).session(session).lean();
          const currentWallet = current?.accountAddress?.trim();
          const currentWalletState = getTenantWalletVerificationState(current ?? {});
          if (
            currentWallet?.toLowerCase() === accountAddress.toLowerCase() &&
            currentWalletState.isWalletVerified
          ) {
            response = this.toWalletRegularizationResponse(current, currentWallet, false);
            return;
          }
          throw new ConflictException('No se pudo regularizar la wallet sin reemplazar una existente');
        }

        let updated = updatedResult;
        const updatedQuery = this.assignmentModel.findById(assignment._id);
        const updatedQuerySession = updatedQuery?.session;
        if (typeof updatedQuerySession === 'function') {
          updated = (await updatedQuerySession.call(updatedQuery, session).lean()) ?? updatedResult;
        }

        await this.auditService.record({
          tenantId: tenantObjectId,
          actor: requester,
          actorInstitutionalRole: assignment.institutionalRole ?? null,
          action: 'INSTITUTIONAL_WALLET_REGULARIZED',
          targetType: 'TenantAdminAssignment',
          targetId: updated._id,
          targetUserId: updated.userId,
          assignmentId: updated._id,
          previousState: {
            hasAccountAddress: Boolean(existingWallet),
            walletVerified: existingWalletState.isWalletVerified,
            status: assignment.status ?? null,
            active: assignment.active ?? false,
            institutionalRole: assignment.institutionalRole ?? null,
          },
          newState: {
            hasAccountAddress: true,
            status: updated.status ?? null,
            active: updated.active ?? false,
            institutionalRole: updated.institutionalRole ?? null,
            walletVerificationSource: updated.walletVerificationSource ?? null,
          },
          session,
        });

        await this.ensureHistoricalRegularizationOperation(
          tenant,
          user,
          updated,
          accountAddress,
          session,
        );

        response = this.toWalletRegularizationResponse(updated, accountAddress, true);
      });
      return response;
    } catch (error) {
      if (this.isWalletDuplicateError(error)) {
        throw new ConflictException(
          'La wallet verificada ya esta asociada a otro administrador institucional',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  private async assignAdminInTransaction(
    tenantId: string,
    dto: AssignTenantAdminDto,
    session: ClientSession,
  ) {
    const tenant = await this.tenantModel.findById(tenantId).session(session).lean();
    if (!tenant || !tenant.active) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    const user = await this.roledUserModel.findById(dto.userId).session(session).lean();
    if (!user || !user.active) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }

    const active = dto.active ?? true;

    const assignment = await this.assignmentModel.findOneAndUpdate(
      {
        tenantId: new Types.ObjectId(tenantId),
        userId: new Types.ObjectId(dto.userId),
      },
      {
        $set: {
          status: active ? 'APPROVED' : 'REVOKED',
          active,
          approvedAt: active ? new Date() : null,
          revokedAt: active ? null : new Date(),
          rejectedAt: null,
          requestedAt: active ? new Date() : null,
          reason: null,
        },
      },
      { upsert: true, returnDocument: 'after', session },
    );
    await this.auditService.record({
      tenantId,
      actor: null,
      action: 'TENANT_ADMIN_ASSIGNMENT_CREATED',
      targetType: 'TenantAdminAssignment',
      targetId: assignment?._id ?? null,
      targetUserId: dto.userId,
      assignmentId: assignment?._id ?? null,
      newState: {
        status: assignment?.status ?? (active ? 'APPROVED' : 'REVOKED'),
        active,
        institutionalRole: assignment?.institutionalRole ?? null,
        hasAccountAddress: Boolean(assignment?.accountAddress),
      },
      session,
    });

    return {
      tenantId,
      userId: dto.userId,
      active,
    };
  }

  private async disableSecondary(
    tenantId: Types.ObjectId,
    assignment: any,
    requester: any,
    reason?: string,
    session?: ClientSession,
  ) {
    if (assignment.active === false && assignment.status === 'SUSPENDED') {
      return this.toAdminAssignmentResponse(assignment);
    }
    if (assignment.status === 'REVOKED') {
      throw new ConflictException('El acceso eliminado no puede suspenderse');
    }

    const updated = await this.assignmentModel.findOneAndUpdate(
      {
        _id: assignment._id,
        tenantId,
        institutionalRole: 'SECONDARY',
      },
      {
        $set: {
          status: 'SUSPENDED',
          active: false,
          suspendedAt: new Date(),
          reactivatedAt: null,
          revokedAt: null,
          approvedBy: this.resolveRequesterObjectId(requester),
          reason: reason?.trim() || null,
        },
      },
      { returnDocument: 'after', session },
    );

    if (!updated) {
      throw new ConflictException('No se pudo deshabilitar el administrador secundario');
    }

    const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
      tenantId,
      requester,
      session,
    );
    await this.auditService.record({
      tenantId,
      actor: requester,
      actorInstitutionalRole,
      action: 'TENANT_ADMIN_SECONDARY_DISABLED',
      targetType: 'TenantAdminAssignment',
      targetId: updated._id,
      targetUserId: updated.userId,
      assignmentId: updated._id,
      previousState: {
        status: assignment.status ?? null,
        active: assignment.active ?? false,
        institutionalRole: assignment.institutionalRole ?? null,
      },
      newState: {
        status: updated.status ?? null,
        active: updated.active ?? false,
        institutionalRole: updated.institutionalRole ?? null,
      },
      reason: reason?.trim() || null,
      session,
    });

    return this.toAdminAssignmentResponse(updated);
  }

  private normalizeAccountAddress(input: string): string {
    if (typeof input !== 'string') {
      throw new BadRequestException('accountAddress debe ser una direccion EVM valida');
    }
    const accountAddress = input.trim();
    if (!accountAddress || !isAddress(accountAddress)) {
      throw new BadRequestException('accountAddress debe ser una direccion EVM valida');
    }
    return accountAddress;
  }

  private async assertWalletBelongsToDni(accountAddress: string, dni: string) {
    const identityBaseUrl = this.configService.get<string>('app.identity.baseUrl');
    const identityApiKey = this.configService.get<string>('app.identity.apiKey');
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!identityBaseUrl || !identityApiKey) {
      throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
    }

    try {
      const response = await this.httpService.axiosRef.get(
        `${identityBaseUrl.replace(/\/$/, '')}/registry/has-dni`,
        {
          params: { account: accountAddress, dnis: dni },
          headers: { 'x-api-key': identityApiKey },
          timeout,
        },
      );

      if (!response?.data || typeof response.data.ok !== 'boolean') {
        throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
      }
      if (!response.data.ok) {
        throw new BadRequestException(
          'La wallet no esta registrada o no corresponde al usuario solicitante.',
        );
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
    }
  }

  private async ensureHistoricalRegularizationOperation(
    tenant: any,
    user: any,
    assignment: any,
    accountAddress: string,
    session?: ClientSession,
  ) {
    const stableInstitutionId = tenant.stableInstitutionId?.trim() || String(tenant._id);
    if (!tenant.stableInstitutionId?.trim()) {
      await this.tenantModel.updateOne(
        { _id: tenant._id },
        { $set: { stableInstitutionId } },
        session ? { session } : undefined,
      );
    }

    const confirmed = await this.isTenantConfirmedOnChain(
      stableInstitutionId,
      accountAddress,
    ).catch(() => false);
    if (confirmed) {
      await this.tenantModel.updateOne(
        { _id: tenant._id },
        { $set: { stableInstitutionId, active: true } },
        session ? { session } : undefined,
      );
      await this.assignmentModel.updateOne(
        { _id: assignment._id },
        {
          $set: {
            status: 'APPROVED',
            active: true,
            walletVerifiedAt: assignment.walletVerifiedAt ?? new Date(),
            walletVerificationSource:
              assignment.walletVerificationSource ?? 'LEGACY_REGULARIZATION',
          },
        },
        session ? { session } : undefined,
      );
      return {
        chainStatus: 'CONFIRMED',
        operationCreated: false,
        stableInstitutionId,
      };
    }

    const existingOperation = await this.applicationModel
      .findOne({
        tenantId: tenant._id,
        stableInstitutionId,
        chainStatus: { $in: ['PENDING_SEND', 'SENT', 'RETRY_PENDING', 'CONFIRMED'] },
      })
      .session(session ?? null)
      .lean();
    if (existingOperation) {
      return {
        chainStatus: existingOperation.chainStatus ?? null,
        operationCreated: false,
        stableInstitutionId,
      };
    }

    await this.applicationModel.create(
      [
        {
          dni: user.dni,
          email: user.email ?? `historico-${stableInstitutionId}@institucional.local`,
          passwordHash: 'historical-regularization',
          name: user.name ?? 'Administrador institucional histórico',
          institutionName: tenant.name,
          institutionNameNorm: tenant.nameNorm,
          accountAddress,
          status: 'PENDING_CHAIN_CONFIRMATION',
          emailVerifiedAt: new Date(),
          approvedAt: new Date(),
          tenantId: tenant._id,
          userId: assignment.userId,
          stableInstitutionId,
          chainStatus: 'PENDING_SEND',
          chainAttempts: 0,
        },
      ],
      session ? { session } : undefined,
    );

    return {
      chainStatus: 'PENDING_SEND',
      operationCreated: true,
      stableInstitutionId,
    };
  }

  private async isTenantConfirmedOnChain(
    stableInstitutionId: string,
    accountAddress: string,
  ): Promise<boolean> {
    const chain = this.configService.get<string>('app.blockchain.chain')!;
    const expectedAdmin = accountAddress.toLowerCase();
    try {
      const admin = await VoteContractReads.getInstitutionAdmin(chain, stableInstitutionId);
      if (typeof admin === 'string' && admin.toLowerCase() === expectedAdmin) {
        return true;
      }
    } catch {
      return false;
    }

    try {
      return Boolean(
        await VoteContractReads.isAuthorizedAddress(
          chain,
          stableInstitutionId,
          accountAddress as Hex,
        ),
      );
    } catch {
      return false;
    }
  }

  private async resolveAuthoritativeWalletByDni(dni: string): Promise<string> {
    const identityBaseUrl = this.configService.get<string>('app.identity.baseUrl');
    const identityApiKey = this.configService.get<string>('app.identity.apiKey');
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!identityBaseUrl || !identityApiKey) {
      throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
    }

    const baseUrl = identityBaseUrl.replace(/\/$/, '');
    try {
      const response = await this.httpService.axiosRef.post(
        `${baseUrl}/registry/resolve-account-by-dni`,
        { dni },
        {
          headers: { 'x-api-key': identityApiKey },
          timeout,
        },
      );
      const data = response?.data;
      if (!data || typeof data.registered !== 'boolean') {
        throw new ServiceUnavailableException('Identity devolvio una respuesta invalida');
      }

      if (!data.registered) {
        const personExists = await this.identityPersonExistsByDni(
          baseUrl,
          identityApiKey,
          dni,
          timeout,
        );
        throw new BadRequestException(
          personExists
            ? 'La persona debe crear o registrar primero su billetera en Tu Voto Decide'
            : 'La persona debe registrarse primero en Tu Voto Decide',
        );
      }

      if (typeof data.accountAddress !== 'string' || !data.accountAddress.trim()) {
        throw new BadRequestException(
          'La persona debe crear o registrar primero su billetera en Tu Voto Decide',
        );
      }
      return data.accountAddress.trim();
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
    }
  }

  private async identityPersonExistsByDni(
    identityBaseUrl: string,
    identityApiKey: string,
    dni: string,
    timeout: number,
  ): Promise<boolean> {
    const response = await this.httpService.axiosRef.get(
      `${identityBaseUrl}/registry/get-by-dni`,
      {
        params: { dnis: dni },
        headers: { 'x-api-key': identityApiKey },
        timeout,
      },
    );
    const records = response?.data?.records;
    if (!Array.isArray(records)) {
      throw new ServiceUnavailableException('Identity devolvio una respuesta invalida');
    }
    return records.some((record: any) => String(record?.dni ?? '').trim() === dni);
  }

  private toWalletRegularizationResponse(
    assignment: any,
    accountAddress: string,
    updated: boolean,
  ) {
    const effectiveAssignment = {
      ...assignment,
      accountAddress,
      accountAddressNormalized: updated
        ? (assignment.accountAddressNormalized ??
          normalizeTenantWalletAddress(accountAddress)?.toLowerCase() ??
          null)
        : assignment.accountAddressNormalized,
    };
    const walletState = getTenantWalletVerificationState(effectiveAssignment);
    return {
      tenantId: String(assignment.tenantId),
      assignmentId: String(assignment._id),
      userId: String(assignment.userId),
      accountAddress,
      institutionalRole: assignment.institutionalRole ?? null,
      status: assignment.status ?? null,
      active: assignment.active ?? false,
      hasWallet: walletState.hasWallet,
      requiresWalletUpdate: walletState.requiresWalletUpdate,
      walletStatus: walletState.walletStatus,
      walletVerifiedAt: effectiveAssignment.walletVerifiedAt ?? null,
      walletVerificationSource: effectiveAssignment.walletVerificationSource ?? null,
      updated,
    };
  }

  private toObjectIdOrBadRequest(value: string, message: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(message);
    }
    return new Types.ObjectId(value);
  }

  private async rehabilitateSecondary(
    tenantId: Types.ObjectId,
    assignment: any,
    requester: any,
    reason?: string,
    session?: ClientSession,
  ) {
    if (assignment.active === true && assignment.status === 'APPROVED') {
      return this.toAdminAssignmentResponse(assignment);
    }
    if (assignment.status === 'REVOKED') {
      throw new ConflictException('El acceso eliminado no puede reactivarse');
    }

    if (!assignment.accountAddress?.trim()) {
      throw new ConflictException('El administrador secundario no tiene wallet operativa');
    }

    let tenantQuery = this.tenantModel.findById(tenantId, { active: 1 });
    let userQuery = this.roledUserModel.findById(assignment.userId, { active: 1 });
    if (session) {
      tenantQuery = tenantQuery.session(session);
      userQuery = userQuery.session(session);
    }
    const [tenant, user] = await Promise.all([tenantQuery.lean(), userQuery.lean()]);
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    if (!user || user.active !== true) {
      throw new ConflictException('El usuario del administrador secundario esta inactivo');
    }

    await this.assertWalletCompatibleForAssignment(assignment, session);

    const updated = await this.assignmentModel.findOneAndUpdate(
      {
        _id: assignment._id,
        tenantId,
        institutionalRole: 'SECONDARY',
      },
      {
        $set: {
          status: 'APPROVED',
          active: true,
          approvedAt: new Date(),
          approvedBy: this.resolveRequesterObjectId(requester),
          revokedAt: null,
          suspendedAt: null,
          reactivatedAt: new Date(),
          rejectedAt: null,
          reason: reason?.trim() || null,
        },
      },
      { returnDocument: 'after', session },
    );

    if (!updated) {
      throw new ConflictException('No se pudo rehabilitar el administrador secundario');
    }

    const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
      tenantId,
      requester,
      session,
    );
    await this.auditService.record({
      tenantId,
      actor: requester,
      actorInstitutionalRole,
      action: 'TENANT_ADMIN_SECONDARY_REHABILITATED',
      targetType: 'TenantAdminAssignment',
      targetId: updated._id,
      targetUserId: updated.userId,
      assignmentId: updated._id,
      previousState: {
        status: assignment.status ?? null,
        active: assignment.active ?? false,
        institutionalRole: assignment.institutionalRole ?? null,
      },
      newState: {
        status: updated.status ?? null,
        active: updated.active ?? false,
        institutionalRole: updated.institutionalRole ?? null,
      },
      reason: reason?.trim() || null,
      session,
    });

    return this.toAdminAssignmentResponse(updated);
  }

  private async transferPrimaryInTransaction(
    tenantId: Types.ObjectId,
    targetAssignmentId: Types.ObjectId,
    requester: any,
    reason: string | undefined,
    session: ClientSession,
  ) {
    const tenant = await this.tenantModel
      .findById(tenantId, { active: 1 })
      .session(session)
      .lean();
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    const target = await this.assignmentModel
      .findOne({ _id: targetAssignmentId, tenantId })
      .session(session)
      .lean();
    if (!target) {
      throw new NotFoundException('Administrador institucional no encontrado');
    }
    this.assertEligibleSecondaryTarget(target);

    const activePrimaries = await this.assignmentModel
      .find({
        tenantId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      })
      .session(session)
      .lean();

    if (activePrimaries.length > 1) {
      throw new ConflictException('El tenant tiene mas de un administrador principal activo');
    }

    const currentPrimary = activePrimaries[0] ?? null;
    if (currentPrimary && String(currentPrimary._id) === String(target._id)) {
      throw new ConflictException('El destino ya es el administrador principal');
    }

    if (currentPrimary) {
      await this.assertCanManageTenant(tenantId, requester, session);
    } else if (!this.isGlobalAdmin(requester)) {
      throw new ForbiddenException(
        'Solo un administrador global puede designar principal cuando el tenant no tiene PRIMARY',
      );
    }

    const targetUser = await this.roledUserModel
      .findById(target.userId, { active: 1 })
      .session(session)
      .lean();
    if (!targetUser || targetUser.active !== true) {
      throw new ConflictException('El usuario destino esta inactivo');
    }
    await this.assertWalletCompatibleForAssignment(target, session);

    const now = new Date();
    const actorId = this.resolveRequesterObjectId(requester);
    let previousPrimaryAssignmentId: string | null = null;

    if (currentPrimary) {
      const downgraded = await this.assignmentModel.updateOne(
        {
          _id: currentPrimary._id,
          tenantId,
          institutionalRole: 'PRIMARY',
          status: 'APPROVED',
          active: true,
        },
        {
          $set: {
            institutionalRole: 'SECONDARY',
            approvedAt: now,
            approvedBy: actorId,
            reason: reason?.trim() || null,
          },
        },
        { session },
      );
      if (downgraded.modifiedCount !== 1) {
        throw new ConflictException('El administrador principal cambio durante la transferencia');
      }
      previousPrimaryAssignmentId = String(currentPrimary._id);
    }

    const promoted = await this.assignmentModel.updateOne(
      {
        _id: target._id,
        tenantId,
        institutionalRole: 'SECONDARY',
        status: 'APPROVED',
        active: true,
        accountAddress: { $nin: [null, ''] },
      },
      {
        $set: {
          institutionalRole: 'PRIMARY',
          approvedAt: now,
          approvedBy: actorId,
          revokedAt: null,
          rejectedAt: null,
          reason: reason?.trim() || null,
        },
      },
      { session },
    );
    if (promoted.modifiedCount !== 1) {
      throw new ConflictException('El administrador destino no es elegible para principal');
    }

    const activePrimaryCount = await this.assignmentModel
      .countDocuments({
        tenantId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      })
      .session(session);
    if (activePrimaryCount !== 1) {
      throw new ConflictException('La transferencia no dejo exactamente un PRIMARY activo');
    }

    const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
      tenantId,
      requester,
      session,
    );
    await this.auditService.record({
      tenantId,
      actor: requester,
      actorInstitutionalRole,
      action: currentPrimary ? 'TENANT_PRIMARY_TRANSFERRED' : 'TENANT_PRIMARY_ASSIGNED',
      targetType: 'TenantAdminAssignment',
      targetId: target._id,
      targetUserId: target.userId,
      assignmentId: target._id,
      previousState: {
        previousPrimaryAssignmentId,
        targetRole: 'SECONDARY',
        targetActive: true,
      },
      newState: {
        previousPrimaryRole: currentPrimary ? 'SECONDARY' : null,
        primaryAssignmentId: String(target._id),
        targetRole: 'PRIMARY',
        targetActive: true,
      },
      reason: reason?.trim() || null,
      session,
    });

    return {
      tenantId: String(tenantId),
      previousPrimaryAssignmentId,
      primaryAssignmentId: String(target._id),
      transferredAt: now,
    };
  }

  private async createPrimaryTransferAuthorizationInTransaction(
    tenantId: Types.ObjectId,
    targetAssignmentId: Types.ObjectId,
    requester: any,
    reason: string | undefined,
    session: ClientSession,
  ) {
    const tenant = await this.tenantModel.findById(tenantId).session(session);
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    const stableInstitutionId = tenant.stableInstitutionId?.trim() || String(tenant._id);
    if (!tenant.stableInstitutionId?.trim()) {
      tenant.stableInstitutionId = stableInstitutionId;
      await tenant.save({ session });
    }

    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId) || this.isGlobalAdmin(requester)) {
      throw new ForbiddenException('Solo el administrador principal vigente puede transferir el rol');
    }
    const primary = await this.assignmentModel.findOne({
      tenantId,
      userId: new Types.ObjectId(requesterId),
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    }).session(session).lean();
    if (!primary?.accountAddress) {
      throw new ForbiddenException('Solo el administrador principal vigente puede transferir el rol');
    }

    const target = await this.assignmentModel.findOne({
      _id: targetAssignmentId,
      tenantId,
    }).session(session).lean();
    if (!target) {
      throw new NotFoundException('Administrador institucional no encontrado');
    }
    if (String(target._id) === String(primary._id)) {
      throw new ConflictException('La persona seleccionada ya es administradora principal');
    }
    this.assertEligibleSecondaryTarget(target);

    const targetUser = await this.roledUserModel
      .findById(target.userId, { active: 1, dni: 1, email: 1, name: 1, password: 1 })
      .session(session)
      .lean();
    if (!targetUser || targetUser.active !== true) {
      throw new ConflictException('El usuario destino esta inactivo');
    }
    await this.assertWalletCompatibleForAssignment(target, session);

    const activeStatuses = [
      'PENDING_MOBILE_AUTHORIZATION',
      'PENDING_CHAIN_CONFIRMATION',
      'CHAIN_RETRY_PENDING',
      'RECONCILIATION_PENDING',
      'CHAIN_FAILED',
    ];
    const existing = await this.applicationModel.findOne({
      tenantId,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      status: { $in: activeStatuses },
    } as any).session(session);
    if (existing) {
      if (String(existing.targetAssignmentId || '') !== String(target._id)) {
        throw new ConflictException('Ya existe una transferencia de administrador principal pendiente');
      }
      return this.toPrimaryTransferAuthorizationResponse(existing, tenant, primary);
    }

    const now = new Date();
    const app = new this.applicationModel({
      dni: targetUser.dni,
      email: targetUser.email,
      passwordHash: targetUser.password || 'institutional-primary-transfer',
      name: targetUser.name || 'Administrador de la institución',
      institutionName: tenant.name,
      institutionNameNorm: tenant.nameNorm,
      accountAddress: target.accountAddress,
      status: 'PENDING_MOBILE_AUTHORIZATION',
      stableInstitutionId,
      chainStatus: undefined,
      tenantId,
      userId: target.userId,
      targetAssignmentId: target._id,
      approvedBy: primary.userId,
      initiatedByAssignmentId: primary._id,
      initiatedByWallet: primary.accountAddress,
      approvedAt: now,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      mobileAuthorizationRequestedAt: now,
      mobileAuthorizationExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      reason: reason?.trim() || undefined,
    });
    await app.save({ session });
    const notification = await this.recordPrimaryTransferNotice(app, tenant, primary, requester, session);
    app.mobileAuthorizationNotificationId = notification?._id ?? null;
    await app.save({ session });
    const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
      tenantId,
      requester,
      session,
    );
    await this.auditService.record({
      tenantId,
      actor: requester,
      actorInstitutionalRole,
      action: 'TENANT_PRIMARY_TRANSFER_REQUESTED',
      targetType: 'TenantAdminAssignment',
      targetId: target._id,
      targetUserId: target.userId,
      assignmentId: target._id,
      applicationId: app._id,
      previousState: {
        primaryAssignmentId: String(primary._id),
        targetRole: 'SECONDARY',
      },
      newState: {
        status: 'PENDING_MOBILE_AUTHORIZATION',
        primaryRoleChanged: false,
      },
      reason: reason?.trim() || null,
      session,
    } as any);
    return this.toPrimaryTransferAuthorizationResponse(app, tenant, primary);
  }

  private async recordPrimaryTransferNotice(
    app: InstitutionalAdminApplicationDocument,
    tenant: InstitutionalTenantDocument,
    primary: any,
    requester: any,
    session: ClientSession,
  ) {
    const deduplicationKey = `institutional-primary-transfer:${String(app._id)}`;
    return this.notificationLogModel.findOneAndUpdate(
      { 'data.deduplicationKey': deduplicationKey },
      {
        $setOnInsert: {
          type: 'generic',
          topic: `user_${String(primary.userId)}`,
          title: 'Transferencia de rol principal pendiente',
          body: `Autoriza desde tu teléfono la transferencia del rol principal de ${tenant.name} a ${app.name}.`,
          data: {
            event: 'MOBILE_AUTHORIZATION_REQUESTED',
            applicationId: String(app._id),
            tenantId: String(tenant._id),
            targetUserId: app.userId ? String(app.userId) : null,
            action: 'CHANGE_INSTITUTION_ADMIN',
            requesterId: requester?.sub ? String(requester.sub) : null,
            deduplicationKey,
          },
          status: 'SENT',
        },
      },
      { upsert: true, returnDocument: 'after', session },
    );
  }

  private toPrimaryTransferAuthorizationResponse(
    app: any,
    tenant: any,
    primary: any,
  ) {
    return {
      tenantId: String(tenant._id),
      transferId: String(app._id),
      applicationId: String(app._id),
      targetAssignmentId: app.targetAssignmentId ? String(app.targetAssignmentId) : null,
      previousPrimaryUserId: primary?.userId ? String(primary.userId) : null,
      targetUserId: app.userId ? String(app.userId) : null,
      status: app.status,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      mobileAuthorizationStatus: app.status,
      stableInstitutionId: app.stableInstitutionId ?? null,
      targetWallet: app.accountAddress ?? null,
      signerWallet: primary?.accountAddress ?? null,
      expiresAt: app.mobileAuthorizationExpiresAt ?? null,
    };
  }

  private async getActiveTenantOrThrow(tenantId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId invalido');
    }

    let query = this.tenantModel.findById(tenantId);
    if (session) {
      query = query.session(session);
    }
    const tenant = await query.lean();
    if (!tenant || !tenant.active) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    return tenant;
  }

  private async getAssignmentForTenantOrThrow(
    tenantId: Types.ObjectId,
    assignmentId: string,
    session?: ClientSession,
  ) {
    if (!Types.ObjectId.isValid(assignmentId)) {
      throw new BadRequestException('assignmentId invalido');
    }

    const query = this.assignmentModel
      .findOne({
        _id: new Types.ObjectId(assignmentId),
        tenantId,
      });
    if (session) {
      query.session(session);
    }
    const assignment = await query.lean();
    if (!assignment) {
      throw new NotFoundException('Administrador institucional no encontrado');
    }
    return assignment;
  }

  private async assertCanManageTenant(
    tenantId: Types.ObjectId,
    requester: any,
    session?: ClientSession,
  ) {
    if (this.isGlobalAdmin(requester)) {
      return;
    }

    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para administrar este tenant');
    }

    let query = this.assignmentModel.findOne({
      tenantId,
      userId: new Types.ObjectId(requesterId),
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    });
    if (session) {
      query = query.session(session);
    }
    const primary = await query.lean();
    if (!primary) {
      throw new ForbiddenException('No autorizado para administrar este tenant');
    }
  }

  private assertEligibleSecondaryTarget(assignment: any) {
    if (assignment.institutionalRole !== 'SECONDARY') {
      throw new ConflictException('El destino debe ser un administrador secundario');
    }
    if (assignment.status !== 'APPROVED' || assignment.active !== true) {
      throw new ConflictException('El administrador destino no esta activo y aprobado');
    }
    if (!assignment.accountAddress?.trim()) {
      throw new ConflictException('El administrador destino no tiene wallet operativa');
    }
  }

  private async assertWalletCompatibleForAssignment(
    assignment: any,
    session?: ClientSession,
  ) {
    const accountAddress = assignment.accountAddress?.trim();
    if (!accountAddress) {
      throw new ConflictException('La relacion institucional no tiene wallet operativa');
    }

    let query = this.assignmentModel.find({
      _id: { $ne: assignment._id },
      $or: [
        { accountAddressNormalized: accountAddress.trim().toLowerCase() },
        { accountAddress: this.buildAccountAddressRegex(accountAddress) },
      ],
    });
    if (session) {
      query = query.session(session);
    }
    const matches = await query.lean();
    for (const match of matches) {
      if (String(match.userId) !== String(assignment.userId)) {
        throw new ConflictException(
          'La wallet verificada ya esta asociada a otro administrador institucional',
        );
      }
    }
  }

  private toAdminAssignmentResponse(assignment: any, user?: any) {
    const walletState = getTenantWalletVerificationState(assignment);
    return {
      assignmentId: String(assignment._id),
      userId: String(assignment.userId),
      name: user?.name ?? null,
      email: user?.email ?? null,
      userActive: user?.active ?? null,
      accountAddress: assignment.accountAddress ?? null,
      hasWallet: walletState.hasWallet,
      requiresWalletUpdate: walletState.requiresWalletUpdate,
      walletStatus: walletState.walletStatus,
      walletVerifiedAt: assignment.walletVerifiedAt ?? null,
      walletVerificationSource: assignment.walletVerificationSource ?? null,
      institutionalRole: assignment.institutionalRole ?? null,
      status: assignment.status ?? null,
      active: assignment.active ?? false,
      requestedAt: assignment.requestedAt ?? null,
      approvedAt: assignment.approvedAt ?? null,
      revokedAt: assignment.revokedAt ?? null,
      suspendedAt: assignment.suspendedAt ?? null,
      reactivatedAt: assignment.reactivatedAt ?? null,
    };
  }

  private toGlobalTenantAdminResponse(assignment: any, user?: any) {
    const accountAddress = assignment.accountAddress?.trim() || null;
    const walletState = getTenantWalletVerificationState(assignment);
    return {
      assignmentId: String(assignment._id),
      userId: String(assignment.userId),
      displayName: user?.name ?? null,
      institutionalRole: assignment.institutionalRole ?? null,
      active: assignment.active ?? false,
      approvalStatus: assignment.status ?? null,
      accountAddress,
      hasWallet: walletState.hasWallet,
      requiresWalletUpdate: walletState.requiresWalletUpdate,
      walletStatus: walletState.walletStatus,
      walletVerifiedAt: assignment.walletVerifiedAt ?? null,
      walletVerificationSource: assignment.walletVerificationSource ?? null,
    };
  }

  private buildTenantListQuery(
    query: InstitutionalTenantListQueryDto,
    activeOnly: boolean,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = activeOnly ? { active: true } : {};
    const search = query.search?.trim();
    if (search) {
      filter.name = this.buildSafeSearchRegex(search);
    }
    return {
      filter,
      page,
      limit,
      skip: (page - 1) * limit,
    };
  }

  private buildSafeSearchRegex(input: string) {
    const sanitized = input.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!sanitized) {
      return /^$/;
    }
    return new RegExp(this.escapeRegExp(sanitized), 'i');
  }

  private resolveRequesterObjectId(requester: any): Types.ObjectId | null {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    return requesterId && Types.ObjectId.isValid(requesterId)
      ? new Types.ObjectId(requesterId)
      : null;
  }

  private isGlobalAdmin(requester: any): boolean {
    return requester?.role === 'ADMIN';
  }

  private buildAccountAddressRegex(accountAddress: string) {
    return new RegExp(`^${this.escapeRegExp(accountAddress.trim())}$`, 'i');
  }

  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isPrimaryDuplicateError(error: any): boolean {
    if (error?.code !== 11000) {
      return false;
    }
    const keyPattern = error?.keyPattern ?? {};
    const keyValue = error?.keyValue ?? {};
    const message = typeof error?.message === 'string' ? error.message : '';
    return (
      (keyPattern.tenantId === 1 && keyPattern.institutionalRole === 1) ||
      keyValue.institutionalRole === 'PRIMARY' ||
      message.includes('tenantId_1_institutionalRole_1')
    );
  }

  private isWalletDuplicateError(error: any): boolean {
    if (error?.code !== 11000) {
      return false;
    }
    const keyPattern = error?.keyPattern ?? {};
    const message = typeof error?.message === 'string' ? error.message : '';
    return (
      keyPattern.accountAddressNormalized === 1 ||
      message.includes('accountAddressNormalized_1')
    );
  }

  private isTransactionConflict(error: any): boolean {
    const labels = typeof error?.hasErrorLabel === 'function'
      ? ['TransientTransactionError', 'UnknownTransactionCommitResult'].some((label) =>
          error.hasErrorLabel(label),
        )
      : false;
    return labels || error?.code === 112 || error?.codeName === 'WriteConflict';
  }

  private normalizeName(input: string): string {
    return input
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private formatDisplayName(input: string): string {
    return input.trim().replace(/\s+/g, ' ');
  }
}
