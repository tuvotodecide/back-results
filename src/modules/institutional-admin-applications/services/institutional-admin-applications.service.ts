import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ClientSession, Model, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { Hex, isAddress } from 'viem';
import { InstitutionalEmailOutboxService } from '@/modules/mail/institutional-email-outbox.service';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import { HistoryService } from '@/modules/history/services/history.service';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
  TenantAdminRole,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { normalizeTenantWalletAddress } from '@/modules/institutional-tenants/utils/tenant-wallet-verification.util';
import {
  VotingEvent,
  VotingEventDocument,
} from '@/modules/institutional-voting/schemas/voting-event.schema';
import { CreateInstitutionalAdminApplicationDto } from '../dto/create-institutional-admin-application.dto';
import { InstitutionalAdminApplication, InstitutionalAdminApplicationDocument } from '../schemas/institutional-admin-application.schema';
import { executeCoinbaseOp } from '@/api/account';
import { VoteContractCalls } from '@/api/vote';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';

type IdentityHasDniResponse = {
  ok: boolean;
};

@Injectable()
export class InstitutionalAdminApplicationsService {
  private readonly chain: string;
  private readonly pk: string;

  constructor(
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    private readonly emailOutboxService: InstitutionalEmailOutboxService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly auditService: InstitutionalAuditService,
    private readonly historyService: HistoryService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    this.pk = this.configService.get<string>('app.blockchain.privateKey')!;
  }

