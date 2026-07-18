import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomInt } from 'crypto';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@/core/services/logger.service';
import { CreateQrPaymentDto } from '../dto/create-qr-payment.dto';
import { PaymentListQueryDto } from '../dto/payment-query.dto';
import { toPublicPaymentDto } from '../dto/payment-response.dto';
import { ReconcilePaymentDto } from '../dto/reconcile-payment.dto';
import { PaymentDomainError } from '../errors/payment-domain.error';
import {
  PAYMENT_PROVIDER_RED_ENLACE,
  PaymentStatus,
  QR_PAYMENT_PROVIDER,
  RED_ENLACE_BRANCH_CODE,
  RED_ENLACE_BRANCH_NAME,
  RED_ENLACE_BUSINESS_CATEGORY,
  RED_ENLACE_QR_TTL_DEFAULT,
  RED_ENLACE_REFERENCE_MAX_LENGTH,
  validPaymentTransitions,
} from '../payments.constants';
import { QrPaymentProvider, VerifyQrResult } from '../providers/qr-payment-provider.interface';
import {
  PaymentTvdQuoteSnapshot,
  PaymentTransaction,
  PaymentTransactionDocument,
} from '../schemas/payment-transaction.schema';
import {
  assertMinorWithinBounds,
  parseBobAmountToMinor,
} from '../utils/money.util';
import {
  RED_ENLACE_ACTIVE_QR_STATUSES,
  mapRedEnlaceStatus,
  normalizeRedEnlaceStatus,
} from '../utils/payment-status.mapper';
import {
  buildRedEnlaceGlosa,
  sanitizeProviderDetail,
} from '../utils/red-enlace-glosa.util';
import { parseRedEnlaceQrTtl } from '../utils/red-enlace-ttl.util';
import { PaymentTenantAccessService } from './payment-tenant-access.service';
import { TvdQuotesService } from '@/modules/tvd/services/tvd-quotes.service';
import { TvdQrAccreditationsService } from '@/modules/tvd/services/tvd-qr-accreditations.service';

@Injectable()
export class PaymentTransactionsService {
  private readonly context = 'PaymentTransactionsService';

  constructor(
    @InjectModel(PaymentTransaction.name)
    private readonly paymentModel: Model<PaymentTransactionDocument>,
    @Inject(QR_PAYMENT_PROVIDER)
    private readonly provider: QrPaymentProvider,
    private readonly tenantAccess: PaymentTenantAccessService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    @Optional()
    private readonly tvdQuotes?: TvdQuotesService,
    @Optional()
    private readonly tvdQrAccreditations?: TvdQrAccreditationsService,
  ) {}

