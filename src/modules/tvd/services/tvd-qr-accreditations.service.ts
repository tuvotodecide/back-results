import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
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
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import { TokenAccreditationStatus } from '../tvd.constants';

const POSITIVE_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

export type TvdQrAccreditationResult = {
  accreditationId?: Types.ObjectId | null;
  status: TokenAccreditationStatus;
  tokenAmount?: string | null;
  reasonCode?: string | null;
  reused: boolean;
};

@Injectable()
export class TvdQrAccreditationsService {
  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly userModel: Model<RoledUserDocument>,
    private readonly auditService: InstitutionalAuditService,
    private readonly configService: ConfigService,
  ) {}

  async createOrReuseForConfirmedPayment(
    payment: any,
    context: { source: 'WEBHOOK' | 'RECONCILIATION' | 'MOCK' },
  ): Promise<TvdQrAccreditationResult> {
    if (payment?.status !== 'PAYMENT_CONFIRMED') {
      return {
        status: 'BLOCKED_CONFIGURATION',
        reasonCode: 'TVD_PAYMENT_NOT_CONFIRMED',
        reused: false,
      };
    }

    const sourceId = String(payment._id);
    const existing = await this.accreditationModel
      .findOne({ sourceType: 'QR_PAYMENT', sourceId })
      .lean();
    if (existing) {
      await this.recordAuditSafely('TVD_QR_ACCREDITATION_REUSED', {
        payment,
        accreditation: existing,
        context,
        reasonCode: existing.lastErrorCode ?? null,
      });
      return {
        accreditationId: existing._id,
        status: existing.status,
        tokenAmount: existing.tokenAmount,
        reasonCode: existing.lastErrorCode ?? null,
        reused: true,
      };
    }

    const validation = await this.validatePaymentForAccreditation(payment);
    if (!validation.canCreateAccreditation) {
      await this.recordAuditSafely('TVD_QR_ACCREDITATION_BLOCKED', {
        payment,
        context,
        reasonCode: validation.reasonCode,
      });
      return {
        status: 'BLOCKED_CONFIGURATION',
        tokenAmount: payment.tvdQuote?.tokenAmount ?? null,
        reasonCode: validation.reasonCode,
        reused: false,
      };
    }

    const status = validation.reasonCode ? 'BLOCKED_CONFIGURATION' : 'PENDING';
    try {
      const created = await this.accreditationModel.create({
        sourceType: 'QR_PAYMENT',
        sourceId,
        tenantId: payment.tenantId,
        targetAssignmentId: payment.targetAssignmentId,
        targetWallet: payment.targetWallet,
        targetWalletNormalized: payment.targetWalletNormalized,
        fiatAmountMinor: payment.tvdQuote.fiatAmountMinor,
        fiatCurrency: payment.tvdQuote.fiatCurrency,
        bobPerToken: payment.tvdQuote.bobPerToken,
        exchangeRateVersion: payment.tvdQuote.exchangeRateVersion,
        tokenAmount: payment.tvdQuote.tokenAmount,
        tokenAmountSmallestUnit: payment.tvdQuote.tokenAmountSmallestUnit,
        status,
        attempts: 0,
        lastErrorCode: validation.reasonCode ?? null,
        createdBy: payment.requestedByUserId,
      });

      await this.recordAuditSafely(
        status === 'PENDING'
          ? 'TVD_QR_ACCREDITATION_CREATED'
          : 'TVD_QR_ACCREDITATION_BLOCKED',
        {
          payment,
          accreditation: created,
          context,
          reasonCode: validation.reasonCode ?? null,
        },
      );

      return {
        accreditationId: created._id,
        status: created.status,
        tokenAmount: created.tokenAmount,
        reasonCode: created.lastErrorCode ?? null,
        reused: false,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        const existingAfterRace = await this.accreditationModel
          .findOne({ sourceType: 'QR_PAYMENT', sourceId })
          .lean();
        if (existingAfterRace) {
          await this.recordAuditSafely('TVD_QR_ACCREDITATION_REUSED', {
            payment,
            accreditation: existingAfterRace,
            context,
            reasonCode: existingAfterRace.lastErrorCode ?? null,
          });
          return {
            accreditationId: existingAfterRace._id,
            status: existingAfterRace.status,
            tokenAmount: existingAfterRace.tokenAmount,
            reasonCode: existingAfterRace.lastErrorCode ?? null,
            reused: true,
          };
        }
      }
      throw error;
    }
  }

  private async validatePaymentForAccreditation(payment: any): Promise<{
    canCreateAccreditation: boolean;
    reasonCode?: string | null;
  }> {
    if (!payment.targetAssignmentId) {
      return {
        canCreateAccreditation: false,
        reasonCode: 'TVD_PAYMENT_TARGET_ASSIGNMENT_MISSING',
      };
    }
    if (!payment.targetWallet || !payment.targetWalletNormalized) {
      return {
        canCreateAccreditation: false,
        reasonCode: 'TVD_PAYMENT_TARGET_WALLET_MISSING',
      };
    }
    if (!isAddress(payment.targetWallet) || getAddress(payment.targetWallet) === zeroAddress) {
      return {
        canCreateAccreditation: false,
        reasonCode: 'TVD_PAYMENT_TARGET_WALLET_INVALID',
      };
    }

    const quoteValidation = this.validateQuote(payment);
    if (quoteValidation) {
      return quoteValidation.canCreateAccreditation === false
        ? quoteValidation
        : { canCreateAccreditation: true, reasonCode: quoteValidation.reasonCode };
    }

    const tenant = await this.tenantModel.findById(payment.tenantId, { active: 1 }).lean();
    if (!tenant?.active) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_TENANT_INACTIVE' };
    }

    const assignment = await this.assignmentModel
      .findById(payment.targetAssignmentId)
      .lean();
    if (!assignment || String(assignment.tenantId) !== String(payment.tenantId)) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_ASSIGNMENT_TENANT_MISMATCH' };
    }
    if (!assignment.active || assignment.status !== 'APPROVED') {
      return { canCreateAccreditation: true, reasonCode: 'TVD_ASSIGNMENT_NOT_APPROVED' };
    }

    const user = await this.userModel.findById(assignment.userId, { active: 1 }).lean();
    if (!user?.active) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_INSTITUTIONAL_USER_INACTIVE' };
    }

    const walletState = getTenantWalletVerificationState(assignment);
    if (!walletState.hasWallet) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_WALLET_MISSING' };
    }
    const currentWallet = normalizeTenantWalletAddress(assignment.accountAddress);
    if (!currentWallet || !isAddress(currentWallet) || getAddress(currentWallet) === zeroAddress) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_WALLET_NOT_VERIFIED' };
    }
    if (currentWallet.toLowerCase() !== String(payment.targetWalletNormalized)) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_WALLET_CHANGED' };
    }
    if (!walletState.isWalletVerified) {
      return { canCreateAccreditation: true, reasonCode: 'TVD_WALLET_NOT_VERIFIED' };
    }

    return { canCreateAccreditation: true, reasonCode: null };
  }

  private validateQuote(payment: any) {
    const quote = payment.tvdQuote;
    if (!quote) {
      return {
        canCreateAccreditation: false,
        reasonCode: 'TVD_QUOTE_MISSING',
      };
    }
    if (
      quote.fiatAmountMinor !== payment.amountMinor ||
      quote.fiatCurrency !== payment.currency
    ) {
      return {
        canCreateAccreditation: true,
        reasonCode: 'TVD_QUOTE_FIAT_MISMATCH',
      };
    }
    if (
      !quote.bobPerToken ||
      typeof quote.exchangeRateVersion !== 'number' ||
      !POSITIVE_DECIMAL_REGEX.test(String(quote.tokenAmount ?? '')) ||
      !POSITIVE_INTEGER_REGEX.test(String(quote.tokenAmountSmallestUnit ?? ''))
    ) {
      return {
        canCreateAccreditation: false,
        reasonCode: 'TVD_QUOTE_INVALID',
      };
    }
    const expectedSmallestUnit = this.toSmallestUnits(
      quote.tokenAmount,
      this.getConfiguredDecimals(),
    );
    if (expectedSmallestUnit !== quote.tokenAmountSmallestUnit) {
      return {
        canCreateAccreditation: true,
        reasonCode: 'TVD_DECIMALS_MISMATCH',
      };
    }
    return null;
  }

  private toSmallestUnits(tokenAmount: string, decimals: number) {
    const [whole, fraction = ''] = tokenAmount.split('.');
    if (fraction.length > decimals) return '';
    return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`).toString();
  }

  private getConfiguredDecimals() {
    const raw = String(this.configService.get<string>('app.tvd.decimals') ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) return -1;
    const decimals = Number(raw);
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36
      ? decimals
      : -1;
  }

  private async recordAuditSafely(
    action:
      | 'TVD_QR_ACCREDITATION_CREATED'
      | 'TVD_QR_ACCREDITATION_REUSED'
      | 'TVD_QR_ACCREDITATION_NEEDS_REVIEW'
      | 'TVD_QR_ACCREDITATION_BLOCKED',
    input: {
      payment: any;
      context: { source: 'WEBHOOK' | 'RECONCILIATION' | 'MOCK' };
      accreditation?: any;
      reasonCode?: string | null;
    },
  ) {
    try {
      await this.auditService.record({
        tenantId: input.payment.tenantId,
        actor: {
          sub: String(input.payment.requestedByUserId),
          role: 'INSTITUTIONAL_PAYMENT',
          active: true,
        },
        action,
        targetType: 'TokenAccreditation',
        targetId: input.accreditation?._id ?? null,
        assignmentId: input.payment.targetAssignmentId ?? null,
        reason: input.reasonCode ?? null,
        correlationId: String(input.payment._id),
        newState: {
          paymentId: String(input.payment._id),
          providerReference: input.payment.providerReference ?? null,
          merchantReference: input.payment.merchantReference ?? null,
          source: input.context.source,
          tokenAccreditationId: input.accreditation?._id
            ? String(input.accreditation._id)
            : null,
          tokenAmount:
            input.accreditation?.tokenAmount ?? input.payment.tvdQuote?.tokenAmount ?? null,
          tokenAmountSmallestUnit:
            input.accreditation?.tokenAmountSmallestUnit ??
            input.payment.tvdQuote?.tokenAmountSmallestUnit ??
            null,
          status: input.accreditation?.status ?? 'BLOCKED_CONFIGURATION',
          targetWallet: input.payment.targetWallet ?? null,
          reasonCode: input.reasonCode ?? null,
        },
      });
    } catch {
      // Fiat confirmation and accreditation idempotency must remain recoverable
      // even if audit persistence is temporarily unavailable.
    }
  }
}
