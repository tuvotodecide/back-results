import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { availableNetworks } from '@/api/params';
import {
  RoledUser,
  RoledUserDocument,
} from '@/modules/auth/schemas/roledUser.schema';
import { HistoryOperationKey } from '@/modules/history/dto/create-history.dto';
import { History, HistoryDocument } from '@/modules/history/schemas/history.schema';
import { HistoryService } from '@/modules/history/services/history.service';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  TenantWalletVerificationFields,
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
  TokenAccreditationSourceType,
  TokenAccreditationStatus,
} from '../tvd.constants';
import {
  TvdAccreditationListQueryDto,
  TvdAdminAccreditationListQueryDto,
  TvdAdminInstitutionListQueryDto,
  TvdAdminOperationsQueryDto,
} from '../dto/tvd-query.dto';
import { TvdBlockchainService } from './tvd-blockchain.service';
import {
  TvdAdminOperation,
  TvdAdminOperationSource,
  TvdAdminOperationStatus,
  TvdAdminOperationType,
  TvdAdminOperationsResponse,
  canAffectTvdAdminAssignedTotal,
  canAffectTvdAdminConsumedTotal,
  historyOperationNameToAdminOperationType,
  tokenAccreditationSourceToAdminOperationType,
  tokenAccreditationStatusToAdminStatus,
  tvdAdminOperationDefinitions,
  tvdAdminOperationLabels,
  tvdAdminOperationStatusLabels,
} from '../types/tvd-admin-operations.types';

type Requester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

type InstitutionalContextTenant = Pick<InstitutionalTenant, 'active' | 'name'> & {
  _id: Types.ObjectId;
};

type InstitutionalContextAssignment = TenantWalletVerificationFields & {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  status?: string | null;
  active?: boolean | null;
  institutionalRole?: string | null;
};

type InstitutionalContextUser = Pick<RoledUser, 'active'> & {
  _id: Types.ObjectId;
};

type InstitutionalContext = {
  tenant: InstitutionalContextTenant;
  assignment: InstitutionalContextAssignment;
  user: InstitutionalContextUser;
  wallet: string;
  walletNormalized: string;
};

@Injectable()
export class TvdQueryService {
  private readonly logger = new Logger(TvdQueryService.name);
  private readonly adminAccreditationCandidateLimit = 10000;
  private readonly adminHistoryCandidateLimit = 500;

  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    @InjectModel(History.name)
    private readonly historyModel: Model<HistoryDocument>,
    @InjectModel(PaymentTransaction.name)
    private readonly paymentModel: Model<PaymentTransactionDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
    private readonly blockchain: TvdBlockchainService,
    private readonly historyService: HistoryService,
    private readonly configService: ConfigService,
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
    const operatorContext = await this.getOperatorContextSafely();

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

