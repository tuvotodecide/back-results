import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { InstitutionalAuditService } from '@/modules/institutional-audit/services/institutional-audit.service';
import {
  CreateTvdExchangeRateDto,
  ListTvdExchangeRatesQueryDto,
} from '../dto/tvd-exchange-rate.dto';
import { TvdExchangeRatesService } from './tvd-exchange-rates.service';

const IDEMPOTENCY_KEY_MAX_LENGTH = 120;
const REASON_MAX_LENGTH = 240;

type AdminRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
};

type NormalizedRatePayload = {
  fiatCurrency: 'BOB';
  bobPerToken: string;
  validFrom: string | null;
  validUntil: string | null;
  reason: string;
};

@Injectable()
export class TvdExchangeRateAdminService {
  constructor(
    private readonly exchangeRates: TvdExchangeRatesService,
    private readonly auditService: InstitutionalAuditService,
  ) {}

  async createRate(
    dto: CreateTvdExchangeRateDto,
    requester: AdminRequester,
    idempotencyKey?: string,
  ) {
    const requesterId = this.assertAdminRequester(requester);
    const sourceId = this.normalizeIdempotencyKey(idempotencyKey);
    const reason = this.normalizeReason(dto.reason);
    const effectiveFrom = dto.validFrom ? new Date(dto.validFrom) : new Date();
    const effectiveTo = dto.validUntil ? new Date(dto.validUntil) : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) {
      throw new BadRequestException({
        code: 'TVD_INVALID_RATE_PERIOD',
        message: 'validUntil debe ser posterior a validFrom',
      });
    }

    const payload: NormalizedRatePayload = {
      fiatCurrency: dto.fiatCurrency,
      bobPerToken: String(dto.bobPerToken ?? '').trim(),
      validFrom: dto.validFrom ?? null,
      validUntil: dto.validUntil ?? null,
      reason,
    };
    const idempotencyRequestHash = this.hashPayload(payload);

    let rate: any;
    try {
      rate = await this.exchangeRates.createActiveRate({
        currency: dto.fiatCurrency,
        bobPerToken: payload.bobPerToken,
        effectiveFrom,
        effectiveTo,
        createdBy: requesterId,
        idempotencyKey: sourceId,
        idempotencyRequestHash,
        reason,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw error;
    }

    await this.recordAuditSafely(rate, requester, reason);
    return this.toResponse(rate);
  }

  async listRates(query: ListTvdExchangeRatesQueryDto) {
    const result = await this.exchangeRates.listRates({
      currency: query.currency ?? 'BOB',
      active: this.toOptionalBoolean(query.active),
      current: this.toOptionalBoolean(query.current),
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return {
      ...result,
      data: result.data.map((rate) => this.toResponse(rate)),
    };
  }

  async getCurrentRate() {
    const rate = await this.exchangeRates.resolveActiveRateAt(new Date(), 'BOB');
    return this.toResponse(rate);
  }

  private assertAdminRequester(requester: AdminRequester) {
    if (!requester?.sub || !Types.ObjectId.isValid(String(requester.sub))) {
      throw new UnauthorizedException({
        code: 'TVD_EXCHANGE_RATE_UNAUTHORIZED',
        message: 'Usuario no autenticado',
      });
    }
    if (requester.active === false) {
      throw new UnauthorizedException({
        code: 'TVD_EXCHANGE_RATE_UNAUTHORIZED',
        message: 'Usuario inactivo',
      });
    }
    if (requester.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'TVD_EXCHANGE_RATE_UNAUTHORIZED',
        message: 'Rol global ADMIN requerido',
      });
    }
    return new Types.ObjectId(String(requester.sub));
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

  private hashPayload(payload: NormalizedRatePayload) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private toOptionalBoolean(value?: string) {
    if (value === undefined) return undefined;
    return value === 'true';
  }

  private async recordAuditSafely(rate: any, requester: AdminRequester, reason: string) {
    try {
      await this.auditService.record({
        actor: requester,
        action: 'TVD_EXCHANGE_RATE_CREATED',
        targetType: 'TvdExchangeRate',
        targetId: rate?._id,
        reason,
        correlationId: rate?.idempotencyKey ?? null,
        newState: {
          rateId: String(rate?._id ?? ''),
          fiatCurrency: rate?.currency,
          bobPerToken: rate?.bobPerToken,
          version: rate?.version,
          active: rate?.active,
          effectiveFrom: rate?.effectiveFrom,
          effectiveTo: rate?.effectiveTo ?? null,
        },
      });
    } catch {
      // Rate creation must not be rolled back if audit storage is temporarily unavailable.
    }
  }

  private toResponse(rate: any) {
    const now = new Date();
    const validFrom = rate.effectiveFrom ? new Date(rate.effectiveFrom) : null;
    const validUntil = rate.effectiveTo ? new Date(rate.effectiveTo) : null;
    const current =
      rate.active === true &&
      !!validFrom &&
      validFrom <= now &&
      (!validUntil || validUntil > now);

    return {
      id: String(rate._id),
      fiatCurrency: rate.currency,
      bobPerToken: rate.bobPerToken,
      version: rate.version,
      active: rate.active,
      current,
      validFrom,
      validUntil,
      reason: rate.reason ?? null,
      createdBy: rate.createdBy ? String(rate.createdBy) : null,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    };
  }
}
