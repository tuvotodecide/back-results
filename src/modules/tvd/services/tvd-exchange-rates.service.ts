import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TvdExchangeRate,
  TvdExchangeRateDocument,
} from '../schemas/tvd-exchange-rate.schema';
import { TvdFiatCurrency } from '../tvd.constants';
import { TvdConversionService } from './tvd-conversion.service';

export type CreateTvdExchangeRateInput = {
  currency: TvdFiatCurrency;
  bobPerToken: string;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  createdBy: string | Types.ObjectId;
  idempotencyKey?: string | null;
  idempotencyRequestHash?: string | null;
  reason?: string | null;
};

export type ListTvdExchangeRatesInput = {
  currency?: TvdFiatCurrency;
  active?: boolean;
  current?: boolean;
  page?: number;
  limit?: number;
  at?: Date;
};

@Injectable()
export class TvdExchangeRatesService {
  constructor(
    @InjectModel(TvdExchangeRate.name)
    private readonly exchangeRateModel: Model<TvdExchangeRateDocument>,
    private readonly conversion: TvdConversionService,
  ) {}

  async createActiveRate(input: CreateTvdExchangeRateInput) {
    this.assertBobCurrency(input.currency);
    const bobPerToken = this.conversion.assertPositiveDecimal(
      input.bobPerToken,
      'bobPerToken',
    );
    const createdBy = this.toObjectId(input.createdBy, 'createdBy invalido');
    const effectiveFrom = input.effectiveFrom ?? new Date();
    const effectiveTo = input.effectiveTo ?? null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException('validUntil debe ser posterior a validFrom');
    }
    const idempotencyKey = input.idempotencyKey?.trim() || null;
    const idempotencyRequestHash = input.idempotencyRequestHash?.trim() || null;
    if (idempotencyKey) {
      const existing = await this.exchangeRateModel
        .findOne({ idempotencyKey })
        .lean();
      if (existing) {
        this.assertIdempotentPayload(existing, idempotencyRequestHash);
        return existing;
      }
    }

    const latest = await this.exchangeRateModel
      .findOne({ currency: 'BOB' })
      .sort({ version: -1 })
      .lean();
    const version = Number(latest?.version ?? 0) + 1;

    await this.exchangeRateModel.updateMany(
      { currency: 'BOB', active: true },
      {
        $set: {
          active: false,
          effectiveTo: effectiveFrom,
        },
      },
    );

    try {
      return await this.exchangeRateModel.create({
        currency: 'BOB',
        bobPerToken,
        version,
        active: true,
        effectiveFrom,
        effectiveTo,
        createdBy,
        idempotencyKey,
        idempotencyRequestHash,
        reason: input.reason?.trim() || null,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        if (idempotencyKey) {
          const existing = await this.exchangeRateModel
            .findOne({ idempotencyKey })
            .lean();
          if (existing) {
            this.assertIdempotentPayload(existing, idempotencyRequestHash);
            return existing;
          }
        }
        throw new ConflictException('Ya existe una tasa TVD activa');
      }
      throw error;
    }
  }

  async listRates(input: ListTvdExchangeRatesInput = {}) {
    if (input.currency) {
      this.assertBobCurrency(input.currency);
    }
    const at = input.at ?? new Date();
    const page = Math.max(1, Number(input.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(input.limit ?? 50)));
    const query: Record<string, any> = { currency: input.currency ?? 'BOB' };
    if (typeof input.active === 'boolean') {
      query.active = input.active;
    }
    if (input.current === true) {
      query.active = true;
      query.effectiveFrom = { $lte: at };
      query.$or = [
        { effectiveTo: null },
        { effectiveTo: { $exists: false } },
        { effectiveTo: { $gt: at } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.exchangeRateModel
        .find(query)
        .sort({ version: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.exchangeRateModel.countDocuments(query),
    ]);

    return { data: rows, total, page, limit };
  }

  async resolveActiveRateAt(
    at: Date = new Date(),
    currency: TvdFiatCurrency = 'BOB',
  ) {
    this.assertBobCurrency(currency);
    const rows = await this.exchangeRateModel
      .find({
        currency: 'BOB',
        active: true,
        effectiveFrom: { $lte: at },
        $or: [
          { effectiveTo: null },
          { effectiveTo: { $exists: false } },
          { effectiveTo: { $gt: at } },
        ],
      })
      .sort({ version: -1 })
      .lean();

    if (rows.length > 1) {
      throw new ConflictException('Existe mas de una tasa TVD activa vigente');
    }
    if (!rows.length) {
      throw new NotFoundException('No existe tasa TVD activa vigente');
    }
    return rows[0];
  }

  private assertBobCurrency(currency: string) {
    if (currency !== 'BOB') {
      throw new BadRequestException('currency debe ser BOB');
    }
  }

  private toObjectId(value: string | Types.ObjectId, message: string) {
    if (value instanceof Types.ObjectId) return value;
    if (!Types.ObjectId.isValid(String(value))) {
      throw new BadRequestException(message);
    }
    return new Types.ObjectId(String(value));
  }

  private assertIdempotentPayload(existing: any, expectedHash: string | null) {
    if (!expectedHash || existing.idempotencyRequestHash !== expectedHash) {
      throw new ConflictException({
        code: 'TVD_IDEMPOTENCY_CONFLICT',
        message: 'La clave de idempotencia ya fue utilizada con otro payload',
      });
    }
  }
}
