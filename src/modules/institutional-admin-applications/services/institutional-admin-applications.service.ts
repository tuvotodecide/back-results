import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ClientSession, Model, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { Hex, isAddress } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
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
import {
  InstitutionalInvitationMobileRequestUser,
  InstitutionalInvitationRegistrationContinuation,
  InstitutionalInvitationRegistrationContinuationService,
  INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION,
  InstitutionalMobileRequestUser,
} from '../auth/institutional-mobile-auth.types';
import { executeCoinbaseOp } from '@/api/account';
import { VoteContractCalls, VoteContractReads } from '@/api/vote';
import { availableNetworks } from '@/api/params';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';
import { NotificationLog, NotificationLogDocument } from '@/modules/notifications/schemas/notification-log.schema';
import { AcceptInstitutionalAdminInvitationDto } from '../dto/accept-institutional-admin-invitation.dto';
import { CreateInstitutionalAdminInvitationDto } from '../dto/create-institutional-admin-invitation.dto';
import {
  InstitutionalAdminInvitation,
  InstitutionalAdminInvitationDocument,
} from '../schemas/institutional-admin-invitation.schema';
import { OfficialPublicationNotificationService } from '@/modules/institutional-voting/services/publication/official-publication-notification.service';
import { OfficialPublicationUserOperationService } from '@/modules/institutional-voting/services/publication/official-publication-user-operation.service';
import { OfficialPublicationChainVerificationService } from '@/modules/institutional-voting/services/publication/official-publication-chain-verification.service';

type IdentityHasDniResponse = {
  ok: boolean;
};

type IdentityResolveAccountByDniResponse = {
  registered: boolean;
  accountAddress: string | null;
};

type IdentityGetByDniResponse = {
  records?: Array<{
    did?: string;
    dni?: string;
  }>;
};

