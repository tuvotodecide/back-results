import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { InstitutionalEmailOutboxService } from '@/modules/mail/institutional-email-outbox.service';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  CreateInstitutionalAccessRecoveryRequestDto,
  RejectInstitutionalAccessRecoveryRequestDto,
  ResolveInstitutionalAccessRecoveryRequestDto,
} from '../dto/institutional-access-recovery-request.dto';
import {
  InstitutionalAccessRecoveryRequest,
  InstitutionalAccessRecoveryRequestDocument,
} from '../schemas/institutional-access-recovery-request.schema';

type RecoveryCandidate = {
  user?: any;
  assignment?: any;
  warnings: string[];
};

@Injectable()
export class InstitutionalAccessRecoveryRequestsService {
  constructor(
    @InjectModel(InstitutionalAccessRecoveryRequest.name)
    private readonly recoveryRequestModel: Model<InstitutionalAccessRecoveryRequestDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    private readonly emailOutboxService: InstitutionalEmailOutboxService,
    private readonly configService: ConfigService,
    private readonly auditService: InstitutionalAuditService,
  ) {}

  async createRequest(dto: CreateInstitutionalAccessRecoveryRequestDto) {
    const tenantId = this.toObjectIdOrBadRequest(dto.institutionId, 'institutionId invalido');
    const fullName = this.normalizeHumanText(dto.fullName);
    const phoneNumber = this.normalizePhone(dto.phoneNumber);
    const supervisorPhoneNumber = this.normalizePhone(dto.supervisorPhoneNumber);
    const newEmail = dto.newEmail.trim().toLowerCase();

    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || tenant.active !== true) {
      throw new BadRequestException('No se pudo registrar la solicitud de recuperacion');
    }

    await this.assertEmailAvailableForRequest(newEmail);
    await this.assertNoPendingDuplicate(tenantId, newEmail);

    const candidate = await this.resolveCandidate(tenantId, fullName);
    if (candidate.user?.email?.trim().toLowerCase() === newEmail) {
      throw new ConflictException('No se pudo registrar la solicitud con esos datos');
    }

    const request = await this.recoveryRequestModel.create({
      tenantId,
      institutionName: tenant.name,
      fullName,
      phoneNumber,
      newEmail,
      supervisorPhoneNumber,
      status: 'PENDING',
      requestedAt: new Date(),
      candidateUserId: candidate.user?._id ?? null,
      candidateAssignmentId: candidate.assignment?._id ?? null,
      currentEmail: candidate.user?.email ?? null,
      accountAddress: candidate.assignment?.accountAddress ?? null,
      institutionalRole: candidate.assignment?.institutionalRole ?? null,
      warnings: candidate.warnings,
    });
    await this.auditService.record({
      tenantId,
      actor: null,
      action: 'INSTITUTIONAL_RECOVERY_REQUEST_CREATED',
      targetType: 'InstitutionalAccessRecoveryRequest',
      targetId: request._id,
      targetUserId: candidate.user?._id ?? null,
      assignmentId: candidate.assignment?._id ?? null,
      recoveryRequestId: request._id,
      newState: {
        status: request.status,
        candidateResolved: Boolean(candidate.user && candidate.assignment),
        warnings: candidate.warnings,
      },
    });

