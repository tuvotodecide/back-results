import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import {
  PaymentTransaction,
  PaymentTransactionDocument,
} from '@/modules/payments/schemas/payment-transaction.schema';
import { toPublicPaymentDto } from '@/modules/payments/dto/payment-response.dto';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import {
  TvdAccreditationListQueryDto,
  TvdAdminAccreditationListQueryDto,
  TvdAdminInstitutionListQueryDto,
} from '../dto/tvd-query.dto';
import { TvdBlockchainService } from './tvd-blockchain.service';

type Requester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

type InstitutionalContext = {
  tenant: any;
  assignment: any;
  user: any;
  wallet: string;
  walletNormalized: string;
};

@Injectable()
export class TvdQueryService {
  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    @InjectModel(PaymentTransaction.name)
    private readonly paymentModel: Model<PaymentTransactionDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
    private readonly blockchain: TvdBlockchainService,
  ) {}

  async getMySummary(requester: Requester) {
    const context = await this.resolveInstitutionalContext(requester);
    const [balance, tokenSymbol] = await Promise.all([
      this.readBalanceSafely(context.wallet),
      this.readTokenSymbolSafely(),
    ]);
    const [lastAccreditation, pendingAccreditationsCount] = await Promise.all([
      this.accreditationModel
        .findOne({
          tenantId: context.tenant._id,
          targetAssignmentId: context.assignment._id,
        })
        .sort({ createdAt: -1 })
        .lean(),
      this.accreditationModel.countDocuments({
        tenantId: context.tenant._id,
        targetAssignmentId: context.assignment._id,
        status: { $in: ['PENDING', 'SUBMITTING', 'SUBMITTED'] },
      }),
    ]);
    const operatorContext = this.getOperatorContextSafely();

    return {
      tenantId: String(context.tenant._id),
      assignmentId: String(context.assignment._id),
      wallet: context.wallet,
      walletStatus: 'VERIFIED',
      assignedBalance: {
        smallestUnit: balance.assignedBalanceSmallestUnit,
        formatted: balance.assignedBalanceFormatted,
        decimals: balance.decimals,
      },
      liquidBalance: {
        smallestUnit: balance.liquidBalanceSmallestUnit,
        formatted: balance.liquidBalanceFormatted,
      },
      totalBalance: {
        smallestUnit: balance.totalBalanceSmallestUnit,
        formatted: balance.totalBalanceFormatted,
      },
      tokenSymbol,
      chainId: operatorContext.chainId,
      contractAddress: operatorContext.assignmentContractAddress,
      lastAccreditation: lastAccreditation
        ? this.toAccreditationResponse(lastAccreditation)
        : null,
      pendingAccreditationsCount,
    };
  }

  async listMyAccreditations(
    query: TvdAccreditationListQueryDto,
    requester: Requester,
  ) {
    const context = await this.resolveInstitutionalContext(requester);
    return this.listAccreditations(
      {
        tenantId: context.tenant._id,
        targetAssignmentId: context.assignment._id,
      },
      query,
    );
  }

  async getMyAccreditation(accreditationId: string, requester: Requester) {
    const context = await this.resolveInstitutionalContext(requester);
    const accreditation = await this.findAccreditationOrThrow(accreditationId, {
      tenantId: context.tenant._id,
      targetAssignmentId: context.assignment._id,
    });
    return this.toAccreditationResponse(accreditation);
  }

  async listMyPayments(query: any, requester: Requester) {
    const context = await this.resolveInstitutionalContext(requester);
    return this.listPayments(
      {
        tenantId: context.tenant._id,
        targetAssignmentId: context.assignment._id,
      },
      query,
    );
  }

  async getMyPayment(paymentId: string, requester: Requester) {
    const context = await this.resolveInstitutionalContext(requester);
    const payment = await this.findPaymentOrThrow(paymentId, {
      tenantId: context.tenant._id,
      targetAssignmentId: context.assignment._id,
    });
    const accreditation = await this.findPaymentAccreditation(payment);
    return this.toPaymentResponse(payment, accreditation);
  }

  async listAdminInstitutions(query: TvdAdminInstitutionListQueryDto, requester: Requester) {
    this.assertAdmin(requester);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = {};
    const search = String(query.search ?? '').trim();
    if (search) {
      filter.nameNorm = { $regex: this.escapeRegex(search.toLowerCase()), $options: 'i' };
    }

    const [tenants, total] = await Promise.all([
      this.tenantModel
        .find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.tenantModel.countDocuments(filter),
    ]);
    const tenantIds = tenants.map((tenant) => tenant._id);
    const assignments = await this.assignmentModel
      .find({ tenantId: { $in: tenantIds } })
      .lean();
    const userIds = assignments.map((assignment) => assignment.userId);
    const users = await this.userModel
      .find({ _id: { $in: userIds } }, { active: 1 })
      .lean();
    const userActiveById = new Map(users.map((user) => [String(user._id), user.active === true]));
    const assignmentsByTenant = this.groupBy(assignments, (assignment) =>
      String(assignment.tenantId),
    );

    return {
      items: tenants.map((tenant) => {
        const tenantAssignments = assignmentsByTenant.get(String(tenant._id)) ?? [];
        const eligibleWalletsCount = tenantAssignments.filter((assignment) =>
          this.isEligibleWallet(tenant, assignment, userActiveById),
        ).length;
        return {
          tenantId: String(tenant._id),
          name: tenant.name,
          active: tenant.active,
          assignmentsCount: tenantAssignments.length,
          eligibleWalletsCount,
        };
      }),
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    };
  }

  async listAdminInstitutionWallets(tenantId: string, requester: Requester) {
    this.assertAdmin(requester);
    const tenantObjectId = this.toObjectIdOrThrow(tenantId, 'TVD_TENANT_NOT_FOUND');
    const tenant = await this.tenantModel.findById(tenantObjectId).lean();
    if (!tenant) {
      throw new NotFoundException({
        code: 'TVD_TENANT_NOT_FOUND',
        message: 'Institucion no encontrada',
      });
    }
    const assignments = await this.assignmentModel
      .find({ tenantId: tenantObjectId })
      .sort({ institutionalRole: 1, createdAt: 1 })
      .lean();
    const users = await this.userModel
      .find({ _id: { $in: assignments.map((assignment) => assignment.userId) } }, { active: 1 })
      .lean();
    const userActiveById = new Map(users.map((user) => [String(user._id), user.active === true]));

    return {
      tenantId: String(tenant._id),
      tenantName: tenant.name,
      tenantActive: tenant.active,
      wallets: assignments.map((assignment) => {
        const walletState = getTenantWalletVerificationState(assignment);
        const userActive = userActiveById.get(String(assignment.userId)) === true;
        const eligible = this.isEligibleWallet(tenant, assignment, userActiveById);
        return {
          assignmentId: String(assignment._id),
          userId: String(assignment.userId),
          institutionalRole: assignment.institutionalRole ?? null,
          status: assignment.status,
          active: assignment.active,
          userActive,
          wallet: walletState.accountAddress,
          walletNormalized: walletState.accountAddressNormalized,
          walletStatus: walletState.walletStatus,
          walletVerifiedAt: assignment.walletVerifiedAt ?? null,
          walletVerificationSource: assignment.walletVerificationSource ?? null,
          eligible,
        };
      }),
    };
  }

  async listAdminAccreditations(
    query: TvdAdminAccreditationListQueryDto,
    requester: Requester,
  ) {
    this.assertAdmin(requester);
    const baseFilter: Record<string, any> = {};
    if (query.tenantId) {
      baseFilter.tenantId = this.toObjectIdOrThrow(
        query.tenantId,
        'TVD_TENANT_NOT_FOUND',
      );
    }
    if (query.assignmentId) {
      baseFilter.targetAssignmentId = this.toObjectIdOrThrow(
        query.assignmentId,
        'TVD_ACCREDITATION_NOT_FOUND',
      );
    }
    return this.listAccreditations(baseFilter, query);
  }

  async getAdminAccreditation(accreditationId: string, requester: Requester) {
    this.assertAdmin(requester);
    const accreditation = await this.findAccreditationOrThrow(accreditationId, {});
    return this.toAccreditationResponse(accreditation);
  }

  private async resolveInstitutionalContext(
    requester: Requester,
  ): Promise<InstitutionalContext> {
    if (!requester?.sub || !Types.ObjectId.isValid(String(requester.sub))) {
      throw new UnauthorizedException({
        code: 'TVD_UNAUTHORIZED',
        message: 'Usuario no autenticado',
      });
    }
    if (requester.active === false) {
      throw new UnauthorizedException({
        code: 'TVD_UNAUTHORIZED',
        message: 'Usuario inactivo',
      });
    }
    const userId = new Types.ObjectId(String(requester.sub));
    const assignmentFilter: Record<string, any> = {
      userId,
      status: 'APPROVED',
      active: true,
    };
    if (requester.tenantId && Types.ObjectId.isValid(String(requester.tenantId))) {
      assignmentFilter.tenantId = new Types.ObjectId(String(requester.tenantId));
    }
    const assignment = await this.assignmentModel
      .findOne(assignmentFilter)
      .sort({ institutionalRole: 1, createdAt: 1 })
      .lean();
    if (!assignment) {
      throw new ForbiddenException({
        code: 'TVD_ASSIGNMENT_NOT_FOUND',
        message: 'No existe assignment institucional operativo',
      });
    }
    const [tenant, user] = await Promise.all([
      this.tenantModel.findById(assignment.tenantId).lean(),
      this.userModel.findById(userId, { active: 1 }).lean(),
    ]);
    if (!tenant?.active) {
      throw new ForbiddenException({
        code: 'TVD_TENANT_INACTIVE',
        message: 'Institucion inactiva',
      });
    }
    if (!user?.active) {
      throw new ForbiddenException({
        code: 'TVD_INSTITUTIONAL_USER_INACTIVE',
        message: 'Usuario institucional inactivo',
      });
    }
    const walletState = getTenantWalletVerificationState(assignment);
    if (!walletState.isWalletVerified || !walletState.accountAddress) {
      throw new BadRequestException({
        code: 'TVD_WALLET_NOT_VERIFIED',
        message: 'Wallet institucional no verificada',
      });
    }
    const wallet = normalizeTenantWalletAddress(assignment.accountAddress);
    if (!wallet) {
      throw new BadRequestException({
        code: 'TVD_WALLET_NOT_VERIFIED',
        message: 'Wallet institucional invalida',
      });
    }

    return {
      tenant,
      assignment,
      user,
      wallet,
      walletNormalized: wallet.toLowerCase(),
    };
  }

  private async listAccreditations(baseFilter: Record<string, any>, query: TvdAccreditationListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { ...baseFilter };
    if (query.status) filter.status = query.status;
    if (query.sourceType) filter.sourceType = query.sourceType;
    this.applyDateRange(filter, query.dateFrom, query.dateTo);

    const [items, total] = await Promise.all([
      this.accreditationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.accreditationModel.countDocuments(filter),
    ]);

    return {
      items: items.map((item) => this.toAccreditationResponse(item)),
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    };
  }

  private async listPayments(baseFilter: Record<string, any>, query: any) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { ...baseFilter };
    if (query.status) filter.status = query.status;
    this.applyDateRange(filter, query.from, query.to);

    const [payments, total] = await Promise.all([
      this.paymentModel
        .find(filter, { qrImage: 0, providerResponseDetail: 0, achReference: 0 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);
    const accreditationIds = payments
      .map((payment) => payment.tokenAccreditationId)
      .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const accreditations = accreditationIds.length
      ? await this.accreditationModel
          .find({ _id: { $in: accreditationIds } })
          .lean()
      : [];
    const accreditationById = new Map(
      accreditations.map((accreditation) => [String(accreditation._id), accreditation]),
    );

    return {
      items: payments.map((payment) =>
        this.toPaymentResponse(
          payment,
          payment.tokenAccreditationId
            ? accreditationById.get(String(payment.tokenAccreditationId))
            : null,
        ),
      ),
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
    };
  }

  private async findAccreditationOrThrow(accreditationId: string, filter: Record<string, any>) {
    const id = this.toObjectIdOrThrow(accreditationId, 'TVD_ACCREDITATION_NOT_FOUND');
    const accreditation = await this.accreditationModel
      .findOne({ _id: id, ...filter })
      .lean();
    if (!accreditation) {
      throw new NotFoundException({
        code: 'TVD_ACCREDITATION_NOT_FOUND',
        message: 'Acreditacion TVD no encontrada',
      });
    }
    return accreditation;
  }

  private async findPaymentOrThrow(paymentId: string, filter: Record<string, any>) {
    const id = this.toObjectIdOrThrow(paymentId, 'TVD_PAYMENT_NOT_FOUND');
    const payment = await this.paymentModel
      .findOne({ _id: id, ...filter }, { qrImage: 0, providerResponseDetail: 0, achReference: 0 })
      .lean();
    if (!payment) {
      throw new NotFoundException({
        code: 'TVD_PAYMENT_NOT_FOUND',
        message: 'Pago no encontrado',
      });
    }
    return payment;
  }

  private async findPaymentAccreditation(payment: any) {
    if (payment.tokenAccreditationId) {
      return this.accreditationModel.findById(payment.tokenAccreditationId).lean();
    }
    return this.accreditationModel
      .findOne({
        sourceType: 'QR_PAYMENT',
        sourceId: String(payment._id),
      })
      .lean();
  }

  private async readBalanceSafely(wallet: string) {
    try {
      return await this.blockchain.getTotalBalance(wallet);
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
        message: 'Saldo TVD temporalmente no disponible',
        errorCode: this.sanitizeTvdErrorCode(error),
      });
    }
  }

  private async readTokenSymbolSafely() {
    try {
      return await this.blockchain.getTokenSymbol();
    } catch {
      return null;
    }
  }

  private getOperatorContextSafely() {
    try {
      return this.blockchain.getOperatorContext();
    } catch {
      return {
        chainId: null,
        assignmentContractAddress: null,
      };
    }
  }

  private assertAdmin(requester: Requester) {
    if (!requester?.sub) {
      throw new UnauthorizedException({
        code: 'TVD_UNAUTHORIZED',
        message: 'Usuario no autenticado',
      });
    }
    if (requester.active === false) {
      throw new UnauthorizedException({
        code: 'TVD_UNAUTHORIZED',
        message: 'Usuario inactivo',
      });
    }
    if (requester.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'TVD_ADMIN_REQUIRED',
        message: 'Rol global ADMIN requerido',
      });
    }
  }

  private isEligibleWallet(tenant: any, assignment: any, userActiveById: Map<string, boolean>) {
    const walletState = getTenantWalletVerificationState(assignment);
    return Boolean(
      tenant?.active === true &&
        assignment.status === 'APPROVED' &&
        assignment.active === true &&
        userActiveById.get(String(assignment.userId)) === true &&
        walletState.isWalletVerified,
    );
  }

  private applyDateRange(filter: Record<string, any>, from?: string, to?: string) {
    if (from && to && new Date(from) > new Date(to)) {
      throw new BadRequestException({
        code: 'TVD_INVALID_DATE_RANGE',
        message: 'dateFrom/from debe ser anterior a dateTo/to',
      });
    }
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
  }

  private toObjectIdOrThrow(value: string, code: string) {
    if (!Types.ObjectId.isValid(String(value))) {
      throw new NotFoundException({
        code,
        message: 'Recurso no encontrado',
      });
    }
    return new Types.ObjectId(String(value));
  }

  private toAccreditationResponse(accreditation: any) {
    return {
      id: String(accreditation._id),
      tenantId: String(accreditation.tenantId),
      targetAssignmentId: String(accreditation.targetAssignmentId),
      sourceType: accreditation.sourceType,
      sourceId: accreditation.sourceId,
      paymentId: accreditation.sourceType === 'QR_PAYMENT' ? accreditation.sourceId : null,
      tokenAmount: accreditation.tokenAmount,
      tokenAmountSmallestUnit: accreditation.tokenAmountSmallestUnit ?? null,
      fiatAmountMinor: accreditation.fiatAmountMinor ?? null,
      fiatCurrency: accreditation.fiatCurrency ?? null,
      bobPerToken: accreditation.bobPerToken ?? null,
      exchangeRateVersion: accreditation.exchangeRateVersion ?? null,
      status: accreditation.status,
      txHash: accreditation.txHash ?? null,
      chainId: accreditation.chainId ?? null,
      contractAddress: accreditation.contractAddress ?? null,
      blockNumber: accreditation.blockNumber ?? null,
      attempts: accreditation.attempts ?? 0,
      failureCategory: accreditation.failureCategory ?? null,
      lastErrorCode: accreditation.lastErrorCode ?? null,
      reason: accreditation.reason ?? null,
      createdAt: accreditation.createdAt,
      updatedAt: accreditation.updatedAt,
      submittedAt: accreditation.submittedAt ?? null,
      confirmedAt: accreditation.confirmedAt ?? null,
    };
  }

  private toPaymentResponse(payment: any, accreditation: any | null | undefined) {
    const publicPayment = toPublicPaymentDto(payment, { includeQr: false });
    return {
      paymentId: publicPayment.id,
      amount: publicPayment.amount,
      amountMinor: publicPayment.amountMinor,
      currency: publicPayment.currency,
      status: publicPayment.status,
      provider: publicPayment.provider,
      merchantReference: publicPayment.merchantReference,
      providerReference: publicPayment.providerReference,
      qrExpiresAt: publicPayment.qrExpiresAt,
      confirmationSource: publicPayment.confirmationSource,
      createdAt: publicPayment.createdAt,
      updatedAt: publicPayment.updatedAt,
      confirmedAt: publicPayment.confirmedAt,
      tvdQuote: publicPayment.tvdQuote,
      accreditationId: accreditation?._id
        ? String(accreditation._id)
        : publicPayment.tokenAccreditation?.id ?? null,
      accreditationStatus:
        accreditation?.status ?? publicPayment.tokenAccreditation?.status ?? null,
      txHash: accreditation?.txHash ?? null,
    };
  }

  private sanitizeTvdErrorCode(error: unknown) {
    const code = (error as any)?.code;
    if (typeof code === 'string' && code.startsWith('TVD_')) {
      return code.slice(0, 80);
    }
    return 'TVD_RPC_UNAVAILABLE';
  }

  private groupBy<T>(items: T[], keyFn: (item: T) => string) {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const key = keyFn(item);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return grouped;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