  async resolveMyInstitutionalWallet(requester: Requester) {
    const context = await this.resolveInstitutionalContext(requester);

    return {
      tenantId: String(context.tenant._id),
      assignmentId: String(context.assignment._id),
      userId: String(context.user._id),
      wallet: context.wallet,
      walletNormalized: context.walletNormalized,
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

  async listAdminInstitutions(
    query: TvdAdminInstitutionListQueryDto,
    requester: Requester,
  ) {
    this.assertAdmin(requester);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = {};
    const search = String(query.search ?? '').trim();
    if (search) {
      filter.nameNorm = {
        $regex: this.escapeRegex(search.toLowerCase()),
        $options: 'i',
      };
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
    const userActiveById = new Map(
      users.map((user) => [String(user._id), user.active === true]),
    );
    const assignmentsByTenant = this.groupBy(assignments, (assignment) =>
      String(assignment.tenantId),
    );

    return {
      items: tenants.map((tenant) => {
        const tenantAssignments =
          assignmentsByTenant.get(String(tenant._id)) ?? [];
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
    const tenantObjectId = this.toObjectIdOrThrow(
      tenantId,
      'TVD_TENANT_NOT_FOUND',
    );
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
      .find(
        { _id: { $in: assignments.map((assignment) => assignment.userId) } },
        { active: 1 },
      )
      .lean();
    const userActiveById = new Map(
      users.map((user) => [String(user._id), user.active === true]),
    );

    return {
      tenantId: String(tenant._id),
      tenantName: tenant.name,
      tenantActive: tenant.active,
      wallets: assignments.map((assignment) => {
        const walletState = getTenantWalletVerificationState(assignment);
        const userActive =
          userActiveById.get(String(assignment.userId)) === true;
        const eligible = this.isEligibleWallet(
          tenant,
          assignment,
          userActiveById,
        );
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
    const accreditation = await this.findAccreditationOrThrow(
      accreditationId,
      {},
    );
    return this.toAccreditationResponse(accreditation);
  }

  async listAdminOperations(
    query: TvdAdminOperationsQueryDto,
    requester: Requester,
  ): Promise<TvdAdminOperationsResponse> {
    this.assertAdmin(requester);
    this.assertDateRange(query.dateFrom, query.dateTo);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tenant = query.tenantId
      ? await this.findTenantOrThrow(query.tenantId)
      : null;
    const tenantObjectId = tenant?._id ?? null;

    const [accreditations, histories] = await Promise.all([
      this.findAdminOperationAccreditations(query, tenantObjectId),
      this.findAdminOperationHistories(query, tenantObjectId),
    ]);

    const historyItems = await this.enrichHistoryAmountsSafely(histories);
    const tenantsById = await this.resolveOperationTenants(
      accreditations,
      historyItems,
      tenant,
    );

    const operations = [
      ...accreditations
        .map((accreditation) =>
          this.toAdminAccreditationOperation(accreditation, tenantsById),
        )
        .filter((operation): operation is TvdAdminOperation =>
          Boolean(operation),
        ),
      ...historyItems
        .map((history) => this.toAdminHistoryOperation(history, tenantsById))
        .filter((operation): operation is TvdAdminOperation =>
          Boolean(operation),
        ),
    ]
      .filter((operation) => this.matchesAdminOperationStatus(operation, query))
      .sort(
        (left, right) =>
          new Date(right.date).getTime() - new Date(left.date).getTime(),
      );

    const total = operations.length;
    const start = (page - 1) * limit;
    const items = operations.slice(start, start + limit);

    return {
      items,
      page,
      limit,
      total,
      hasNextPage: page * limit < total,
      summary: this.buildAdminOperationsSummary(operations),
    };
  }

  private async findAdminOperationAccreditations(
    query: TvdAdminOperationsQueryDto,
    tenantObjectId: Types.ObjectId | null,
  ) {
    const sourceTypes = this.getAccreditationSourceTypesForOperation(
      query.operationType,
    );
    if (sourceTypes.length === 0) return [];

    const statusValues = query.status
      ? this.getAccreditationStatusesForAdminStatus(query.status)
      : null;
    if (statusValues && statusValues.length === 0) return [];

    const filter: Record<string, any> = {
      sourceType: { $in: sourceTypes },
    };
    if (tenantObjectId) filter.tenantId = tenantObjectId;
    if (statusValues) filter.status = { $in: statusValues };
    this.applyDateRangeOnField(filter, 'createdAt', query.dateFrom, query.dateTo);

    const items = await this.accreditationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(this.adminAccreditationCandidateLimit + 1)
      .lean();

    this.assertCandidateLimit(
      items,
      this.adminAccreditationCandidateLimit,
    );
    return items;
  }

  private async findAdminOperationHistories(
    query: TvdAdminOperationsQueryDto,
    tenantObjectId: Types.ObjectId | null,
  ) {
    if (
      query.operationType &&
      query.operationType !== TvdAdminOperationType.VOTE_CONSUMPTION
    ) {
      return [];
    }
    if (
      query.status &&
      query.status !== TvdAdminOperationStatus.CONFIRMED &&
      query.status !== TvdAdminOperationStatus.NEEDS_REVIEW
    ) {
      return [];
    }

    const filter: Record<string, any> = {
      operationName: HistoryOperationKey.castVote,
    };
    if (tenantObjectId) filter.institutionId = tenantObjectId;
    this.applyDateRangeOnField(
      filter,
      'registerDate',
      query.dateFrom,
      query.dateTo,
    );

    const items = await this.historyModel
      .find(filter)
      .sort({ registerDate: -1 })
      .limit(this.adminHistoryCandidateLimit + 1)
      .lean();

    this.assertCandidateLimit(items, this.adminHistoryCandidateLimit);
    return items;
  }

  private async enrichHistoryAmountsSafely(items: any[]) {
    if (items.length === 0) return [];

    return Promise.all(
      items.map(async (item) => {
        try {
          const [enriched] = await this.historyService.getRelatedAmounts([
            item as HistoryDocument,
          ]);
          return enriched ?? item;
        } catch (error) {
          this.logger.warn(
            `No se pudo enriquecer una operacion TVD historica: ${this.sanitizeTvdErrorCode(error)}`,
          );
          return item;
        }
      }),
    );
  }

  private async resolveOperationTenants(
    accreditations: any[],
    histories: any[],
    selectedTenant: any | null,
  ) {
    const tenantsById = new Map<string, any>();
    if (selectedTenant) {
      tenantsById.set(String(selectedTenant._id), selectedTenant);
      return tenantsById;
    }

    const tenantIds = new Set<string>();
    for (const accreditation of accreditations) {
      if (accreditation.tenantId) tenantIds.add(String(accreditation.tenantId));
    }
    for (const history of histories) {
      if (history.institutionId) tenantIds.add(String(history.institutionId));
    }

    if (tenantIds.size === 0) return tenantsById;

    const tenants = await this.tenantModel
      .find({ _id: { $in: [...tenantIds].map((id) => new Types.ObjectId(id)) } })
      .lean();
    for (const tenant of tenants) {
      tenantsById.set(String(tenant._id), tenant);
    }
    return tenantsById;
  }

  private assertCandidateLimit(items: any[], limit: number) {
    if (items.length <= limit) return;

    throw new BadRequestException({
      code: 'TVD_OPERATION_FILTER_TOO_BROAD',
      message: 'Selecciona filtros mas especificos para consultar el historial',
    });
  }

  private toAdminAccreditationOperation(
    accreditation: any,
    tenantsById: Map<string, any>,
  ): TvdAdminOperation | null {
    const operationType =
      tokenAccreditationSourceToAdminOperationType[
        accreditation.sourceType as TokenAccreditationSourceType
      ];
    if (!operationType) return null;

    const tenantId = String(accreditation.tenantId);
    const tenant = tenantsById.get(tenantId);
    if (!tenant) return null;

    const status = tokenAccreditationStatusToAdminStatus[accreditation.status];
    if (!status) return null;

    const amount = this.normalizeTvdAmountString(accreditation.tokenAmount);
    const amountSmallestUnit =
      accreditation.tokenAmountSmallestUnit ?? this.toSmallestUnitsOrNull(amount);
    const txHash = accreditation.txHash ?? null;

    return {
      id: String(accreditation._id),
      tenantId,
      institutionName: tenant.name,
      operationType,
      operationLabel: tvdAdminOperationLabels[operationType],
      economicDirection: tvdAdminOperationDefinitions[operationType].direction,
      status,
      statusLabel: tvdAdminOperationStatusLabels[status],
      amount,
      amountSmallestUnit,
      txHash,
      date: this.toIsoString(accreditation.createdAt),
      explorerUrl: this.buildExplorerUrl(txHash),
      source: TvdAdminOperationSource.TOKEN_ACCREDITATION,
    };
  }

  private toAdminHistoryOperation(
    history: any,
    tenantsById: Map<string, any>,
  ): TvdAdminOperation | null {
    const operationType =
      historyOperationNameToAdminOperationType[history.operationName];
    if (!operationType || !history.institutionId) return null;

    const tenantId = String(history.institutionId);
    const tenant = tenantsById.get(tenantId);
    if (!tenant) return null;

    const txHash = history.txHash ?? null;
    const amount = this.normalizeTvdAmountString(history.relatedAmount);
    const amountSmallestUnit = this.toSmallestUnitsOrNull(amount);
    const status =
      txHash && amountSmallestUnit
        ? TvdAdminOperationStatus.CONFIRMED
        : TvdAdminOperationStatus.NEEDS_REVIEW;

    return {
      id: String(history._id),
      tenantId,
      institutionName: tenant.name,
      operationType,
      operationLabel: tvdAdminOperationLabels[operationType],
      economicDirection: tvdAdminOperationDefinitions[operationType].direction,
      status,
      statusLabel: tvdAdminOperationStatusLabels[status],
      amount,
      amountSmallestUnit,
      txHash,
      date: this.toIsoString(history.registerDate),
      explorerUrl: this.buildExplorerUrl(txHash),
      source: TvdAdminOperationSource.HISTORY,
    };
  }

  private matchesAdminOperationStatus(
    operation: TvdAdminOperation,
    query: TvdAdminOperationsQueryDto,
  ) {
    return !query.status || operation.status === query.status;
  }

  private buildAdminOperationsSummary(operations: TvdAdminOperation[]) {
    let assigned = 0n;
    let consumed = 0n;

    for (const operation of operations) {
      const amount = this.toBigIntOrNull(operation.amountSmallestUnit);
      if (amount === null) continue;

      if (canAffectTvdAdminAssignedTotal(operation)) {
        assigned += amount;
      }
      if (canAffectTvdAdminConsumedTotal(operation)) {
        consumed += amount;
      }
    }

    return {
      totalOperations: operations.length,
      totalAssigned: this.formatSmallestUnits(assigned),
      totalConsumed: this.formatSmallestUnits(consumed),
    };
  }

  private getAccreditationSourceTypesForOperation(
    operationType?: TvdAdminOperationType,
  ): TokenAccreditationSourceType[] {
    if (!operationType) return ['MANUAL_GRANT', 'QR_PAYMENT'];
    if (operationType === TvdAdminOperationType.MANUAL_ASSIGNMENT) {
      return ['MANUAL_GRANT'];
    }
    if (operationType === TvdAdminOperationType.QR_RECHARGE) {
      return ['QR_PAYMENT'];
    }
    return [];
  }

  private getAccreditationStatusesForAdminStatus(
    status: TvdAdminOperationStatus,
  ): TokenAccreditationStatus[] {
    switch (status) {
      case TvdAdminOperationStatus.PENDING:
        return ['PENDING'];
      case TvdAdminOperationStatus.PROCESSING:
        return ['SUBMITTING', 'SUBMITTED'];
      case TvdAdminOperationStatus.CONFIRMED:
        return ['CONFIRMED'];
      case TvdAdminOperationStatus.FAILED:
        return ['FAILED'];
      case TvdAdminOperationStatus.NEEDS_REVIEW:
        return ['NEEDS_REVIEW'];
      case TvdAdminOperationStatus.CANCELLED:
      default:
        return [];
    }
  }

  private async findTenantOrThrow(tenantId: string) {
    const tenantObjectId = this.toObjectIdOrThrow(
      tenantId,
      'TVD_TENANT_NOT_FOUND',
    );
    const tenant = await this.tenantModel.findById(tenantObjectId).lean();
    if (!tenant) {
      throw new NotFoundException({
        code: 'TVD_TENANT_NOT_FOUND',
        message: 'Institucion no encontrada',
      });
    }
    return tenant;
  }

  private applyDateRangeOnField(
    filter: Record<string, any>,
    fieldName: string,
    from?: string,
    to?: string,
  ) {
    if (from || to) {
      filter[fieldName] = {};
      if (from) filter[fieldName].$gte = new Date(from);
      if (to) filter[fieldName].$lte = new Date(to);
    }
  }

  private assertDateRange(from?: string, to?: string) {
    if (from && to && new Date(from) > new Date(to)) {
      throw new BadRequestException({
        code: 'TVD_INVALID_DATE_RANGE',
        message: 'La fecha desde debe ser anterior a la fecha hasta',
      });
    }
  }

  private normalizeTvdAmountString(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;

    const [wholeRaw, fractionRaw] = raw.split('.');
    const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '') || '0';
    if (fractionRaw === undefined) return whole;

    const fraction = fractionRaw.replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  }

  private toSmallestUnitsOrNull(amount: string | null | undefined) {
    if (!amount) return null;
    const normalized = this.normalizeTvdAmountString(amount);
    if (!normalized) return null;

    const decimals = this.getConfiguredDecimals();
    const [whole, fraction = ''] = normalized.split('.');
    if (fraction.length > decimals) return null;

    return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`).toString();
  }

  private toBigIntOrNull(value: string | null | undefined) {
    const raw = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) return null;
    return BigInt(raw);
  }

  private formatSmallestUnits(value: bigint) {
    if (value === 0n) return '0';

    const decimals = this.getConfiguredDecimals();
    if (decimals === 0) return value.toString();

    const raw = value.toString().padStart(decimals + 1, '0');
    const whole = raw.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0';
    const fraction = raw.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  }

  private getConfiguredDecimals() {
    const raw = String(
      this.configService.get<string>('app.tvd.decimals') ?? '',
    ).trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
      throw new ServiceUnavailableException({
        code: 'TVD_DECIMALS_UNAVAILABLE',
        message: 'Datos TVD temporalmente no disponibles',
      });
    }

    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new ServiceUnavailableException({
        code: 'TVD_DECIMALS_UNAVAILABLE',
        message: 'Datos TVD temporalmente no disponibles',
      });
    }
    return decimals;
  }

  private toIsoString(value: Date | string | null | undefined) {
    const date = value ? new Date(value) : new Date();
    return date.toISOString();
  }

  private buildExplorerUrl(txHash: string | null) {
    if (!txHash) return null;

    const chain = this.configService.get<string>('app.blockchain.chain');
    const network = (
      availableNetworks as unknown as Record<string, { explorer?: string }>
    )[String(chain ?? '')];
    const explorer = network?.explorer;
    if (!explorer) return null;

    return `${explorer.replace(/\/+$/, '')}/tx/${txHash}`;
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
    if (
      requester.tenantId &&
      Types.ObjectId.isValid(String(requester.tenantId))
    ) {
      assignmentFilter.tenantId = new Types.ObjectId(
        String(requester.tenantId),
      );
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

  private async listAccreditations(
    baseFilter: Record<string, any>,
    query: TvdAccreditationListQueryDto,
  ) {
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
        .find(filter, {
          qrImage: 0,
          providerResponseDetail: 0,
          achReference: 0,
        })
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
      accreditations.map((accreditation) => [
        String(accreditation._id),
        accreditation,
      ]),
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

  private async findAccreditationOrThrow(
    accreditationId: string,
    filter: Record<string, any>,
  ) {
    const id = this.toObjectIdOrThrow(
      accreditationId,
      'TVD_ACCREDITATION_NOT_FOUND',
    );
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

  private async findPaymentOrThrow(
    paymentId: string,
    filter: Record<string, any>,
  ) {
    const id = this.toObjectIdOrThrow(paymentId, 'TVD_PAYMENT_NOT_FOUND');
    const payment = await this.paymentModel
      .findOne(
        { _id: id, ...filter },
        { qrImage: 0, providerResponseDetail: 0, achReference: 0 },
      )
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
      return this.accreditationModel
        .findById(payment.tokenAccreditationId)
        .lean();
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

  private async getOperatorContextSafely() {
    try {
      return await this.blockchain.getOperatorContext();
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

  private isEligibleWallet(
    tenant: any,
    assignment: any,
    userActiveById: Map<string, boolean>,
  ) {
    const walletState = getTenantWalletVerificationState(assignment);
    return Boolean(
      tenant?.active === true &&
      assignment.status === 'APPROVED' &&
      assignment.active === true &&
      userActiveById.get(String(assignment.userId)) === true &&
      walletState.isWalletVerified,
    );
  }

  private applyDateRange(
    filter: Record<string, any>,
    from?: string,
    to?: string,
  ) {
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
      paymentId:
        accreditation.sourceType === 'QR_PAYMENT'
          ? accreditation.sourceId
          : null,
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

  private toPaymentResponse(
    payment: any,
    accreditation: any | null | undefined,
  ) {
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
        : (publicPayment.tokenAccreditation?.id ?? null),
      accreditationStatus:
        accreditation?.status ??
        publicPayment.tokenAccreditation?.status ??
        null,
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
