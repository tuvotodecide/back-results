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
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async createApplication(dto: CreateInstitutionalAdminApplicationDto) {
    const email = dto.email.trim().toLowerCase();
    const dni = dto.dni.trim();
    const institutionName = this.formatDisplayName(dto.institutionName);
    const institutionNameNorm = this.normalizeName(institutionName);
    const existingTenant = await this.tenantModel
      .findOne({ nameNorm: institutionNameNorm }, { _id: 1 })
      .lean();
    if (existingTenant) {
      throw new ConflictException('La institucion ya se encuentra registrada');
    }

    const existingUser = await this.roledUserModel.findOne({
      $or: [{ email }, { dni }],
    });
    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese email o DNI');
    }

    const pending = await this.applicationModel
      .findOne({
        $or: [{ email }, { dni }],
        status: { $in: ['PENDING_EMAIL_VERIFICATION', 'PENDING_APPROVAL'] },
      })
      .lean();
    if (pending) {
      throw new ConflictException('Ya existe una solicitud pendiente para ese email o DNI');
    }

    const verificationToken = randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(
      Date.now() + 1000 * 60 * 60 * this.configService.get<number>('app.mail.verificationTokenTTLHours', 24),
    );

    const created = await this.applicationModel.create({
      dni,
      email,
      name: dto.name.trim(),
      institutionName,
      institutionNameNorm,
      status: 'PENDING_EMAIL_VERIFICATION',
      verificationToken,
      verificationTokenExpiresAt,
    });

    await this.sendVerificationEmail(created.email, created.name, verificationToken);

    return {
      id: String(created._id),
      status: created.status,
      email: created.email,
      tenantAlreadyExists: false,
    };
  }

  async verifyEmail(token: string) {
    const app = await this.applicationModel.findOne({ verificationToken: token });
    if (!app) {
      throw new BadRequestException('Token de verificacion invalido');
    }

    if (app.status !== 'PENDING_EMAIL_VERIFICATION') {
      throw new BadRequestException('La solicitud no esta pendiente de verificacion');
    }

    if (!app.verificationTokenExpiresAt || app.verificationTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El token de verificacion ha expirado');
    }

    app.status = 'PENDING_APPROVAL';
    app.verificationToken = undefined;
    app.verificationTokenExpiresAt = undefined;
    app.emailVerifiedAt = new Date();
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
      data: rows.map((row) => ({
        id: String(row._id),
        dni: row.dni,
        email: row.email,
        name: row.name,
        institutionName: row.institutionName,
        status: row.status,
        emailVerifiedAt: row.emailVerifiedAt ?? null,
        approvedAt: row.approvedAt ?? null,
        tenantId: row.tenantId ? String(row.tenantId) : null,
        userId: row.userId ? String(row.userId) : null,
        createdAt: row.createdAt,
      })),
      total: rows.length,
    };
  }

  async approveApplication(applicationId: string, requester: any) {
    if (!Types.ObjectId.isValid(applicationId)) {
      throw new BadRequestException('applicationId invalido');
    }

    const app = await this.applicationModel.findById(applicationId);
    if (!app) {
      throw new NotFoundException('Solicitud no encontrada');
    }

    if (app.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('La solicitud no esta pendiente de aprobacion');
    }

    let user = await this.roledUserModel.findOne({
      $or: [{ email: app.email }, { dni: app.dni }],
    });

    if (!user) {
      user = await this.roledUserModel.create({
        dni: app.dni,
        email: app.email,
        name: app.name,
        password: bcrypt.hashSync(randomBytes(24).toString('hex'), 10),
        role: 'ADMIN',
        active: true,
      });
    } else {
      user.role = 'ADMIN';
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
      { $set: { active: true } },
      { upsert: true, new: true },
    );

    app.status = 'APPROVED';
    app.approvedAt = new Date();
    app.approvedBy = requester?.sub ? new Types.ObjectId(requester.sub) : undefined;
    app.tenantId = tenant._id as Types.ObjectId;
    app.userId = user._id as Types.ObjectId;
    await app.save();

    return {
      id: String(app._id),
      status: app.status,
      tenantId: String(tenant._id),
      userId: String(user._id),
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
    const verificationBaseUrl =
      this.configService.get<string>('app.mail.institutionalAdminVerificationBaseUrl') ||
      this.configService.get<string>('app.mail.verificationBaseUrl') ||
      '';

    if (!verificationBaseUrl) {
      return;
    }

    const url = this.buildUrlWithToken(verificationBaseUrl, token);

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

  private buildUrlWithToken(baseUrl: string, token: string): string {
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