  async createQrPayment(
    dto: CreateQrPaymentDto,
    requester: any,
    idempotencyKey?: string,
  ) {
    const tenant = await this.tenantAccess.resolveTenantForWrite(
      requester,
      dto.tenantId,
    );
    const requestedByUserId = this.tenantAccess.getRequesterObjectId(requester);
    const amountMinor = parseBobAmountToMinor(dto.amount);
    this.assertAmountBounds(amountMinor);

    const normalizedIdempotencyKey = this.normalizeIdempotencyKey(idempotencyKey);
    const requestHash = this.hashRequest({
      tenantId: String(tenant._id),
      userId: String(requestedByUserId),
      amountMinor,
      currency: dto.currency,
      description: dto.description,
    });

    if (normalizedIdempotencyKey) {
      const existing = await this.paymentModel
        .findOne({
          tenantId: tenant._id,
          requestedByUserId,
          idempotencyKey: normalizedIdempotencyKey,
        })
        .lean();

      if (existing) {
        if (existing.idempotencyRequestHash !== requestHash) {
          throw new ConflictException('Idempotency-Key usada con otro payload');
        }
        return toPublicPaymentDto(existing, { includeQr: true });
      }
    }

    const paymentTarget = await this.tenantAccess.resolvePaymentTargetForRequester(
      tenant._id as Types.ObjectId,
      requester,
    );

    const tvdQuote = this.tvdQuotes
      ? await this.tvdQuotes.createPaymentQuoteSnapshot({
          amountMinor,
          currency: dto.currency,
        })
      : null;

    const payment = await this.createPaymentWithUniqueReference({
      tenantId: tenant._id as Types.ObjectId,
      requestedByUserId,
      amountMinor,
      currency: dto.currency,
      idempotencyKey: normalizedIdempotencyKey,
      idempotencyRequestHash: requestHash,
      targetAssignmentId: paymentTarget.targetAssignmentId,
      targetWallet: paymentTarget.targetWallet,
      targetWalletNormalized: paymentTarget.targetWalletNormalized,
      tvdQuote,
    });

    await this.transitionPayment(payment._id, 'CREATED', 'QR_REQUESTING');

    const expiresAt = this.calculateQrExpiresAt();
    const glosa = buildRedEnlaceGlosa({
      branchCode: RED_ENLACE_BRANCH_CODE,
      branchName: RED_ENLACE_BRANCH_NAME,
      businessCategory: RED_ENLACE_BUSINESS_CATEGORY,
      customerGloss: this.buildCustomerGloss(payment.merchantReference),
    });

    try {
      const result = await this.provider.generateQr({
        merchantReference: payment.merchantReference,
        amountMinor,
        currency: dto.currency,
        glosa,
        description: dto.description,
        expiresAt,
      });

      this.assertProviderGenerateResult(payment, amountMinor, dto.currency, result);
      const providerStatus = normalizeRedEnlaceStatus(result.providerStatus);
      if (!RED_ENLACE_ACTIVE_QR_STATUSES.has(providerStatus)) {
        const mapping = mapRedEnlaceStatus({
          providerStatus,
          responseCode: result.responseCode,
          source: 'RECONCILIATION',
        });
        const updated = await this.paymentModel.findOneAndUpdate(
          { _id: payment._id, status: 'QR_REQUESTING' },
          {
            $set: {
              providerReference: result.providerReference,
              providerStatus,
              providerResponseCode: result.responseCode ?? null,
              providerResponseDetail: sanitizeProviderDetail(result.responseDetail),
              status: mapping.status,
            },
          },
          { new: true },
        );

        return toPublicPaymentDto(updated ?? payment, { includeQr: true });
      }

      const updated = await this.paymentModel.findOneAndUpdate(
        { _id: payment._id, status: 'QR_REQUESTING' },
        {
          $set: {
            providerReference: result.providerReference,
            providerStatus,
            providerResponseCode: result.responseCode ?? null,
            providerResponseDetail: sanitizeProviderDetail(result.responseDetail),
            qrImage: result.qrImage,
            qrExpiresAt: result.qrExpiresAt ?? expiresAt,
            status: 'QR_ACTIVE',
          },
        },
        { new: true },
      );

      if (!updated) {
        throw new PaymentDomainError(
          'PAYMENT_MANUAL_REVIEW_REQUIRED',
          'No se pudo activar el QR',
          409,
        );
      }

      this.logger.log(
        JSON.stringify({
          event: 'payment_qr_active',
          paymentId: String(updated._id),
          tenantId: String(updated.tenantId),
          requestedByUserId: String(updated.requestedByUserId),
          merchantReference: updated.merchantReference,
          providerReference: updated.providerReference,
        }),
        this.context,
      );

      return toPublicPaymentDto(updated, { includeQr: true });
    } catch (error) {
      if (error instanceof PaymentDomainError) {
        await this.paymentModel.updateOne(
          { _id: payment._id, status: 'QR_REQUESTING' },
          {
            $set: {
              status:
                error.code === 'RED_ENLACE_REFERENCE_MISMATCH' ||
                error.code === 'RED_ENLACE_AMOUNT_MISMATCH' ||
                error.code === 'RED_ENLACE_CURRENCY_MISMATCH'
                  ? 'MISMATCH'
                  : 'FAILED',
              providerResponseDetail: error.message.slice(0, 240),
            },
          },
        );
        throw this.toHttpError(error);
      }

      await this.paymentModel.updateOne(
        { _id: payment._id, status: 'QR_REQUESTING' },
        { $set: { status: 'FAILED' } },
      );
      throw error;
    }
  }

  async getPayment(paymentId: string, requester: any) {
    const payment = await this.getPaymentDocumentOrThrow(paymentId);
    await this.tenantAccess.assertTenantAccess(String(payment.tenantId), requester);
    return toPublicPaymentDto(payment, { includeQr: true });
  }

