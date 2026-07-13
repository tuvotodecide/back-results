import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';

@Injectable()
export class PaymentTenantAccessService {
  constructor(
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
  ) {}

  async resolveTenantForWrite(requester: any, tenantId?: string) {
    const requesterId = this.getRequesterId(requester);
    const tokenTenantId = requester?.tenantId ? String(requester.tenantId) : undefined;
    const candidateTenantId = tenantId || tokenTenantId;

    if (requester?.role === 'ADMIN') {
      if (!candidateTenantId) {
        throw new BadRequestException('tenantId requerido');
      }
      return this.getTenantOrThrow(candidateTenantId);
    }

    if (!candidateTenantId) {
      const assignments = await this.assignmentModel
        .find({
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        })
        .lean();

      if (assignments.length !== 1) {
        throw new BadRequestException('tenantId requerido');
      }

      return this.getTenantOrThrow(String(assignments[0].tenantId));
    }

    const tenant = await this.getTenantOrThrow(candidateTenantId);
    await this.assertTenantAccess(String(tenant._id), requester);
    return tenant;
  }

  async resolveTenantIdsForRead(requester: any, tenantId?: string) {
    const requesterId = this.getRequesterId(requester);

    if (tenantId) {
      const tenant = await this.getTenantOrThrow(tenantId);
      await this.assertTenantAccess(String(tenant._id), requester);
      return [tenant._id as Types.ObjectId];
    }

    if (requester?.role === 'ADMIN') {
      const tenants = await this.tenantModel.find({ active: true }, { _id: 1 }).lean();
      return tenants.map((tenant) => tenant._id as Types.ObjectId);
    }

    const tokenTenantId = requester?.tenantId ? String(requester.tenantId) : undefined;
    if (tokenTenantId) {
      const tenant = await this.getTenantOrThrow(tokenTenantId);
      await this.assertTenantAccess(String(tenant._id), requester);
      return [tenant._id as Types.ObjectId];
    }

    const assignments = await this.assignmentModel
      .find(
        {
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        { tenantId: 1 },
      )
      .lean();

    return assignments.map((assignment) => assignment.tenantId as Types.ObjectId);
  }

  async assertTenantAccess(tenantId: string, requester: any) {
    if (requester?.role === 'ADMIN') return;

    const requesterId = this.getRequesterId(requester);
    const assignment = await this.assignmentModel
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        userId: new Types.ObjectId(requesterId),
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      })
      .lean();

    if (!assignment) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }
  }

  async getTenantOrThrow(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId invalido');
    }

    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.active) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }
    return tenant;
  }

  getRequesterObjectId(requester: any) {
    return new Types.ObjectId(this.getRequesterId(requester));
  }

  private getRequesterId(requester: any) {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('Usuario autenticado invalido');
    }
    return requesterId;
  }
}
