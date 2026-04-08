import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { MailService } from '@/modules/mail/mail.service';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import { RegisterRoledUserDto } from '../dto/register-roled-user.dto';
import {
  AccessStatusDto,
  SignInDto,
  SignInResponseDto,
  TenantAccessStatus,
} from '../dto/sign-in.dto';
import { RequestPasswordResetDto, ResetPasswordDto } from '../dto/password-reset.dto';
import {
  RoledUser,
  RoledUserDocument,
  TerritorialAccessStatus,
} from '../schemas/roledUser.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RoledUser.name) private roledUserModel: Model<RoledUserDocument>,
    @InjectModel(Department.name) private departmentModel: Model<Department>,
    @InjectModel(Municipality.name) private municipalityModel: Model<Municipality>,
    @InjectModel(TenantAdminAssignment.name)
    private tenantAdminAssignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(InstitutionalTenant.name)
    private institutionalTenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private institutionalAdminApplicationModel: Model<InstitutionalAdminApplicationDocument>,
    private jwtService: JwtService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterRoledUserDto): Promise<RoledUserDocument> {
    await this.validateTerritorialRegistration(dto);

    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    const requestedRole = dto.votingDepartmentId ? 'GOVERNOR' : 'MAYOR';
    const existingUser = await this.resolveUserByEmailOrDni(email, dni);

    if (existingUser && this.hasDifferentUserIdentity(existingUser, email, dni)) {
      throw new ConflictException(
        'El email y el DNI ya están asociados a usuarios distintos; no se puede unificar automáticamente',
      );
    }

    if (existingUser) {
      this.assertTerritorialRequestConsistency(existingUser, dto, requestedRole);
      return this.updateExistingUserTerritorialRequest(existingUser, dto, requestedRole);
    }

    return this.createNewTerritorialUser(dto, requestedRole);
  }

  async verifyEmail(token: string): Promise<RoledUserDocument> {
    const user = await this.roledUserModel.findOne({ verificationToken: token });

    if (!user) {
      throw new BadRequestException('Token de verificación inválido');
    }

    if (
      user.verificationTokenExpiresAt &&
      user.verificationTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El token de verificación ha expirado');
    }

    user.verificationToken = undefined;
    user.verificationTokenExpiresAt = undefined;

    if (user.role === 'MAYOR' || user.role === 'GOVERNOR') {
      user.territorialAccessStatus = 'PENDING_APPROVAL';
    }

    await user.save();
    await this.syncUserActiveState(user._id);

    return user;
  }

  async signIn(dto: SignInDto): Promise<SignInResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.roledUserModel.findOne({ email });

    if (!user) {
      const application = await this.institutionalAdminApplicationModel
        .findOne({ email })
        .sort({ createdAt: -1, _id: -1 })
        .lean();

      if (application?.status === 'PENDING_EMAIL_VERIFICATION') {
        throw new UnauthorizedException({
          message: 'El correo electrónico no ha sido verificado',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }

      if (application?.status === 'PENDING_APPROVAL') {
        throw new UnauthorizedException({
          message: 'La solicitud institucional está pendiente de aprobación',
          code: 'TENANT_ACCESS_PENDING',
        });
      }

      throw new ForbiddenException('Credenciales inválidas');
    }

    const passwordMatches = bcrypt.compareSync(dto.password, user.password);
    if (!passwordMatches) {
      throw new ForbiddenException('Credenciales inválidas');
    }

    const [availableContexts, accessStatus] = await Promise.all([
      this.resolveAvailableContexts(user),
      this.buildAccessStatusForUser(user),
    ]);
    const requiresContextSelection = availableContexts.length > 1;
    const defaultContext = availableContexts.length === 1 ? availableContexts[0] : null;
    const defaultTenantContext = defaultContext?.type === 'TENANT' ? defaultContext : null;

    if (availableContexts.length === 0) {
      this.throwNoContextAccessError(accessStatus);
    }

    const payload: Record<string, unknown> = {
      sub: user._id.toString(),
      dni: user.dni,
      role: user.role,
      active: user.active,
    };

    if (this.hasApprovedTerritorialAccess(user)) {
      if (user.votingDepartmentId) {
        payload.votingDepartmentId = user.votingDepartmentId.toString();
      }
      if (user.votingMunicipalityId) {
        payload.votingMunicipalityId = user.votingMunicipalityId.toString();
      }
    }

    if (defaultTenantContext?.tenantId) {
      payload.tenantId = defaultTenantContext.tenantId;
    }

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      role: user.role,
      active: user.active,
      tenantId: defaultTenantContext?.tenantId ?? null,
      availableContexts,
      requiresContextSelection,
      defaultContext,
      accessStatus,
    };
  }

  async getAccessStatus(userId: string): Promise<AccessStatusDto> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('userId invalido');
    }

    const user = await this.roledUserModel.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.buildAccessStatusForUser(user);
  }

  async requestPasswordReset(dto: RequestPasswordResetDto): Promise<void> {
    const user = await this.roledUserModel.findOne({ email: dto.email.trim().toLowerCase() });

    if (!user || user.verificationToken) {
      throw new UnauthorizedException('El correo electrónico no ha sido verificado');
    }

    if (!user.active) {
      throw new UnauthorizedException('El usuario no está activo');
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetTokenExpiresAt = new Date(
      Date.now() +
        1000 * 60 * 60 * this.configService.get<number>('app.mail.passwordResetTokenTTLHours', 2),
    );

    user.passwordResetToken = resetToken;
    user.passwordResetTokenExpiresAt = resetTokenExpiresAt;
    await user.save();

    await this.sendPasswordResetEmail(user.email, user.name, resetToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const user = await this.roledUserModel.findOne({ passwordResetToken: dto.token });

    if (!user) {
      throw new BadRequestException('Token de restablecimiento inválido');
    }

    if (
      !user.passwordResetTokenExpiresAt ||
      user.passwordResetTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('El token de restablecimiento ha expirado');
    }

    user.password = bcrypt.hashSync(dto.password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpiresAt = undefined;

    await user.save();
  }

  async createRoledUser(dto: RegisterRoledUserDto): Promise<RoledUserDocument> {
    await this.validateTerritorialRegistration(dto);

    const user = await this.roledUserModel.create({
      dni: dto.dni.trim(),
      email: dto.email.trim().toLowerCase(),
      name: dto.name.trim(),
      password: bcrypt.hashSync(dto.password, 10),
      role: dto.votingDepartmentId ? 'GOVERNOR' : 'MAYOR',
      territorialAccessStatus: 'APPROVED',
      territorialApprovedAt: new Date(),
      votingDepartmentId: dto.votingDepartmentId
        ? new Types.ObjectId(dto.votingDepartmentId)
        : null,
      votingMunicipalityId: dto.votingMunicipalityId
        ? new Types.ObjectId(dto.votingMunicipalityId)
        : null,
      active: true,
    });

    return user;
  }

  async deleteRoledUserByEmail(email: string): Promise<void> {
    await this.roledUserModel.deleteOne({ email: email.trim().toLowerCase() });
  }

  async syncUserActiveState(userId: Types.ObjectId | string): Promise<void> {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const user = await this.roledUserModel.findById(normalizedUserId);
    if (!user) return;

    const hasApprovedTenantMembership = await this.tenantAdminAssignmentModel.exists({
      userId: normalizedUserId,
      active: true,
      $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
    });

    const shouldRemainActive =
      user.role === 'ADMIN' ||
      this.hasApprovedTerritorialAccess(user) ||
      Boolean(hasApprovedTenantMembership);

    if (user.active !== shouldRemainActive) {
      user.active = shouldRemainActive;
      await user.save();
    }
  }

  private async createNewTerritorialUser(
    dto: RegisterRoledUserDto,
    requestedRole: 'MAYOR' | 'GOVERNOR',
  ): Promise<RoledUserDocument> {
    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(
      Date.now() +
        1000 * 60 * 60 * this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
    );

    const user = await this.roledUserModel.create({
      dni: dto.dni.trim(),
      email: dto.email.trim().toLowerCase(),
      name: dto.name.trim(),
      password: bcrypt.hashSync(dto.password, 10),
      role: requestedRole,
      territorialAccessStatus: 'PENDING_EMAIL_VERIFICATION',
      votingDepartmentId: dto.votingDepartmentId
        ? new Types.ObjectId(dto.votingDepartmentId)
        : null,
      votingMunicipalityId: dto.votingMunicipalityId
        ? new Types.ObjectId(dto.votingMunicipalityId)
        : null,
      active: false,
      verificationToken,
      verificationTokenExpiresAt,
    });

    await this.sendVerificationEmail(user.email, user.name, verificationToken);
    return user;
  }

  private async updateExistingUserTerritorialRequest(
    user: RoledUserDocument,
    dto: RegisterRoledUserDto,
    requestedRole: 'MAYOR' | 'GOVERNOR',
  ): Promise<RoledUserDocument> {
    const emailVerified = !user.verificationToken;
    const nextStatus: TerritorialAccessStatus = emailVerified
      ? 'PENDING_APPROVAL'
      : 'PENDING_EMAIL_VERIFICATION';

    user.name = user.name || dto.name.trim();
    user.role = user.role === 'ADMIN' ? user.role : requestedRole;
    user.votingDepartmentId = dto.votingDepartmentId
      ? new Types.ObjectId(dto.votingDepartmentId)
      : null;
    user.votingMunicipalityId = dto.votingMunicipalityId
      ? new Types.ObjectId(dto.votingMunicipalityId)
      : null;
    user.territorialAccessStatus = nextStatus;
    user.territorialApprovedAt = null;
    user.territorialRejectedAt = null;
    user.territorialRevokedAt = null;
    user.territorialApprovedBy = null;
    user.territorialReason = null;

    if (!emailVerified) {
      user.verificationToken = randomBytes(32).toString('hex');
      user.verificationTokenExpiresAt = new Date(
        Date.now() +
          1000 * 60 * 60 *
            this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
      );
      await this.sendVerificationEmail(user.email, user.name, user.verificationToken);
    }

    await user.save();
    await this.syncUserActiveState(user._id);
    return user;
  }

  private async validateTerritorialRegistration(dto: RegisterRoledUserDto): Promise<void> {
    if (
      (!dto.votingDepartmentId && !dto.votingMunicipalityId) ||
      (dto.votingDepartmentId && dto.votingMunicipalityId)
    ) {
      throw new BadRequestException(
        'Debe proporcionar exactamente un ID de departamento o un ID de municipio de votación',
      );
    }

    if (
      dto.votingDepartmentId &&
      !(await this.departmentModel.exists({ _id: dto.votingDepartmentId }))
    ) {
      throw new BadRequestException('El departamento de votación proporcionado no existe');
    }

    if (
      dto.votingMunicipalityId &&
      !(await this.municipalityModel.exists({ _id: dto.votingMunicipalityId }))
    ) {
      throw new BadRequestException('El municipio de votación proporcionado no existe');
    }
  }

  private async resolveAvailableContexts(user: RoledUserDocument) {
    const contexts: SignInResponseDto['availableContexts'] = [];

    if (user.role === 'ADMIN') {
      contexts.push({
        type: 'GLOBAL_ADMIN',
        role: user.role,
        label: 'Administrador global',
      });
    }

    if (this.hasApprovedTerritorialAccess(user)) {
      contexts.push({
        type: 'TERRITORIAL',
        role: user.role,
        label:
          user.role === 'GOVERNOR'
            ? 'Acceso territorial departamental'
            : 'Acceso territorial municipal',
        votingDepartmentId: user.votingDepartmentId?.toString() ?? null,
        votingMunicipalityId: user.votingMunicipalityId?.toString() ?? null,
      });
    }

    const memberships = await this.tenantAdminAssignmentModel
      .find({
        userId: user._id,
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (memberships.length === 0) {
      return contexts;
    }

    const tenants = await this.institutionalTenantModel
      .find(
        {
          _id: { $in: memberships.map((membership) => membership.tenantId) },
          active: true,
        },
        { name: 1 },
      )
      .lean();

    const tenantById = new Map(tenants.map((tenant) => [String(tenant._id), tenant]));

    for (const membership of memberships) {
      const tenant = tenantById.get(String(membership.tenantId));
      if (!tenant) continue;

      contexts.push({
        type: 'TENANT',
        role: user.role,
        label: `Tenant: ${tenant.name}`,
        tenantId: String(membership.tenantId),
        tenantName: tenant.name,
        membershipId: String(membership._id),
      });
    }

    return contexts;
  }

  private async buildAccessStatusForUser(user: RoledUserDocument): Promise<AccessStatusDto> {
    const [memberships, applications] = await Promise.all([
      this.tenantAdminAssignmentModel
        .find({ userId: user._id })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
      this.institutionalAdminApplicationModel
        .find({
          $or: [{ userId: user._id }, { email: user.email }],
        })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean(),
    ]);

    const tenantIds = new Set<string>();
    for (const membership of memberships) tenantIds.add(String(membership.tenantId));
    for (const app of applications) {
      if (app.tenantId) tenantIds.add(String(app.tenantId));
    }

    const tenants = tenantIds.size
      ? await this.institutionalTenantModel
          .find({ _id: { $in: Array.from(tenantIds).map((id) => new Types.ObjectId(id)) } })
          .lean()
      : [];
    const tenantById = new Map(tenants.map((tenant) => [String(tenant._id), tenant.name]));

    const tenantItems: AccessStatusDto['tenant']['items'] = memberships.map((membership) => ({
      applicationId:
        applications.find(
          (app) =>
            String(app.tenantId || '') === String(membership.tenantId) &&
            String(app.userId || '') === String(user._id),
        )?._id?.toString() ?? null,
      membershipId: String(membership._id),
      status: this.normalizeTenantAccessStatus(
        membership.status ?? (membership.active ? 'APPROVED' : 'REVOKED'),
      ),
      tenantId: String(membership.tenantId),
      tenantName: tenantById.get(String(membership.tenantId)) ?? null,
      reason: membership.reason ?? null,
    }));

    for (const application of applications) {
      const tenantId = application.tenantId ? String(application.tenantId) : null;
      const alreadyIncluded = tenantItems.some(
        (item) => item.applicationId === String(application._id),
      );
      if (alreadyIncluded) continue;
      tenantItems.push({
        applicationId: String(application._id),
        membershipId: null,
        status: this.normalizeTenantAccessStatus(application.status),
        tenantId,
        tenantName: tenantId
          ? tenantById.get(tenantId) ?? application.institutionName
          : application.institutionName,
        reason: application.reason ?? null,
      });
    }

    const latestTenantItem = tenantItems[0] ?? null;
    const hasApprovedTenantAccess = tenantItems.some((item) => item.status === 'APPROVED');

    const territorialStatus = this.resolveTerritorialStatus(user);
    const hasApprovedTerritorialAccess = this.hasApprovedTerritorialAccess(user);

    return {
      tenant: {
        hasApprovedAccess: hasApprovedTenantAccess,
        latestStatus: latestTenantItem?.status ?? null,
        canRequest: !tenantItems.some((item) => item.status === 'PENDING'),
        shouldSelectTenantContext: tenantItems.filter((item) => item.status === 'APPROVED').length > 1,
        message: this.buildTenantStatusMessage(tenantItems),
        items: tenantItems,
      },
      territorial: {
        hasApprovedAccess: hasApprovedTerritorialAccess,
        status: territorialStatus,
        requestedRole:
          user.role === 'MAYOR' || user.role === 'GOVERNOR' ? user.role : null,
        votingDepartmentId: user.votingDepartmentId?.toString() ?? null,
        votingMunicipalityId: user.votingMunicipalityId?.toString() ?? null,
        reason: user.territorialReason ?? null,
        canRequest: !['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL'].includes(territorialStatus),
        message: this.buildTerritorialStatusMessage(user, territorialStatus),
      },
    };
  }

  private throwNoContextAccessError(accessStatus: AccessStatusDto): never {
    if (accessStatus.territorial.status === 'PENDING_EMAIL_VERIFICATION') {
      throw new UnauthorizedException({
        message: 'El correo electrónico no ha sido verificado',
        code: 'EMAIL_NOT_VERIFIED',
        accessStatus,
      });
    }

    if (accessStatus.territorial.status === 'PENDING_APPROVAL') {
      throw new UnauthorizedException({
        message: 'La solicitud territorial está pendiente de aprobación',
        code: 'TERRITORIAL_ACCESS_PENDING',
        accessStatus,
      });
    }

    if (accessStatus.tenant.latestStatus === 'PENDING') {
      throw new UnauthorizedException({
        message: 'La solicitud institucional está pendiente de aprobación',
        code: 'TENANT_ACCESS_PENDING',
        accessStatus,
      });
    }

    if (accessStatus.tenant.latestStatus === 'REJECTED') {
      throw new UnauthorizedException({
        message: 'La solicitud institucional fue rechazada',
        code: 'TENANT_ACCESS_REJECTED',
        accessStatus,
      });
    }

    if (accessStatus.tenant.latestStatus === 'REVOKED') {
      throw new UnauthorizedException({
        message: 'El acceso institucional fue revocado',
        code: 'TENANT_ACCESS_REVOKED',
        accessStatus,
      });
    }

    if (accessStatus.territorial.status === 'REJECTED') {
      throw new UnauthorizedException({
        message: 'La solicitud territorial fue rechazada',
        code: 'TERRITORIAL_ACCESS_REJECTED',
        accessStatus,
      });
    }

    if (accessStatus.territorial.status === 'REVOKED') {
      throw new UnauthorizedException({
        message: 'El acceso territorial fue revocado',
        code: 'TERRITORIAL_ACCESS_REVOKED',
        accessStatus,
      });
    }

    throw new UnauthorizedException({
      message: 'El usuario no tiene accesos aprobados todavía',
      code: 'NO_APPROVED_CONTEXTS',
      accessStatus,
    });
  }

  private hasApprovedTerritorialAccess(user: RoledUserDocument): boolean {
    return (
      user.territorialAccessStatus === 'APPROVED' ||
      ((!user.territorialAccessStatus || user.territorialAccessStatus === 'NONE') &&
        (user.role === 'MAYOR' || user.role === 'GOVERNOR') &&
        user.active)
    );
  }

  private resolveTerritorialStatus(user: RoledUserDocument): TerritorialAccessStatus {
    if (user.territorialAccessStatus && user.territorialAccessStatus !== 'NONE') {
      return user.territorialAccessStatus;
    }
    if ((user.role === 'MAYOR' || user.role === 'GOVERNOR') && user.active) {
      return 'APPROVED';
    }
    return 'NONE';
  }

  private buildTerritorialStatusMessage(
    user: RoledUserDocument,
    status: TerritorialAccessStatus,
  ): string {
    if (status === 'APPROVED') {
      return 'El usuario tiene acceso territorial aprobado';
    }
    if (status === 'PENDING_EMAIL_VERIFICATION') {
      return 'La solicitud territorial requiere verificación de correo';
    }
    if (status === 'PENDING_APPROVAL') {
      return 'La solicitud territorial está pendiente de aprobación ADMIN';
    }
    if (status === 'REJECTED') {
      return user.territorialReason || 'La solicitud territorial fue rechazada';
    }
    if (status === 'REVOKED') {
      return user.territorialReason || 'El acceso territorial fue revocado';
    }
    return 'El usuario no tiene acceso territorial aprobado';
  }

  private buildTenantStatusMessage(items: AccessStatusDto['tenant']['items']): string {
    if (items.some((item) => item.status === 'APPROVED')) {
      return 'El usuario tiene al menos un acceso institucional aprobado';
    }
    if (items.some((item) => item.status === 'PENDING')) {
      return 'La solicitud institucional está pendiente de aprobación ADMIN';
    }
    if (items.some((item) => item.status === 'REJECTED')) {
      return 'La última solicitud institucional fue rechazada';
    }
    if (items.some((item) => item.status === 'REVOKED')) {
      return 'El acceso institucional fue revocado';
    }
    return 'El usuario no tiene acceso institucional aprobado';
  }

  private normalizeTenantAccessStatus(status: string | null | undefined): TenantAccessStatus {
    if (status === 'APPROVED') return 'APPROVED';
    if (status === 'REJECTED') return 'REJECTED';
    if (status === 'REVOKED') return 'REVOKED';
    return 'PENDING';
  }

  private async resolveUserByEmailOrDni(
    email: string,
    dni: string,
  ): Promise<RoledUserDocument | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedDni = dni.trim();

    const [byEmail, byDni] = await Promise.all([
      this.roledUserModel.findOne({ email: normalizedEmail }),
      this.roledUserModel.findOne({ dni: normalizedDni }),
    ]);

    if (byEmail && byDni && String(byEmail._id) !== String(byDni._id)) {
      throw new ConflictException(
        'El email y el DNI ya están asociados a usuarios distintos; no se puede reutilizar el usuario base',
      );
    }

    return byEmail || byDni || null;
  }

  private hasDifferentUserIdentity(user: RoledUserDocument, email: string, dni: string): boolean {
    return user.email !== email || user.dni !== dni;
  }

  private assertTerritorialRequestConsistency(
    user: RoledUserDocument,
    dto: RegisterRoledUserDto,
    requestedRole: 'MAYOR' | 'GOVERNOR',
  ): void {
    const requestedDepartmentId = dto.votingDepartmentId ?? null;
    const requestedMunicipalityId = dto.votingMunicipalityId ?? null;
    const currentDepartmentId = user.votingDepartmentId?.toString() ?? null;
    const currentMunicipalityId = user.votingMunicipalityId?.toString() ?? null;
    const currentStatus = this.resolveTerritorialStatus(user);
    const sameScope =
      currentDepartmentId === requestedDepartmentId &&
      currentMunicipalityId === requestedMunicipalityId &&
      (user.role === requestedRole || user.role === 'USER');

    if (!sameScope && (currentDepartmentId || currentMunicipalityId)) {
      throw new ConflictException(
        'El usuario ya tiene un alcance territorial distinto registrado; no se permite duplicarlo o cambiarlo en esta fase',
      );
    }

    if (sameScope && currentStatus === 'APPROVED') {
      throw new ConflictException('El usuario ya tiene acceso territorial aprobado para ese contexto');
    }

    if (
      sameScope &&
      ['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL'].includes(currentStatus)
    ) {
      throw new ConflictException('La solicitud territorial ya existe y sigue pendiente');
    }
  }

  private async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const verificationLink = this.buildEmailLink(token, 'app.mail.verificationBaseUrl');

    await this.mailService.sendEmail(to, 'Verificación de correo electrónico', 'verify-email', {
      name: name.split(' ')[0],
      verificationLink,
    });
  }

  private async sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
    const resetLink = this.buildEmailLink(token, 'app.mail.passwordResetBaseUrl');

    await this.mailService.sendEmail(to, 'Restablecer contraseña', 'reset-password', {
      name: name.split(' ')[0],
      resetLink,
    });
  }

  private buildEmailLink(token: string, baseUrlEnvName: string): string | null {
    const baseUrl = this.configService.get<string>(baseUrlEnvName);

    if (!baseUrl) {
      throw new Error('Base URL no configurada');
    }

    try {
      const url = new URL(baseUrl);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}token=${token}`;
    }
  }
}