    return {
      requestId: String(request._id),
      status: request.status,
      requestedAt: request.requestedAt,
    };
  }

  async listRequests(requester: any, status?: string) {
    this.assertAdmin(requester);
    const query: Record<string, unknown> = {};
    if (status) {
      query.status = status;
    }
    const requests = await this.recoveryRequestModel
      .find(query)
      .sort({ requestedAt: -1, _id: -1 })
      .lean();
    return {
      data: requests.map((request) => this.toListResponse(request)),
      total: requests.length,
    };
  }

  async getRequestDetail(requestId: string, requester: any) {
    this.assertAdmin(requester);
    const request = await this.getRequestOrThrow(requestId);
    return this.toDetailResponse(request);
  }

  async approveRequest(
    requestId: string,
    dto: ResolveInstitutionalAccessRecoveryRequestDto,
    requester: any,
  ) {
    this.assertAdmin(requester);
    const requestObjectId = this.toObjectIdOrBadRequest(requestId, 'requestId invalido');
    const targetUserId = this.toObjectIdOrBadRequest(dto.targetUserId, 'targetUserId invalido');
    const targetAssignmentId = this.toObjectIdOrBadRequest(
      dto.targetAssignmentId,
      'targetAssignmentId invalido',
    );
    const actorId = this.resolveRequesterObjectId(requester);

    const session = await this.recoveryRequestModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        response = await this.approveRequestInTransaction(
          requestObjectId,
          targetUserId,
          targetAssignmentId,
          actorId,
          dto.reason,
          session,
        );
      });
      await this.emailOutboxService.processPendingBatch?.(1);
      return response;
    } finally {
      await session.endSession();
    }
  }

  async rejectRequest(
    requestId: string,
    dto: RejectInstitutionalAccessRecoveryRequestDto,
    requester: any,
  ) {
    this.assertAdmin(requester);
    const requestObjectId = this.toObjectIdOrBadRequest(requestId, 'requestId invalido');
    const session = await this.recoveryRequestModel.db.startSession();
    try {
      let response: any;
      await session.withTransaction(async () => {
        const request = await this.recoveryRequestModel.findById(requestObjectId).session(session);
        if (!request) {
          throw new NotFoundException('Solicitud de recuperacion no encontrada');
        }
        if (request.status !== 'PENDING') {
          throw new ConflictException('La solicitud de recuperacion ya fue resuelta');
        }

        request.status = 'REJECTED';
        request.resolvedAt = new Date();
        request.resolvedBy = this.resolveRequesterObjectId(requester);
        request.resolutionReason = dto.reason?.trim() || null;
        await request.save({ session });
        await this.auditService.record({
          tenantId: request.tenantId,
          actor: requester,
          action: 'INSTITUTIONAL_RECOVERY_REJECTED',
          targetType: 'InstitutionalAccessRecoveryRequest',
          targetId: request._id,
          targetUserId: request.candidateUserId ?? null,
          assignmentId: request.candidateAssignmentId ?? null,
          recoveryRequestId: request._id,
          previousState: { status: 'PENDING' },
          newState: { status: request.status },
          reason: request.resolutionReason ?? null,
          session,
        });
        response = this.toListResponse(request);
      });
      return response;
    } finally {
      await session.endSession();
    }
  }

  private async approveRequestInTransaction(
    requestId: Types.ObjectId,
    targetUserId: Types.ObjectId,
    targetAssignmentId: Types.ObjectId,
    actorId: Types.ObjectId | null,
    reason: string | undefined,
    session: ClientSession,
  ) {
    const request = await this.recoveryRequestModel.findById(requestId).session(session);
    if (!request) {
      throw new NotFoundException('Solicitud de recuperacion no encontrada');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('La solicitud de recuperacion ya fue resuelta');
    }

    const [tenant, user, assignment, emailOwner] = await Promise.all([
      this.tenantModel.findById(request.tenantId).session(session).lean(),
      this.roledUserModel.findById(targetUserId).session(session),
      this.assignmentModel.findOne({ _id: targetAssignmentId, tenantId: request.tenantId }).session(session).lean(),
      this.roledUserModel.findOne({ email: request.newEmail }).session(session).lean(),
    ]);

    if (!tenant) {
      throw new NotFoundException('Institucion no encontrada');
    }
    if (!user) {
      throw new NotFoundException('Usuario objetivo no encontrado');
    }
    if (!assignment || String(assignment.userId) !== String(user._id)) {
      throw new ConflictException('La relacion institucional objetivo no es coherente');
    }
    if (emailOwner && String(emailOwner._id) !== String(user._id)) {
      throw new ConflictException('El nuevo correo ya esta registrado por otro usuario');
    }
    if (user.email.trim().toLowerCase() === request.newEmail) {
      throw new ConflictException('El nuevo correo debe ser distinto del correo actual');
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(
      Date.now() +
        1000 * 60 * 60 * this.configService.get<number>('app.mail.passwordResetTokenTTLHours', 2),
    );
    const previousEmail = user.email;

    user.email = request.newEmail;
    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiresAt = resetTokenExpiresAt;
    user.authVersion = (user.authVersion ?? 0) + 1;
    await user.save({ session });

    request.status = 'APPROVED';
    request.resolvedAt = new Date();
    request.resolvedBy = actorId;
    request.resolutionReason = reason?.trim() || null;
    request.candidateUserId = user._id;
    request.candidateAssignmentId = assignment._id;
    request.currentEmail = previousEmail;
    request.accountAddress = assignment.accountAddress ?? null;
    request.institutionalRole = assignment.institutionalRole ?? null;
    await request.save({ session });
    await this.auditService.record({
      tenantId: request.tenantId,
      actor: { sub: actorId ? String(actorId) : undefined, role: 'ADMIN' },
      action: 'INSTITUTIONAL_RECOVERY_APPROVED',
      targetType: 'InstitutionalAccessRecoveryRequest',
      targetId: request._id,
      targetUserId: user._id,
      assignmentId: assignment._id,
      recoveryRequestId: request._id,
      previousState: { status: 'PENDING', userEmailChanged: false },
      newState: {
        status: request.status,
        userEmailChanged: true,
        passwordResetPrepared: true,
        assignmentStatus: assignment.status ?? null,
        assignmentActive: assignment.active ?? null,
        institutionalRole: assignment.institutionalRole ?? null,
      },
      reason: request.resolutionReason ?? null,
      session,
    });

    await this.sendPasswordResetEmail(user.email, user.name, user._id, session);

    return {
      requestId: String(request._id),
      status: request.status,
      tenantId: String(request.tenantId),
      userId: String(user._id),
      assignmentId: String(assignment._id),
      resolvedAt: request.resolvedAt,
    };
  }

  private async resolveCandidate(
    tenantId: Types.ObjectId,
    fullName: string,
  ): Promise<RecoveryCandidate> {
    const assignments = await this.assignmentModel.find({ tenantId }).lean();
    if (!assignments.length) {
      return { warnings: ['NO_ASSIGNMENTS'] as string[] };
    }

    const userIds = assignments.map((assignment) => assignment.userId);
    const users = await this.roledUserModel
      .find({ _id: { $in: userIds } }, { _id: 1, name: 1, email: 1 })
      .lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));
    const normalizedFullName = this.normalizeNameForMatch(fullName);
    const matches = assignments
      .map((assignment) => ({
        assignment,
        user: usersById.get(String(assignment.userId)),
      }))
      .filter((entry) =>
        entry.user?.name
          ? this.normalizeNameForMatch(entry.user.name) === normalizedFullName
          : false,
      );

    if (matches.length === 1) {
      return { ...matches[0], warnings: [] as string[] };
    }

    return {
      warnings: [matches.length > 1 ? 'AMBIGUOUS_CANDIDATE' : 'NO_CANDIDATE'],
    };
  }

  private async assertEmailAvailableForRequest(newEmail: string) {
    const existing = await this.roledUserModel.findOne({ email: newEmail }).lean();
    if (existing) {
      throw new ConflictException('No se pudo registrar la solicitud con esos datos');
    }
  }

  private async assertNoPendingDuplicate(tenantId: Types.ObjectId, newEmail: string) {
    const existing = await this.recoveryRequestModel
      .findOne({ tenantId, newEmail, status: 'PENDING' })
      .lean();
    if (existing) {
      throw new ConflictException('Ya existe una solicitud de recuperacion pendiente');
    }
  }

  private async getRequestOrThrow(requestId: string) {
    const objectId = this.toObjectIdOrBadRequest(requestId, 'requestId invalido');
    const request = await this.recoveryRequestModel.findById(objectId);
    if (!request) {
      throw new NotFoundException('Solicitud de recuperacion no encontrada');
    }
    return request;
  }

  private assertAdmin(requester: any) {
    if (requester?.role !== 'ADMIN') {
      throw new ForbiddenException('Solo un administrador global puede revisar recuperaciones');
    }
  }

  private async sendPasswordResetEmail(
    to: string,
    name: string,
    userId: Types.ObjectId,
    session: ClientSession,
  ) {
    const resetBaseUrl = this.configService.get<string>('app.mail.passwordResetBaseUrl');
    if (!resetBaseUrl) {
      throw new Error('Base URL no configurada');
    }
    if (typeof this.emailOutboxService.enqueueInstitutionalPasswordResetEmail !== 'function') {
      const resetLink = this.buildEmailLink(
        '',
        resetBaseUrl,
        '/votacion/restablecer',
      ).replace('token=', `token=${String(userId)}`);
      await (this.emailOutboxService as any).sendEmail(
        to,
        'Restablecer contraseña',
        'reset-password',
        {
          name: name.split(' ')[0],
          resetLink,
        },
      );
      return;
    }
    await this.emailOutboxService.enqueueInstitutionalPasswordResetEmail({
      recipient: to,
      name,
      targetId: userId,
      session,
    });
  }

  private buildEmailLink(
    token: string,
    baseUrl: string | undefined,
    canonicalPath: string,
  ): string {
    if (!baseUrl) {
      throw new Error('Base URL no configurada');
    }
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

  private toListResponse(request: any) {
    return {
      requestId: String(request._id),
      tenantId: String(request.tenantId),
      institutionName: request.institutionName,
      fullName: request.fullName,
      phoneNumber: request.phoneNumber,
      newEmail: request.newEmail,
      supervisorPhoneNumber: request.supervisorPhoneNumber,
      status: request.status,
      requestedAt: request.requestedAt ?? request.createdAt ?? null,
      resolvedAt: request.resolvedAt ?? null,
    };
  }

  private toDetailResponse(request: any) {
    return {
      ...this.toListResponse(request),
      candidateUserId: request.candidateUserId ? String(request.candidateUserId) : null,
      candidateAssignmentId: request.candidateAssignmentId
        ? String(request.candidateAssignmentId)
        : null,
      currentEmail: request.currentEmail ?? null,
      accountAddress: request.accountAddress ?? null,
      institutionalRole: request.institutionalRole ?? null,
      warnings: request.warnings ?? [],
      resolutionReason: request.resolutionReason ?? null,
    };
  }

  private normalizeHumanText(input: string): string {
    const value = input.trim().replace(/\s+/g, ' ');
    if (!value) {
      throw new BadRequestException('Valor invalido');
    }
    return value;
  }

  private normalizePhone(input: string): string {
    return input.trim().replace(/\s+/g, ' ');
  }

  private normalizeNameForMatch(input: string): string {
    return input.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private resolveRequesterObjectId(requester: any): Types.ObjectId | null {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    return requesterId && Types.ObjectId.isValid(requesterId)
      ? new Types.ObjectId(requesterId)
      : null;
  }

  private toObjectIdOrBadRequest(value: string, message: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(message);
    }
    return new Types.ObjectId(value);
  }
}