@Injectable()
export class InstitutionalAdminApplicationsService {
  private readonly logger = new Logger(InstitutionalAdminApplicationsService.name);
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
    @InjectModel(InstitutionalAdminInvitation.name)
    private readonly invitationModel: Model<InstitutionalAdminInvitationDocument>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
    private readonly emailOutboxService: InstitutionalEmailOutboxService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly auditService: InstitutionalAuditService,
    private readonly historyService: HistoryService,
    private readonly notificationService: OfficialPublicationNotificationService,
    private readonly userOperationService: OfficialPublicationUserOperationService,
    private readonly chainVerificationService: OfficialPublicationChainVerificationService,
    @Inject(INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION)
    private readonly mobileZkAuthService: InstitutionalInvitationRegistrationContinuationService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    this.pk = this.configService.get<string>('app.blockchain.privateKey')!;
  }

  async createApplication(dto: CreateInstitutionalAdminApplicationDto) {
    if (dto.invitationId) {
      return this.createInvitationRegistrationApplication(dto);
    }
    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    const selectedTenant = await this.resolveSelectedTenantForRegistration(dto.institutionId);
    const rawInstitutionName = selectedTenant?.name ?? dto.institutionName;
    if (!rawInstitutionName) {
      throw new BadRequestException('Debe seleccionar una institución o enviar un nombre válido');
    }
    const institutionName = this.formatDisplayName(rawInstitutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const clientAccountAddress = dto.accountAddress
      ? this.normalizeAccountAddress(dto.accountAddress)
      : undefined;
    const existingTenant =
      selectedTenant ?? (await this.tenantModel.findOne({ nameNorm: institutionNameNorm }));
    const existingUser = await this.resolveUserByEmailOrDni(email, dni);
    const sameInstitutionFilter = existingTenant
      ? { tenantId: existingTenant._id }
      : { institutionNameNorm };

    const latestSameInstitutionApplication = await this.applicationModel
      .findOne({
        ...sameInstitutionFilter,
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
          throw new ConflictException('Ya administras esta institución.');
        }
        throw new ConflictException('Ya tienes una solicitud pendiente para esta institución.');
      }
    }

    if (
      latestSameInstitutionApplication &&
      [
        'PENDING_EMAIL_VERIFICATION',
        'PENDING_APPROVAL',
        'PENDING_MOBILE_AUTHORIZATION',
        'PENDING_CHAIN_CONFIRMATION',
        'CHAIN_RETRY_PENDING',
        'RECONCILIATION_PENDING',
        'CHAIN_FAILED',
        'APPROVED',
      ].includes(latestSameInstitutionApplication.status)
    ) {
      if (latestSameInstitutionApplication.status === 'APPROVED') {
        throw new ConflictException('Ya administras esta institución.');
      }
      throw new ConflictException('Ya tienes una solicitud pendiente para esta institución.');
    }

    const resolvedIdentityWallet = await this.resolveWalletFromIdentityByDni(dni);
    const accountAddress = resolvedIdentityWallet.accountAddress;
    if (
      clientAccountAddress &&
      this.normalizeAccountAddressForComparison(clientAccountAddress) !==
        this.normalizeAccountAddressForComparison(accountAddress)
    ) {
      throw new BadRequestException({
        code: 'IDENTITY_WALLET_MISMATCH',
        message: 'La billetera enviada no corresponde al CI o DNI informado.',
      });
    }

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

    const passwordHash = this.resolveApplicationPasswordHash(user, dto.password);
    const created = await this.applicationModel.create({
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

  /**
   * Completa D3 usando exclusivamente el contexto efímero emitido después de
   * ZK. invitationId por sí solo nunca autoriza este registro.
   */
  private async createInvitationRegistrationApplication(
    dto: CreateInstitutionalAdminApplicationDto,
  ) {
    if (!dto.invitationId || !Types.ObjectId.isValid(dto.invitationId)) {
      throw new BadRequestException('invitationId inválido');
    }

    const invitation = await this.getInvitationOrThrow(dto.invitationId);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    const continuation = await this.getInvitationRegistrationContinuation(
      invitation,
      dto.registrationContinuationCode,
    );
    const tenant = await this.tenantModel.findById(invitation.tenantId);
    if (!tenant) {
      throw new ConflictException('La institución de la invitación ya no está disponible.');
    }

    const requestedDni = dto.dni.trim();
    if (requestedDni !== invitation.dni) {
      throw new ForbiddenException('El CI o DNI no corresponde a la invitación.');
    }
    const dni = continuation.dni;

    const invitationWallet = this.normalizeAccountAddress(invitation.accountAddress);
    if (
      dto.accountAddress &&
      this.normalizeAccountAddressForComparison(this.normalizeAccountAddress(dto.accountAddress)) !==
        this.normalizeAccountAddressForComparison(invitationWallet)
    ) {
      throw new BadRequestException({
        code: 'IDENTITY_WALLET_MISMATCH',
        message: 'La billetera enviada no corresponde a la invitación.',
      });
    }

    const email = dto.email.trim().toLowerCase();
    const existingInvitationApplication = await this.applicationModel.findOne({
      invitationId: invitation._id,
    });
    if (existingInvitationApplication) {
      return {
        id: String(existingInvitationApplication._id),
        status: existingInvitationApplication.status,
        invitationId: String(invitation._id),
        tenantId: String(invitation.tenantId),
        userId: existingInvitationApplication.userId
          ? String(existingInvitationApplication.userId)
          : null,
      };
    }
    const claim = await this.mobileZkAuthService.claimInvitationRegistrationContinuation(
      dto.registrationContinuationCode!,
      String(invitation._id),
    );
    const session = await this.applicationModel.db.startSession();
    try {
      let response: {
        id: string;
        status: string;
        invitationId: string;
        tenantId: string;
        userId: string;
      } | null = null;
      await session.withTransaction(async () => {
        const freshInvitation = await this.getInvitationOrThrow(dto.invitationId!, session);
        await this.assertInvitationPendingAndCurrent(
          freshInvitation,
          freshInvitation.invitationToken,
        );
        const existingUser = await this.resolveUserByEmailOrDni(email, dni, session);
        let user = existingUser;
        if (!user) {
          const password = this.requirePassword(
            dto.password,
            'password es requerido para crear la cuenta administrativa de la invitación',
          );
          try {
            const created = await this.roledUserModel.create(
              [{
                dni,
                email,
                name: dto.name.trim(),
                password: bcrypt.hashSync(password, 10),
                role: 'USER',
                active: false,
              }],
              { session },
            );
            user = Array.isArray(created) ? created[0] : created;
          } catch (error) {
            this.rethrowIdentityDuplicate(error);
            throw error;
          }
        }

        const shouldRequireEmailVerification =
          !existingUser || Boolean(existingUser.verificationToken);
        const verificationToken = shouldRequireEmailVerification
          ? randomBytes(32).toString('hex')
          : undefined;
        const verificationTokenExpiresAt = shouldRequireEmailVerification
          ? new Date(
              Date.now() +
                1000 * 60 * 60 *
                  this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
            )
          : undefined;
        const createdApplications = await this.applicationModel.create(
          [{
            dni,
            email,
            passwordHash: this.resolveApplicationPasswordHash(user, dto.password),
            name: dto.name.trim(),
            institutionName: tenant.name,
            institutionNameNorm: tenant.nameNorm,
            accountAddress: invitationWallet,
            status: shouldRequireEmailVerification
              ? 'PENDING_EMAIL_VERIFICATION'
              : 'PENDING_APPROVAL',
            verificationToken,
            verificationTokenExpiresAt,
            emailVerifiedAt: shouldRequireEmailVerification ? undefined : new Date(),
            tenantId: tenant._id,
            invitationId: freshInvitation._id,
            userId: this.toObjectId(user._id),
          }],
          { session },
        );
        const application = Array.isArray(createdApplications)
          ? createdApplications[0]
          : createdApplications;
        freshInvitation.applicationId = application._id;
        await freshInvitation.save({ session });
        await this.mobileZkAuthService.completeInvitationRegistrationContinuation(
          dto.registrationContinuationCode!,
          String(freshInvitation._id),
          claim.claimId,
          String(application._id),
          session,
        );
        if (shouldRequireEmailVerification) {
          await this.emailOutboxService.enqueueInstitutionalVerificationEmail({
            recipient: application.email,
            name: application.name,
            targetId: application._id,
            session,
          });
        }
        await this.auditService.record({
          tenantId: tenant._id,
          actor: null,
          action: 'INSTITUTIONAL_APPLICATION_CREATED',
          targetType: 'InstitutionalAdminApplication',
          targetId: application._id,
          targetUserId: application.userId ?? null,
          applicationId: application._id,
          newState: {
            status: application.status,
            invitationId: String(freshInvitation._id),
            tenantResolved: true,
          },
          session,
        });
        response = {
          id: String(application._id),
          status: application.status,
          invitationId: String(freshInvitation._id),
          tenantId: String(tenant._id),
          userId: String(user._id),
        };
      });
      return response!;
    } catch (error: any) {
      await this.mobileZkAuthService.releaseInvitationRegistrationContinuation(
        dto.registrationContinuationCode!,
        String(invitation._id),
        claim.claimId,
      ).catch(() => undefined);
      if (error?.code === 11000) {
        const existing = await this.applicationModel.findOne({ invitationId: invitation._id });
        if (existing) {
          return {
            id: String(existing._id),
            status: existing.status,
            invitationId: String(invitation._id),
            tenantId: String(invitation.tenantId),
            userId: existing.userId ? String(existing.userId) : null,
          };
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
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

    let invitation: InstitutionalAdminInvitationDocument | null = null;
    if (app.invitationId) {
      invitation = await this.getInvitationOrThrow(String(app.invitationId));
      await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
      if (
        String(invitation.applicationId || '') !== String(app._id) ||
        String(invitation.tenantId) !== String(app.tenantId) ||
        invitation.dni !== app.dni
      ) {
        throw new ForbiddenException('La solicitud no corresponde a la invitación.');
      }
    }

    app.status = 'PENDING_APPROVAL';
    app.verificationToken = undefined;
    app.verificationTokenExpiresAt = undefined;
    app.emailVerifiedAt = new Date();

    await app.save();
    if (invitation) {
      invitation.status = 'ACCEPTED';
      invitation.acceptedAt = new Date();
      await invitation.save();
    }
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
        approvalTarget: app.tenantId ? 'PRIMARY' : 'SUPERADMIN',
      },
    });

    return {
      id: String(app._id),
      status: app.status,
      emailVerifiedAt: app.emailVerifiedAt,
    };
  }

  async resendVerificationEmail(rawEmail: string) {
    // Respuesta genérica siempre: el endpoint es público y no debe revelar
    // si un correo tiene una solicitud institucional pendiente.
    const genericResponse = {
      message:
        'Si existe una solicitud pendiente de verificación para ese correo, se envió un nuevo enlace.',
    };
    const email = rawEmail.trim().toLowerCase();

    const app = await this.applicationModel
      .findOne({ email, status: 'PENDING_EMAIL_VERIFICATION' })
      .sort({ createdAt: -1, _id: -1 });
    if (!app) {
      return genericResponse;
    }

    if (app.invitationId) {
      const invitation = await this.invitationModel.findById(app.invitationId);
      const invitationStillUsable =
        invitation &&
        invitation.status === 'PENDING' &&
        invitation.expiresAt.getTime() > Date.now() &&
        String(invitation.applicationId || '') === String(app._id);
      if (!invitationStillUsable) {
        return genericResponse;
      }
    }

    const cooldownMs =
      1000 *
      this.configService.get<number>('app.mail.verificationResendCooldownSeconds', 60);
    const lastSentAt = app.verificationLastSentAt ?? (app as any).createdAt;
    if (lastSentAt && Date.now() - new Date(lastSentAt).getTime() < cooldownMs) {
      return genericResponse;
    }

    app.verificationToken = randomBytes(32).toString('hex');
    app.verificationTokenExpiresAt = new Date(
      Date.now() +
        1000 * 60 * 60 * this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
    );
    app.verificationResendCount = (app.verificationResendCount ?? 0) + 1;
    app.verificationLastSentAt = new Date();
    await app.save();

    await this.sendVerificationEmail(
      app._id,
      app.email,
      app.name,
      app.verificationToken,
      `resend-${app.verificationResendCount}`,
    );

    await this.auditService.record({
      tenantId: app.tenantId ?? null,
      actor: null,
      action: 'INSTITUTIONAL_VERIFICATION_EMAIL_RESENT',
      targetType: 'InstitutionalAdminApplication',
      targetId: app._id,
      targetUserId: app.userId ?? null,
      applicationId: app._id,
      newState: {
        status: app.status,
        resendCount: app.verificationResendCount,
        verificationTokenExpiresAt: app.verificationTokenExpiresAt,
      },
    });

    return genericResponse;
  }

  async listApplications(status?: string, requester?: any, tenantIdFilter?: string) {
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }
    if (this.isGlobalInstitutionalApprover(requester)) {
      if (tenantIdFilter) {
        if (!Types.ObjectId.isValid(tenantIdFilter)) {
          throw new BadRequestException('tenantId inválido');
        }
        query.tenantId = new Types.ObjectId(tenantIdFilter);
      }
    } else {
      const tenantId = tenantIdFilter || requester?.tenantId;
      if (!tenantId || !Types.ObjectId.isValid(String(tenantId))) {
        throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
      }
      await this.assertRequesterIsPrimaryForTenant(requester, String(tenantId));
      query.tenantId = new Types.ObjectId(String(tenantId));
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

  async getApplicationDetail(applicationId: string, requester?: any) {
    const app = await this.getApplicationOrThrow(applicationId);
    if (!this.isGlobalInstitutionalApprover(requester)) {
      if (!app.tenantId) {
        throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
      }
      await this.assertRequesterIsPrimaryForTenant(requester, app.tenantId);
    }
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

        if (app.status === 'PENDING_MOBILE_AUTHORIZATION') {
          const functionalStatus = this.resolveApplicationFunctionalStatus(app);
          response = {
            id: String(app._id),
            status: app.status,
            functionalStatus: functionalStatus.code,
            functionalStatusLabel: functionalStatus.label,
            tenantId: app.tenantId ? String(app.tenantId) : null,
            userId: app.userId ? String(app.userId) : null,
            stableInstitutionId: app.stableInstitutionId ?? null,
            mobileAuthorizationNotificationId: app.mobileAuthorizationNotificationId
              ? String(app.mobileAuthorizationNotificationId)
              : null,
          };
          return;
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
            const tenantObjectId = new Types.ObjectId();
            const createdTenants = await this.tenantModel.create(
              [
                {
                  _id: tenantObjectId,
                  name: app.institutionName,
                  nameNorm: app.institutionNameNorm,
                  description: `Tenant creado desde solicitud ${String(app._id)}`,
                  stableInstitutionId: String(tenantObjectId),
                  active: false,
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
              if (tenant) {
                tenantCreatedDuringApproval = true;
              }
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
        const stableInstitutionId = this.resolveStableInstitutionId(tenant);
        const shouldWaitForNetworkConfirmation = tenantCreatedDuringApproval;
        const shouldWaitForMobileAuthorization = !tenantCreatedDuringApproval;
        const assignmentStatus = shouldWaitForNetworkConfirmation || shouldWaitForMobileAuthorization
          ? 'PENDING'
          : 'APPROVED';
        const assignmentActive = !(shouldWaitForNetworkConfirmation || shouldWaitForMobileAuthorization);
        const applicationStatus = shouldWaitForNetworkConfirmation
          ? 'PENDING_CHAIN_CONFIRMATION'
          : shouldWaitForMobileAuthorization
            ? 'PENDING_MOBILE_AUTHORIZATION'
            : 'APPROVED';
        let assignment: any;
        try {
          assignment = await this.assignmentModel.findOneAndUpdate(
            {
              tenantId: tenant._id,
              userId: user._id,
            },
            {
              $set: {
                status: assignmentStatus,
                active: assignmentActive,
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

        user.active = assignmentActive;
        user.verificationToken = undefined;
        user.verificationTokenExpiresAt = undefined;
        await user.save({ session });

        app.status = applicationStatus as any;
        app.accountAddress = accountAddress;
        app.approvedAt = approvedAt;
        app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
        app.rejectedAt = undefined;
        app.revokedAt = undefined;
        app.reason = undefined;
        app.tenantId = this.toObjectId(tenant._id);
        app.userId = this.toObjectId(user._id);
        app.stableInstitutionId = stableInstitutionId;
        if (shouldWaitForMobileAuthorization) {
          app.mobileAuthorizationRequestedAt = approvedAt;
        }
        if (shouldWaitForNetworkConfirmation) {
          app.chainStatus = 'PENDING_SEND';
          app.chainAttempts = app.chainAttempts ?? 0;
          app.chainNextRetryAt = undefined;
          app.chainLastError = undefined;
          app.chainTxHash = undefined;
          app.chainConfirmedAt = undefined;
          app.chainLockedAt = undefined;
          app.chainLockedUntil = undefined;
        }
        await app.save({ session });
        if (shouldWaitForMobileAuthorization) {
          const notification = await this.recordMobileAuthorizationNotice(
            app,
            tenant,
            requester,
            session,
          );
          app.mobileAuthorizationNotificationId = notification?._id ?? app.mobileAuthorizationNotificationId;
          await app.save({ session });
        }
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
            status: assignment?.status ?? assignmentStatus,
            active: assignment?.active ?? assignmentActive,
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
            userActive: assignmentActive,
            stableInstitutionId,
            chainStatus: app.chainStatus ?? null,
            mobileAuthorizationRequested: shouldWaitForMobileAuthorization,
          },
          session,
        });

        const functionalStatus = this.resolveApplicationFunctionalStatus(app);
        response = {
          id: String(app._id),
          status: app.status,
          functionalStatus: functionalStatus.code,
          functionalStatusLabel: functionalStatus.label,
          tenantId: String(tenant._id),
          userId: String(user._id),
          institutionalRole,
          stableInstitutionId,
          chainStatus: app.chainStatus ?? null,
          mobileAuthorizationNotificationId: app.mobileAuthorizationNotificationId
            ? String(app.mobileAuthorizationNotificationId)
            : null,
        };
      });
      if (response?.status === 'PENDING_MOBILE_AUTHORIZATION') {
        await this.enqueueMobileAuthorizationDelivery(response.id);
      }
      if (
        response?.status === 'PENDING_CHAIN_CONFIRMATION' &&
        response?.chainStatus === 'PENDING_SEND'
      ) {
        return this.retryInstitutionCreationAuthorization(applicationId, requester);
      }
      return response;
    } finally {
      await session.endSession();
    }
  }

  async retryInstitutionCreationAuthorization(applicationId: string, requester: any) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('applicationId inválido');
    }

    const app = await this.getApplicationOrThrow(applicationId);
    if (!this.isGlobalInstitutionalApprover(requester)) {
      if (!app.tenantId) {
        throw new ForbiddenException('No autorizado para revisar esta solicitud institucional');
      }
      await this.assertRequesterIsPrimaryForTenant(requester, app.tenantId);
    }

    await this.applicationModel.deleteMany({
      _id: { $ne: app._id },
      dni: app.dni,
      email: app.email,
      $or: [
        { status: { $nin: ['APPROVED', 'REJECTED'] } },
        { institutionNameNorm: { $exists: false } },
        { accountAddress: { $exists: false } },
        { chainTxHash: { $exists: false } },
      ],
    });

    if (app.status === 'APPROVED') {
      return this.toAuthorizationRetryResponse(app);
    }

    if (app.status === 'PENDING_MOBILE_AUTHORIZATION') {
      await this.enqueueMobileAuthorizationDelivery(applicationId);
      return this.toAuthorizationRetryResponse(await this.getApplicationOrThrow(applicationId));
    }

    if (
      ![
        'PENDING_CHAIN_CONFIRMATION',
        'RECONCILIATION_PENDING',
        'CHAIN_RETRY_PENDING',
        'CHAIN_FAILED',
      ].includes(String(app.status))
    ) {
      throw new BadRequestException('La solicitud no permite reintentar autorización');
    }

    const usesMobileAuthorization =
      Boolean(app.mobileAuthorizationUserOpHash) ||
      app.mobileAuthorizationAction === 'REMOVE_AUTHORIZED_ADDRESS' ||
      app.mobileAuthorizationAction === 'CHANGE_INSTITUTION_ADMIN';

    if (usesMobileAuthorization) {
      let reconciliation: any;
      if (app.mobileAuthorizationUserOpHash) {
        reconciliation = await this.processMobileAuthorizationRetry(applicationId);
      }
      let refreshed = await this.getApplicationOrThrow(applicationId);
      if (refreshed.status === 'CHAIN_FAILED' && reconciliation?.reissuable) {
        const recovered = await this.recoverFailedMobileAuthorization(applicationId);
        if (recovered.recovered) {
          refreshed = await this.getApplicationOrThrow(applicationId);
        }
      }
      return this.toAuthorizationRetryResponse(refreshed);
    }

    if (app.chainTxHash) {
      await this.reconcileInstitutionCreationOperation(applicationId);
    } else {
      if (app.status === 'CHAIN_FAILED') {
        await this.applicationModel.updateOne(
          { _id: app._id },
          {
            $set: {
              status: 'CHAIN_RETRY_PENDING',
              chainStatus: 'RETRY_PENDING',
              chainNextRetryAt: null,
              chainLockedAt: null,
              chainLockedUntil: null,
            },
          },
        );
      }
      const processed = await this.processInstitutionCreationOperation(applicationId);
      if (!processed?.processed) {
        throw new ConflictException('La autorización no está disponible para reintento en este momento');
      }
      if (processed?.status === 'SENT' || processed?.status === 'CONFIRMED') {
        await this.reconcileInstitutionCreationOperation(applicationId);
      }
    }

    const refreshed = await this.getApplicationOrThrow(applicationId);
    return this.toAuthorizationRetryResponse(refreshed);
  }

  async createInstitutionOnChain(
    stableInstitutionId: string,
    adminAddr: string,
    session?: ClientSession,
  ) {
    try {
      const response = await executeCoinbaseOp(
        this.pk as Hex,
        this.chain,
        VoteContractCalls.createInstitution(this.chain, stableInstitutionId, adminAddr as Hex),
        undefined,
        undefined
      );

      const historyPayload = {
        txHash: response.txHash,
        operationName: HistoryOperationKey.institutionCreated,
        type: HistoryType.AUTOMATED,
        registerDate: new Date().toISOString(),
        institutionId: stableInstitutionId,
      };
      if (session) {
        await this.historyService.createWithSession(historyPayload, session);
      } else if (typeof this.historyService.create === 'function') {
        await this.historyService.create(historyPayload);
      }
      return response;
    } catch (error) {
      throw new Error('Failed to create insitution on-chain', { cause: error });
    }
  }

  async processInstitutionCreationOperation(applicationId: string) {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 60_000);
    const app = await this.applicationModel.findOneAndUpdate(
      {
        _id: this.toObjectId(applicationId),
        status: { $in: ['PENDING_CHAIN_CONFIRMATION', 'RECONCILIATION_PENDING', 'CHAIN_RETRY_PENDING'] },
        chainStatus: { $in: ['PENDING_SEND', 'RETRY_PENDING', 'SENT'] },
        $and: [
          {
            $or: [
              { chainLockedUntil: { $exists: false } },
              { chainLockedUntil: null },
              { chainLockedUntil: { $lte: now } },
            ],
          },
          {
            $or: [
              { chainStatus: { $in: ['PENDING_SEND', 'SENT'] } },
              { chainNextRetryAt: { $exists: false } },
              { chainNextRetryAt: null },
              { chainNextRetryAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        $set: {
          chainLockedAt: now,
          chainLockedUntil: lockUntil,
        },
        $inc: {
          chainAttempts: 1,
        },
      },
      { returnDocument: 'after' },
    );

    if (!app) {
      return {
        processed: false,
        reason: 'NO_CLAIMABLE_OPERATION',
      };
    }

    const stableInstitutionId = this.requireStableInstitutionId(app);
    const accountAddress = this.normalizeAccountAddress(app.accountAddress);

    try {
      this.assertInstitutionCreationChainConfig(stableInstitutionId, accountAddress);
    } catch (error) {
      this.logInstitutionCreationError(error, app, stableInstitutionId, accountAddress);
      const attempts = app.chainAttempts ?? 1;
      await this.applicationModel.updateOne(
        { _id: app._id },
        {
          $set: {
            status: 'CHAIN_RETRY_PENDING',
            chainStatus: 'RETRY_PENDING',
            chainAttempts: attempts,
            chainNextRetryAt: this.calculateNextChainRetryAt(attempts),
            chainLastError: this.toSafeChainError(error),
            chainLockedAt: null,
            chainLockedUntil: null,
          },
        },
      );
      return {
        processed: true,
        status: 'RETRY_PENDING',
        stableInstitutionId,
        attempts,
        nextRetryAt: this.calculateNextChainRetryAt(attempts),
      };
    }

    try {
      const alreadyConfirmed = await this.isInstitutionConfirmedOnChain(
        stableInstitutionId,
        accountAddress,
      );
      if (alreadyConfirmed) {
        await this.completeInstitutionCreationFromNetwork(String(app._id));
        return {
          processed: true,
          status: 'CONFIRMED',
          stableInstitutionId,
          reusedNetworkState: true,
        };
      }
    } catch (error) {
      this.logInstitutionCreationError(error, app, stableInstitutionId, accountAddress);
      const attempts = app.chainAttempts ?? 1;
      const recoverable = this.isRecoverableChainError(error);
      const nextRetryAt = recoverable ? this.calculateNextChainRetryAt(attempts) : null;
      await this.applicationModel.updateOne(
        { _id: app._id },
        {
          $set: {
            status: recoverable ? 'CHAIN_RETRY_PENDING' : 'CHAIN_FAILED',
            chainStatus: recoverable ? 'RETRY_PENDING' : 'FAILED',
            chainAttempts: attempts,
            chainLastError: this.toSafeChainError(error),
            chainNextRetryAt: nextRetryAt,
            chainLockedAt: null,
            chainLockedUntil: null,
          },
        },
      );
      return {
        processed: true,
        status: recoverable ? 'RETRY_PENDING' : 'FAILED',
        stableInstitutionId,
        attempts,
        nextRetryAt,
      };
    }

    if (app.chainStatus === 'SENT') {
      await this.applicationModel.updateOne(
        { _id: app._id },
        { $set: { chainLockedAt: null, chainLockedUntil: null } },
      );
      return {
        processed: true,
        status: 'PENDING_CHAIN_CONFIRMATION',
        stableInstitutionId,
      };
    }

    try {
      const response = await this.createInstitutionOnChain(stableInstitutionId, accountAddress);
      const attempts = app.chainAttempts ?? 1;
      await this.applicationModel.updateOne(
        { _id: app._id },
        {
          $set: {
            status: 'PENDING_CHAIN_CONFIRMATION',
            chainStatus: 'SENT',
            chainAttempts: attempts,
            chainTxHash: response?.txHash ?? app.chainTxHash ?? null,
            chainLastError: null,
            chainNextRetryAt: null,
            chainLockedAt: null,
            chainLockedUntil: null,
          },
        },
      );
      return {
        processed: true,
        status: 'SENT',
        stableInstitutionId,
        txHash: response?.txHash ?? null,
        attempts,
      };
    } catch (error) {
      this.logInstitutionCreationError(error, app, stableInstitutionId, accountAddress);
      const attempts = app.chainAttempts ?? 1;
      const recoverable = this.isRecoverableChainError(error);
      const nextRetryAt = recoverable ? this.calculateNextChainRetryAt(attempts) : null;
      await this.applicationModel.updateOne(
        { _id: app._id },
        {
          $set: {
            status: recoverable ? 'CHAIN_RETRY_PENDING' : 'CHAIN_FAILED',
            chainStatus: recoverable ? 'RETRY_PENDING' : 'FAILED',
            chainAttempts: attempts,
            chainNextRetryAt: nextRetryAt,
            chainLastError: this.toSafeChainError(error),
            chainLockedAt: null,
            chainLockedUntil: null,
          },
        },
      );
      return {
        processed: true,
        status: recoverable ? 'RETRY_PENDING' : 'FAILED',
        stableInstitutionId,
        attempts,
        nextRetryAt,
      };
    }
  }

  async reconcileInstitutionCreationOperation(applicationId: string) {
    const app = await this.getApplicationOrThrow(applicationId);
    const stableInstitutionId = this.requireStableInstitutionId(app);
    const accountAddress = this.normalizeAccountAddress(app.accountAddress);
    const confirmed = await this.isInstitutionConfirmedOnChain(stableInstitutionId, accountAddress);
    if (!confirmed) {
      return {
        reconciled: false,
        status: app.status,
        stableInstitutionId,
      };
    }

    await this.completeInstitutionCreationFromNetwork(applicationId);
    return {
      reconciled: true,
      status: 'APPROVED',
      stableInstitutionId,
    };
  }

  async backfillHistoricalInstitutionStableIds() {
    const tenants = await this.tenantModel
      .find({
        $or: [
          { stableInstitutionId: { $exists: false } },
          { stableInstitutionId: null },
          { stableInstitutionId: '' },
        ],
      })
      .sort({ createdAt: 1, _id: 1 });

    let updatedTenants = 0;
    let createdOperations = 0;
    let reconciled = 0;

    for (const tenant of tenants) {
      const stableInstitutionId = String(tenant._id);
      const primary = await this.assignmentModel
        .findOne({
          tenantId: tenant._id,
          institutionalRole: 'PRIMARY',
          accountAddress: { $exists: true, $ne: null },
        })
        .sort({ active: -1, approvedAt: 1, createdAt: 1, _id: 1 });

      if (!tenant.stableInstitutionId) {
        tenant.stableInstitutionId = stableInstitutionId;
        await tenant.save();
        updatedTenants += 1;
      }

      if (!primary?.accountAddress) {
        continue;
      }

      const confirmed = await this.isInstitutionConfirmedOnChain(
        stableInstitutionId,
        primary.accountAddress,
      ).catch(() => false);
      if (confirmed) {
        await this.tenantModel.updateOne({ _id: tenant._id }, { $set: { active: true } });
        await this.assignmentModel.updateOne(
          { _id: primary._id },
          {
            $set: {
              status: 'APPROVED',
              active: true,
            },
          },
        );
        reconciled += 1;
        continue;
      }

      const existingOperation = await this.applicationModel.findOne({
        tenantId: tenant._id,
        stableInstitutionId,
        chainStatus: { $in: ['PENDING_SEND', 'SENT', 'RETRY_PENDING', 'CONFIRMED'] },
      });
      if (existingOperation) {
        if (tenant.active !== false) {
          tenant.active = false;
          await tenant.save();
        }
        continue;
      }

      if (tenant.active !== false) {
        tenant.active = false;
        await tenant.save();
      }

      await this.applicationModel.create({
        dni: `historico-${stableInstitutionId}`,
        email: `historico-${stableInstitutionId}@institucional.local`,
        passwordHash: 'historical-backfill',
        name: 'Administrador histórico',
        institutionName: tenant.name,
        institutionNameNorm: tenant.nameNorm,
        accountAddress: primary.accountAddress,
        status: 'PENDING_CHAIN_CONFIRMATION',
        emailVerifiedAt: new Date(),
        approvedAt: primary.approvedAt ?? new Date(),
        tenantId: tenant._id,
        userId: primary.userId,
        stableInstitutionId,
        chainStatus: 'PENDING_SEND',
        chainAttempts: 0,
      });
      createdOperations += 1;
    }

    return {
      updatedTenants,
      createdOperations,
      reconciled,
    };
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

  async listPendingApplications(requester?: any) {
    return this.listApplications('PENDING_APPROVAL', requester);
  }

  async listInvitations(tenantId: string, requester: any) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId inválido');
    }
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Institución no encontrada');
    }
    await this.assertRequesterIsPrimaryForTenant(requester, tenant._id);

    await this.invitationModel.updateMany(
      {
        tenantId: tenant._id,
        status: 'PENDING',
        expiresAt: { $lte: new Date() },
      },
      {
        $set: {
          status: 'EXPIRED',
          reason: 'Invitación vencida automáticamente.',
        },
      },
    );

    const rows = await this.invitationModel
      .find({ tenantId: tenant._id })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return {
      tenantId: String(tenant._id),
      data: rows.map((row) => this.toInvitationResponse(row)),
      total: rows.length,
    };
  }

  async createInvitation(
    tenantId: string,
    dto: CreateInstitutionalAdminInvitationDto,
    requester: any,
  ) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId inválido');
    }
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException('Institución no encontrada');
    }
    await this.assertRequesterIsPrimaryForTenant(requester, tenant._id);

    const dni = dto.dni.trim();
    const resolvedIdentityWallet = await this.resolveWalletFromIdentityByDni(dni);
    const accountAddress = this.normalizeAccountAddress(resolvedIdentityWallet.accountAddress);
    const existingUser = await this.resolveUserByDniOnly(dni);

    if (existingUser?._id) {
      const existingMembership = await this.assignmentModel.findOne({
        tenantId: tenant._id,
        userId: this.toObjectId(existingUser._id),
        $or: [
          { status: { $in: ['PENDING', 'APPROVED'] } },
          { status: { $exists: false }, active: true },
        ],
      }).lean();
      if (existingMembership) {
        throw new ConflictException('La persona ya administra esta institución o tiene una solicitud pendiente.');
      }
    }

    const activeInvitation = await this.invitationModel.findOne({
      tenantId: tenant._id,
      dni,
      status: 'PENDING',
      expiresAt: { $gt: new Date() },
    });
    if (activeInvitation) {
      throw new ConflictException('Ya existe una invitación vigente para esta persona.');
    }

    const invitation = await this.invitationModel.create({
      tenantId: tenant._id,
      invitedBy: new Types.ObjectId(requester.sub),
      dni,
      name: this.formatDisplayName(dto.name ?? `Persona ${dni}`),
      accountAddress,
      status: 'PENDING',
      invitationToken: randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      noticeCount: 1,
      lastNoticeAt: new Date(),
      reason: dto.reason?.trim() || null,
    });

    await this.notificationService.enqueueForInstitutionalInvitation(String(invitation._id));
    return this.toInvitationResponse(invitation);
  }

  async acceptInvitation(
    invitationId: string,
    dto: AcceptInstitutionalAdminInvitationDto,
  ) {
    return this.acceptInvitationForUser(invitationId, dto);
  }

  async acceptInvitationFromMobile(
    invitationId: string,
    authUser?: InstitutionalInvitationMobileRequestUser,
  ) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    this.assertMobileInvitationAuthUserMatches(invitation, authUser);
    const user = await this.findAdministrativeAccountByInvitation(
      invitation.dni,
    );
    if (!user) {
      const tenant = await this.tenantModel.findById(invitation.tenantId).lean();
      if (!tenant) {
        throw new ConflictException('La institución de la invitación ya no está disponible.');
      }
      const continuation = await this.mobileZkAuthService.issueInvitationRegistrationContinuation(
        authUser!.mobileAuthContextHash,
      );
      return {
        status: 'REQUIRES_ADMIN_ACCOUNT',
        invitationId: String(invitation._id),
        tenant: { id: String(tenant._id), name: tenant.name },
        continuationCode: continuation.continuationCode,
        continuationExpiresAt: continuation.expiresAt,
      };
    }
    return this.acceptInvitationForUser(
      invitationId,
      { token: invitation.invitationToken, email: user.email },
      String(user._id),
    );
  }

  private async acceptInvitationForUser(
    invitationId: string,
    dto: AcceptInstitutionalAdminInvitationDto,
    expectedUserId?: string,
  ) {
    const session = await this.invitationModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const invitation = await this.getInvitationOrThrow(invitationId, session);
        await this.assertInvitationPendingAndCurrent(invitation, dto.token);
        const email = dto.email.trim().toLowerCase();
        let user = await this.resolveUserByEmailOrDni(email, invitation.dni, session);

        if (expectedUserId && (!user?._id || String(user._id) !== expectedUserId)) {
          throw new ForbiddenException({
            code: 'INSTITUTIONAL_INVITATION_ACCOUNT_MISMATCH',
            message: 'La cuenta autenticada no corresponde a la invitación.',
          });
        }

        if (!user) {
          const password = this.requirePassword(
            dto.password,
            'password es requerido para aceptar una invitación institucional nueva',
          );
          try {
            const createdUsers = await this.roledUserModel.create(
              [
                {
                  dni: invitation.dni,
                  email,
                  name: this.formatDisplayName(dto.name ?? invitation.name),
                  password: bcrypt.hashSync(password, 10),
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

        // A completed application is not, by itself, proof of current access.
        // The assignment is the canonical access record: a historical application
        // can remain APPROVED after a legacy revocation while its assignment is
        // already REVOKED/inactive.
        const membershipQuery = this.assignmentModel.findOne({
          tenantId: invitation.tenantId,
          userId: user._id,
          $or: [
            { status: 'APPROVED', active: true },
            { status: { $exists: false }, active: true },
          ],
        });
        if (typeof membershipQuery.session === 'function') {
          membershipQuery.session(session);
        }
        const activeMembership = await membershipQuery;
        if (activeMembership) {
          throw new ConflictException('Ya existe una solicitud vigente para esta institución.');
        }

        // Keep duplicate protection for real in-flight processes, but do not
        // treat an APPROVED historical application as active access.
        const existingPendingApplication = await this.applicationModel
          .findOne({
            tenantId: invitation.tenantId,
            userId: user._id,
            invitationId: { $ne: invitation._id },
            status: {
              $in: [
                'PENDING_EMAIL_VERIFICATION',
                'PENDING_APPROVAL',
                'PENDING_MOBILE_AUTHORIZATION',
                'PENDING_CHAIN_CONFIRMATION',
                'CHAIN_RETRY_PENDING',
                'RECONCILIATION_PENDING',
              ],
            },
          })
          .session(session);
        if (existingPendingApplication) {
          throw new ConflictException('Ya existe una solicitud vigente para esta institución.');
        }

        const tenant = await this.tenantModel.findById(invitation.tenantId).session(session);
        if (!tenant) {
          throw new ConflictException('La institución de la invitación ya no está disponible.');
        }

        const now = new Date();
        const app = await this.applicationModel.create(
          [
            {
              dni: invitation.dni,
              email,
              passwordHash: this.resolveApplicationPasswordHash(user, dto.password),
              name: this.formatDisplayName(dto.name ?? user.name ?? invitation.name),
              institutionName: tenant.name,
              institutionNameNorm: tenant.nameNorm,
              accountAddress: invitation.accountAddress,
              status: 'PENDING_APPROVAL',
              emailVerifiedAt: now,
              tenantId: tenant._id,
              invitationId: invitation._id,
              userId: user._id,
            },
          ],
          { session },
        );
        const createdApplication = Array.isArray(app) ? app[0] : app;

        invitation.status = 'ACCEPTED';
        invitation.acceptedAt = now;
        invitation.applicationId = createdApplication._id;
        await invitation.save({ session });

        response = {
          id: String(invitation._id),
          status: invitation.status,
          applicationId: String(createdApplication._id),
          applicationStatus: createdApplication.status,
        };
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  async getMobileInvitationRequest(
    invitationId: string,
    authUser?: InstitutionalInvitationMobileRequestUser,
  ) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    this.assertMobileInvitationAuthUserMatches(invitation, authUser);
    const tenant = await this.tenantModel.findById(invitation.tenantId).lean();
    if (!tenant) {
      throw new NotFoundException('Institución no encontrada');
    }
    const adminAccount = await this.findAdministrativeAccountByInvitation(
      invitation.dni,
    );
    return {
      invitationId: String(invitation._id),
      tenantId: String(invitation.tenantId),
      institutionName: tenant.name,
      dni: invitation.dni,
      status: invitation.status,
      expiresAt: invitation.expiresAt ?? null,
      hasAdminAccount: Boolean(adminAccount),
    };
  }

  async getInvitationRegistrationContext(invitationId: string, registrationContinuationCode?: string) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    await this.getInvitationRegistrationContinuation(invitation, registrationContinuationCode);
    const tenant = await this.tenantModel.findById(invitation.tenantId).lean();
    if (!tenant) {
      throw new ConflictException('La institución de la invitación ya no está disponible.');
    }
    return {
      invitationId: String(invitation._id),
      tenant: { id: String(tenant._id), name: tenant.name },
      status: 'REQUIRES_ADMIN_ACCOUNT',
    };
  }

  async rejectInvitation(invitationId: string, reason?: string) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    invitation.status = 'REJECTED';
    invitation.rejectedAt = new Date();
    invitation.reason = reason?.trim() || null;
    await invitation.save();
    return this.toInvitationResponse(invitation);
  }

  async rejectInvitationFromMobile(
    invitationId: string,
    authUser?: InstitutionalInvitationMobileRequestUser,
  ) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    this.assertMobileInvitationAuthUserMatches(invitation, authUser);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    invitation.status = 'REJECTED';
    invitation.rejectedAt = new Date();
    invitation.reason = 'Rechazada desde el teléfono';
    await invitation.save();
    return this.toInvitationResponse(invitation);
  }

  async cancelInvitation(invitationId: string, requester: any, reason?: string) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    const tenant = await this.tenantModel.findById(invitation.tenantId);
    if (!tenant) {
      throw new ConflictException('La institución de la invitación ya no está disponible.');
    }
    await this.assertRequesterIsPrimaryForTenant(requester, tenant._id);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    invitation.status = 'CANCELLED';
    invitation.cancelledAt = new Date();
    invitation.reason = reason?.trim() || null;
    await invitation.save();
    return this.toInvitationResponse(invitation);
  }

  async resendInvitation(invitationId: string, requester: any) {
    const invitation = await this.getInvitationOrThrow(invitationId);
    const tenant = await this.tenantModel.findById(invitation.tenantId);
    if (!tenant) {
      throw new ConflictException('La institución de la invitación ya no está disponible.');
    }
    await this.assertRequesterIsPrimaryForTenant(requester, tenant._id);
    await this.assertInvitationPendingAndCurrent(invitation, invitation.invitationToken);
    invitation.noticeCount = (invitation.noticeCount ?? 0) + 1;
    invitation.lastNoticeAt = new Date();
    await invitation.save();
    await this.notificationService.enqueueForInstitutionalInvitation(String(invitation._id), {
      deliveryAttempt: invitation.noticeCount,
    });
    return this.toInvitationResponse(invitation);
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
    if (!dto.accountAddress) {
      throw new BadRequestException('accountAddress es requerido para crear un admin institucional de prueba');
    }
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

  private resolveStableInstitutionId(tenant: InstitutionalTenantDocument): string {
    const current = tenant.stableInstitutionId?.trim();
    if (current) {
      return current;
    }
    const stableInstitutionId = String(tenant._id);
    tenant.stableInstitutionId = stableInstitutionId;
    return stableInstitutionId;
  }

  private requireStableInstitutionId(app: InstitutionalAdminApplicationDocument): string {
    const stableInstitutionId = app.stableInstitutionId?.trim();
    if (!stableInstitutionId) {
      throw new ConflictException('La solicitud institucional no tiene identificador estable');
    }
    return stableInstitutionId;
  }

  private async isInstitutionConfirmedOnChain(
    stableInstitutionId: string,
    accountAddress: string,
  ): Promise<boolean> {
    const expectedAdmin = this.normalizeAccountAddressForComparison(accountAddress);
    try {
      const admin = await VoteContractReads.getInstitutionAdmin(this.chain, stableInstitutionId);
      if (
        typeof admin === 'string' &&
        this.normalizeAccountAddressForComparison(admin) === expectedAdmin
      ) {
        return true;
      }
      if (typeof admin === 'string' && admin.trim()) {
        throw new ConflictException('La institución ya existe en la red con otro administrador');
      }
    } catch (error) {
      if (this.isInstitutionNotFoundRevert(error)) {
        this.logger.debug({
          event: 'INSTITUTION_NOT_FOUND_ON_CHAIN',
          stableInstitutionId,
          chain: this.chain,
        });
        return false;
      }
      throw error;
    }

    try {
      return Boolean(
        await VoteContractReads.isAuthorizedAddress(
          this.chain,
          stableInstitutionId,
          accountAddress as Hex,
        ),
      );
    } catch (error) {
      if (this.isInstitutionNotFoundRevert(error)) {
        return false;
      }
      throw error;
    }
  }

  private async completeInstitutionCreationFromNetwork(applicationId: string) {
    const session = await this.applicationModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        const app = await this.getApplicationOrThrow(applicationId, session);
        if (app.status === 'APPROVED' && app.chainStatus === 'CONFIRMED') {
          return;
        }
        if (!app.tenantId || !app.userId) {
          throw new ConflictException('La solicitud institucional no tiene tenant o usuario asociado');
        }

        const tenant = await this.tenantModel.findById(app.tenantId).session(session);
        if (!tenant) {
          throw new ConflictException('No se pudo resolver la institución de la solicitud');
        }
        const stableInstitutionId = this.requireStableInstitutionId(app);
        tenant.stableInstitutionId = tenant.stableInstitutionId ?? stableInstitutionId;
        tenant.active = true;
        await tenant.save({ session });

        await this.assignmentModel.updateOne(
          { tenantId: app.tenantId, userId: app.userId },
          {
            $set: {
              status: 'APPROVED',
              active: true,
              accountAddress: app.accountAddress,
              accountAddressNormalized: normalizeTenantWalletAddress(app.accountAddress)?.toLowerCase(),
              applicationId: app._id,
              institutionalRole: 'PRIMARY',
              approvedAt: app.approvedAt ?? new Date(),
              revokedAt: null,
              rejectedAt: null,
              reason: null,
              walletVerifiedAt: app.approvedAt ?? new Date(),
              walletVerificationSource: 'IDENTITY',
            },
          },
          { upsert: true, session },
        );

        app.status = 'APPROVED';
        app.chainStatus = 'CONFIRMED';
        app.chainConfirmedAt = app.chainConfirmedAt ?? new Date();
        app.chainNextRetryAt = undefined;
        app.chainLastError = undefined;
        app.chainLockedAt = undefined;
        app.chainLockedUntil = undefined;
        await app.save({ session });

        await this.syncUserActiveState(app.userId, session);
      });
    } finally {
      await session.endSession();
    }
  }

  private isRecoverableChainError(error: any): boolean {
    const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();
    const status = Number(error?.status ?? error?.response?.status ?? error?.cause?.status ?? 0);
    const responseStatus = Number(error?.response?.statusCode ?? error?.cause?.response?.statusCode ?? 0);
    const responseCode = String(error?.response?.code ?? error?.cause?.response?.code ?? '').toUpperCase();
    const name = String(error?.name ?? error?.cause?.name ?? '').toLowerCase();
    const message = String(error?.message ?? error?.cause?.message ?? '').toLowerCase();
    return (
      ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'TIMEOUT'].includes(code) ||
      responseCode.endsWith('_NOT_CONFIGURED') ||
      responseCode === 'CHAIN_NOT_CONFIGURED' ||
      name.includes('serviceunavailable') ||
      status === 408 ||
      status === 429 ||
      status >= 500 ||
      responseStatus === 408 ||
      responseStatus === 429 ||
      responseStatus >= 500 ||
      message.includes('timeout') ||
      message.includes('pending') ||
      message.includes('temporarily') ||
      message.includes('network')
    );
  }

  private isInstitutionNotFoundRevert(error: any): boolean {
    const expectedReason = 'institution does not exist';
    const values = this.collectErrorTextValues(error);
    return values.some((value) => value.trim().toLowerCase().includes(expectedReason));
  }

  private collectErrorTextValues(error: any, depth = 0): string[] {
    if (!error || depth > 4) return [];
    const values: string[] = [];
    for (const key of ['name', 'message', 'shortMessage', 'details']) {
      const value = error?.[key];
      if (typeof value === 'string') values.push(value);
    }
    if (Array.isArray(error?.metaMessages)) {
      for (const item of error.metaMessages) {
        if (typeof item === 'string') values.push(item);
      }
    }
    return values.concat(this.collectErrorTextValues(error.cause, depth + 1));
  }

  private calculateNextChainRetryAt(attempts: number): Date {
    const boundedAttempt = Math.min(Math.max(attempts, 1), 6);
    return new Date(Date.now() + 1000 * 60 * boundedAttempt);
  }

  private maxMobileAuthorizationRetryAttempts() {
    return Math.max(
      1,
      Number(this.configService.get<string>('app.institutionalAuthorization.maxRetries') || 5),
    );
  }

  private requiredMobileAuthorizationConfirmations() {
    return Math.max(
      1,
      Number(this.configService.get<string>('app.officialPublication.requiredConfirmations') || 1),
    );
  }

  private toSafeChainError(error: any): string {
    if (this.isRecoverableChainError(error)) {
      return 'No pudimos completar la creación en la red. El sistema volverá a intentar.';
    }
    return 'No pudimos completar la creación en la red.';
  }

  private assertInstitutionCreationChainConfig(
    stableInstitutionId: string,
    accountAddress: string,
  ) {
    const network = availableNetworks[this.chain as keyof typeof availableNetworks] as any;
    if (!network) {
      throw new ServiceUnavailableException({
        code: 'CHAIN_NOT_CONFIGURED',
        message: 'No pudimos completar la creación en la red.',
      });
    }
    if (!network.chain?.id) {
      throw new ServiceUnavailableException({
        code: 'CHAIN_ID_NOT_CONFIGURED',
        message: 'No pudimos completar la creación en la red.',
      });
    }
    if (!network.bundler) {
      throw new ServiceUnavailableException({
        code: 'BUNDLER_NOT_CONFIGURED',
        message: 'No pudimos completar la creación en la red.',
      });
    }
    if (!network.voteContract || !isAddress(network.voteContract)) {
      throw new ServiceUnavailableException({
        code: 'VOTE_CONTRACT_NOT_CONFIGURED',
        message: 'No pudimos completar la creación en la red.',
      });
    }
    if (!this.pk || !/^0x[a-fA-F0-9]{64}$/.test(this.pk)) {
      throw new ServiceUnavailableException({
        code: 'OPERATOR_PRIVATE_KEY_NOT_CONFIGURED',
        message: 'No pudimos completar la creación en la red.',
      });
    }
    if (!stableInstitutionId || !accountAddress) {
      throw new ServiceUnavailableException({
        code: 'INSTITUTION_CREATION_CONTEXT_INCOMPLETE',
        message: 'No pudimos completar la creación en la red.',
      });
    }
  }

  private logInstitutionCreationError(
    error: any,
    app: InstitutionalAdminApplicationDocument,
    stableInstitutionId: string,
    accountAddress: string,
  ) {
    const network = availableNetworks[this.chain as keyof typeof availableNetworks] as any;
    this.logger.error({
      event: 'INSTITUTION_CREATION_CHAIN_ERROR',
      applicationId: String(app._id),
      tenantId: app.tenantId ? String(app.tenantId) : null,
      stableInstitutionId,
      accountAddress,
      chain: this.chain,
      chainId: network?.chain?.id ?? null,
      contractAddress: network?.voteContract ?? null,
      chainAttempt: app.chainAttempts ?? 0,
      ...this.extractSafeErrorDetails(error),
    });
  }

  private extractSafeErrorDetails(error: any) {
    const cause = error?.cause;
    return {
      errorName: this.sanitizeLogValue(error?.name),
      errorMessage: this.sanitizeLogValue(error?.message),
      errorShortMessage: this.sanitizeLogValue(error?.shortMessage),
      errorDetails: this.sanitizeLogValue(error?.details),
      errorCode: this.sanitizeLogValue(error?.code ?? error?.response?.code),
      errorCauseName: this.sanitizeLogValue(cause?.name),
      errorCauseMessage: this.sanitizeLogValue(cause?.message),
      metaMessages: Array.isArray(error?.metaMessages)
        ? error.metaMessages.map((item: unknown) => this.sanitizeLogValue(item))
        : undefined,
      stack: this.sanitizeLogValue(error?.stack),
    };
  }

  private sanitizeLogValue(value: unknown) {
    if (value === undefined || value === null) return undefined;
    return String(value)
      .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_HEX_32]')
      .replace(/(api[_-]?key|token|authorization|password|secret)=([^&\s]+)/gi, '$1=[REDACTED]');
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
      if (institutionalRole === 'SECONDARY') {
        throw new ForbiddenException(
          'Solo el administrador principal vigente puede aprobar solicitudes de acceso a esta institución',
        );
      }
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

  private async resolveWalletFromIdentityByDni(
    dni: string,
  ): Promise<{ accountAddress: string }> {
    const identityBaseUrl = this.configService.get<string>('app.identity.baseUrl');
    const identityApiKey = this.configService.get<string>('app.identity.apiKey');
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!identityBaseUrl || !identityApiKey) {
      throw new ServiceUnavailableException({
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'No se pudo verificar la billetera en este momento',
      });
    }

    const baseUrl = identityBaseUrl.replace(/\/$/, '');
    try {
      const response =
        await this.httpService.axiosRef.post<IdentityResolveAccountByDniResponse>(
          `${baseUrl}/registry/resolve-account-by-dni`,
          { dni },
          {
            headers: { 'x-api-key': identityApiKey },
            timeout,
          },
        );

      const data = response?.data;
      if (!data || typeof data.registered !== 'boolean') {
        throw new ServiceUnavailableException({
          code: 'IDENTITY_INVALID_RESPONSE',
          message: 'No se pudo verificar la billetera en este momento',
        });
      }

      if (data.registered) {
        if (typeof data.accountAddress !== 'string' || !data.accountAddress.trim()) {
          throw new ServiceUnavailableException({
            code: 'IDENTITY_INVALID_RESPONSE',
            message: 'No se pudo verificar la billetera en este momento',
          });
        }
        const identityAccountAddress = data.accountAddress.trim();
        if (!isAddress(identityAccountAddress)) {
          throw new ServiceUnavailableException({
            code: 'IDENTITY_INVALID_RESPONSE',
            message: 'No se pudo verificar la billetera en este momento',
          });
        }
        return {
          accountAddress: identityAccountAddress,
        };
      }

      const personExists = await this.identityPersonExistsByDni(baseUrl, identityApiKey, dni, timeout);
      if (personExists) {
        throw new BadRequestException({
          code: 'IDENTITY_WALLET_NOT_FOUND',
          message: 'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
        });
      }

      throw new BadRequestException({
        code: 'IDENTITY_PERSON_NOT_REGISTERED',
        message: 'La persona debe registrarse primero en Tu Voto Decide.',
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'No se pudo verificar la billetera en este momento',
      });
    }
  }

  private async identityPersonExistsByDni(
    baseUrl: string,
    identityApiKey: string,
    dni: string,
    timeout: number,
  ): Promise<boolean> {
    try {
      const response = await this.httpService.axiosRef.get<IdentityGetByDniResponse>(
        `${baseUrl}/registry/get-by-dni`,
        {
          params: { dnis: dni },
          headers: { 'x-api-key': identityApiKey },
          timeout,
        },
      );
      const records = response?.data?.records;
      if (!Array.isArray(records)) {
        throw new ServiceUnavailableException({
          code: 'IDENTITY_INVALID_RESPONSE',
          message: 'No se pudo verificar la billetera en este momento',
        });
      }
      return records.some((record) => String(record?.dni ?? '').trim() === dni);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'No se pudo verificar la billetera en este momento',
      });
    }
  }

  private async sendVerificationEmail(
    applicationId: Types.ObjectId | string,
    to: string,
    name: string,
    token: string,
    correlationId?: string,
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
        correlationId,
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

  private async getInvitationOrThrow(invitationId: string, session?: ClientSession) {
    if (!Types.ObjectId.isValid(invitationId)) {
      throw new BadRequestException('invitationId inválido');
    }
    const query = this.invitationModel.findById(invitationId);
    if (session && typeof query.session === 'function') {
      query.session(session);
    }
    const invitation = await query;
    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }
    return invitation;
  }

  private async assertInvitationPendingAndCurrent(
    invitation: InstitutionalAdminInvitationDocument,
    token: string,
  ) {
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('La invitación ya no está vigente');
    }
    if (invitation.invitationToken !== token) {
      throw new BadRequestException('Token de invitación inválido');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      await this.invitationModel.updateOne(
        { _id: invitation._id, status: 'PENDING' },
        { $set: { status: 'EXPIRED' } },
      );
      throw new BadRequestException('La invitación ha vencido');
    }
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
      throw new ConflictException({
        code: 'ADMIN_EMAIL_OR_DNI_ALREADY_EXISTS',
        message: 'El email o DNI ya está asociado a otro usuario',
      });
    }

    return matches[0];
  }

  /** A real administrative account requires persisted, usable credentials. */
  private async findAdministrativeAccountByInvitation(dni: string) {
    const user = await this.roledUserModel
      .findOne({ dni })
      .lean();
    return user?.email && user?.password ? user : null;
  }

  private async getInvitationRegistrationContinuation(
    invitation: InstitutionalAdminInvitationDocument,
    registrationContinuationCode?: string,
  ): Promise<InstitutionalInvitationRegistrationContinuation> {
    const continuation = await this.mobileZkAuthService.getInvitationRegistrationContinuation(
      String(registrationContinuationCode || '').trim(),
      String(invitation._id),
    );
    if (
      continuation.tenantId !== String(invitation.tenantId) ||
      continuation.dni !== invitation.dni ||
      this.normalizeAccountAddressForComparison(continuation.smartAccountAddress) !==
        this.normalizeAccountAddressForComparison(String(invitation.accountAddress))
    ) {
      throw new ForbiddenException('El contexto de registro no corresponde a la invitación.');
    }
    return continuation;
  }

  private async resolveUserByDniOnly(dni: string, session?: ClientSession) {
    const query = this.roledUserModel.findOne({ dni });
    if (session && typeof query.session === 'function') {
      query.session(session);
    }
    return query;
  }

  async createRemovalAuthorization(
    tenantId: string,
    assignmentId: string,
    requester: any,
    reason?: string,
  ) {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(assignmentId)) {
      throw new BadRequestException({
        code: 'INSTITUTIONAL_REMOVAL_TARGET_INVALID',
        message: 'La institución o la persona indicada no es válida.',
      });
    }

    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant || tenant.active !== true) {
      throw new NotFoundException({
        code: 'INSTITUTIONAL_TENANT_NOT_FOUND',
        message: 'Institución no encontrada.',
      });
    }
    const stableInstitutionId = tenant.stableInstitutionId?.trim() || String(tenant._id);
    if (!tenant.stableInstitutionId?.trim()) {
      tenant.stableInstitutionId = stableInstitutionId;
      await tenant.save();
    }

    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_PRIMARY_REQUIRED',
        message: 'Solo el administrador principal puede eliminar accesos.',
      });
    }
    const primary = await this.assignmentModel.findOne({
      tenantId: tenant._id,
      userId: new Types.ObjectId(requesterId),
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    }).lean();
    if (!primary?.accountAddress) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_PRIMARY_REQUIRED',
        message: 'Solo el administrador principal puede eliminar accesos.',
      });
    }

    const target = await this.assignmentModel.findOne({
      _id: new Types.ObjectId(assignmentId),
      tenantId: tenant._id,
    });
    if (!target) {
      throw new NotFoundException({
        code: 'INSTITUTIONAL_ASSIGNMENT_NOT_FOUND',
        message: 'La persona indicada no administra esta institución.',
      });
    }
    if (target.institutionalRole === 'PRIMARY') {
      throw new ConflictException({
        code: 'INSTITUTIONAL_PRIMARY_CANNOT_BE_REMOVED',
        message: 'Para eliminar al administrador principal primero debe transferirse el rol.',
      });
    }
    if (target.active !== true || target.status !== 'APPROVED') {
      throw new ConflictException({
        code: 'INSTITUTIONAL_ASSIGNMENT_ALREADY_INACTIVE',
        message: 'El acceso ya no está activo.',
      });
    }
    const targetWallet = this.normalizeAccountAddress(String(target.accountAddress || ''));
    const targetUser = await this.roledUserModel.findById(target.userId);
    if (!targetUser) {
      throw new ConflictException({
        code: 'INSTITUTIONAL_TARGET_USER_NOT_FOUND',
        message: 'No se encontró la cuenta de la persona seleccionada.',
      });
    }

    const activeStatuses = [
      'PENDING_MOBILE_AUTHORIZATION',
      'PENDING_CHAIN_CONFIRMATION',
      'CHAIN_RETRY_PENDING',
      'RECONCILIATION_PENDING',
      'CHAIN_FAILED',
    ] as const;
    const existing = await this.applicationModel.findOne({
      tenantId: tenant._id,
      userId: target.userId,
      targetAssignmentId: target._id,
      mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS',
      status: { $in: activeStatuses },
    } as any);
    if (existing) {
      return this.toMobileAuthorizationResponse(existing, tenant, primary, existing.status);
    }

    const now = new Date();
    const created = new this.applicationModel({
      dni: targetUser.dni,
      email: targetUser.email,
      passwordHash: targetUser.password || 'institutional-removal',
      name: targetUser.name || 'Administrador de la institución',
      institutionName: tenant.name,
      institutionNameNorm: tenant.nameNorm,
      accountAddress: targetWallet,
      status: 'PENDING_MOBILE_AUTHORIZATION',
      stableInstitutionId,
      tenantId: tenant._id,
      userId: target.userId,
      targetAssignmentId: target._id,
      mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS',
      mobileAuthorizationRequestedAt: now,
      approvedAt: now,
      approvedBy: this.resolveRequesterObjectId(requester) ?? undefined,
      reason: reason?.trim() || undefined,
    });
    await created.save();
    const notification = await this.recordMobileAuthorizationNotice(created, tenant, requester);
    created.mobileAuthorizationNotificationId = notification?._id ?? null;
    await created.save();
    await this.enqueueMobileAuthorizationDelivery(String(created._id));
    return this.toMobileAuthorizationResponse(created, tenant, primary, created.status);
  }

  async getMobileAuthorizationRequest(applicationId: string, authUser?: InstitutionalMobileRequestUser) {
    const app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    // Polling must never advance or recreate this state machine.  In particular,
    // a GET racing with a submission must not save a stale PENDING document.
    const status = this.getMobileAuthorizationStatus(app);
    this.assertMobileAuthUserMatches(primary, authUser);
    return this.toMobileAuthorizationResponse(app, tenant, primary, status);
  }

  async claimMobileAuthorization(applicationId: string, dto: any = {}, authUser?: InstitutionalMobileRequestUser) {
    let app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    this.assertMobileAuthUserMatches(primary, authUser);
    if (await this.reconcileHistoricalMobileAuthorizationIfAlreadyOnChain(applicationId)) {
      app = await this.getApplicationOrThrow(applicationId);
      return { request: this.toMobileAuthorizationResponse(app, tenant, primary, app.status) };
    }
    const status = await this.expireMobileAuthorizationIfNeeded(app);
    if (status === 'MOBILE_AUTHORIZATION_EXPIRED') {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_EXPIRED', message: 'La autorización móvil venció.' });
    }
    if (status !== 'PENDING_MOBILE_AUTHORIZATION') {
      throw new ConflictException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SIGNABLE',
        message: 'La autorización ya fue enviada y no puede volver a firmarse.',
      });
    }
    if (!String(dto?.deviceId || '').trim()) {
      throw new BadRequestException({ code: 'INSTITUTIONAL_DEVICE_ID_REQUIRED', message: 'El dispositivo es requerido.' });
    }
    if (app.mobileAuthorizationDeviceId && app.mobileAuthorizationDeviceId !== String(dto.deviceId)) {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_ALREADY_CLAIMED', message: 'Esta autorización ya está siendo procesada en otro dispositivo.' });
    }
    const stableInstitutionId = this.requireStableInstitutionId(app);
    if (String(stableInstitutionId) === String(app._id)) {
      throw new ConflictException({ code: 'INSTITUTIONAL_STABLE_ID_REQUIRED', message: 'La autorización debe usar el identificador estable de institución.' });
    }
    const targetWallet = this.normalizeAccountAddress(app.accountAddress);
    const action = this.resolveMobileAuthorizationAction(app);
    const call = action === 'REMOVE_AUTHORIZED_ADDRESS'
      ? VoteContractCalls.removeAuthorizedAddress(this.chain, stableInstitutionId, targetWallet as Hex)
      : action === 'CHANGE_INSTITUTION_ADMIN'
        ? VoteContractCalls.changeInstitutionAdmin(this.chain, stableInstitutionId, targetWallet as Hex)
        : VoteContractCalls.addAuthorizedAddress(this.chain, stableInstitutionId, targetWallet as Hex);
    const claimed = await this.applicationModel.findOneAndUpdate(
      {
        _id: app._id,
        status: 'PENDING_MOBILE_AUTHORIZATION',
        mobileAuthorizationUserOpHash: null,
        $or: [
          { chainLockedUntil: { $exists: false } },
          { chainLockedUntil: null },
          { chainLockedUntil: { $lte: new Date() } },
        ],
      },
      {
        $set: {
          mobileAuthorizationDeviceId: String(dto.deviceId).slice(0, 128),
          mobileAuthorizationClaimedAt: app.mobileAuthorizationClaimedAt ?? new Date(),
          mobileAuthorizationExpiresAt: app.mobileAuthorizationExpiresAt ?? this.resolveMobileAuthorizationExpiresAt(app),
        },
      },
      { returnDocument: 'after' },
    );
    if (!claimed) {
      throw new ConflictException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SIGNABLE',
        message: 'La autorización cambió de estado antes de poder firmarse.',
      });
    }
    return {
      request: this.toMobileAuthorizationResponse(claimed, tenant, primary, claimed.status),
      execution: {
        chainId: Number(this.chain),
        stableInstitutionId,
        action,
        signerWallet: primary.accountAddress,
        targetWallet,
        calls: [{
          target: call.to,
          value: String(call.value ?? 0),
          callData: call.data,
          purpose: action,
        }],
      },
    };
  }

  async markMobileAuthorizationSigning(applicationId: string, dto: any = {}, authUser?: InstitutionalMobileRequestUser) {
    let app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    this.assertMobileAuthUserMatches(primary, authUser);
    if (await this.reconcileHistoricalMobileAuthorizationIfAlreadyOnChain(applicationId)) {
      app = await this.getApplicationOrThrow(applicationId);
      return this.toMobileAuthorizationResponse(app, tenant, primary, app.status);
    }
    const status = await this.expireMobileAuthorizationIfNeeded(app);
    if (status === 'MOBILE_AUTHORIZATION_EXPIRED') {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_EXPIRED', message: 'La autorización móvil venció.' });
    }
    if (status !== 'PENDING_MOBILE_AUTHORIZATION') {
      throw new ConflictException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SIGNABLE',
        message: 'La autorización ya fue enviada y no puede volver a firmarse.',
      });
    }
    this.assertSameMobileDevice(app, dto?.deviceId);
    const signing = await this.applicationModel.findOneAndUpdate(
      {
        _id: app._id,
        status: 'PENDING_MOBILE_AUTHORIZATION',
        mobileAuthorizationUserOpHash: null,
        mobileAuthorizationDeviceId: app.mobileAuthorizationDeviceId,
        $or: [
          { chainLockedUntil: { $exists: false } },
          { chainLockedUntil: null },
          { chainLockedUntil: { $lte: new Date() } },
        ],
      },
      { $set: { mobileAuthorizationSignedAt: app.mobileAuthorizationSignedAt ?? new Date() } },
      { returnDocument: 'after' },
    );
    if (!signing) {
      throw new ConflictException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SIGNABLE',
        message: 'La autorización cambió de estado antes de poder firmarse.',
      });
    }
    return this.toMobileAuthorizationResponse(signing, tenant, primary, signing.status);
  }

  async rejectMobileAuthorization(applicationId: string, dto: any = {}, authUser?: InstitutionalMobileRequestUser) {
    const app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    const status = await this.expireMobileAuthorizationIfNeeded(app);
    if (!['PENDING_MOBILE_AUTHORIZATION', 'MOBILE_AUTHORIZATION_EXPIRED'].includes(String(status))) {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_NOT_REJECTABLE', message: 'La autorización ya fue enviada y no puede rechazarse desde el teléfono.' });
    }
    this.assertMobileAuthUserMatches(primary, authUser);
    app.status = 'REJECTED' as any;
    app.rejectedAt = new Date();
    app.reason = String(dto?.reasonCode || 'MOBILE_REJECTED').slice(0, 120);
    await app.save();
    if (this.resolveMobileAuthorizationAction(app) === 'ADD_AUTHORIZED_ADDRESS' && app.tenantId && app.userId) {
      await this.assignmentModel.updateOne(
        { tenantId: app.tenantId, userId: app.userId },
        { $set: { status: 'REJECTED', active: false, rejectedAt: app.rejectedAt, reason: app.reason } },
      );
      await this.syncUserActiveState(app.userId);
    }
    return this.toMobileAuthorizationResponse(app, tenant, primary, app.status);
  }

  async submitMobileAuthorization(applicationId: string, dto: any = {}, authUser?: InstitutionalMobileRequestUser) {
    let app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    this.assertMobileAuthUserMatches(primary, authUser);
    if (await this.reconcileHistoricalMobileAuthorizationIfAlreadyOnChain(applicationId)) {
      app = await this.getApplicationOrThrow(applicationId);
      return this.toMobileAuthorizationResponse(app, tenant, primary, app.status);
    }
    const status = await this.expireMobileAuthorizationIfNeeded(app);
    if (status === 'MOBILE_AUTHORIZATION_EXPIRED') {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_EXPIRED', message: 'La autorización móvil venció.' });
    }
    this.assertSameMobileDevice(app, dto?.deviceId);
    const userOpHash = String(dto?.userOpHash || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{64}$/i.test(userOpHash)) {
      throw new BadRequestException({ code: 'INSTITUTIONAL_USER_OP_HASH_REQUIRED', message: 'La operación firmada es requerida.' });
    }
    if (app.mobileAuthorizationUserOpHash) {
      if (app.mobileAuthorizationUserOpHash.toLowerCase() !== userOpHash) {
        throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_SUBMISSION_CONFLICT', message: 'Ya existe una operación firmada distinta para esta autorización.' });
      }
      return this.toMobileAuthorizationResponse(app, tenant, primary, app.status);
    }
    if (status !== 'PENDING_MOBILE_AUTHORIZATION') {
      throw new ConflictException({
        code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SUBMITTABLE',
        message: 'La autorización no está disponible para una nueva firma.',
      });
    }
    const txHash = dto?.txHash ? String(dto.txHash).trim().toLowerCase() : null;
    const submitted = await this.applicationModel.findOneAndUpdate(
      {
        _id: app._id,
        status: 'PENDING_MOBILE_AUTHORIZATION',
        mobileAuthorizationUserOpHash: null,
        mobileAuthorizationDeviceId: app.mobileAuthorizationDeviceId,
        $or: [
          { chainLockedUntil: { $exists: false } },
          { chainLockedUntil: null },
          { chainLockedUntil: { $lte: new Date() } },
        ],
      },
      {
        $set: {
          mobileAuthorizationUserOpHash: userOpHash,
          mobileAuthorizationTxHash: txHash,
          chainTxHash: txHash ?? app.chainTxHash ?? null,
          chainStatus: 'SENT',
          chainLastError: null,
          chainNextRetryAt: null,
          status: 'PENDING_CHAIN_CONFIRMATION',
        },
        $inc: { chainAttempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (submitted) {
      return this.toMobileAuthorizationResponse(submitted, tenant, primary, submitted.status);
    }

    // Another request won the transition.  Re-read so the same hash remains
    // idempotent while a different hash is never allowed to replace it.
    const fresh = await this.getApplicationOrThrow(applicationId);
    if (fresh.mobileAuthorizationUserOpHash) {
      if (fresh.mobileAuthorizationUserOpHash.toLowerCase() === userOpHash) {
        return this.toMobileAuthorizationResponse(fresh, tenant, primary, fresh.status);
      }
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_SUBMISSION_CONFLICT', message: 'Ya existe una operación firmada distinta para esta autorización.' });
    }
    throw new ConflictException({
      code: 'INSTITUTIONAL_AUTHORIZATION_NOT_SUBMITTABLE',
      message: 'La autorización cambió de estado antes de registrar la firma.',
    });
  }

  async reconcileMobileAuthorizationOperation(applicationId: string) {
    let app = await this.getApplicationOrThrow(applicationId);
    const { tenant, primary } = await this.resolveMobileAuthorizationContext(app);
    if (await this.reconcileHistoricalMobileAuthorizationIfAlreadyOnChain(applicationId)) {
      app = await this.getApplicationOrThrow(applicationId);
      return { reconciled: true, request: this.toMobileAuthorizationResponse(app, tenant, primary, app.status) };
    }
    await this.processMobileAuthorizationRetry(applicationId);
    const refreshed = await this.getApplicationOrThrow(applicationId);
    const reconciled = ['APPROVED', 'REVOKED'].includes(String(refreshed.status)) &&
      refreshed.chainStatus === 'CONFIRMED';
    return { reconciled, request: this.toMobileAuthorizationResponse(refreshed, tenant, primary, refreshed.status) };
  }

  /**
   * Recovers legacy rows that lost their user-operation hash after the contract
   * call succeeded. This is deliberately invoked by explicit reconciliation or
   * before issuing a new signing package, never by polling GET.
   */
  private async reconcileHistoricalMobileAuthorizationIfAlreadyOnChain(applicationId: string) {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 60_000);
    const app = await this.applicationModel.findOneAndUpdate(
      {
        _id: this.toObjectId(applicationId),
        status: 'PENDING_MOBILE_AUTHORIZATION',
        $and: [
          {
            $or: [
              { mobileAuthorizationAction: 'ADD_AUTHORIZED_ADDRESS' },
              { mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS' },
              { mobileAuthorizationAction: null },
              { mobileAuthorizationAction: { $exists: false } },
            ],
          },
          {
            $or: [
              { chainLockedUntil: { $exists: false } },
              { chainLockedUntil: null },
              { chainLockedUntil: { $lte: now } },
            ],
          },
        ],
      },
      { $set: { chainLockedAt: now, chainLockedUntil: lockUntil } },
      { returnDocument: 'after' },
    );
    if (!app) return false;

    try {
      const stableInstitutionId = this.requireStableInstitutionId(app);
      const targetWallet = this.normalizeAccountAddress(app.accountAddress);
      const confirmed = await this.isMobileAuthorizationConfirmedOnNetwork(
        app,
        stableInstitutionId,
        targetWallet,
      );
      if (confirmed) {
        await this.completeMobileAuthorizationFromNetwork(app);
        const finalized = await this.getApplicationOrThrow(applicationId);
        return ['APPROVED', 'REVOKED'].includes(String(finalized.status));
      }
      await this.applicationModel.updateOne(
        { _id: app._id, status: 'PENDING_MOBILE_AUTHORIZATION', chainLockedUntil: lockUntil },
        { $set: { chainLockedAt: null, chainLockedUntil: null } },
      );
      return false;
    } catch (error) {
      await this.applicationModel.updateOne(
        { _id: app._id, status: 'PENDING_MOBILE_AUTHORIZATION', chainLockedUntil: lockUntil },
        { $set: { chainLockedAt: null, chainLockedUntil: null } },
      );
      throw error;
    }
  }

  async processMobileAuthorizationRetry(applicationId: string) {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 60_000);
    const app = await this.applicationModel.findOneAndUpdate(
      {
        _id: this.toObjectId(applicationId),
        status: { $in: ['PENDING_CHAIN_CONFIRMATION', 'CHAIN_RETRY_PENDING', 'RECONCILIATION_PENDING', 'CHAIN_FAILED'] },
        mobileAuthorizationUserOpHash: { $exists: true, $ne: null },
        $and: [
          { $or: [{ chainLockedUntil: { $exists: false } }, { chainLockedUntil: null }, { chainLockedUntil: { $lte: now } }] },
          { $or: [{ chainNextRetryAt: { $exists: false } }, { chainNextRetryAt: null }, { chainNextRetryAt: { $lte: now } }] },
        ],
      },
      { $set: { chainLockedAt: now, chainLockedUntil: lockUntil } },
      { returnDocument: 'after' },
    );
    if (!app) return { processed: false, reason: 'NO_CLAIMABLE_OPERATION', reissuable: false };
    try {
      const userOperation = await this.verifyMobileAuthorizationUserOperation(app);
      if (userOperation.status === 'PENDING') {
        return this.reconcilePendingMobileAuthorizationFromNetwork(app, userOperation.code);
      }
      if (userOperation.status !== 'CONFIRMED') {
        // A receipt/bundler failure is not enough to request a second
        // signature: the contract may already contain the desired state.
        const stableInstitutionId = this.requireStableInstitutionId(app);
        const targetWallet = this.normalizeAccountAddress(app.accountAddress);
        if (await this.isMobileAuthorizationConfirmedOnNetwork(app, stableInstitutionId, targetWallet)) {
          await this.completeMobileAuthorizationFromNetwork(app);
          return { processed: true, status: 'CONFIRMED', reusedNetworkState: true, reissuable: false };
        }
        await this.applicationModel.updateOne(
          {
            _id: app._id,
            status: app.status,
            mobileAuthorizationUserOpHash: app.mobileAuthorizationUserOpHash,
          },
          { $set: {
            status: 'CHAIN_FAILED', chainStatus: 'FAILED', chainLastError: userOperation.code,
            chainNextRetryAt: null, chainLockedAt: null, chainLockedUntil: null,
          } },
        );
        return { processed: true, status: 'FAILED', reason: userOperation.code, reissuable: true };
      }
      if (userOperation.txHash && !app.mobileAuthorizationTxHash) {
        await this.applicationModel.updateOne(
          {
            _id: app._id,
            status: app.status,
            mobileAuthorizationUserOpHash: app.mobileAuthorizationUserOpHash,
          },
          { $set: { mobileAuthorizationTxHash: userOperation.txHash, chainTxHash: userOperation.txHash } },
        );
      }
      const stableInstitutionId = this.requireStableInstitutionId(app);
      const targetWallet = this.normalizeAccountAddress(app.accountAddress);
      const confirmed = await this.isMobileAuthorizationConfirmedOnNetwork(app, stableInstitutionId, targetWallet);
      if (confirmed) {
        await this.completeMobileAuthorizationFromNetwork(app);
        return { processed: true, status: 'CONFIRMED', reusedNetworkState: true, reissuable: false };
      }
      return this.deferMobileAuthorizationConfirmation(
        app,
        'INSTITUTIONAL_ONCHAIN_STATE_PENDING',
      );
    } catch (error) {
      const attempts = (app.chainAttempts ?? 0) + 1;
      const retryable = attempts < this.maxMobileAuthorizationRetryAttempts();
      await this.applicationModel.updateOne(
        {
          _id: app._id,
          status: app.status,
          mobileAuthorizationUserOpHash: app.mobileAuthorizationUserOpHash,
        },
        { $set: {
          status: retryable ? 'CHAIN_RETRY_PENDING' : 'CHAIN_FAILED',
          chainStatus: retryable ? 'RETRY_PENDING' : 'FAILED',
          chainAttempts: attempts,
          chainNextRetryAt: retryable ? this.calculateNextChainRetryAt(attempts) : null,
          chainLastError: this.toSafeChainError(error),
          chainLockedAt: null,
          chainLockedUntil: null,
        } },
      );
      return { processed: true, status: retryable ? 'RETRY_PENDING' : 'FAILED', attempts, reissuable: false };
    }
  }

  private async reconcilePendingMobileAuthorizationFromNetwork(
    app: InstitutionalAdminApplicationDocument,
    pendingCode: string,
  ) {
    const stableInstitutionId = this.requireStableInstitutionId(app);
    const targetWallet = this.normalizeAccountAddress(app.accountAddress);
    const confirmed = await this.isMobileAuthorizationConfirmedOnNetwork(
      app,
      stableInstitutionId,
      targetWallet,
    );
    if (confirmed) {
      await this.completeMobileAuthorizationFromNetwork(app);
      return { processed: true, status: 'CONFIRMED', reusedNetworkState: true, reissuable: false };
    }
    return this.deferMobileAuthorizationConfirmation(app, pendingCode);
  }

  private async deferMobileAuthorizationConfirmation(
    app: InstitutionalAdminApplicationDocument,
    code: string,
  ) {
    const attempts = (app.chainAttempts ?? 0) + 1;
    const retryable = attempts < this.maxMobileAuthorizationRetryAttempts();
    await this.applicationModel.updateOne(
      {
        _id: app._id,
        status: app.status,
        mobileAuthorizationUserOpHash: app.mobileAuthorizationUserOpHash,
      },
      {
        $set: {
          status: retryable ? 'CHAIN_RETRY_PENDING' : 'CHAIN_FAILED',
          chainStatus: retryable ? 'RETRY_PENDING' : 'FAILED',
          chainAttempts: attempts,
          chainNextRetryAt: retryable ? this.calculateNextChainRetryAt(attempts) : null,
          chainLastError: code,
          chainLockedAt: null,
          chainLockedUntil: null,
        },
      },
    );
    return {
      processed: true,
      status: retryable ? 'RETRY_PENDING' : 'FAILED',
      attempts,
      reason: code,
      reissuable: false,
    };
  }

  private async verifyMobileAuthorizationUserOperation(app: InstitutionalAdminApplicationDocument) {
    const userOpHash = String(app.mobileAuthorizationUserOpHash || '').trim();
    if (!/^0x[a-f0-9]{64}$/i.test(userOpHash)) return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OP_HASH_INVALID' } as const;
    const [lookup, receipt] = await Promise.all([
      this.userOperationService.getUserOperationByHash(userOpHash),
      this.userOperationService.getUserOperationReceipt(userOpHash),
    ]);
    if (!receipt) return { status: 'PENDING', code: 'INSTITUTIONAL_USER_OPERATION_PENDING' } as const;
    const receiptStatus = receipt.receipt?.status;
    if (!receipt.success || !(receiptStatus === 'success' || receiptStatus === '0x1' || receiptStatus === 1 || receiptStatus === 1n)) {
      return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_REVERTED' } as const;
    }
    if (String(receipt.userOpHash || '').toLowerCase() !== userOpHash.toLowerCase()) {
      return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_RECEIPT_MISMATCH' } as const;
    }
    const { primary } = await this.resolveMobileAuthorizationContext(app);
    const expectedSender = String(primary.accountAddress || '').toLowerCase();
    const senders = [lookup?.userOperation?.sender, receipt.sender]
      .map((value) => String(value || '').toLowerCase())
      .filter(Boolean);
    if (!senders.length || senders.some((sender) => sender !== expectedSender)) {
      return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_SENDER_MISMATCH' } as const;
    }
    const expectedEntryPoint = String(
      this.configService.get<string>('app.institutionalAuthorization.entryPointAddress') || entryPoint07Address,
    ).toLowerCase();
    const entryPoints = [lookup?.entryPoint, receipt.entryPoint]
      .map((value) => String(value || '').toLowerCase())
      .filter(Boolean);
    if (entryPoints.some((entryPoint) => entryPoint !== expectedEntryPoint)) {
      return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_ENTRY_POINT_MISMATCH' } as const;
    }
    const receiptBlock = BigInt(receipt.receipt?.blockNumber);
    const currentBlock = await this.userOperationService.getBlockNumber();
    const confirmations = currentBlock >= receiptBlock ? Number(currentBlock - receiptBlock + 1n) : 0;
    if (confirmations < this.requiredMobileAuthorizationConfirmations()) {
      return { status: 'PENDING', code: 'INSTITUTIONAL_USER_OPERATION_CONFIRMATIONS_PENDING' } as const;
    }
    const stableInstitutionId = this.requireStableInstitutionId(app);
    const targetWallet = this.normalizeAccountAddress(app.accountAddress);
    const action = this.resolveMobileAuthorizationAction(app);
    const call = action === 'REMOVE_AUTHORIZED_ADDRESS'
      ? VoteContractCalls.removeAuthorizedAddress(this.chain, stableInstitutionId, targetWallet as Hex)
      : action === 'CHANGE_INSTITUTION_ADMIN'
        ? VoteContractCalls.changeInstitutionAdmin(this.chain, stableInstitutionId, targetWallet as Hex)
        : VoteContractCalls.addAuthorizedAddress(this.chain, stableInstitutionId, targetWallet as Hex);
    const calls = this.chainVerificationService.decodeSmartAccountCalls(
      String(lookup?.userOperation?.callData || ''),
    );
    if (
      !calls ||
      calls.length !== 1 ||
      String(calls[0].to).toLowerCase() !== String(call.to).toLowerCase() ||
      BigInt(calls[0].value) !== BigInt(call.value || 0) ||
      String(calls[0].data).toLowerCase() !== String(call.data || '').toLowerCase()
    ) {
      return { status: 'FAILED', code: 'INSTITUTIONAL_USER_OPERATION_CALL_MISMATCH' } as const;
    }
    const txHash = String(receipt.txHash || receipt.receipt?.transactionHash || '').trim().toLowerCase();
    return {
      status: 'CONFIRMED',
      code: 'INSTITUTIONAL_USER_OPERATION_CONFIRMED',
      txHash: /^0x[a-f0-9]{64}$/i.test(txHash) ? txHash : null,
    } as const;
  }

  async findMobileAuthorizationReconciliationBatch(limit: number, now = new Date()) {
    return this.applicationModel
      .find({
        mobileAuthorizationUserOpHash: { $exists: true, $ne: null },
        $and: [
          {
            $or: [
              { status: { $in: ['PENDING_CHAIN_CONFIRMATION', 'CHAIN_RETRY_PENDING', 'RECONCILIATION_PENDING'] } },
              { status: 'CHAIN_FAILED', chainLastError: { $in: this.reissuableMobileAuthorizationFailureCodes() } },
            ],
          },
          {
            $or: [
              { chainNextRetryAt: { $exists: false } },
              { chainNextRetryAt: null },
              { chainNextRetryAt: { $lte: now } },
            ],
          },
        ],
      })
      .sort({ chainNextRetryAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();
  }

  async findMobileAuthorizationDeliveryRetryBatch(limit: number, now = new Date()) {
    return this.applicationModel
      .find({
        status: 'PENDING_MOBILE_AUTHORIZATION',
        $and: [
          {
            $or: [
              { mobileAuthorizationDeliveryLockedUntil: { $exists: false } },
              { mobileAuthorizationDeliveryLockedUntil: null },
              { mobileAuthorizationDeliveryLockedUntil: { $lte: now } },
            ],
          },
          {
            $or: [
              { mobileAuthorizationDeliveryNextRetryAt: { $exists: false } },
              { mobileAuthorizationDeliveryNextRetryAt: { $lte: now } },
            ],
          },
        ],
      })
      .sort({ mobileAuthorizationDeliveryNextRetryAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();
  }

  async retryMobileAuthorizationDelivery(applicationId: string) {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 60_000);
    const app = await this.applicationModel.findOneAndUpdate(
      {
        _id: this.toObjectId(applicationId),
        status: 'PENDING_MOBILE_AUTHORIZATION',
        $and: [
          {
            $or: [
              { mobileAuthorizationDeliveryLockedUntil: { $exists: false } },
              { mobileAuthorizationDeliveryLockedUntil: null },
              { mobileAuthorizationDeliveryLockedUntil: { $lte: now } },
            ],
          },
          {
            $or: [
              { mobileAuthorizationDeliveryNextRetryAt: { $exists: false } },
              { mobileAuthorizationDeliveryNextRetryAt: { $lte: now } },
            ],
          },
        ],
      },
      { $set: { mobileAuthorizationDeliveryLockedUntil: lockUntil } },
      { returnDocument: 'after' },
    );
    if (!app) return { processed: false, reason: 'NO_CLAIMABLE_DELIVERY' };
    const result = await this.enqueueMobileAuthorizationDelivery(applicationId);
    return { processed: true, ...result };
  }

  private async enqueueMobileAuthorizationDelivery(applicationId: string) {
    const result = await this.notificationService.enqueueForInstitutionalAuthorization(applicationId);
    const now = new Date();
    const enqueued = Boolean(result?.enqueued);
    const app = await this.applicationModel.findOneAndUpdate(
      { _id: this.toObjectId(applicationId), status: 'PENDING_MOBILE_AUTHORIZATION' },
      {
        $inc: { mobileAuthorizationDeliveryAttempts: 1 },
        $set: {
          mobileAuthorizationDeliveryNextRetryAt: enqueued
            ? null
            : this.calculateNextMobileAuthorizationDeliveryRetryAt(now),
          mobileAuthorizationDeliveryLastError: enqueued ? null : String(result?.skipped || 'MOBILE_DELIVERY_NOT_ENQUEUED'),
          mobileAuthorizationDeliveryLockedUntil: null,
        },
      },
      { returnDocument: 'after' },
    );
    return { ...result, attempts: app?.mobileAuthorizationDeliveryAttempts ?? null };
  }

  private calculateNextMobileAuthorizationDeliveryRetryAt(now = new Date()) {
    return new Date(now.getTime() + 60_000);
  }

  async recoverFailedMobileAuthorization(applicationId: string) {
    const reopened = await this.reopenMobileAuthorizationAfterVerifiedChainFailure(applicationId);
    if (!reopened) return { recovered: false };
    const delivery = await this.enqueueMobileAuthorizationDelivery(applicationId);
    return { recovered: true, delivery };
  }

  private reissuableMobileAuthorizationFailureCodes() {
    return [
      'INSTITUTIONAL_USER_OP_HASH_INVALID',
      'INSTITUTIONAL_USER_OPERATION_REVERTED',
      'INSTITUTIONAL_USER_OPERATION_RECEIPT_MISMATCH',
      'INSTITUTIONAL_USER_OPERATION_SENDER_MISMATCH',
      'INSTITUTIONAL_USER_OPERATION_ENTRY_POINT_MISMATCH',
      'INSTITUTIONAL_USER_OPERATION_CALL_MISMATCH',
    ];
  }

  private async reopenMobileAuthorizationAfterVerifiedChainFailure(applicationId: string) {
    const now = new Date();
    return this.applicationModel.findOneAndUpdate(
      {
        _id: this.toObjectId(applicationId),
        status: 'CHAIN_FAILED',
        mobileAuthorizationUserOpHash: { $exists: true, $ne: null },
        chainLastError: { $in: this.reissuableMobileAuthorizationFailureCodes() },
      },
      {
        $set: {
          status: 'PENDING_MOBILE_AUTHORIZATION',
          mobileAuthorizationRequestedAt: now,
          mobileAuthorizationExpiresAt: null,
          mobileAuthorizationDeliveryNextRetryAt: now,
          mobileAuthorizationDeliveryLastError: null,
          mobileAuthorizationDeliveryLockedUntil: null,
        },
        $unset: {
          chainStatus: '',
          chainTxHash: '',
          chainAttempts: '',
          chainNextRetryAt: '',
          chainLastError: '',
          chainLockedAt: '',
          chainLockedUntil: '',
          chainConfirmedAt: '',
          mobileAuthorizationDeviceId: '',
          mobileAuthorizationClaimedAt: '',
          mobileAuthorizationSignedAt: '',
          mobileAuthorizationUserOpHash: '',
          mobileAuthorizationTxHash: '',
        },
      },
      { returnDocument: 'after' },
    );
  }

  private async recordMobileAuthorizationNotice(
    app: InstitutionalAdminApplicationDocument,
    tenant: InstitutionalTenantDocument,
    requester: any,
    session?: ClientSession,
  ) {
    if (app.mobileAuthorizationNotificationId) {
      const existingQuery = this.notificationLogModel.findById(app.mobileAuthorizationNotificationId);
      if (session && typeof existingQuery.session === 'function') {
        existingQuery.session(session);
      }
      const existing = await existingQuery;
      if (existing) return existing;
    }

    const primaryQuery = this.assignmentModel
      .findOne({
        tenantId: tenant._id,
        institutionalRole: 'PRIMARY',
        active: true,
        status: 'APPROVED',
      });
    if (session && typeof primaryQuery.session === 'function') {
      primaryQuery.session(session);
    }
    const primary = await primaryQuery.lean();
    if (!primary?.userId) {
      throw new ConflictException('La institución no tiene administrador principal vigente para autorizar desde el teléfono');
    }

    const deduplicationKey = `institutional-mobile-authorization:${String(app._id)}`;
    const action = this.resolveMobileAuthorizationAction(app);
    const isRemoval = action === 'REMOVE_AUTHORIZED_ADDRESS';
    const isTransfer = action === 'CHANGE_INSTITUTION_ADMIN';
    const notificationQuery = this.notificationLogModel.findOneAndUpdate(
      { 'data.deduplicationKey': deduplicationKey },
      {
        $setOnInsert: {
          type: 'generic',
          topic: `user_${String(primary.userId)}`,
          title: 'Autorización pendiente',
          body: isTransfer
            ? `Revisa esta solicitud de ${tenant.name}.`
            : isRemoval
            ? `Revisa esta solicitud de ${tenant.name}.`
            : `Revisa esta solicitud de ${tenant.name}.`,
          data: {
            type: 'MOBILE_AUTHORIZATION_REQUESTED',
            event: 'MOBILE_AUTHORIZATION_REQUESTED',
            applicationId: String(app._id),
            tenantId: String(tenant._id),
            targetUserId: app.userId ? String(app.userId) : null,
            action,
            requesterId: requester?.sub ? String(requester.sub) : null,
            deduplicationKey,
          },
          status: 'PENDING',
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (session && typeof notificationQuery.session === 'function') {
      notificationQuery.session(session);
    }
    try {
      return await notificationQuery;
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error;
      }
      const existingQuery = this.notificationLogModel.findOne({
        'data.deduplicationKey': deduplicationKey,
      });
      if (session && typeof existingQuery.session === 'function') {
        existingQuery.session(session);
      }
      return await existingQuery;
    }
  }

  private async resolveMobileAuthorizationContext(app: InstitutionalAdminApplicationDocument) {
    if (!app.tenantId || !app.userId) {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_CONTEXT_INCOMPLETE', message: 'La solicitud no tiene institución o persona asociada.' });
    }
    const tenant = await this.tenantModel.findById(app.tenantId);
    if (!tenant) {
      throw new NotFoundException({ code: 'INSTITUTIONAL_TENANT_NOT_FOUND', message: 'Institución no encontrada.' });
    }
    const primaryFilter: Record<string, any> = {
      tenantId: tenant._id,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    };
    const action = this.resolveMobileAuthorizationAction(app);
    const isCompletedPrimaryTransfer =
      action === 'CHANGE_INSTITUTION_ADMIN' &&
      ['APPROVED', 'REVOKED'].includes(String(app.status));
    const isPendingPrimaryTransfer =
      action === 'CHANGE_INSTITUTION_ADMIN' &&
      !['APPROVED', 'REJECTED', 'REVOKED'].includes(String(app.status));
    if (isCompletedPrimaryTransfer) {
      const historicalSigner = await this.resolveHistoricalPrimaryTransferSigner(app, tenant._id);
      return { tenant, primary: historicalSigner };
    }
    if (isPendingPrimaryTransfer) {
      if (!app.approvedBy) {
        throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_SIGNER_NOT_FOUND', message: 'La transferencia no tiene administrador principal firmante.' });
      }
      if (!app.initiatedByAssignmentId || !app.initiatedByWallet) {
        throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_INITIATOR_NOT_BOUND', message: 'La transferencia no conserva el administrador principal que la inició.' });
      }
      primaryFilter._id = app.initiatedByAssignmentId;
      primaryFilter.userId = app.approvedBy;
    }
    const primary = await this.assignmentModel.findOne(primaryFilter).lean();
    if (!primary?.accountAddress) {
      throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_SIGNER_NOT_FOUND', message: 'La institución no tiene administrador principal vigente.' });
    }
    if (isPendingPrimaryTransfer) {
      if (
        this.normalizeAccountAddressForComparison(String(primary.accountAddress)) !==
        this.normalizeAccountAddressForComparison(String(app.initiatedByWallet))
      ) {
        throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_INITIATOR_WALLET_CHANGED', message: 'La billetera del administrador principal cambió durante la transferencia.' });
      }
      await this.assertPendingPrimaryTransferTargetStillEligible(app);
    }
    return { tenant, primary };
  }

  /**
   * A completed primary-transfer request belongs to the PRIMARY that was bound
   * when it was created, not to the person who became PRIMARY as its result.
   * This is used only to read that request's terminal state; every mutating
   * method still rejects terminal requests before a new operation can be sent.
   */
  private async resolveHistoricalPrimaryTransferSigner(
    app: InstitutionalAdminApplicationDocument,
    tenantId: Types.ObjectId,
  ) {
    if (!app.approvedBy || !app.initiatedByAssignmentId || !app.initiatedByWallet) {
      throw new ConflictException({
        code: 'INSTITUTIONAL_PRIMARY_TRANSFER_INITIATOR_NOT_BOUND',
        message: 'La transferencia no conserva el administrador principal que la inició.',
      });
    }
    const signer = await this.assignmentModel.findOne({
      _id: app.initiatedByAssignmentId,
      tenantId,
      userId: app.approvedBy,
    }).lean();
    if (
      !signer?.accountAddress ||
      this.normalizeAccountAddressForComparison(String(signer.accountAddress)) !==
        this.normalizeAccountAddressForComparison(String(app.initiatedByWallet))
    ) {
      throw new ConflictException({
        code: 'INSTITUTIONAL_PRIMARY_TRANSFER_INITIATOR_WALLET_CHANGED',
        message: 'La billetera del administrador principal cambió durante la transferencia.',
      });
    }
    return signer;
  }

  private async assertPendingPrimaryTransferTargetStillEligible(
    app: InstitutionalAdminApplicationDocument,
  ) {
    if (!app.targetAssignmentId || !app.userId) {
      throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_TARGET_NOT_FOUND', message: 'La transferencia no tiene persona destino válida.' });
    }
    const target = await this.assignmentModel.findOne({
      _id: app.targetAssignmentId,
      tenantId: app.tenantId,
      userId: app.userId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
    }).lean();
    if (!target?.accountAddress) {
      throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_TARGET_NOT_ELIGIBLE', message: 'La persona destino ya no puede recibir el rol principal.' });
    }
    if (
      this.normalizeAccountAddressForComparison(String(target.accountAddress)) !==
      this.normalizeAccountAddressForComparison(String(app.accountAddress))
    ) {
      throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_TARGET_WALLET_CHANGED', message: 'La billetera destino cambió durante la transferencia.' });
    }
  }

  private resolveMobileAuthorizationExpiresAt(app: InstitutionalAdminApplicationDocument) {
    const explicit = app.mobileAuthorizationExpiresAt;
    if (explicit instanceof Date && Number.isFinite(explicit.getTime())) return explicit;
    const base = app.mobileAuthorizationRequestedAt ?? app.approvedAt ?? (app as any).createdAt ?? new Date();
    return new Date(new Date(base).getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  private getMobileAuthorizationStatus(app: InstitutionalAdminApplicationDocument) {
    const expiresAt = this.resolveMobileAuthorizationExpiresAt(app);
    return app.status === 'PENDING_MOBILE_AUTHORIZATION' && expiresAt.getTime() <= Date.now()
      ? 'MOBILE_AUTHORIZATION_EXPIRED'
      : app.status;
  }

  private async expireMobileAuthorizationIfNeeded(app: InstitutionalAdminApplicationDocument) {
    const expiresAt = this.resolveMobileAuthorizationExpiresAt(app);
    if (app.status === 'PENDING_MOBILE_AUTHORIZATION' && expiresAt.getTime() <= Date.now()) {
      // CAS prevents an expiration request that loaded an old snapshot from
      // overwriting a concurrent submission.
      const expired = await this.applicationModel.findOneAndUpdate(
        {
          _id: app._id,
          status: 'PENDING_MOBILE_AUTHORIZATION',
          mobileAuthorizationUserOpHash: null,
        },
        {
          $set: {
            status: 'MOBILE_AUTHORIZATION_EXPIRED',
            mobileAuthorizationExpiresAt: expiresAt,
            reason: 'Autorización móvil vencida.',
          },
        },
        { returnDocument: 'after' },
      );
      if (expired) {
        app.status = expired.status;
        app.reason = expired.reason;
        app.mobileAuthorizationExpiresAt = expired.mobileAuthorizationExpiresAt;
        return 'MOBILE_AUTHORIZATION_EXPIRED';
      }
    }
    return app.status;
  }

  private assertMobileSignerWallet(expectedWallet: string, receivedWallet: string) {
    const expected = this.normalizeAccountAddressForComparison(expectedWallet);
    const received = this.normalizeAccountAddressForComparison(receivedWallet);
    if (!expected || !received || expected !== received) {
      throw new ForbiddenException({ code: 'INSTITUTIONAL_AUTHORIZATION_WALLET_MISMATCH', message: 'La billetera del teléfono no corresponde al administrador principal.' });
    }
  }

  private assertMobileAuthUserMatches(primary: any, authUser?: InstitutionalMobileRequestUser) {
    if (!authUser?.smartAccountAddress) {
      throw new UnauthorizedException({
        code: 'INSTITUTIONAL_MOBILE_AUTH_REQUIRED',
        message: 'La autorización móvil requiere credencial vigente.',
      });
    }
    if (primary?.userId && String(primary.userId) !== String(authUser.sub)) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_AUTHORIZATION_SIGNER_MISMATCH',
        message: 'La credencial móvil no corresponde al administrador principal.',
      });
    }
    this.assertMobileSignerWallet(String(primary.accountAddress), authUser.smartAccountAddress);
  }

  private assertMobileInvitationAuthUserMatches(
    invitation: InstitutionalAdminInvitationDocument,
    authUser?: InstitutionalInvitationMobileRequestUser,
  ) {
    if (
      !authUser?.sub ||
      !authUser?.invitationId ||
      !authUser?.mobileAuthContextHash ||
      authUser.invitationId !== String(invitation._id) ||
      authUser.dni !== invitation.dni
    ) {
      throw new UnauthorizedException({
        code: 'INSTITUTIONAL_INVITATION_MOBILE_AUTH_REQUIRED',
        message: 'La invitación requiere credencial móvil vigente.',
      });
    }
    if (
      !authUser.smartAccountAddress ||
      authUser.smartAccountAddress.toLowerCase() !== String(invitation.accountAddress).toLowerCase()
    ) {
      throw new ForbiddenException({
        code: 'INSTITUTIONAL_INVITATION_WALLET_MISMATCH',
        message: 'La billetera del teléfono no corresponde a la invitación.',
      });
    }
  }

  private assertSameMobileDevice(app: InstitutionalAdminApplicationDocument, deviceId: string) {
    const current = String(app.mobileAuthorizationDeviceId || '').trim();
    const incoming = String(deviceId || '').trim();
    if (!current || !incoming || current !== incoming) {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_DEVICE_MISMATCH', message: 'La autorización pertenece a otro dispositivo.' });
    }
  }

  private async completeMobileAuthorizationFromNetwork(app: InstitutionalAdminApplicationDocument) {
    if (!app.tenantId || !app.userId) {
      throw new ConflictException({ code: 'INSTITUTIONAL_AUTHORIZATION_CONTEXT_INCOMPLETE', message: 'La solicitud no tiene institución o persona asociada.' });
    }
    const session = await this.applicationModel.db.startSession();
    try {
      await session.withTransaction(async () => {
        const fresh = await this.getApplicationOrThrow(String(app._id), session);
        const action = this.resolveMobileAuthorizationAction(fresh);
        if (fresh.chainStatus === 'CONFIRMED' && ['APPROVED', 'REVOKED'].includes(String(fresh.status))) return;
        if (['APPROVED', 'REJECTED', 'REVOKED'].includes(String(fresh.status))) return;
        if (action === 'CHANGE_INSTITUTION_ADMIN') {
          if (!fresh.targetAssignmentId || !fresh.approvedBy) {
            throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_CONTEXT_INCOMPLETE', message: 'La transferencia no tiene relaciones completas.' });
          }
          const now = new Date();
          const previousPrimary = await this.assignmentModel.updateOne(
            {
              tenantId: fresh.tenantId,
              userId: fresh.approvedBy,
              institutionalRole: 'PRIMARY',
              status: 'APPROVED',
              active: true,
            },
            {
              $set: {
                institutionalRole: 'SECONDARY',
                approvedAt: now,
                reason: fresh.reason ?? null,
              },
            },
            { session },
          );
          if (previousPrimary.modifiedCount !== 1) {
            throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_STALE', message: 'El administrador principal cambió durante la transferencia.' });
          }
          const promoted = await this.assignmentModel.updateOne(
            {
              _id: fresh.targetAssignmentId,
              tenantId: fresh.tenantId,
              userId: fresh.userId,
              institutionalRole: 'SECONDARY',
              status: 'APPROVED',
              active: true,
              accountAddress: { $nin: [null, ''] },
            },
            {
              $set: {
                institutionalRole: 'PRIMARY',
                approvedAt: now,
                approvedBy: fresh.approvedBy,
                rejectedAt: null,
                revokedAt: null,
                reason: fresh.reason ?? null,
              },
            },
            { session },
          );
          if (promoted.modifiedCount !== 1) {
            throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_TARGET_NOT_ELIGIBLE', message: 'La persona destino ya no puede recibir el rol principal.' });
          }
          const primaryCount = await this.assignmentModel.countDocuments({
            tenantId: fresh.tenantId,
            institutionalRole: 'PRIMARY',
            status: 'APPROVED',
            active: true,
          }).session(session);
          if (primaryCount !== 1) {
            throw new ConflictException({ code: 'INSTITUTIONAL_PRIMARY_TRANSFER_INCONSISTENT', message: 'La transferencia no dejó exactamente un administrador principal.' });
          }
          fresh.status = 'APPROVED' as any;
        } else if (action === 'REMOVE_AUTHORIZED_ADDRESS') {
          const revokedAt = new Date();
          const assignment = await this.assignmentModel.findOne({
            _id: fresh.targetAssignmentId ?? undefined,
            tenantId: fresh.tenantId,
            userId: fresh.userId,
            institutionalRole: 'SECONDARY',
          }).session(session);
          await this.assignmentModel.updateOne(
            {
              _id: fresh.targetAssignmentId ?? undefined,
              tenantId: fresh.tenantId,
              userId: fresh.userId,
              institutionalRole: 'SECONDARY',
            },
            {
              $set: {
                status: 'REVOKED',
                active: false,
                revokedAt,
                reason: fresh.reason ?? 'Acceso eliminado después de confirmación de red.',
              },
            },
            { session },
          );
          if (assignment?.applicationId && String(assignment.applicationId) !== String(fresh._id)) {
            await this.applicationModel.updateOne(
              {
                _id: assignment.applicationId,
                tenantId: fresh.tenantId,
                userId: fresh.userId,
                status: 'APPROVED',
              },
              {
                $set: {
                  status: 'REVOKED',
                  revokedAt,
                  reason: fresh.reason ?? 'Acceso eliminado después de confirmación de red.',
                },
              },
              { session },
            );
          }
          fresh.status = 'REVOKED' as any;
        } else {
          await this.assignmentModel.updateOne(
            { tenantId: fresh.tenantId, userId: fresh.userId },
            {
              $set: {
                status: 'APPROVED',
                active: true,
                institutionalRole: 'SECONDARY',
                accountAddress: fresh.accountAddress,
                accountAddressNormalized: normalizeTenantWalletAddress(fresh.accountAddress)?.toLowerCase(),
                approvedAt: fresh.approvedAt ?? new Date(),
                rejectedAt: null,
                revokedAt: null,
                reason: null,
                walletVerifiedAt: fresh.approvedAt ?? new Date(),
                walletVerificationSource: 'IDENTITY',
              },
            },
            { upsert: true, session },
          );
          await this.roledUserModel.updateOne({ _id: fresh.userId }, { $set: { active: true } }, { session });
          fresh.status = 'APPROVED' as any;
        }
        fresh.chainStatus = 'CONFIRMED';
        fresh.chainConfirmedAt = fresh.chainConfirmedAt ?? new Date();
        fresh.chainLastError = undefined;
        fresh.chainNextRetryAt = undefined;
        fresh.chainLockedAt = undefined;
        fresh.chainLockedUntil = undefined;
        await fresh.save({ session });
        await this.syncUserActiveState(fresh.userId as Types.ObjectId, session);
        if (action === 'CHANGE_INSTITUTION_ADMIN' && fresh.approvedBy) {
          await this.syncUserActiveState(fresh.approvedBy as Types.ObjectId, session);
        }
      });
    } finally {
      await session.endSession();
    }
  }

  private async isMobileAuthorizationConfirmedOnNetwork(
    app: InstitutionalAdminApplicationDocument,
    stableInstitutionId: string,
    targetWallet: string,
  ) {
    if (this.resolveMobileAuthorizationAction(app) === 'CHANGE_INSTITUTION_ADMIN') {
      const admin = await VoteContractReads.getInstitutionAdmin(this.chain, stableInstitutionId);
      return this.normalizeAccountAddressForComparison(String(admin || '')) ===
        this.normalizeAccountAddressForComparison(targetWallet);
    }
    const currentAuthorization = await VoteContractReads.isAuthorizedAddress(
      this.chain,
      stableInstitutionId,
      targetWallet as Hex,
    );
    return currentAuthorization === this.expectedNetworkAuthorizationState(app);
  }

  private toMobileAuthorizationResponse(app: any, tenant: any, primary: any, status: string) {
    const action = this.resolveMobileAuthorizationAction(app);
    const functionalStatus = this.resolveApplicationFunctionalStatus({ ...app, status });
    return {
      requestId: String(app._id),
      applicationId: String(app._id),
      tenantId: app.tenantId ? String(app.tenantId) : null,
      institutionName: tenant?.name ?? app.institutionName,
      stableInstitutionId: app.stableInstitutionId ?? null,
      requesterName: app.name,
      requesterDni: app.dni,
      targetWallet: app.accountAddress,
      signerWallet: primary?.accountAddress ?? null,
      action,
      status,
      expiresAt: this.resolveMobileAuthorizationExpiresAt(app).toISOString(),
      userOpHash: app.mobileAuthorizationUserOpHash ?? null,
      txHash: app.mobileAuthorizationTxHash ?? app.chainTxHash ?? null,
      safeMessage: app.chainLastError ?? null,
      functionalStatus: functionalStatus.code,
      functionalStatusLabel: functionalStatus.label,
      canSign: status === 'PENDING_MOBILE_AUTHORIZATION',
    };
  }

  private resolveMobileAuthorizationAction(app: any) {
    if (app?.mobileAuthorizationAction === 'REMOVE_AUTHORIZED_ADDRESS') {
      return 'REMOVE_AUTHORIZED_ADDRESS';
    }
    if (app?.mobileAuthorizationAction === 'CHANGE_INSTITUTION_ADMIN') {
      return 'CHANGE_INSTITUTION_ADMIN';
    }
    return 'ADD_AUTHORIZED_ADDRESS';
  }

  private expectedNetworkAuthorizationState(app: any) {
    return this.resolveMobileAuthorizationAction(app) === 'REMOVE_AUTHORIZED_ADDRESS'
      ? false
      : true;
  }

  private resolveRequesterObjectId(requester: any): Types.ObjectId | null {
    const sub = requester?.sub ? String(requester.sub) : '';
    return Types.ObjectId.isValid(sub) ? new Types.ObjectId(sub) : null;
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
      throw new ConflictException({
        code: 'ADMIN_EMAIL_OR_DNI_ALREADY_EXISTS',
        message: 'Ya existe un usuario con ese email o DNI',
      });
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

  private toAuthorizationRetryResponse(row: any) {
    const application = this.toApplicationResponse(row);
    const hasTxHash = Boolean(row?.chainTxHash);
    let outcome = 'PENDING';
    let retryable = false;
    let message = 'La operación fue enviada y está pendiente de confirmación.';

    if (row?.status === 'APPROVED' && row?.chainStatus === 'CONFIRMED') {
      outcome = 'APPROVED';
      retryable = false;
      message = 'La autorización fue completada correctamente.';
    } else if (row?.status === 'CHAIN_RETRY_PENDING') {
      outcome = 'RETRYABLE_FAILURE';
      retryable = true;
      message = row?.chainLastError ?? 'No pudimos completar la autorización. Corrige la causa e inténtalo nuevamente.';
    } else if (row?.status === 'CHAIN_FAILED') {
      retryable = !hasTxHash;
      outcome = retryable ? 'RETRYABLE_FAILURE' : 'FINAL_FAILURE';
      message = row?.chainLastError ?? 'No fue posible completar la autorización.';
    } else if (row?.status === 'PENDING_MOBILE_AUTHORIZATION') {
      outcome = 'PENDING';
      retryable = true;
      message = 'La autorización está pendiente de firma en el teléfono del administrador principal.';
    } else if (['PENDING_CHAIN_CONFIRMATION', 'RECONCILIATION_PENDING'].includes(String(row?.status))) {
      outcome = 'PENDING';
      retryable = !hasTxHash || row?.status === 'RECONCILIATION_PENDING';
      message = hasTxHash
        ? 'La operación fue enviada y está pendiente de confirmación.'
        : 'La autorización sigue pendiente de envío a la red.';
    }

    return {
      ...application,
      application,
      outcome,
      retryable,
      message,
    };
  }

  private toApplicationResponse(row: any) {
    const functionalStatus = this.resolveApplicationFunctionalStatus(row);
    return {
      id: String(row._id),
      dni: row.dni,
      email: row.email,
      name: row.name,
      institutionName: row.institutionName,
      accountAddress: row.accountAddress,
      status: row.status,
      functionalStatus: functionalStatus.code,
      functionalStatusLabel: functionalStatus.label,
      emailVerifiedAt: row.emailVerifiedAt ?? null,
      approvedAt: row.approvedAt ?? null,
      rejectedAt: row.rejectedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      reason: row.reason ?? null,
      tenantId: row.tenantId ? String(row.tenantId) : null,
      userId: row.userId ? String(row.userId) : null,
      stableInstitutionId: row.stableInstitutionId ?? null,
      chainStatus: row.chainStatus ?? null,
      chainAttempts: row.chainAttempts ?? 0,
      chainNextRetryAt: row.chainNextRetryAt ?? null,
      chainLastError: row.chainLastError ?? null,
      chainTxHash: row.chainTxHash ?? null,
      chainConfirmedAt: row.chainConfirmedAt ?? null,
      mobileAuthorizationRequestedAt: row.mobileAuthorizationRequestedAt ?? null,
      mobileAuthorizationNotificationId: row.mobileAuthorizationNotificationId
        ? String(row.mobileAuthorizationNotificationId)
        : null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  }

  private resolveApplicationFunctionalStatus(row: any) {
    switch (row?.status) {
      case 'PENDING_APPROVAL':
        return { code: 'PENDING_REVIEW', label: 'Pendiente de revisión' };
      case 'PENDING_MOBILE_AUTHORIZATION':
        return { code: 'PENDING_MOBILE_SIGNATURE', label: 'Pendiente de firma en tu teléfono' };
      case 'PENDING_CHAIN_CONFIRMATION':
      case 'RECONCILIATION_PENDING':
        return { code: 'PROCESSING_AUTHORIZATION', label: 'Procesando autorización' };
      case 'CHAIN_RETRY_PENDING':
        return { code: 'RECOVERABLE_ERROR', label: 'Error recuperable' };
      case 'APPROVED':
        return { code: 'ACCESS_ENABLED', label: 'Acceso habilitado' };
      case 'REJECTED':
        return { code: 'REJECTED', label: 'Rechazado' };
      case 'MOBILE_AUTHORIZATION_EXPIRED':
        return { code: 'EXPIRED', label: 'Vencido' };
      case 'REVOKED':
        return { code: 'ACCESS_REMOVED', label: 'Acceso eliminado' };
      default:
        return { code: row?.status ?? 'UNKNOWN', label: row?.status ?? 'UNKNOWN' };
    }
  }

  private toInvitationResponse(row: any) {
    return {
      id: String(row._id),
      tenantId: row.tenantId ? String(row.tenantId) : null,
      dni: row.dni,
      name: row.name,
      status: row.status,
      expiresAt: row.expiresAt ?? null,
      acceptedAt: row.acceptedAt ?? null,
      rejectedAt: row.rejectedAt ?? null,
      cancelledAt: row.cancelledAt ?? null,
      applicationId: row.applicationId ? String(row.applicationId) : null,
      noticeCount: row.noticeCount ?? 0,
      lastNoticeAt: row.lastNoticeAt ?? null,
      reason: row.reason ?? null,
    };
  }
}
