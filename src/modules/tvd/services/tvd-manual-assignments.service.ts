import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
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
import { CreateTvdManualAssignmentDto } from '../dto/tvd-manual-assignment.dto';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import { TokenAccreditationStatus } from '../tvd.constants';
import { TvdAccreditationProcessorService } from './tvd-accreditation-processor.service';
import { TvdAccreditationReconciliationService } from './tvd-accreditation-reconciliation.service';

const POSITIVE_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const IDEMPOTENCY_KEY_MAX_LENGTH = 120;
const REASON_MAX_LENGTH = 240;

type ManualAssignmentRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
};

type NormalizedManualAssignmentPayload = {
  tenantId: string;
  assignmentId: string;
  tokenAmount: string;
  tokenAmountSmallestUnit: string;
  reason: string;
};

type ResolvedAssignmentWallet = {
  tenantId: Types.ObjectId;
  assignmentId: Types.ObjectId;
  targetUserId: Types.ObjectId;
  wallet: string;
  walletNormalized: string;
};

@Injectable()
export class TvdManualAssignmentsService {
  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
    private readonly processor: TvdAccreditationProcessorService,
    private readonly reconciliation: TvdAccreditationReconciliationService,
    private readonly auditService: InstitutionalAuditService,
    private readonly configService: ConfigService,
  ) {}

  async createManualAssignment(
    dto: CreateTvdManualAssignmentDto,
    requester: ManualAssignmentRequester,
    idempotencyKey?: string,
  ) {
    this.assertAdminRequester(requester);
    const sourceId = this.normalizeIdempotencyKey(idempotencyKey);
    const decimals = this.getConfiguredDecimals();
    const reason = this.normalizeReason(dto.reason);
    const tokenAmount = this.normalizeTokenAmount(dto.tokenAmount);
    const tokenAmountSmallestUnit = this.toSmallestUnits(tokenAmount, decimals);
    const payload: NormalizedManualAssignmentPayload = {
      tenantId: dto.tenantId,
      assignmentId: dto.assignmentId,
      tokenAmount,
      tokenAmountSmallestUnit,
      reason,
    };
    const idempotencyRequestHash = this.hashPayload(payload);

    const existing = await this.accreditationModel
      .findOne({ sourceType: 'MANUAL_GRANT', sourceId })
      .lean();
    if (existing) {
      this.assertIdempotentPayload(existing, idempotencyRequestHash);
      return this.toSafeResponse(existing);
    }

    const resolved = await this.resolveAssignmentWallet(dto.tenantId, dto.assignmentId);
    const requesterId = this.toObjectIdOrThrow(
      requester.sub,
      'TVD_MANUAL_ASSIGNMENT_UNAUTHORIZED',
    );

    const pending = await this.createPendingAccreditation({
      sourceId,
      idempotencyRequestHash,
      resolved,
      tokenAmount,
      tokenAmountSmallestUnit,
      reason,
      requesterId,
      requesterRole: requester.role ?? null,
    });
    if (!pending.created) {
      return this.toSafeResponse(pending.accreditation);
    }
    const accreditation = pending.accreditation;

    await this.recordAuditSafely('TVD_MANUAL_ASSIGNMENT_REQUESTED', {
      accreditation,
      requester,
      resolved,
      reason,
      status: 'PENDING',
    });

    try {
      const ownerId = `tvd-manual-assignment:${String(accreditation._id)}`;
      Logger.log('Init on chain');
      const processed = await this.processor.processAccreditationById(
        accreditation._id,
        { ownerId },
      );
      const confirmed =
        processed?.status === 'SUBMITTED'
          ? await this.reconciliation.reconcileSubmittedAccreditation(
              accreditation._id,
              ownerId,
            )
          : processed;

      if (confirmed?.status !== 'CONFIRMED') {
        const errorCode =
          confirmed?.lastErrorCode ??
          (confirmed?.status === 'NEEDS_REVIEW'
            ? 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW'
            : 'TVD_MANUAL_ASSIGNMENT_FAILED');
        await this.recordAuditSafely(
          confirmed?.status === 'NEEDS_REVIEW'
            ? 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW'
            : 'TVD_MANUAL_ASSIGNMENT_FAILED',
          {
            accreditation: confirmed ?? accreditation,
            requester,
            resolved,
            reason,
            status: confirmed?.status ?? 'FAILED',
            errorCode,
          },
        );

        if (confirmed?.status === 'NEEDS_REVIEW') {
          throw new ServiceUnavailableException({
            code: 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW',
            message: 'La asignacion TVD requiere revision manual',
            accreditation: this.toSafeResponse(confirmed),
          });
        }

        throw new ServiceUnavailableException({
          code: 'TVD_MANUAL_ASSIGNMENT_FAILED',
          message: 'La asignacion TVD no pudo completarse',
          errorCode,
          accreditation: this.toSafeResponse(confirmed),
        });
      }

      await this.recordAuditSafely('TVD_MANUAL_ASSIGNMENT_CONFIRMED', {
        accreditation: confirmed ?? accreditation,
        requester,
        resolved,
        reason,
        status: 'CONFIRMED',
        txHash: confirmed?.txHash ?? undefined,
      });

      return this.toSafeResponse(confirmed);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      const errorCode = this.sanitizeErrorCode(error);
      const status = this.statusForBlockchainError(errorCode);
      const updated = await this.accreditationModel
        .findByIdAndUpdate(
          accreditation._id,
          {
            $set: {
              status,
              lastErrorCode: errorCode,
            },
          },
          { returnDocument: 'after' },
        )
        .lean();

      await this.recordAuditSafely(
        status === 'NEEDS_REVIEW'
          ? 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW'
          : 'TVD_MANUAL_ASSIGNMENT_FAILED',
        {
          accreditation: updated ?? accreditation,
          requester,
          resolved,
          reason,
          status,
          errorCode,
        },
      );

      if (status === 'NEEDS_REVIEW') {
        throw new ServiceUnavailableException({
          code: 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW',
          message: 'La asignacion TVD requiere revision manual',
          accreditation: this.toSafeResponse(updated),
        });
      }

      throw new ServiceUnavailableException({
        code: 'TVD_MANUAL_ASSIGNMENT_FAILED',
        message: 'La asignacion TVD no pudo completarse',
        errorCode,
        accreditation: this.toSafeResponse(updated),
      });
    }
  }

  async getManualAssignment(
    accreditationId: string,
    requester: ManualAssignmentRequester,
  ) {
    this.assertAdminRequester(requester);
    if (!Types.ObjectId.isValid(accreditationId)) {
      throw new BadRequestException({
        code: 'TVD_MANUAL_ASSIGNMENT_NOT_FOUND',
        message: 'Acreditacion TVD no encontrada',
      });
    }
    const accreditation = await this.accreditationModel
      .findOne({
        _id: new Types.ObjectId(accreditationId),
        sourceType: 'MANUAL_GRANT',
      })
      .lean();
    if (!accreditation) {
      throw new NotFoundException({
        code: 'TVD_MANUAL_ASSIGNMENT_NOT_FOUND',
        message: 'Acreditacion TVD no encontrada',
      });
    }
    return this.toSafeResponse(accreditation);
  }

  private async resolveAssignmentWallet(
    tenantId: string,
    assignmentId: string,
  ): Promise<ResolvedAssignmentWallet> {
    const tenantObjectId = this.toObjectIdOrThrow(tenantId, 'TVD_TENANT_NOT_FOUND');
    const assignmentObjectId = this.toObjectIdOrThrow(
      assignmentId,
      'TVD_ASSIGNMENT_NOT_FOUND',
    );

    const tenant = await this.tenantModel.findById(tenantObjectId).lean();
    if (!tenant) {
      throw new NotFoundException({
        code: 'TVD_TENANT_NOT_FOUND',
        message: 'Tenant institucional no encontrado',
      });
    }
    if (!tenant.active) {
      throw new BadRequestException({
        code: 'TVD_TENANT_INACTIVE',
        message: 'Tenant institucional inactivo',
      });
    }

    const assignment = await this.assignmentModel.findById(assignmentObjectId).lean();
    if (!assignment) {
      throw new NotFoundException({
        code: 'TVD_ASSIGNMENT_NOT_FOUND',
        message: 'Assignment institucional no encontrado',
      });
    }
    if (String(assignment.tenantId) !== String(tenantObjectId)) {
      throw new ConflictException({
        code: 'TVD_ASSIGNMENT_TENANT_MISMATCH',
        message: 'Assignment institucional no pertenece al tenant',
      });
    }
    if (!assignment.active) {
      throw new BadRequestException({
        code: 'TVD_ASSIGNMENT_INACTIVE',
        message: 'Assignment institucional inactivo',
      });
    }
    if (assignment.status !== 'APPROVED') {
      throw new BadRequestException({
        code: 'TVD_ASSIGNMENT_NOT_APPROVED',
        message: 'Assignment institucional no aprobado',
      });
    }

    const institutionalUser = await this.userModel
      .findById(assignment.userId, { active: 1 })
      .lean();
    if (!institutionalUser?.active) {
      throw new BadRequestException({
        code: 'TVD_INSTITUTIONAL_USER_INACTIVE',
        message: 'Usuario institucional inactivo',
      });
    }

    const walletState = getTenantWalletVerificationState(assignment);
    if (!walletState.hasWallet) {
      throw new BadRequestException({
        code: 'TVD_WALLET_MISSING',
        message: 'Wallet institucional ausente',
      });
    }
    if (!walletState.isWalletVerified) {
      throw new BadRequestException({
        code: 'TVD_WALLET_NOT_VERIFIED',
        message: 'Wallet institucional no verificada',
      });
    }
    const wallet = normalizeTenantWalletAddress(assignment.accountAddress);
    if (!wallet || !isAddress(wallet) || getAddress(wallet) === zeroAddress) {
      throw new BadRequestException({
        code: 'TVD_WALLET_NOT_VERIFIED',
        message: 'Wallet institucional invalida',
      });
    }

    return {
      tenantId: tenantObjectId,
      assignmentId: assignmentObjectId,
      targetUserId: new Types.ObjectId(String(assignment.userId)),
      wallet,
      walletNormalized: wallet.toLowerCase(),
    };
  }

  private async createPendingAccreditation(input: {
    sourceId: string;
    idempotencyRequestHash: string;
    resolved: ResolvedAssignmentWallet;
    tokenAmount: string;
    tokenAmountSmallestUnit: string;
    reason: string;
    requesterId: Types.ObjectId;
    requesterRole: string | null;
  }) {
    try {
      const accreditation = await this.accreditationModel.create({
        sourceType: 'MANUAL_GRANT',
        sourceId: input.sourceId,
        idempotencyRequestHash: input.idempotencyRequestHash,
        tenantId: input.resolved.tenantId,
        targetAssignmentId: input.resolved.assignmentId,
        targetWallet: input.resolved.wallet,
        targetWalletNormalized: input.resolved.walletNormalized,
        tokenAmount: input.tokenAmount,
        tokenAmountSmallestUnit: input.tokenAmountSmallestUnit,
        reason: input.reason,
        requestedByRole: input.requesterRole,
        status: 'PENDING',
        attempts: 0,
        createdBy: input.requesterId,
      });
      return { created: true, accreditation };
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await this.accreditationModel
          .findOne({ sourceType: 'MANUAL_GRANT', sourceId: input.sourceId })
          .lean();
        this.assertIdempotentPayload(existing, input.idempotencyRequestHash);
        return {
          created: false,
          accreditation: existing as TokenAccreditationDocument,
        };
      }
      throw error;
    }
  }

  private markSubmitting(accreditationId: Types.ObjectId) {
    return this.accreditationModel.updateOne(
      { _id: accreditationId, status: 'PENDING' },
      {
        $set: { status: 'SUBMITTING' },
        $inc: { attempts: 1 },
      },
    );
  }

  private async recordAuditSafely(
    action:
      | 'TVD_MANUAL_ASSIGNMENT_REQUESTED'
      | 'TVD_MANUAL_ASSIGNMENT_CONFIRMED'
      | 'TVD_MANUAL_ASSIGNMENT_FAILED'
      | 'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW',
    input: {
      accreditation: any;
      requester: ManualAssignmentRequester;
      resolved: ResolvedAssignmentWallet;
      reason: string;
      status: TokenAccreditationStatus;
      txHash?: string;
      errorCode?: string;
    },
  ) {
    try {
      await this.auditService.record({
        tenantId: input.resolved.tenantId,
        actor: input.requester,
        action,
        targetType: 'TokenAccreditation',
        targetId: input.accreditation?._id,
        targetUserId: input.resolved.targetUserId,
        assignmentId: input.resolved.assignmentId,
        reason: input.reason,
        correlationId: input.accreditation?.sourceId ?? null,
        newState: {
          accreditationId: String(input.accreditation?._id ?? ''),
          sourceType: 'MANUAL_GRANT',
          status: input.status,
          targetWallet: input.resolved.wallet,
          tokenAmount: input.accreditation?.tokenAmount,
          tokenAmountSmallestUnit: input.accreditation?.tokenAmountSmallestUnit,
          txHash: input.txHash ?? input.accreditation?.txHash ?? null,
          errorCode: input.errorCode ?? null,
        },
      });
    } catch {
      if (input.accreditation?._id) {
        await this.accreditationModel.updateOne(
          { _id: input.accreditation._id },
          { $set: { lastErrorCode: 'TVD_AUDIT_RECORD_FAILED' } },
        );
      }
    }
  }

  private assertAdminRequester(requester: ManualAssignmentRequester) {
    if (!requester?.sub) {
      throw new UnauthorizedException({
        code: 'TVD_MANUAL_ASSIGNMENT_UNAUTHORIZED',
        message: 'Usuario no autenticado',
      });
    }
    if (requester.active === false) {
      throw new UnauthorizedException({
        code: 'TVD_MANUAL_ASSIGNMENT_UNAUTHORIZED',
        message: 'Usuario inactivo',
      });
    }
    if (requester.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'TVD_MANUAL_ASSIGNMENT_UNAUTHORIZED',
        message: 'Rol global ADMIN requerido',
      });
    }
  }

  private normalizeIdempotencyKey(value?: string) {
    const key = String(value ?? '').trim();
    if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'TVD_IDEMPOTENCY_KEY_REQUIRED',
        message: 'Idempotency-Key requerido',
      });
    }
    return key;
  }

  private normalizeReason(value: string) {
    if (value !== String(value ?? '').trim()) {
      throw new BadRequestException({
        code: 'TVD_INVALID_REASON',
        message: 'Reason invalido',
      });
    }
    const reason = value.trim();
    if (reason.length < 8 || reason.length > REASON_MAX_LENGTH || /[<>]/.test(reason)) {
      throw new BadRequestException({
        code: 'TVD_INVALID_REASON',
        message: 'Reason invalido',
      });
    }
    return reason;
  }

  private normalizeTokenAmount(value: string) {
    if (value !== String(value ?? '').trim()) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'Monto TVD invalido',
      });
    }
    const amount = value.trim();
    if (!POSITIVE_DECIMAL_REGEX.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'Monto TVD invalido',
      });
    }
    const [whole, fraction = ''] = amount.split('.');
    const normalizedFraction = fraction.replace(/0+$/, '');
    return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
  }

  private toSmallestUnits(tokenAmount: string, decimals: number) {
    const [whole, fraction = ''] = tokenAmount.split('.');
    if (fraction.length > decimals) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'Precision TVD superior a TVD_DECIMALS',
      });
    }
    const smallest = BigInt(`${whole}${fraction.padEnd(decimals, '0')}`);
    if (smallest <= 0n) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'Monto TVD invalido',
      });
    }
    return smallest.toString();
  }

  private getConfiguredDecimals() {
    const raw = String(this.configService.get<string>('app.tvd.decimals') ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'TVD_DECIMALS requerido para convertir el monto',
      });
    }
    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new BadRequestException({
        code: 'TVD_INVALID_TOKEN_AMOUNT',
        message: 'TVD_DECIMALS invalido',
      });
    }
    return decimals;
  }

  private toObjectIdOrThrow(value: string | undefined, code: string) {
    const raw = String(value ?? '');
    if (!Types.ObjectId.isValid(raw)) {
      throw new BadRequestException({
        code,
        message: 'Identificador invalido',
      });
    }
    return new Types.ObjectId(raw);
  }

  private hashPayload(payload: NormalizedManualAssignmentPayload) {
    return createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  private assertIdempotentPayload(existing: any, expectedHash: string) {
    if (!existing || existing.idempotencyRequestHash !== expectedHash) {
      throw new ConflictException({
        code: 'TVD_IDEMPOTENCY_CONFLICT',
        message: 'La clave de idempotencia ya fue utilizada con otro payload',
      });
    }
  }

  private sanitizeErrorCode(error: unknown) {
    const code = (error as any)?.code;
    if (typeof code === 'string' && code.startsWith('TVD_')) {
      return code.slice(0, 80);
    }
    return 'TVD_MANUAL_ASSIGNMENT_FAILED';
  }

  private statusForBlockchainError(errorCode: string): TokenAccreditationStatus {
    if (
      [
        'TVD_RECEIPT_NOT_FOUND',
        'TVD_EVENT_NOT_FOUND',
        'TVD_EVENT_WALLET_MISMATCH',
        'TVD_EVENT_AMOUNT_MISMATCH',
        'TVD_CONFIRMATIONS_INSUFFICIENT',
      ].includes(errorCode)
    ) {
      return 'NEEDS_REVIEW';
    }
    return 'FAILED';
  }

  private toSafeResponse(accreditation: any) {
    if (!accreditation) return null;
    const row = typeof accreditation.toObject === 'function'
      ? accreditation.toObject()
      : accreditation;
    return {
      id: String(row._id),
      sourceType: row.sourceType,
      tenantId: String(row.tenantId),
      targetAssignmentId: String(row.targetAssignmentId),
      targetWallet: row.targetWallet,
      tokenAmount: row.tokenAmount,
      tokenAmountSmallestUnit: row.tokenAmountSmallestUnit ?? null,
      status: row.status,
      txHash: row.txHash ?? null,
      chainId: row.chainId ?? null,
      contractAddress: row.contractAddress ?? null,
      blockNumber: row.blockNumber ?? null,
      reason: row.reason ?? null,
      lastErrorCode: row.lastErrorCode ?? null,
      createdAt: row.createdAt,
      submittedAt: row.submittedAt ?? null,
      confirmedAt: row.confirmedAt ?? null,
    };
  }
}
