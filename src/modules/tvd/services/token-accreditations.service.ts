import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isAddress } from 'viem';
import {
  TokenAccreditation,
  TokenAccreditationDocument,
} from '../schemas/token-accreditation.schema';
import {
  tokenAccreditationSourceTypes,
  TokenAccreditationSourceType,
  TvdFiatCurrency,
} from '../tvd.constants';
import { TvdConversionService } from './tvd-conversion.service';

export type CreatePendingTokenAccreditationInput = {
  sourceType: TokenAccreditationSourceType;
  sourceId: string;
  tenantId: string | Types.ObjectId;
  targetAssignmentId: string | Types.ObjectId;
  targetWallet: string;
  fiatAmountMinor?: string;
  fiatCurrency?: TvdFiatCurrency;
  bobPerToken?: string;
  exchangeRateVersion?: number;
  tokenAmount: string;
  tokenAmountSmallestUnit?: string;
  createdBy: string | Types.ObjectId;
};

@Injectable()
export class TokenAccreditationsService {
  constructor(
    @InjectModel(TokenAccreditation.name)
    private readonly accreditationModel: Model<TokenAccreditationDocument>,
    private readonly conversion: TvdConversionService,
  ) {}

  async createPending(input: CreatePendingTokenAccreditationInput) {
    this.assertSourceType(input.sourceType);
    const targetWallet = this.normalizeWallet(input.targetWallet);
    const tokenAmount = this.conversion.assertPositiveDecimal(
      input.tokenAmount,
      'tokenAmount',
    );
    const tokenAmountSmallestUnit = input.tokenAmountSmallestUnit
      ? this.conversion.assertPositiveInteger(
          input.tokenAmountSmallestUnit,
          'tokenAmountSmallestUnit',
        )
      : null;

    if (input.fiatCurrency && input.fiatCurrency !== 'BOB') {
      throw new BadRequestException('fiatCurrency debe ser BOB');
    }
    if (input.fiatAmountMinor) {
      this.conversion.assertPositiveInteger(input.fiatAmountMinor, 'fiatAmountMinor');
    }
    if (input.bobPerToken) {
      this.conversion.assertPositiveDecimal(input.bobPerToken, 'bobPerToken');
    }

    const document = {
      sourceType: input.sourceType,
      sourceId: String(input.sourceId).trim(),
      tenantId: this.toObjectId(input.tenantId, 'tenantId invalido'),
      targetAssignmentId: this.toObjectId(
        input.targetAssignmentId,
        'targetAssignmentId invalido',
      ),
      targetWallet,
      targetWalletNormalized: targetWallet.toLowerCase(),
      fiatAmountMinor: input.fiatAmountMinor ?? null,
      fiatCurrency: input.fiatCurrency ?? null,
      bobPerToken: input.bobPerToken ?? null,
      exchangeRateVersion: input.exchangeRateVersion ?? null,
      tokenAmount,
      tokenAmountSmallestUnit,
      status: 'PENDING' as const,
      attempts: 0,
      createdBy: this.toObjectId(input.createdBy, 'createdBy invalido'),
    };

    if (!document.sourceId) {
      throw new BadRequestException('sourceId requerido');
    }

    const existing = await this.accreditationModel.findOne({
      sourceType: document.sourceType,
      sourceId: document.sourceId,
    });
    if (existing) return existing;

    try {
      return await this.accreditationModel.create(document as any);
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicated = await this.accreditationModel.findOne({
          sourceType: document.sourceType,
          sourceId: document.sourceId,
        });
        if (duplicated) return duplicated;
        throw new ConflictException('Acreditacion duplicada por origen');
      }
      throw error;
    }
  }

  listByTenant(tenantId: string | Types.ObjectId) {
    return this.accreditationModel
      .find({ tenantId: this.toObjectId(tenantId, 'tenantId invalido') })
      .sort({ createdAt: -1 })
      .lean();
  }

  private assertSourceType(value: string) {
    if (!tokenAccreditationSourceTypes.includes(value as any)) {
      throw new BadRequestException('sourceType invalido');
    }
  }

  private normalizeWallet(value: string) {
    const wallet = String(value ?? '').trim();
    if (!wallet || !isAddress(wallet)) {
      throw new BadRequestException('targetWallet debe ser una direccion EVM valida');
    }
    return wallet;
  }

  private toObjectId(value: string | Types.ObjectId, message: string) {
    if (value instanceof Types.ObjectId) return value;
    if (!Types.ObjectId.isValid(String(value))) {
      throw new BadRequestException(message);
    }
    return new Types.ObjectId(String(value));
  }
}