  async createApplication(dto: CreateInstitutionalAdminApplicationDto) {
    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    const selectedTenant = await this.resolveSelectedTenantForRegistration(dto.institutionId);
    const rawInstitutionName = selectedTenant?.name ?? dto.institutionName;
    if (!rawInstitutionName) {
      throw new BadRequestException('Debe seleccionar una institución o enviar un nombre válido');
    }
    const institutionName = this.formatDisplayName(rawInstitutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const accountAddress = this.normalizeAccountAddress(dto.accountAddress);
    const existingTenant =
      selectedTenant ?? (await this.tenantModel.findOne({ nameNorm: institutionNameNorm }));
    const existingUser = await this.resolveUserByEmailOrDni(email, dni);

    const latestSameInstitutionApplication = await this.applicationModel
      .findOne({
        institutionNameNorm,
          $or: [
            { email },
            { dni },
            ...(existingUser?._id ? [{ userId: this.toObjectId(existingUser._id) }] : []),
        ],
      })
      .sort({ createdAt: -1, _id: -1 });

    if (existingTenant && existingUser?._id) {
      const existingMembership = await this.assignmentModel
        .findOne({
          tenantId: existingTenant._id,
          userId: this.toObjectId(existingUser._id),
          $or: [
            { status: { $in: ['PENDING', 'APPROVED'] } },
            { status: { $exists: false }, active: true },
          ],
        })
        .lean();
      if (existingMembership) {
        const currentStatus =
          existingMembership.status ?? (existingMembership.active ? 'APPROVED' : 'REVOKED');
        if (currentStatus === 'APPROVED') {
          throw new ConflictException(
            'El usuario ya tiene acceso institucional aprobado para este tenant',
          );
        }
        throw new ConflictException('La solicitud institucional ya existe y sigue pendiente');
      }
    }

    if (latestSameInstitutionApplication && ['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED'].includes(latestSameInstitutionApplication.status)) {
      if (latestSameInstitutionApplication.status === 'APPROVED') {
        throw new ConflictException(
          'El usuario ya tiene acceso institucional aprobado para este tenant',
        );
      }
      throw new ConflictException('La solicitud institucional ya existe y sigue pendiente');
    }

    await this.assertWalletBelongsToDni(accountAddress, dni);

    let user = existingUser;
    if (!user) {
      const password = this.requirePassword(
        dto.password,
        'password es requerido para crear una identidad institucional nueva',
      );
      try {
        user = await this.roledUserModel.create({
          dni,
          email,
          name: dto.name.trim(),
          password: bcrypt.hashSync(password, 10),
          role: 'USER',
          active: false,
        });
      } catch (error) {
        this.rethrowIdentityDuplicate(error);
        throw error;
      }
    }

    const shouldRequireEmailVerification = !existingUser || Boolean(existingUser.verificationToken);
    const nextStatus = shouldRequireEmailVerification
      ? 'PENDING_EMAIL_VERIFICATION'
      : 'PENDING_APPROVAL';

    const verificationToken = shouldRequireEmailVerification
      ? randomBytes(32).toString('hex')
      : undefined;
    const verificationTokenExpiresAt = shouldRequireEmailVerification
      ? new Date(
          Date.now() +
            1000 * 60 * 60 * this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
        )
      : undefined;

    let created = latestSameInstitutionApplication;
    if (created && ['REJECTED', 'REVOKED'].includes(created.status)) {
      const passwordHash = this.resolveApplicationPasswordHash(
        user,
        dto.password,
        created.passwordHash,
      );
      created.dni = dni;
      created.email = email;
      created.passwordHash = passwordHash;
      created.name = dto.name.trim();
      created.institutionName = institutionName;
      created.institutionNameNorm = institutionNameNorm;
      created.accountAddress = accountAddress;
      created.status = nextStatus as any;
      created.verificationToken = verificationToken;
      created.verificationTokenExpiresAt = verificationTokenExpiresAt;
      created.emailVerifiedAt = shouldRequireEmailVerification ? undefined : new Date();
      created.approvedAt = undefined;
      created.rejectedAt = undefined;
      created.revokedAt = undefined;
      created.reason = undefined;
      created.tenantId = existingTenant?._id;
      created.userId = user._id;
      await created.save();
    } else {
      const passwordHash = this.resolveApplicationPasswordHash(user, dto.password);
      created = await this.applicationModel.create({
        dni,
        email,
        passwordHash,
        name: dto.name.trim(),
        institutionName,
        institutionNameNorm,
        accountAddress,
        status: nextStatus,
        verificationToken,
        verificationTokenExpiresAt,
        emailVerifiedAt: shouldRequireEmailVerification ? undefined : new Date(),
        tenantId: existingTenant?._id,
        userId: this.toObjectId(user._id),
      });
    }

    if (!shouldRequireEmailVerification && created.tenantId && created.userId) {
      await this.assignmentModel.findOneAndUpdate(
        {
          tenantId: created.tenantId,
          userId: created.userId,
        },
        {
          $set: {
            status: 'PENDING',
            active: false,
            requestedAt: new Date(),
            approvedAt: null,
            rejectedAt: null,
            revokedAt: null,
            approvedBy: null,
            reason: null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    }

    if (shouldRequireEmailVerification && verificationToken) {
      await this.sendVerificationEmail(created._id, created.email, created.name, verificationToken);
    }

    await this.auditService.record({
      tenantId: created.tenantId ?? null,
      actor: null,
      action: 'INSTITUTIONAL_APPLICATION_CREATED',
      targetType: 'InstitutionalAdminApplication',
      targetId: created._id,
      targetUserId: created.userId ?? null,
      applicationId: created._id,
      newState: {
        status: created.status,
        tenantResolved: Boolean(created.tenantId),
        userResolved: Boolean(created.userId),
        hasAccountAddress: Boolean(created.accountAddress),
      },
    });

    return {
      id: String(created._id),
      status: created.status,
      email: created.email,
      tenantAlreadyExists: Boolean(existingTenant),
      tenantId: created.tenantId ? String(created.tenantId) : null,
      userId: created.userId ? String(created.userId) : null,
    };
  }

  async verifyEmail(token: string) {
    const app = await this.applicationModel.findOne({ verificationToken: token });
    if (!app) {
      throw new BadRequestException('Token de verificación inválido');
    }

    if (app.status !== 'PENDING_EMAIL_VERIFICATION') {
      throw new BadRequestException('La solicitud no está pendiente de verificación');
    }

    if (!app.verificationTokenExpiresAt || app.verificationTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El token de verificación ha expirado');
    }

    app.status = 'PENDING_APPROVAL';
    app.verificationToken = undefined;
    app.verificationTokenExpiresAt = undefined;
    app.emailVerifiedAt = new Date();

    if (app.tenantId && app.userId) {
      await this.assignmentModel.findOneAndUpdate(
        {
          tenantId: app.tenantId,
          userId: app.userId,
        },
        {
          $set: {
            status: 'PENDING',
            active: false,
            requestedAt: new Date(),
            approvedAt: null,
            rejectedAt: null,
            revokedAt: null,
            approvedBy: null,
            reason: null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    }

    await app.save();
    await this.auditService.record({
      tenantId: app.tenantId ?? null,
      actor: null,
      action: 'INSTITUTIONAL_EMAIL_VERIFIED',
      targetType: 'InstitutionalAdminApplication',
      targetId: app._id,
      targetUserId: app.userId ?? null,
      applicationId: app._id,
      previousState: { status: 'PENDING_EMAIL_VERIFICATION' },
      newState: {
        status: app.status,
        emailVerified: true,
        assignmentPending: Boolean(app.tenantId && app.userId),
      },
    });

    return {
      id: String(app._id),
      status: app.status,
      emailVerifiedAt: app.emailVerifiedAt,
    };
  }

  async listApplications(status?: string) {
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }

    const rows = await this.applicationModel
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return {
      data: rows.map((row) => this.toApplicationResponse(row)),
      total: rows.length,
    };
  }

  async getApplicationDetail(applicationId: string) {
    const app = await this.getApplicationOrThrow(applicationId);
    return this.toApplicationResponse(app);
  }

  async approveApplication(applicationId: string, requester: any) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('applicationId inválido');
    }

    const session = await this.applicationModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const app = await this.getApplicationOrThrow(applicationId, session);
        if (!app) {
          throw new NotFoundException('Solicitud no encontrada');
        }

        if (app.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException('La solicitud no está pendiente de aprobación');
        }

        if (!app.accountAddress) {
          throw new BadRequestException('La solicitud institucional no tiene wallet verificada');
        }

        const accountAddress = this.normalizeAccountAddress(app.accountAddress);
        const accountAddressNormalized = normalizeTenantWalletAddress(accountAddress)?.toLowerCase();
        if (!accountAddressNormalized) {
          throw new BadRequestException('La solicitud institucional no tiene wallet verificada');
        }
        let user = await this.resolveUserByEmailOrDni(app.email, app.dni, session);
        let tenantQuery = app.tenantId
          ? this.tenantModel.findById(app.tenantId)
          : this.tenantModel.findOne({ nameNorm: app.institutionNameNorm });
        const tenantQuerySession = tenantQuery?.session;
        if (typeof tenantQuerySession === 'function') {
          tenantQuery = tenantQuerySession.call(tenantQuery, session);
        }
        let tenant = await tenantQuery;

        await this.assertRequesterIsNotTarget(requester, app, user?._id, session);
        const initialApprovalPlan = await this.resolveInstitutionalApprovalPlan(
          tenant?._id,
          requester,
          user?._id,
          session,
        );

        await this.assertWalletAssignmentCompatibility({
          accountAddress,
          userId: user?._id,
          tenantId: tenant?._id,
        }, session);

        if (!user) {
          try {
            const createdUsers = await this.roledUserModel.create(
              [
                {
                  dni: app.dni,
                  email: app.email,
                  name: app.name,
                  password: app.passwordHash,
                  role: 'USER',
                  active: false,
                },
              ],
              { session },
            );
            user = Array.isArray(createdUsers) ? createdUsers[0] : createdUsers;
          } catch (error) {
            this.rethrowIdentityDuplicate(error);
            throw error;
          }
        }

        let tenantCreatedDuringApproval = false;
        if (!tenant) {
          try {
            const createdTenants = await this.tenantModel.create(
              [
                {
                  name: app.institutionName,
                  nameNorm: app.institutionNameNorm,
                  description: `Tenant creado desde solicitud ${String(app._id)}`,
                  active: true,
                },
              ],
              { session },
            );
            tenant = Array.isArray(createdTenants) ? createdTenants[0] : createdTenants;
            tenantCreatedDuringApproval = true;
          } catch (error: any) {
            if (error?.code === 11000) {
              const retryTenantQuery = this.tenantModel.findOne({
                nameNorm: app.institutionNameNorm,
              });
              const retryTenantQuerySession = retryTenantQuery?.session;
              if (typeof retryTenantQuerySession === 'function') {
                retryTenantQuerySession.call(retryTenantQuery, session);
              }
              tenant = await retryTenantQuery;
            } else {
              throw error;
            }
          }
        }

        if (!tenant) {
          throw new ConflictException('No se pudo resolver o crear el tenant');
        }

        const institutionalRole = tenantCreatedDuringApproval
          ? initialApprovalPlan.institutionalRole
          : (
              await this.resolveInstitutionalApprovalPlan(
                tenant._id,
                requester,
                user._id,
                session,
              )
            ).institutionalRole;

        await this.assertWalletAssignmentCompatibility({
          accountAddress,
          userId: user._id,
          tenantId: tenant._id,
        }, session);

        const approvedAt = new Date();
        let assignment: any;
        try {
          assignment = await this.assignmentModel.findOneAndUpdate(
            {
              tenantId: tenant._id,
              userId: user._id,
            },
            {
              $set: {
                status: 'APPROVED',
                active: true,
                accountAddress,
                accountAddressNormalized,
                applicationId: app._id,
                institutionalRole,
                requestedAt: app.emailVerifiedAt ?? (app as any).createdAt ?? new Date(),
                approvedAt,
                rejectedAt: null,
                revokedAt: null,
                approvedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
                reason: null,
                walletVerifiedAt: approvedAt,
                walletVerifiedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
                walletVerificationSource: 'IDENTITY',
              },
            },
            { upsert: true, returnDocument: 'after', session },
          );
        } catch (error) {
          if (this.isPrimaryAssignmentDuplicateError(error, institutionalRole)) {
            throw new ConflictException(
              'La institución ya cuenta con un administrador principal activo',
            );
          }
          if (this.isWalletDuplicateError(error)) {
            throw new ConflictException(
              'La wallet verificada ya esta asociada a otro administrador institucional',
            );
          }
          throw error;
        }

        user.active = true;
        user.verificationToken = undefined;
        user.verificationTokenExpiresAt = undefined;
        await user.save({ session });

        app.status = 'APPROVED';
        app.accountAddress = accountAddress;
        app.approvedAt = approvedAt;
        app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
        app.rejectedAt = undefined;
        app.revokedAt = undefined;
        app.reason = undefined;
        app.tenantId = this.toObjectId(tenant._id);
        app.userId = this.toObjectId(user._id);
        await app.save({ session });
        await this.syncUserActiveState(user._id, session);
        const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
          tenant._id,
          requester,
          session,
        );
        await this.auditService.record({
          tenantId: tenant._id,
          actor: requester,
          actorInstitutionalRole,
          action: 'TENANT_ADMIN_ASSIGNMENT_CREATED',
          targetType: 'TenantAdminAssignment',
          targetId: assignment?._id ?? null,
          targetUserId: user._id,
          applicationId: app._id,
          assignmentId: assignment?._id ?? null,
          newState: {
            status: assignment?.status ?? 'APPROVED',
            active: assignment?.active ?? true,
            institutionalRole,
            hasAccountAddress: true,
          },
          session,
        });
        await this.auditService.record({
          tenantId: tenant._id,
          actor: requester,
          actorInstitutionalRole,
          action: 'INSTITUTIONAL_APPLICATION_APPROVED',
          targetType: 'InstitutionalAdminApplication',
          targetId: app._id,
          targetUserId: user._id,
          applicationId: app._id,
          assignmentId: assignment?._id ?? null,
          previousState: { status: 'PENDING_APPROVAL' },
          newState: {
            status: app.status,
            institutionalRole,
            userActive: true,
          },
          session,
        });

        response = {
          id: String(app._id),
          status: app.status,
          tenantId: String(tenant._id),
          userId: String(user._id),
          institutionalRole,
        };

        await this.createInstitutionOnChain(applicationId, app.accountAddress, session)
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async createInstitutionOnChain(applicationId: string, adminAddr: string, session: ClientSession) {
    try {
      // Create institution
      const response = await executeCoinbaseOp(
        this.pk as Hex,
        this.chain,
        VoteContractCalls.createInstitution(this.chain, applicationId, adminAddr as Hex),
        undefined,
        undefined
      );

      await this.historyService.createWithSession({
        txHash: response.txHash,
        operationName: HistoryOperationKey.institutionCreated,
        type: HistoryType.AUTOMATED,
        registerDate: new Date().toISOString(),
        institutionId: applicationId,
      }, session);
    } catch (error) {
      throw new Error('Failed to create insitution on-chain', { cause: error });
    }
  }

  async rejectApplication(applicationId: string, requester: any, reason?: string) {
    const session = await this.applicationModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const app = await this.getApplicationOrThrow(applicationId, session);
        if (app.status !== 'PENDING_APPROVAL') {
          throw new BadRequestException(
            'Solo se puede rechazar una solicitud institucional pendiente de aprobación',
          );
        }

        const targetUserId =
          app.userId ?? (await this.resolveUserByEmailOrDni(app.email, app.dni, session))?._id;
        await this.assertRequesterIsNotTarget(requester, app, targetUserId);
        const tenantQuery = app.tenantId
          ? this.tenantModel.findById(app.tenantId)
          : this.tenantModel.findOne({ nameNorm: app.institutionNameNorm });
        const tenantQuerySession = tenantQuery?.session;
        if (typeof tenantQuerySession === 'function') {
          tenantQuerySession.call(tenantQuery, session);
        }
        const tenant = await tenantQuery;
        if (!this.isGlobalInstitutionalApprover(requester)) {
          if (!tenant) {
            throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
          }
          await this.assertRequesterIsPrimaryForTenant(requester, tenant._id, session);
        }

        let assignment: any = null;
        if (app.tenantId && app.userId) {
          assignment = await this.assignmentModel.findOneAndUpdate(
            { tenantId: app.tenantId, userId: app.userId },
            {
              $set: {
                status: 'REJECTED',
                active: false,
                rejectedAt: new Date(),
                revokedAt: null,
                approvedAt: null,
                approvedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
                reason: reason?.trim() || null,
              },
            },
            { upsert: true, returnDocument: 'after', session },
          );
        }

        app.status = 'REJECTED';
        app.rejectedAt = new Date();
        app.revokedAt = undefined;
        app.approvedAt = undefined;
        app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
        app.reason = reason?.trim() || undefined;
        await app.save({ session });

        if (app.userId) {
          await this.syncUserActiveState(app.userId, session);
        }
        const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
          app.tenantId ?? tenant?._id,
          requester,
          session,
        );
        await this.auditService.record({
          tenantId: app.tenantId ?? tenant?._id ?? null,
          actor: requester,
          actorInstitutionalRole,
          action: 'INSTITUTIONAL_APPLICATION_REJECTED',
          targetType: 'InstitutionalAdminApplication',
          targetId: app._id,
          targetUserId: app.userId ?? targetUserId ?? null,
          applicationId: app._id,
          assignmentId: assignment?._id ?? null,
          previousState: { status: 'PENDING_APPROVAL' },
          newState: {
            status: app.status,
            assignmentStatus: assignment?.status ?? null,
            assignmentActive: assignment?.active ?? null,
          },
          reason: app.reason ?? null,
          session,
        });

        response = {
          id: String(app._id),
          status: app.status,
          reason: app.reason ?? null,
        };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async revokeApplication(applicationId: string, requester: any, reason?: string) {
    const session = await this.applicationModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const app = await this.getApplicationOrThrow(applicationId, session);
        if (app.status !== 'APPROVED') {
          throw new BadRequestException('Solo se puede revocar una solicitud aprobada');
        }
        if (!app.tenantId || !app.userId) {
          throw new ConflictException('La solicitud aprobada no tiene membership asociado');
        }

        const assignment = await this.assignmentModel.findOneAndUpdate(
          { tenantId: app.tenantId, userId: app.userId },
          {
            $set: {
              status: 'REVOKED',
              active: false,
              revokedAt: new Date(),
              reason: reason?.trim() || null,
            },
          },
          { upsert: true, returnDocument: 'after', session },
        );

        app.status = 'REVOKED';
        app.revokedAt = new Date();
        app.reason = reason?.trim() || undefined;
        app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
        await app.save({ session });

        await this.syncUserActiveState(app.userId, session);
        const actorInstitutionalRole = await this.auditService.resolveActorInstitutionalRole(
          app.tenantId,
          requester,
          session,
        );
        await this.auditService.record({
          tenantId: app.tenantId,
          actor: requester,
          actorInstitutionalRole,
          action: 'INSTITUTIONAL_APPLICATION_REVOKED',
          targetType: 'InstitutionalAdminApplication',
          targetId: app._id,
          targetUserId: app.userId,
          applicationId: app._id,
          assignmentId: assignment?._id ?? null,
          previousState: {
            status: 'APPROVED',
            assignmentStatus: 'APPROVED',
            assignmentActive: true,
          },
          newState: {
            status: app.status,
            assignmentStatus: assignment?.status ?? 'REVOKED',
            assignmentActive: assignment?.active ?? false,
          },
          reason: app.reason ?? null,
          session,
        });

        response = {
          id: String(app._id),
          status: app.status,
          reason: app.reason ?? null,
        };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async reopenApplication(applicationId: string, requester: any, reason?: string) {
    const session = await this.applicationModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const app = await this.getApplicationOrThrow(applicationId, session);
        if (!['REJECTED', 'REVOKED'].includes(app.status)) {
          throw new BadRequestException('Solo se pueden reabrir solicitudes rechazadas o revocadas');
        }

        app.status = 'PENDING_APPROVAL';
        app.reason = undefined;
        app.approvedAt = undefined;
        app.rejectedAt = undefined;
        app.revokedAt = undefined;
        app.approvedBy = undefined;
        await app.save({ session });

        if (app.userId) {
          await this.syncUserActiveState(app.userId, session);
        }
        await this.auditService.record({
          tenantId: app.tenantId ?? null,
          actor: requester,
          action: 'INSTITUTIONAL_APPLICATION_REOPENED',
          targetType: 'InstitutionalAdminApplication',
          targetId: app._id,
          targetUserId: app.userId ?? null,
          applicationId: app._id,
          previousState: { status: 'REJECTED_OR_REVOKED' },
          newState: { status: app.status },
          reason: reason?.trim() || null,
          session,
        });

        response = {
          id: String(app._id),
          status: app.status,
          reason: app.reason ?? null,
        };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async listPendingApplications() {
    return this.listApplications('PENDING_APPROVAL');
  }

  async createApprovedTestAdmin(
    dto: CreateInstitutionalAdminApplicationDto,
    requester: any,
  ) {
    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    if (!dto.institutionName) {
      throw new BadRequestException('institutionName es requerido para crear un admin institucional de prueba');
    }
    const institutionName = this.formatDisplayName(dto.institutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const name = dto.name.trim();
    const accountAddress = this.normalizeAccountAddress(dto.accountAddress);

    const existingUser = await this.roledUserModel
      .findOne({
        $or: [{ email }, { dni }],
      })
      .lean();
    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese email o DNI');
    }

    const existingApplication = await this.applicationModel
      .findOne({
        $or: [{ email }, { dni }],
      })
      .lean();
    if (existingApplication) {
      throw new ConflictException('Ya existe una solicitud para ese email o DNI');
    }

    let tenant = await this.tenantModel.findOne({ nameNorm: institutionNameNorm });
    if (!tenant) {
      tenant = await this.tenantModel.create({
        name: institutionName,
        nameNorm: institutionNameNorm,
        description: `Tenant de prueba para ${email}`,
        active: true,
      });
    }

    let user: RoledUserDocument;
    const password = this.requirePassword(
      dto.password,
      'password es requerido para crear un admin institucional de prueba',
    );
    try {
      user = await this.roledUserModel.create({
        dni,
        email,
        name,
        password: bcrypt.hashSync(password, 10),
        role: 'USER',
        active: true,
        verificationToken: undefined,
        verificationTokenExpiresAt: undefined,
      });
    } catch (error) {
      this.rethrowIdentityDuplicate(error);
      throw error;
    }

    const approvedAt = new Date();
    const institutionalRole = await this.resolveTestAdminInstitutionalRole(tenant._id);

    await this.assignmentModel.findOneAndUpdate(
      {
        tenantId: tenant._id,
        userId: user._id,
      },
      {
        $set: {
          status: 'APPROVED',
          active: true,
          accountAddress,
          applicationId: null,
          institutionalRole,
          requestedAt: new Date(),
          approvedAt,
          rejectedAt: null,
          revokedAt: null,
          approvedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
          reason: null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const application = await this.applicationModel.create({
      dni,
      email,
      passwordHash: user.password,
      name,
      institutionName,
      institutionNameNorm,
      accountAddress,
      status: 'APPROVED',
      emailVerifiedAt: approvedAt,
      approvedAt,
      approvedBy: requester?.sub ? new Types.ObjectId(requester.sub) : undefined,
      tenantId: tenant._id,
      userId: user._id,
    });

    return {
      id: String(application._id),
      status: application.status,
      email: application.email,
      userId: String(user._id),
      tenantId: String(tenant._id),
      institutionalRole,
    };
  }

  async cleanupTestAdminByEmail(rawEmail: string) {
    const email = rawEmail.trim().toLowerCase();
    const applications = await this.applicationModel.find({ email }).lean();
    const user = await this.roledUserModel.findOne({ email }).lean();

    const tenantIds = new Set<string>();
    for (const app of applications) {
      if (app.tenantId) tenantIds.add(String(app.tenantId));
    }

    if (user?._id) {
      const assignments = await this.assignmentModel
        .find({ userId: user._id }, { tenantId: 1 })
        .lean();
      for (const assignment of assignments) {
        tenantIds.add(String(assignment.tenantId));
      }
      await this.assignmentModel.deleteMany({ userId: user._id });
      await this.roledUserModel.deleteOne({ _id: user._id });
    }

    await this.applicationModel.deleteMany({ email });

    let deletedTenants = 0;
    for (const tenantId of tenantIds) {
      if (!Types.ObjectId.isValid(tenantId)) {
        continue;
      }

      const [remainingAssignments, remainingEvents] = await Promise.all([
        this.assignmentModel.countDocuments({
          tenantId: new Types.ObjectId(tenantId),
          active: true,
        }),
        this.votingEventModel.countDocuments({
          tenantId: new Types.ObjectId(tenantId),
        }),
      ]);

      if (remainingAssignments === 0 && remainingEvents === 0) {
        const result = await this.tenantModel.deleteOne({
          _id: new Types.ObjectId(tenantId),
        });
        deletedTenants += result.deletedCount ?? 0;
      }
    }

    return {
      success: true,
      email,
      deletedApplications: applications.length,
      deletedUser: Boolean(user),
      deletedTenants,
    };
  }

  private normalizeName(input: string) {
    return input
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private formatDisplayName(input: string) {
    return input.trim().replace(/\s+/g, ' ');
  }

  private async resolveSelectedTenantForRegistration(
    institutionId?: string,
  ): Promise<InstitutionalTenantDocument | null> {
    if (!institutionId) {
      return null;
    }
    if (!Types.ObjectId.isValid(institutionId)) {
      throw new BadRequestException('institutionId inválido');
    }
    const tenant = await this.tenantModel.findById(institutionId);
    if (!tenant || tenant.active !== true) {
      throw new BadRequestException('La institución seleccionada no está disponible');
    }
    return tenant;
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

  private normalizeAccountAddressForComparison(accountAddress: string): string {
    return accountAddress.trim().toLowerCase();
  }

  private buildAccountAddressRegex(accountAddress: string) {
    return new RegExp(`^${this.escapeRegExp(accountAddress.trim())}$`, 'i');
  }

  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async assertWalletAssignmentCompatibility(params: {
    accountAddress: string;
    userId?: Types.ObjectId | string;
    tenantId?: Types.ObjectId | string;
  }, session?: ClientSession) {
    const accountAddressCmp = this.normalizeAccountAddressForComparison(params.accountAddress);
    const expectedUserId = params.userId ? String(params.userId) : null;
    const expectedTenantId = params.tenantId ? String(params.tenantId) : null;

    const walletQuery = this.assignmentModel
      .find({
        $or: [
          { accountAddressNormalized: accountAddressCmp },
          { accountAddress: this.buildAccountAddressRegex(params.accountAddress) },
        ],
      });
    if (session && typeof walletQuery.session === 'function') {
      walletQuery.session(session);
    }
    const assignmentsWithWallet = await walletQuery.lean();

    for (const assignment of assignmentsWithWallet) {
      if (expectedUserId && String(assignment.userId) === expectedUserId) {
        continue;
      }
      throw new ConflictException(
        'La wallet verificada ya esta asociada a otro administrador institucional',
      );
    }

    if (!expectedUserId || !expectedTenantId) {
      return;
    }

    const existingQuery = this.assignmentModel
      .findOne({
        tenantId: new Types.ObjectId(expectedTenantId),
        userId: new Types.ObjectId(expectedUserId),
      });
    if (session && typeof existingQuery.session === 'function') {
      existingQuery.session(session);
    }
    const existingAssignment = await existingQuery.lean();

    if (!existingAssignment) {
      return;
    }

    const existingAccountAddress = existingAssignment.accountAddress?.trim();
    if (existingAccountAddress) {
      const existingAccountAddressCmp =
        this.normalizeAccountAddressForComparison(existingAccountAddress);
      if (existingAccountAddressCmp !== accountAddressCmp) {
        throw new ConflictException(
          'La relacion institucional existente usa una wallet distinta',
        );
      }
      return;
    }

    const status = existingAssignment.status ?? (existingAssignment.active ? 'APPROVED' : null);
    if (existingAssignment.active === true && status === 'APPROVED') {
      throw new ConflictException(
        'La relacion institucional aprobada no tiene wallet y requiere migracion explicita',
      );
    }
  }

  private async resolveInstitutionalApprovalPlan(
    tenantId: Types.ObjectId | string | undefined,
    requester: any,
    targetUserId?: Types.ObjectId | string,
    session?: ClientSession,
  ): Promise<{ institutionalRole: TenantAdminRole }> {
    if (!tenantId) {
      if (!this.isGlobalInstitutionalApprover(requester)) {
        throw new ForbiddenException(
          'Solo un administrador global puede aprobar el primer administrador institucional',
        );
      }
      return { institutionalRole: 'PRIMARY' };
    }

    const tenantObjectId = this.toObjectId(tenantId);
    const targetUserObjectId = targetUserId ? this.toObjectId(targetUserId) : null;
    const activeQuery = this.assignmentModel
      .find({
        tenantId: tenantObjectId,
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      });
    if (session && typeof activeQuery.session === 'function') {
      activeQuery.session(session);
    }
    const activeAssignments = await activeQuery.lean();

    const activePrimaryAssignments = activeAssignments.filter(
      (assignment) => assignment.institutionalRole === 'PRIMARY',
    );

    if (activePrimaryAssignments.length > 1) {
      throw new ConflictException('El tenant tiene mas de un administrador principal activo');
    }

    const existingTargetAssignment = targetUserObjectId
      ? activeAssignments.find(
          (assignment) => String(assignment.userId) === String(targetUserObjectId),
        )
      : null;
    if (existingTargetAssignment?.institutionalRole) {
      await this.assertCanApproveForTenantRole(
        requester,
        tenantObjectId,
        existingTargetAssignment.institutionalRole,
      );
      return { institutionalRole: existingTargetAssignment.institutionalRole };
    }

    if (activeAssignments.length === 0) {
      if (!this.isGlobalInstitutionalApprover(requester)) {
        throw new ForbiddenException(
          'Solo un administrador global puede aprobar el primer administrador institucional',
        );
      }
      return { institutionalRole: 'PRIMARY' };
    }

    if (activePrimaryAssignments.length === 0) {
      throw new ConflictException(
        'El tenant tiene asignaciones activas sin administrador principal explicito',
      );
    }

    await this.assertCanApproveForTenantRole(requester, tenantObjectId, 'SECONDARY');
    return { institutionalRole: 'SECONDARY' };
  }

  private async assertCanApproveForTenantRole(
    requester: any,
    tenantId: Types.ObjectId,
    institutionalRole: TenantAdminRole,
  ) {
    if (this.isGlobalInstitutionalApprover(requester)) {
      return;
    }
    if (institutionalRole === 'PRIMARY') {
      throw new ForbiddenException(
        'Solo un administrador global puede aprobar el administrador principal',
      );
    }
    await this.assertRequesterIsPrimaryForTenant(requester, tenantId);
  }

  private async assertRequesterIsPrimaryForTenant(
    requester: any,
    tenantId: Types.ObjectId | string,
    session?: ClientSession,
  ) {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
    }

    const primaryQuery = this.assignmentModel
      .findOne({
        tenantId: this.toObjectId(tenantId),
        userId: new Types.ObjectId(requesterId),
        institutionalRole: 'PRIMARY',
        active: true,
        status: 'APPROVED',
      });
    if (session && typeof primaryQuery.session === 'function') {
      primaryQuery.session(session);
    }
    const primaryAssignment = await primaryQuery.lean();

    if (!primaryAssignment) {
      throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
    }
  }

  private async assertRequesterIsNotTarget(
    requester: any,
    app: InstitutionalAdminApplicationDocument,
    targetUserId?: Types.ObjectId | string | null,
    session?: ClientSession,
  ) {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
    }

    if (targetUserId && String(targetUserId) === requesterId) {
      throw new ForbiddenException('No puede aprobar su propia solicitud institucional');
    }

    if (targetUserId) {
      return;
    }

    const requesterQuery = this.roledUserModel.findById(new Types.ObjectId(requesterId));
    if (session && typeof requesterQuery.session === 'function') {
      requesterQuery.session(session);
    }
    const requesterUser = await requesterQuery;
    if (requesterUser?.email?.trim().toLowerCase() === app.email.trim().toLowerCase()) {
      throw new ForbiddenException('No puede aprobar su propia solicitud institucional');
    }
  }

  private isGlobalInstitutionalApprover(requester: any): boolean {
    return ['ADMIN', 'ACCESS_APPROVER'].includes(requester?.role);
  }

  private isPrimaryAssignmentDuplicateError(error: any, institutionalRole: TenantAdminRole) {
    if (institutionalRole !== 'PRIMARY' || error?.code !== 11000) {
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

  private async resolveTestAdminInstitutionalRole(
    tenantId: Types.ObjectId | string,
  ): Promise<TenantAdminRole> {
    const activeAssignments = await this.assignmentModel
      .find({
        tenantId: this.toObjectId(tenantId),
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      })
      .lean();

    if (activeAssignments.length === 0) {
      return 'PRIMARY';
    }

    const activePrimaryAssignments = activeAssignments.filter(
      (assignment) => assignment.institutionalRole === 'PRIMARY',
    );
    if (activePrimaryAssignments.length !== 1) {
      throw new ConflictException(
        'El tenant requiere designacion explicita de administrador principal',
      );
    }

    return 'SECONDARY';
  }

  private async assertWalletBelongsToDni(accountAddress: string, dni: string): Promise<void> {
    const identityBaseUrl = this.configService.get<string>('app.identity.baseUrl');
    const identityApiKey = this.configService.get<string>('app.identity.apiKey');
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!identityBaseUrl || !identityApiKey) {
      throw new ServiceUnavailableException('No se pudo verificar la wallet en este momento');
    }

    try {
      const response = await this.httpService.axiosRef.get<IdentityHasDniResponse>(
        `${identityBaseUrl.replace(/\/$/, '')}/registry/has-dni`,
        {
          params: {
            account: accountAddress,
            dnis: dni,
          },
          headers: {
            'x-api-key': identityApiKey,
          },
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

  private async sendVerificationEmail(
    applicationId: Types.ObjectId | string,
    to: string,
    name: string,
    token: string,
  ) {
    const verificationBaseUrl = this.configService.get<string>('app.mail.verificationBaseUrl') || '';

    if (!verificationBaseUrl) {
      return;
    }

    if (typeof this.emailOutboxService.enqueueInstitutionalVerificationEmail === 'function') {
      await this.emailOutboxService.enqueueInstitutionalVerificationEmail({
        recipient: to,
        name,
        targetId: applicationId,
      });
      await this.emailOutboxService.processPendingBatch?.(1);
      return;
    }

    const url = this.buildUrlWithToken(verificationBaseUrl, token, '/votacion/verificar-correo');
    await (this.emailOutboxService as any).sendEmail(
      to,
      'Verifica tu solicitud de administrador institucional',
      'verify-email',
      {
        name: name.split(' ')[0],
        verificationLink: url,
      },
    );
  }

  private buildUrlWithToken(baseUrl: string, token: string, canonicalPath: string): string {
    try {
      const url = new URL(baseUrl);
      url.pathname = canonicalPath;
      url.search = '';
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      const normalizedBase = baseUrl.replace(/\/$/, '');
      return `${normalizedBase}${canonicalPath}?token=${token}`;
    }
  }

  private async getApplicationOrThrow(applicationId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('applicationId invalido');
    }

    const query = this.applicationModel.findById(applicationId);
    if (session && typeof query.session === 'function') {
      query.session(session);
    }
    const app = await query;
    if (!app) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    return app;
  }

  private async resolveUserByEmailOrDni(email: string, dni: string, session?: ClientSession) {
    const query = this.roledUserModel
      .find({ $or: [{ email }, { dni }] })
      .sort({ createdAt: 1, _id: 1 });
    if (session && typeof query.session === 'function') {
      query.session(session);
    }
    const matches = await query;

    if (matches.length === 0) {
      return null;
    }

    const sameIdentity = matches.every(
      (match) => match.email === email && match.dni === dni,
    );
    if (!sameIdentity) {
      throw new ConflictException('El email o DNI ya está asociado a otro usuario');
    }

    return matches[0];
  }

  private resolveApplicationPasswordHash(
    existingUser: RoledUserDocument | null,
    password?: string,
    fallbackHash?: string,
  ): string {
    if (existingUser?.password) {
      return existingUser.password;
    }
    if (password) {
      return bcrypt.hashSync(password, 10);
    }
    if (fallbackHash) {
      return fallbackHash;
    }
    throw new BadRequestException(
      'password es requerido cuando no existe una identidad reutilizable en roled_users',
    );
  }

  private requirePassword(password: string | undefined, message: string): string {
    if (!password) {
      throw new BadRequestException(message);
    }
    return password;
  }

  private rethrowIdentityDuplicate(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as any).code === 11000
    ) {
      throw new ConflictException('Ya existe un usuario con ese email o DNI');
    }
  }

  private async syncUserActiveState(userId: Types.ObjectId | string, session?: ClientSession) {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const userQuery = this.roledUserModel.findById(normalizedUserId);
    if (session && typeof userQuery.session === 'function') {
      userQuery.session(session);
    }
    const user = await userQuery;
    if (!user) return;

    const membershipQuery = this.assignmentModel.exists({
      userId: normalizedUserId,
      active: true,
      $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
    });
    if (session && typeof membershipQuery.session === 'function') {
      membershipQuery.session(session);
    }
    const hasApprovedTenantMembership = await membershipQuery;

    const shouldRemainActive =
      user.role === 'ADMIN' ||
      user.role === 'ACCESS_APPROVER' ||
      user.territorialAccessStatus === 'APPROVED' ||
      ((!user.territorialAccessStatus || user.territorialAccessStatus === 'NONE') &&
        (user.role === 'MAYOR' || user.role === 'GOVERNOR') &&
        user.active) ||
      Boolean(hasApprovedTenantMembership);

    if (user.active !== shouldRemainActive) {
      user.active = shouldRemainActive;
      await user.save({ session });
    }
  }

  private toObjectId(value: Types.ObjectId | string): Types.ObjectId {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }

  private toApplicationResponse(row: any) {
    return {
      id: String(row._id),
      dni: row.dni,
      email: row.email,
      name: row.name,
      institutionName: row.institutionName,
      accountAddress: row.accountAddress,
      status: row.status,
      emailVerifiedAt: row.emailVerifiedAt ?? null,
      approvedAt: row.approvedAt ?? null,
      rejectedAt: row.rejectedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      reason: row.reason ?? null,
      tenantId: row.tenantId ? String(row.tenantId) : null,
      userId: row.userId ? String(row.userId) : null,
      createdAt: row.createdAt ?? null,
    };
  }
}
