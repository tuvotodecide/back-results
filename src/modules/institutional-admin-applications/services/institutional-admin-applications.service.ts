import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import bcrypt from 'bcrypt';
import { MailService } from '@/modules/mail/mail.service';
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
  VotingEvent,
  VotingEventDocument,
} from '@/modules/institutional-voting/schemas/voting-event.schema';
import { CreateInstitutionalAdminApplicationDto } from '../dto/create-institutional-admin-application.dto';
import { InstitutionalAdminApplication, InstitutionalAdminApplicationDocument } from '../schemas/institutional-admin-application.schema';

@Injectable()
export class InstitutionalAdminApplicationsService {
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
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async createApplication(dto: CreateInstitutionalAdminApplicationDto) {
    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    const institutionName = this.formatDisplayName(dto.institutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const existingTenant = await this.tenantModel.findOne({ nameNorm: institutionNameNorm });
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
    } else if (created && ['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL', 'APPROVED'].includes(created.status)) {
      if (created.status === 'APPROVED') {
        throw new ConflictException(
          'El usuario ya tiene acceso institucional aprobado para este tenant',
        );
      }
      throw new ConflictException('La solicitud institucional ya existe y sigue pendiente');
    } else {
      const passwordHash = this.resolveApplicationPasswordHash(user, dto.password);
      created = await this.applicationModel.create({
        dni,
        email,
        passwordHash,
        name: dto.name.trim(),
        institutionName,
        institutionNameNorm,
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
      await this.sendVerificationEmail(created.email, created.name, verificationToken);
    }

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

    const app = await this.applicationModel.findById(applicationId);
    if (!app) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (app.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('La solicitud no está pendiente de aprobación');
    }

    let user = await this.resolveUserByEmailOrDni(app.email, app.dni);

    if (!user) {
      try {
        user = await this.roledUserModel.create({
          dni: app.dni,
          email: app.email,
          name: app.name,
          password: app.passwordHash,
          role: 'USER',
          active: false,
        });
      } catch (error) {
        this.rethrowIdentityDuplicate(error);
        throw error;
      }
    } else {
      user.active = true;
      user.verificationToken = undefined;
      user.verificationTokenExpiresAt = undefined;
      await user.save();
    }

    let tenant = await this.tenantModel.findOne({ nameNorm: app.institutionNameNorm });
    if (!tenant) {
      try {
        tenant = await this.tenantModel.create({
          name: app.institutionName,
          nameNorm: app.institutionNameNorm,
          description: `Tenant creado desde solicitud ${String(app._id)}`,
          active: true,
        });
      } catch (error: any) {
        if (error?.code === 11000) {
          tenant = await this.tenantModel.findOne({ nameNorm: app.institutionNameNorm });
        } else {
          throw error;
        }
      }
    }

    if (!tenant) {
      throw new ConflictException('No se pudo resolver o crear el tenant');
    }

    await this.assignmentModel.findOneAndUpdate(
      {
        tenantId: tenant._id,
        userId: user._id,
      },
      {
        $set: {
          status: 'APPROVED',
          active: true,
          requestedAt: app.emailVerifiedAt ?? (app as any).createdAt ?? new Date(),
          approvedAt: new Date(),
          rejectedAt: null,
          revokedAt: null,
          approvedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
          reason: null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    app.status = 'APPROVED';
    app.approvedAt = new Date();
    app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
    app.rejectedAt = undefined;
    app.revokedAt = undefined;
    app.reason = undefined;
    app.tenantId = this.toObjectId(tenant._id);
    app.userId = this.toObjectId(user._id);
    await app.save();
    await this.syncUserActiveState(user._id);

    return {
      id: String(app._id),
      status: app.status,
      tenantId: String(tenant._id),
      userId: String(user._id),
    };
  }

  async rejectApplication(applicationId: string, requester: any, reason?: string) {
    const app = await this.getApplicationOrThrow(applicationId);
    if (app.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Solo se puede rechazar una solicitud institucional pendiente de aprobación',
      );
    }

    if (app.tenantId && app.userId) {
      await this.assignmentModel.findOneAndUpdate(
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
        { upsert: true, returnDocument: 'after' },
      );
    }

    app.status = 'REJECTED';
    app.rejectedAt = new Date();
    app.revokedAt = undefined;
    app.approvedAt = undefined;
    app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
    app.reason = reason?.trim() || undefined;
    await app.save();

    if (app.userId) {
      await this.syncUserActiveState(app.userId);
    }

    return {
      id: String(app._id),
      status: app.status,
      reason: app.reason ?? null,
    };
  }

  async revokeApplication(applicationId: string, requester: any, reason?: string) {
    const app = await this.getApplicationOrThrow(applicationId);
    if (app.status !== 'APPROVED') {
      throw new BadRequestException('Solo se puede revocar una solicitud aprobada');
    }
    if (!app.tenantId || !app.userId) {
      throw new ConflictException('La solicitud aprobada no tiene membership asociado');
    }

    await this.assignmentModel.findOneAndUpdate(
      { tenantId: app.tenantId, userId: app.userId },
      {
        $set: {
          status: 'REVOKED',
          active: false,
          revokedAt: new Date(),
          reason: reason?.trim() || null,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    app.status = 'REVOKED';
    app.revokedAt = new Date();
    app.reason = reason?.trim() || undefined;
    app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
    await app.save();

    await this.syncUserActiveState(app.userId);

    return {
      id: String(app._id),
      status: app.status,
      reason: app.reason ?? null,
    };
  }

  async reopenApplication(applicationId: string, requester: any, reason?: string) {
    const app = await this.getApplicationOrThrow(applicationId);
    if (!['REJECTED', 'REVOKED'].includes(app.status)) {
      throw new BadRequestException('Solo se pueden reabrir solicitudes rechazadas o revocadas');
    }

    app.status = 'PENDING_APPROVAL';
    app.reason = undefined;
    app.approvedAt = undefined;
    app.rejectedAt = undefined;
    app.revokedAt = undefined;
    app.approvedBy = undefined;
    await app.save();

    if (app.tenantId && app.userId) {
      await this.assignmentModel.findOneAndUpdate(
        { tenantId: app.tenantId, userId: app.userId },
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

    if (app.userId) {
      await this.syncUserActiveState(app.userId);
    }

    return {
      id: String(app._id),
      status: app.status,
      reason: app.reason ?? null,
    };
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
    const institutionName = this.formatDisplayName(dto.institutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const name = dto.name.trim();

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

    await this.assignmentModel.findOneAndUpdate(
      {
        tenantId: tenant._id,
        userId: user._id,
      },
      {
        $set: {
          status: 'APPROVED',
          active: true,
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

  private async sendVerificationEmail(to: string, name: string, token: string) {
    const verificationBaseUrl = this.configService.get<string>('app.mail.verificationBaseUrl') || '';

    if (!verificationBaseUrl) {
      return;
    }

    const url = this.buildUrlWithToken(verificationBaseUrl, token, '/votacion/verificar-correo');

    await this.mailService.sendEmail(
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

  private async getApplicationOrThrow(applicationId: string) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('applicationId invalido');
    }

    const app = await this.applicationModel.findById(applicationId);
    if (!app) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    return app;
  }

  private async resolveUserByEmailOrDni(email: string, dni: string) {
    const matches = await this.roledUserModel
      .find({ $or: [{ email }, { dni }] })
      .sort({ createdAt: 1, _id: 1 });

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

  private async syncUserActiveState(userId: Types.ObjectId | string) {
    const normalizedUserId =
      typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
    const user = await this.roledUserModel.findById(normalizedUserId);
    if (!user) return;

    const hasApprovedTenantMembership = await this.assignmentModel.exists({
      userId: normalizedUserId,
      active: true,
      $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
    });

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
      await user.save();
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
