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
  CreateAdminEmailChangeRequestDto,
  ApproveAdminEmailChangeRequestDto,
  RejectInstitutionalAccessRecoveryRequestDto,
  ResolveInstitutionalAccessRecoveryRequestDto,
} from '../dto/institutional-access-recovery-request.dto';
import {
  InstitutionalAccessRecoveryRequest,
  InstitutionalAccessRecoveryRequestDocument,
} from '../schemas/institutional-access-recovery-request.schema';

type RecoveryCandidate = {
  user?: {
    _id: Types.ObjectId;
    name?: string;
    email?: string;
  };
  assignment?: {
    _id: Types.ObjectId;
    tenantId: Types.ObjectId;
    userId: Types.ObjectId;
    accountAddress?: string | null;
    institutionalRole?: string | null;
  };
  warnings: string[];
};

type RecoveryApprovalResponse = {
  requestId: string;
  status: string;
  tenantId: string;
  userId: string;
  assignmentId: string;
  resolvedAt?: Date | null;
};

type RecoveryListItem = {
  requestId: string;
  requestType: string;
  tenantId: string;
  institutionName: string;
  fullName: string;
  phoneNumber: string | null;
  newEmail: string;
  supervisorPhoneNumber: string | null;
  status: string;
  requestedAt?: Date | null;
  resolvedAt?: Date | null;
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
    const newEmail = dto.newEmail.trim().toLowerCase();

    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || tenant.active !== true) {
      throw new BadRequestException('No se pudo registrar la solicitud de recuperacion');
    }

    await this.assertEmailAvailableForRequest(newEmail);
    await this.assertNoPendingDuplicate(tenantId, newEmail);

    const candidate = await this.resolveCandidate(tenantId, fullName);
    if (candidate.user?.email?.trim().toLowerCase() === newEmail) {
      throw new ConflictException({
        code: 'EMAIL_SAME_AS_CURRENT',
        message: 'El nuevo correo debe ser distinto del correo actual',
      });
    }

    let request: InstitutionalAccessRecoveryRequestDocument;
    try {
      request = await this.recoveryRequestModel.create({
        tenantId,
        institutionName: tenant.name,
        fullName,
        phoneNumber: null,
        newEmail,
        supervisorPhoneNumber: null,
        status: 'PENDING',
        requestedAt: new Date(),
        candidateUserId: candidate.user?._id ?? null,
        candidateAssignmentId: candidate.assignment?._id ?? null,
        currentEmail: candidate.user?.email ?? null,
        accountAddress: candidate.assignment?.accountAddress ?? null,
        institutionalRole: candidate.assignment?.institutionalRole ?? null,
        warnings: candidate.warnings,
      });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'RECOVERY_REQUEST_ALREADY_PENDING',
          message: 'Ya existe una solicitud de recuperacion pendiente',
        });
      }
      throw error;
    }
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

  async createEmailChangeRequest(dto: CreateAdminEmailChangeRequestDto, requester: any) {
    const requesterId = this.resolveRequesterObjectId(requester);
    if (!requesterId) {
      throw new ForbiddenException('La solicitud requiere una cuenta autenticada');
    }
    const user = await this.roledUserModel.findById(requesterId).lean();
    if (!user || user.active !== true) {
      throw new ForbiddenException('La cuenta administrativa no está activa');
    }
    const newEmail = this.normalizeEmail(dto.newEmail);
    const currentEmail = String(user.email || '').trim().toLowerCase();
    if (newEmail === currentEmail) {
      throw new ConflictException('El nuevo correo debe ser distinto del correo actual');
    }
    await this.assertEmailAvailableForRequest(
      newEmail,
      'El correo indicado ya pertenece a otra cuenta',
    );
    await this.assertNoPendingEmailChangeForUser(requesterId);

    const assignment = await this.assignmentModel
      .findOne({
        userId: requesterId,
        status: 'APPROVED',
        active: true,
      })
      .sort({ institutionalRole: 1, approvedAt: -1, _id: 1 })
      .lean();
    if (!assignment?.tenantId) {
      throw new ForbiddenException('La cuenta no tiene una relación institucional activa');
    }
    const tenant = await this.tenantModel.findById(assignment.tenantId).lean();
    if (!tenant || tenant.active !== true) {
      throw new ForbiddenException('La institución asociada no está activa');
    }

    const request = await this.recoveryRequestModel.create({
      requestType: 'ADMIN_EMAIL_CHANGE',
      tenantId: tenant._id,
      institutionName: tenant.name,
      fullName: user.name,
      phoneNumber: 'NO_APLICA',
      newEmail,
      supervisorPhoneNumber: 'NO_APLICA',
      status: 'PENDING',
      requestedAt: new Date(),
      candidateUserId: user._id,
      candidateAssignmentId: assignment._id,
      currentEmail,
      accountAddress: assignment.accountAddress ?? null,
      institutionalRole: assignment.institutionalRole ?? null,
      resolutionReason: dto.reason?.trim() || null,
      warnings: [],
    });
    await this.auditService.record({
      tenantId: tenant._id,
      actor: requester,
      action: 'ADMIN_EMAIL_CHANGE_REQUESTED',
      targetType: 'InstitutionalAccessRecoveryRequest',
      targetId: request._id,
      targetUserId: user._id,
      assignmentId: assignment._id,
      recoveryRequestId: request._id,
      previousState: { email: currentEmail },
      newState: { status: request.status, newEmail },
      reason: request.resolutionReason ?? null,
    });

    return {
      requestId: String(request._id),
      status: request.status,
      currentEmail,
      newEmail,
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
      let response: RecoveryApprovalResponse | undefined;
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
      if (!response) {
        throw new Error('La aprobacion no produjo respuesta');
      }
      return response;
    } finally {
      await session.endSession();
    }
  }

  async approveEmailChangeRequest(
    requestId: string,
    dto: ApproveAdminEmailChangeRequestDto,
    requester: any,
  ) {
    this.assertAdmin(requester);
    const requestObjectId = this.toObjectIdOrBadRequest(requestId, 'requestId invalido');
    const actorId = this.resolveRequesterObjectId(requester);
    const session = await this.recoveryRequestModel.db.startSession();
    try {
      let response: RecoveryApprovalResponse | undefined;
      await session.withTransaction(async () => {
        response = await this.approveEmailChangeRequestInTransaction(
          requestObjectId,
          actorId,
          dto.reason,
          session,
        );
      });
      await this.emailOutboxService.processPendingBatch?.(1);
      if (!response) {
        throw new Error('La aprobacion no produjo respuesta');
      }
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
      let response: RecoveryListItem | undefined;
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
          action: request.requestType === 'ADMIN_EMAIL_CHANGE'
            ? 'ADMIN_EMAIL_CHANGE_REJECTED'
            : 'INSTITUTIONAL_RECOVERY_REJECTED',
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
      if (!response) {
        throw new Error('El rechazo no produjo respuesta');
      }
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
  ): Promise<RecoveryApprovalResponse> {
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
    if (
      !request.candidateUserId ||
      !request.candidateAssignmentId ||
      String(request.candidateUserId) !== String(targetUserId) ||
      String(request.candidateAssignmentId) !== String(targetAssignmentId)
    ) {
      throw new ConflictException('La solicitud no corresponde al administrador objetivo');
    }
    if (!assignment || String(assignment.userId) !== String(user._id)) {
      throw new ConflictException('La relacion institucional objetivo no es coherente');
    }
    if (String(assignment.tenantId) !== String(request.tenantId)) {
      throw new ConflictException('La relacion institucional no corresponde a la institucion');
    }
    if ((request.accountAddress ?? null) !== (assignment.accountAddress ?? null)) {
      throw new ConflictException('La wallet institucional cambio durante la recuperacion');
    }
    if ((request.institutionalRole ?? null) !== (assignment.institutionalRole ?? null)) {
      throw new ConflictException('El rol institucional cambio durante la recuperacion');
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
    try {
      await user.save({ session });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_IN_USE',
          message: 'El correo ingresado ya está en uso.',
        });
      }
      throw error;
    }

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

  private async approveEmailChangeRequestInTransaction(
    requestId: Types.ObjectId,
    actorId: Types.ObjectId | null,
    reason: string | undefined,
    session: ClientSession,
  ): Promise<RecoveryApprovalResponse> {
    const request = await this.recoveryRequestModel.findById(requestId).session(session);
    if (!request) {
      throw new NotFoundException('Solicitud de cambio de correo no encontrada');
    }
    if (request.requestType !== 'ADMIN_EMAIL_CHANGE') {
      throw new ConflictException('La solicitud no corresponde a cambio de correo administrativo');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('La solicitud de cambio de correo ya fue resuelta');
    }
    if (!request.candidateUserId || !request.candidateAssignmentId) {
      throw new ConflictException('La solicitud no tiene cuenta administrativa asociada');
    }

    const [tenant, user, assignment, emailOwner] = await Promise.all([
      this.tenantModel.findById(request.tenantId).session(session).lean(),
      this.roledUserModel.findById(request.candidateUserId).session(session),
      this.assignmentModel.findOne({
        _id: request.candidateAssignmentId,
        tenantId: request.tenantId,
        userId: request.candidateUserId,
      }).session(session).lean(),
      this.roledUserModel.findOne({ email: request.newEmail }).session(session).lean(),
    ]);

    if (!tenant) {
      throw new NotFoundException('Institucion no encontrada');
    }
    if (!user) {
      throw new NotFoundException('Usuario objetivo no encontrado');
    }
    if (!assignment) {
      throw new ConflictException('La relación institucional objetivo no es coherente');
    }
    if ((request.accountAddress ?? null) !== (assignment.accountAddress ?? null)) {
      throw new ConflictException('La wallet institucional cambió durante el cambio de correo');
    }
    if ((request.institutionalRole ?? null) !== (assignment.institutionalRole ?? null)) {
      throw new ConflictException('El rol institucional cambió durante el cambio de correo');
    }
    if (emailOwner && String(emailOwner._id) !== String(user._id)) {
      throw new ConflictException('El correo indicado ya pertenece a otra cuenta');
    }
    const previousEmail = String(user.email || '').trim().toLowerCase();
    if (previousEmail === request.newEmail) {
      throw new ConflictException('El nuevo correo debe ser distinto del correo actual');
    }

    const previousAuthVersion = user.authVersion ?? 0;
    user.email = request.newEmail;
    user.authVersion = previousAuthVersion + 1;
    try {
      await user.save({ session });
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_IN_USE',
          message: 'El correo ingresado ya está en uso.',
        });
      }
      throw error;
    }

    request.status = 'APPROVED';
    request.resolvedAt = new Date();
    request.resolvedBy = actorId;
    request.resolutionReason = reason?.trim() || request.resolutionReason || null;
    request.currentEmail = previousEmail;
    request.accountAddress = assignment.accountAddress ?? null;
    request.institutionalRole = assignment.institutionalRole ?? null;
    await request.save({ session });
    await this.auditService.record({
      tenantId: request.tenantId,
      actor: { sub: actorId ? String(actorId) : undefined, role: 'ADMIN' },
      action: 'ADMIN_EMAIL_CHANGE_APPROVED',
      targetType: 'InstitutionalAccessRecoveryRequest',
      targetId: request._id,
      targetUserId: user._id,
      assignmentId: assignment._id,
      recoveryRequestId: request._id,
      previousState: { status: 'PENDING', email: previousEmail, authVersion: previousAuthVersion },
      newState: { status: request.status, email: request.newEmail, authVersion: user.authVersion },
      reason: request.resolutionReason ?? null,
      session,
    });

    await this.emailOutboxService.enqueueInstitutionalEmailChangeNotice({
      recipient: user.email,
      name: user.name,
      targetId: user._id,
      correlationId: String(request._id),
      previousEmail,
      session,
    });

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

  private async assertEmailAvailableForRequest(
    newEmail: string,
    message = 'El correo ingresado ya está en uso.',
  ) {
    const existing = await this.roledUserModel.findOne({ email: newEmail }).lean();
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_IN_USE',
        message,
      });
    }
  }

  private async assertNoPendingDuplicate(tenantId: Types.ObjectId, newEmail: string) {
    const existing = await this.recoveryRequestModel
      .findOne({ tenantId, newEmail, status: 'PENDING' })
      .lean();
    if (existing) {
      throw new ConflictException({
        code: 'RECOVERY_REQUEST_ALREADY_PENDING',
        message: 'Ya existe una solicitud de recuperacion pendiente',
      });
    }
  }

  private async assertNoPendingEmailChangeForUser(userId: Types.ObjectId) {
    const existing = await this.recoveryRequestModel
      .findOne({
        candidateUserId: userId,
        requestType: 'ADMIN_EMAIL_CHANGE',
        status: 'PENDING',
      })
      .lean();
    if (existing) {
      throw new ConflictException('Ya existe una solicitud de cambio de correo pendiente');
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
    await this.emailOutboxService.enqueueInstitutionalPasswordResetEmail({
      recipient: to,
      name,
      targetId: userId,
      session,
    });
  }

  private toListResponse(request: any): RecoveryListItem {
    return {
      requestId: String(request._id),
      requestType: request.requestType ?? 'ACCESS_RECOVERY',
      tenantId: String(request.tenantId),
      institutionName: request.institutionName,
      fullName: request.fullName,
      phoneNumber: request.phoneNumber ?? null,
      newEmail: request.newEmail,
      supervisorPhoneNumber: request.supervisorPhoneNumber ?? null,
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

  private normalizeEmail(input: string): string {
    const value = String(input || '').trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new BadRequestException('Correo invalido');
    }
    return value;
  }

  private normalizeNameForMatch(input: string): string {
    return input.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000
    );
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
