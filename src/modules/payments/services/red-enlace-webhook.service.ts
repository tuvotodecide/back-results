import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { LoggerService } from '@/core/services/logger.service';
import {
  RedEnlaceWebhookDto,
  RedEnlaceWebhookResponseDto,
} from '../dto/red-enlace-webhook.dto';
import { PaymentDomainError } from '../errors/payment-domain.error';
import { PAYMENT_PROVIDER_RED_ENLACE } from '../payments.constants';
import {
  PaymentProviderEvent,
  PaymentProviderEventDocument,
} from '../schemas/payment-provider-event.schema';
import { parseBobAmountToMinor } from '../utils/money.util';
import { sanitizeProviderDetail } from '../utils/red-enlace-glosa.util';
import { PaymentTransactionsService } from './payment-transactions.service';

@Injectable()
export class RedEnlaceWebhookService {
  private readonly context = 'RedEnlaceWebhookService';

  constructor(
    @InjectModel(PaymentProviderEvent.name)
    private readonly eventModel: Model<PaymentProviderEventDocument>,
    private readonly payments: PaymentTransactionsService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async receiveWebhook(dto: RedEnlaceWebhookDto): Promise<RedEnlaceWebhookResponseDto> {
    const providerReference = String(dto.numeroReferencia);
    try {
      const amount = this.getWebhookAmount(dto);
      const amountMinor = amount ? parseBobAmountToMinor(amount) : null;
      const providerStatus = dto.estado;
      const responseCode = providerStatus;
      const currency = dto.transacciones?.moneda ?? null;
      const achReference = dto.transacciones?.numeroAch ?? null;
      const paymentDate = dto.transacciones?.fechaHoraTransaccion ?? null;
      const fingerprint = this.fingerprint({
        providerReference,
        providerStatus,
        responseCode: responseCode ?? null,
        amountMinor,
        currency,
        achReference,
        paymentDate,
      });

      const event = await this.createInboxEvent({
        providerReference,
        eventFingerprint: fingerprint,
        providerStatus,
        amountMinor,
        currency,
        achReference,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
      });

      if (event.processingStatus === 'DUPLICATE') {
        if (event.lastErrorCode) {
          return {
            numeroReferencia: providerReference,
            codigoRespuesta: '05',
            detalleRespuesta: this.toResponseDetail(event.lastErrorCode),
          };
        }
        return {
          numeroReferencia: providerReference,
          codigoRespuesta: '00',
          detalleRespuesta: null,
        };
      }

      await this.eventModel.updateOne(
        { _id: event._id },
        { $set: { processingStatus: 'PROCESSING' }, $inc: { attemptCount: 1 } },
      );

      const payment = await this.payments.applyWebhookConfirmation({
        providerReference,
        providerStatus,
        responseCode,
        responseDetail: null,
        amountMinor,
        currency,
        achReference,
        paymentDate: paymentDate ? new Date(paymentDate) : null,
      });

      await this.eventModel.updateOne(
        { _id: event._id },
        {
          $set: {
            processingStatus: 'PROCESSED',
            processedAt: new Date(),
            processingResult: 'PROCESSED',
            paymentId: payment?._id ?? null,
          },
        },
      );

      return {
        numeroReferencia: providerReference,
        codigoRespuesta: '00',
        detalleRespuesta: null,
      };
    } catch (error: any) {
      const code =
        error instanceof PaymentDomainError ? error.code : 'WEBHOOK_PROCESSING_ERROR';
      await this.markLastEventFailed(providerReference, code);
      this.logger.warn(
        JSON.stringify({
          event: 'red_enlace_webhook_failed',
          providerReference,
          code,
        }),
        this.context,
      );
      return {
        numeroReferencia: providerReference,
        codigoRespuesta: '05',
        detalleRespuesta: this.toResponseDetail(code),
      };
    }
  }

  private async createInboxEvent(input: {
    providerReference: string;
    eventFingerprint: string;
    providerStatus: string;
    amountMinor?: string | null;
    currency?: string | null;
    achReference?: string | null;
    paymentDate?: Date | null;
  }) {
    try {
      return await this.eventModel.create({
        provider: PAYMENT_PROVIDER_RED_ENLACE,
        providerReference: input.providerReference,
        eventFingerprint: input.eventFingerprint,
        providerStatus: input.providerStatus,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency ?? null,
        achReference: input.achReference ?? null,
        paymentDate: input.paymentDate ?? null,
        processingStatus: 'RECEIVED',
        authenticationMode:
          this.configService.get<string>('app.redEnlace.webhookAuthMode') ||
          'api-key',
        receivedAt: new Date(),
        attemptCount: 0,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        const existingByFingerprint = await this.eventModel.findOne({
          eventFingerprint: input.eventFingerprint,
        });
        if (existingByFingerprint) {
          existingByFingerprint.processingStatus = 'DUPLICATE';
          return existingByFingerprint;
        }
        if (input.achReference) {
          const existingByAch = await this.eventModel.findOne({
            provider: PAYMENT_PROVIDER_RED_ENLACE,
            achReference: input.achReference,
          });
          if (existingByAch) {
            existingByAch.processingStatus = 'DUPLICATE';
            return existingByAch;
          }
        }
      }
      throw error;
    }
  }

  private async markLastEventFailed(providerReference: string, code: string) {
    await this.eventModel
      .findOneAndUpdate(
        {
          provider: PAYMENT_PROVIDER_RED_ENLACE,
          providerReference,
          processingStatus: { $in: ['RECEIVED', 'PROCESSING'] },
        },
        {
          $set: {
            processingStatus: 'FAILED',
            lastErrorCode: code.slice(0, 80),
            processingResult: this.toResponseDetail(code),
            processedAt: new Date(),
          },
        },
        { sort: { receivedAt: -1 } },
      )
      .exec();
  }

  private getWebhookAmount(dto: RedEnlaceWebhookDto) {
    if (dto.transacciones?.monto != null) {
      return String(dto.transacciones.monto);
    }
    return null;
  }

  private fingerprint(value: Record<string, string | null>) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private toResponseDetail(code: string) {
    if (code === 'RED_ENLACE_AMOUNT_MISMATCH') return 'AMOUNT_MISMATCH';
    if (code === 'RED_ENLACE_CURRENCY_MISMATCH') return 'CURRENCY_MISMATCH';
    return sanitizeProviderDetail(code);
  }
}
