import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getAddress, isAddress, zeroAddress } from 'viem';
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
  getTenantWalletVerificationState,
  normalizeTenantWalletAddress,
} from '@/modules/institutional-tenants/utils/tenant-wallet-verification.util';

@Injectable()
export class PaymentTenantAccessService {
  constructor(
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
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

  async resolvePaymentTargetForRequester(
    tenantId: Types.ObjectId | string,
    requester: any,
  ) {
    const requesterId = this.getRequesterId(requester);
    const tenantObjectId = new Types.ObjectId(String(tenantId));
    const requesterObjectId = new Types.ObjectId(requesterId);

    const assignment = await this.assignmentModel
      .findOne({
        tenantId: tenantObjectId,
        userId: requesterObjectId,
        active: true,
        status: 'APPROVED',
      })
      .lean();

    if (!assignment) {
      throw new ForbiddenException('No existe assignment institucional aprobado');
    }

    const user = await this.userModel
      .findById(requesterObjectId, { active: 1 })
      .lean();
    if (!user?.active) {
      throw new ForbiddenException('Usuario institucional inactivo');
    }

    const walletState = getTenantWalletVerificationState(assignment);
    if (!walletState.hasWallet) {
      throw new BadRequestException('Wallet institucional ausente');
    }
    if (!walletState.isWalletVerified) {
      throw new BadRequestException('Wallet institucional no verificada');
    }
    const wallet = normalizeTenantWalletAddress(assignment.accountAddress);
    if (!wallet || !isAddress(wallet) || getAddress(wallet) === zeroAddress) {
      throw new BadRequestException('Wallet institucional invalida');
    }

    return {
      targetAssignmentId: assignment._id as Types.ObjectId,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
    };
  }

  private getRequesterId(requester: any) {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId || !Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('Usuario autenticado invalido');
    }
    return requesterId;
  }
}
