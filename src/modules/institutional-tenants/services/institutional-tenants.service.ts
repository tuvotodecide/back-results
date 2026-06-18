import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import {
  AssignTenantAdminDto,
  CreateInstitutionalTenantDto,
} from '../dto/institutional-tenant.dto';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '../schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '../schemas/tenant-admin-assignment.schema';

@Injectable()
export class InstitutionalTenantsService {
  constructor(
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
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

  async assignAdmin(tenantId: string, dto: AssignTenantAdminDto) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new NotFoundException('Tenant no encontrado');
    }

    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.active) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    const user = await this.roledUserModel.findById(dto.userId).lean();
    if (!user || !user.active) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }

    const active = dto.active ?? true;

    await this.assignmentModel.findOneAndUpdate(
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
      { upsert: true, returnDocument: 'after' },
    );

    return {
      tenantId,
      userId: dto.userId,
      active,
    };
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