  async listPayments(query: PaymentListQueryDto, requester: any) {
    const tenantIds = await this.tenantAccess.resolveTenantIdsForRead(
      requester,
      query.tenantId,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter: Record<string, any> = { tenantId: { $in: tenantIds } };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = new Date(query.from);
      if (query.to) filter.createdAt.$lte = new Date(query.to);
    }

    const [items, total] = await Promise.all([
      this.paymentModel
        .find(filter, { qrImage: 0 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);

    return {
      items: items.map((payment) => toPublicPaymentDto(payment, { includeQr: false })),
      page,
      limit,
      total,
    };
  }

  async reconcilePayment(
    paymentId: string,
    requester: any,
    dto: ReconcilePaymentDto,
  ) {
    if (requester?.role !== 'ADMIN') {
      throw new BadRequestException('Conciliacion requiere administrador global');
    }

    const payment = await this.getPaymentDocumentOrThrow(paymentId);
    if (!payment.providerReference) {
      throw new BadRequestException('La operacion no tiene referencia de proveedor');
    }

    const result = await this.provider.verifyQr({
      providerReference: payment.providerReference,
      mockStatus: dto.mockStatus,
    });

    const updated = await this.applyProviderResult(payment, result, 'RECONCILIATION');
    return toPublicPaymentDto(updated ?? payment, { includeQr: true });
  }

  async applyWebhookConfirmation(input: {
    providerReference: string;
    providerStatus?: string | null;
    responseCode?: string | null;
    responseDetail?: string | null;
    amountMinor?: string | null;
    currency?: string | null;
    achReference?: string | null;
    paymentDate?: Date | null;
  }) {
    const payment = await this.paymentModel
      .findOne({
        provider: PAYMENT_PROVIDER_RED_ENLACE,
        providerReference: input.providerReference,
      })
      .exec();

    if (!payment) {
      throw new PaymentDomainError('PAYMENT_NOT_FOUND', 'Pago no encontrado', 404);
    }

    return this.applyProviderResult(
      payment,
      {
        providerReference: input.providerReference,
        providerStatus: input.providerStatus || input.responseCode || 'UNKNOWN',
        responseCode: input.responseCode ?? undefined,
        responseDetail: input.responseDetail ?? undefined,
        amountMinor: input.amountMinor ?? undefined,
        currency: input.currency ?? undefined,
        achReference: input.achReference ?? null,
        paymentDate: input.paymentDate ?? null,
      },
      'WEBHOOK',
    );
  }

  private async applyProviderResult(
    payment: PaymentTransactionDocument,
    result: VerifyQrResult,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ) {
    if (payment.status === 'PAYMENT_CONFIRMED') {
      const providerStatus = normalizeRedEnlaceStatus(result.providerStatus);
      if (providerStatus === 'SUCCESS' || result.responseCode === '00') {
        return this.ensureQrAccreditationForConfirmedPayment(payment, source);
      }
      return payment;
    }

    if (result.amountMinor && result.amountMinor !== payment.amountMinor) {
      await this.markMismatch(payment, 'RED_ENLACE_AMOUNT_MISMATCH', result);
      throw new PaymentDomainError(
        'RED_ENLACE_AMOUNT_MISMATCH',
        'Monto de Red Enlace no coincide',
        409,
      );
    }

    if (result.currency && result.currency !== payment.currency) {
      await this.markMismatch(payment, 'RED_ENLACE_CURRENCY_MISMATCH', result);
      throw new PaymentDomainError(
        'RED_ENLACE_CURRENCY_MISMATCH',
        'Moneda de Red Enlace no coincide',
        409,
      );
    }

    const mapping = mapRedEnlaceStatus({
      providerStatus: result.providerStatus,
      responseCode: result.responseCode,
      source,
      hasSuccessEvidence: payment.providerStatus === 'SUCCESS',
    });

    if (mapping.status === 'QR_ACTIVE') {
      await this.paymentModel.updateOne(
        { _id: payment._id },
        {
          $set: {
            providerStatus: result.providerStatus,
            providerResponseCode: result.responseCode ?? null,
            providerResponseDetail: sanitizeProviderDetail(result.responseDetail),
          },
        },
      );
      return this.getPaymentDocumentOrThrow(String(payment._id));
    }

    if (this.shouldMoveLateWebhookApprovalToManualReview(payment, mapping.status, source)) {
      return this.moveLateWebhookApprovalToManualReview(payment, result);
    }

    const allowedFrom =
      mapping.status === 'PAYMENT_CONFIRMED'
        ? ['QR_ACTIVE']
        : ['QR_ACTIVE', 'MISMATCH'];

    const updated = (await this.paymentModel
      .findOneAndUpdate(
        {
        _id: payment._id,
        status: { $in: allowedFrom },
        } as any,
        {
        $set: {
          status: mapping.status,
          providerStatus: result.providerStatus,
          providerResponseCode: result.responseCode ?? null,
          providerResponseDetail: sanitizeProviderDetail(result.responseDetail),
          achReference: result.achReference ?? null,
          paymentDate: result.paymentDate ?? null,
          confirmedAt:
            mapping.status === 'PAYMENT_CONFIRMED' ? new Date() : payment.confirmedAt,
          confirmationSource:
            mapping.status === 'PAYMENT_CONFIRMED' ? source : payment.confirmationSource,
        },
        } as any,
        { new: true },
      )
      .exec()) as PaymentTransactionDocument | null;

    if (!updated) {
      return this.getPaymentDocumentOrThrow(String(payment._id));
    }

    this.logger.log(
      JSON.stringify({
        event: 'payment_status_changed',
        paymentId: String(updated._id),
        tenantId: String(updated.tenantId),
        requestedByUserId: String(updated.requestedByUserId),
        merchantReference: updated.merchantReference,
        providerReference: updated.providerReference,
        newStatus: updated.status,
        confirmationSource: updated.confirmationSource,
      }),
      this.context,
    );

    if (updated.status === 'PAYMENT_CONFIRMED') {
      return this.ensureQrAccreditationForConfirmedPayment(updated, source);
    }
    return updated;
  }

  private shouldMoveLateWebhookApprovalToManualReview(
    payment: PaymentTransactionDocument,
    mappedStatus: PaymentStatus,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ) {
    return (
      source === 'WEBHOOK' &&
      mappedStatus === 'PAYMENT_CONFIRMED' &&
      ['EXPIRED', 'FAILED', 'CANCELLED'].includes(payment.status)
    );
  }

  private async moveLateWebhookApprovalToManualReview(
    payment: PaymentTransactionDocument,
    result: VerifyQrResult,
  ) {
    const updated = (await this.paymentModel
      .findOneAndUpdate(
        {
          _id: payment._id,
          status: { $in: ['EXPIRED', 'FAILED', 'CANCELLED'] },
        } as any,
        {
          $set: {
            status: 'MANUAL_REVIEW',
            providerStatus: result.providerStatus,
            providerResponseCode: result.responseCode ?? null,
            providerResponseDetail: sanitizeProviderDetail(result.responseDetail),
            achReference: result.achReference ?? null,
            paymentDate: result.paymentDate ?? null,
          },
        } as any,
        { new: true },
      )
      .exec()) as PaymentTransactionDocument | null;

    return updated ?? this.getPaymentDocumentOrThrow(String(payment._id));
  }

  private async createPaymentWithUniqueReference(input: {
    tenantId: Types.ObjectId;
    requestedByUserId: Types.ObjectId;
    targetAssignmentId: Types.ObjectId;
    targetWallet: string;
    targetWalletNormalized: string;
    amountMinor: string;
    currency: 'BOB';
    idempotencyKey?: string | null;
    idempotencyRequestHash?: string | null;
    tvdQuote?: PaymentTvdQuoteSnapshot | null;
  }) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.paymentModel.create({
          ...input,
          provider: PAYMENT_PROVIDER_RED_ENLACE,
          merchantReference: this.generateMerchantReference(),
          status: 'CREATED',
          tvdQuote: input.tvdQuote ?? null,
        });
      } catch (error: any) {
        if (error?.code === 11000 && error?.keyPattern?.merchantReference) {
          continue;
        }
        if (error?.code === 11000 && error?.keyPattern?.idempotencyKey) {
          const existing = await this.paymentModel.findOne({
            tenantId: input.tenantId,
            requestedByUserId: input.requestedByUserId,
            idempotencyKey: input.idempotencyKey,
          });
          if (existing) return existing;
        }
        throw error;
      }
    }

    throw new InternalServerErrorException('No se pudo generar referencia unica');
  }

  private async ensureQrAccreditationForConfirmedPayment(
    payment: PaymentTransactionDocument,
    source: 'WEBHOOK' | 'RECONCILIATION',
  ) {
    if (!this.tvdQrAccreditations) return payment;

    try {
      const result =
        await this.tvdQrAccreditations.createOrReuseForConfirmedPayment(payment, {
          source,
        });

      await this.paymentModel.updateOne(
        { _id: payment._id },
        {
          $set: {
            tokenAccreditationId: result.accreditationId ?? null,
            tokenAccreditationStatus: result.status,
            tokenAccreditationErrorCode: result.reasonCode ?? null,
          },
        },
      );
      return this.getPaymentDocumentOrThrow(String(payment._id));
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'tvd_qr_accreditation_creation_pending',
          paymentId: String(payment._id),
          tenantId: String(payment.tenantId),
          providerReference: payment.providerReference,
          code: 'TVD_ACCREDITATION_CREATION_PENDING',
        }),
        this.context,
      );
      await this.paymentModel.updateOne(
        { _id: payment._id },
        {
          $set: {
            tokenAccreditationStatus: 'NEEDS_REVIEW',
            tokenAccreditationErrorCode: 'TVD_ACCREDITATION_CREATION_PENDING',
          },
        },
      );
      return this.getPaymentDocumentOrThrow(String(payment._id));
    }
  }

  private async transitionPayment(
    paymentId: Types.ObjectId,
    from: PaymentStatus,
    to: PaymentStatus,
  ) {
    if (!validPaymentTransitions[from].includes(to)) {
      throw new ConflictException('Transicion de pago invalida');
    }

    const updated = await this.paymentModel.findOneAndUpdate(
      { _id: paymentId, status: from },
      { $set: { status: to } },
      { new: true },
    );
    if (!updated) {
      throw new ConflictException('La operacion cambio de estado');
    }
    return updated;
  }

  private assertProviderGenerateResult(
    payment: PaymentTransactionDocument,
    amountMinor: string,
    currency: string,
    result: any,
  ) {
    if (
      result.originMerchantReference &&
      result.originMerchantReference !== payment.merchantReference
    ) {
      throw new PaymentDomainError(
        'RED_ENLACE_REFERENCE_MISMATCH',
        'Referencia de Red Enlace no coincide',
        409,
      );
    }
    if (result.amountMinor && result.amountMinor !== amountMinor) {
      throw new PaymentDomainError(
        'RED_ENLACE_AMOUNT_MISMATCH',
        'Monto de Red Enlace no coincide',
        409,
      );
    }
    if (result.currency && result.currency !== currency) {
      throw new PaymentDomainError(
        'RED_ENLACE_CURRENCY_MISMATCH',
        'Moneda de Red Enlace no coincide',
        409,
      );
    }
    const providerStatus = normalizeRedEnlaceStatus(result.providerStatus);
    if (!result.providerReference) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }
    if (RED_ENLACE_ACTIVE_QR_STATUSES.has(providerStatus) && !result.qrImage) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }
  }

  private async markMismatch(
    payment: PaymentTransactionDocument,
    code: string,
    result: VerifyQrResult,
  ) {
    await this.paymentModel.updateOne(
      { _id: payment._id, status: 'QR_ACTIVE' },
      {
        $set: {
          status: 'MISMATCH',
          providerStatus: result.providerStatus,
          providerResponseCode: result.responseCode ?? code,
          providerResponseDetail: sanitizeProviderDetail(result.responseDetail ?? code),
        },
      },
    );
  }

  private async getPaymentDocumentOrThrow(paymentId: string) {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new BadRequestException('paymentId invalido');
    }
    const payment = await this.paymentModel.findById(paymentId);
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return payment;
  }

  private generateMerchantReference() {
    return randomInt(1, 1_000_000_000)
      .toString()
      .slice(0, RED_ENLACE_REFERENCE_MAX_LENGTH);
  }

  private normalizeIdempotencyKey(value?: string) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, 120) : null;
  }

  private hashRequest(value: Record<string, string>) {
    return createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
  }

  private buildCustomerGloss(merchantReference: string) {
    return `PAGO ${merchantReference}`.slice(0, 60);
  }

  private calculateQrExpiresAt() {
    const ttl =
      this.configService.get<string>('app.redEnlace.qrTtl') ||
      RED_ENLACE_QR_TTL_DEFAULT;
    return new Date(Date.now() + parseRedEnlaceQrTtl(ttl).milliseconds);
  }

  private assertAmountBounds(amountMinor: string) {
    const min = String(
      this.configService.get<string>('app.redEnlace.minAmountMinor') || '1',
    );
    const max = String(
      this.configService.get<string>('app.redEnlace.maxAmountMinor') ||
        '100000000',
    );
    assertMinorWithinBounds(amountMinor, min, max);
  }

  private toHttpError(error: PaymentDomainError) {
    if (error.httpStatus === 409) return new ConflictException(error.message);
    if (error.httpStatus === 404) return new NotFoundException(error.message);
    if (error.httpStatus === 400) return new BadRequestException(error.message);
    return new HttpException(error.message, error.httpStatus);
  }
}
