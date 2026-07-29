import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentDomainError } from '../errors/payment-domain.error';
import {
  RED_ENLACE_API_KEY_HEADER,
  RED_ENLACE_CHANNEL,
  RED_ENLACE_GENERATE_QR_PATH,
  RED_ENLACE_QR_TTL_DEFAULT,
  RED_ENLACE_VERIFY_QR_PATH,
} from '../payments.constants';
import { sanitizeProviderDetail } from '../utils/red-enlace-glosa.util';
import { validateRedEnlaceQrImage } from '../utils/red-enlace-qr-image.util';
import { parseRedEnlaceQrTtl } from '../utils/red-enlace-ttl.util';
import {
  minorToRedEnlaceDecimal,
  parseBobAmountToMinor,
} from '../utils/money.util';
import {
  RED_ENLACE_ACTIVE_QR_STATUSES,
  normalizeRedEnlaceStatus,
} from '../utils/payment-status.mapper';
import {
  GenerateQrInput,
  GenerateQrResult,
  QrPaymentProvider,
  VerifyQrInput,
  VerifyQrResult,
} from './qr-payment-provider.interface';

@Injectable()
export class RedEnlaceQrHttpProvider implements QrPaymentProvider {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async generateQr(input: GenerateQrInput): Promise<GenerateQrResult> {
    const baseUrl = this.getRequiredBaseUrl();
    const apiKey = this.getRequiredApiKey();
    const timeout = this.getTimeoutMs();

    try {
      const response = await this.httpService.axiosRef.post(
        `${baseUrl}${RED_ENLACE_GENERATE_QR_PATH}`,
        {
          numeroReferencia: Number(
            this.normalizeRedEnlaceReference(input.merchantReference),
          ),
          glosa: input.glosa,
          monto: this.minorToProviderAmount(input.amountMinor),
          moneda: input.currency,
          canal: RED_ENLACE_CHANNEL,
          tiempoQr: this.getQrTtl(),
          campoExtra: '',
        },
        {
          timeout,
          headers: { [RED_ENLACE_API_KEY_HEADER]: apiKey },
          validateStatus: () => true,
        },
      );

      if (response.status === 401 || response.status === 403) {
        throw new PaymentDomainError(
          'RED_ENLACE_UNAUTHORIZED',
          'Red Enlace rechazo la autenticacion',
          502,
        );
      }
      if (response.status >= 500) {
        throw new PaymentDomainError(
          'RED_ENLACE_UNAVAILABLE',
          'Red Enlace no disponible',
          502,
        );
      }
      if (response.status >= 400) {
        throw new PaymentDomainError(
          'RED_ENLACE_INVALID_RESPONSE',
          'Red Enlace rechazo la solicitud',
          502,
        );
      }

      return this.normalizeGenerateResponse(response.data, input);
    } catch (error) {
      this.rethrowProviderError(error);
    }
  }

  async verifyQr(input: VerifyQrInput): Promise<VerifyQrResult> {
    const baseUrl = this.getRequiredBaseUrl();
    const apiKey = this.getRequiredApiKey();
    const timeout = this.getTimeoutMs();
    const providerReference = this.normalizeRedEnlaceReference(
      input.providerReference,
    );

    try {
      const response = await this.httpService.axiosRef.get(
        `${baseUrl}${RED_ENLACE_VERIFY_QR_PATH}/${encodeURIComponent(
          providerReference,
        )}`,
        {
          timeout,
          headers: { [RED_ENLACE_API_KEY_HEADER]: apiKey },
          validateStatus: () => true,
        },
      );

      if (response.status === 401 || response.status === 403) {
        throw new PaymentDomainError(
          'RED_ENLACE_UNAUTHORIZED',
          'Red Enlace rechazo la autenticacion',
          502,
        );
      }
      if (response.status === 404) {
        return {
          providerReference,
          providerStatus: 'NOTFOUND',
          responseCode: '404',
          responseDetail: 'Referencia no encontrada en Red Enlace',
        };
      }
      if (response.status >= 500) {
        throw new PaymentDomainError(
          'RED_ENLACE_UNAVAILABLE',
          'Red Enlace no disponible',
          502,
        );
      }
      if (response.status >= 400) {
        throw new PaymentDomainError(
          'RED_ENLACE_INVALID_RESPONSE',
          'Red Enlace rechazo la consulta',
          502,
        );
      }

      return this.normalizeVerifyResponse(response.data, providerReference);
    } catch (error) {
      this.rethrowProviderError(error);
    }
  }

  private normalizeGenerateResponse(
    data: any,
    input: GenerateQrInput,
  ): GenerateQrResult {
    const providerReference =
      data?.numeroReferenciaAtc ??
      data?.numeroReferencia ??
      data?.providerReference ??
      data?.referencia;
    const qrImage =
      data?.imagen ??
      data?.qrImage ??
      data?.imagenQr ??
      data?.qr ??
      data?.qrBase64;
    const providerStatus = this.resolveProviderStatus(data, undefined);
    const normalizedQrImage = RED_ENLACE_ACTIVE_QR_STATUSES.has(providerStatus)
      ? this.validateQrImage(qrImage)
      : qrImage != null
        ? String(qrImage)
        : '';

    if (!providerReference) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }

    const result: GenerateQrResult = {
      providerReference: this.normalizeRedEnlaceReference(providerReference),
      originMerchantReference:
        data?.origenNumeroReferencia != null
          ? this.normalizeRedEnlaceReference(data.origenNumeroReferencia)
          : input.merchantReference,
      amountMinor:
        data?.monto != null ? this.providerAmountToMinor(data.monto) : undefined,
      currency:
        data?.moneda != null ? String(data.moneda).trim().toUpperCase() : undefined,
      providerStatus,
      responseCode:
        data?.codigoRespuesta != null
          ? normalizeRedEnlaceStatus(data.codigoRespuesta)
          : undefined,
      responseDetail: sanitizeProviderDetail(data?.detalleRespuesta),
      qrImage: normalizedQrImage,
      qrExpiresAt: input.expiresAt,
    };

    if (result.originMerchantReference !== input.merchantReference) {
      throw new PaymentDomainError(
        'RED_ENLACE_REFERENCE_MISMATCH',
        'Referencia de Red Enlace no coincide',
        409,
      );
    }
    if (result.amountMinor && result.amountMinor !== input.amountMinor) {
      throw new PaymentDomainError(
        'RED_ENLACE_AMOUNT_MISMATCH',
        'Monto de Red Enlace no coincide',
        409,
      );
    }
    if (result.currency && result.currency !== input.currency) {
      throw new PaymentDomainError(
        'RED_ENLACE_CURRENCY_MISMATCH',
        'Moneda de Red Enlace no coincide',
        409,
      );
    }

    return result;
  }

  private normalizeVerifyResponse(
    data: any,
    providerReference: string,
  ): VerifyQrResult {
    const statusHistory = this.parseStatusHistory(data?.estados);
    const transaction = data?.transacciones;
    const providerStatus = this.resolveProviderStatus(data, statusHistory);

    return {
      providerReference:
        data?.numeroReferenciaAtc != null
          ? this.normalizeRedEnlaceReference(data.numeroReferenciaAtc)
          : data?.numeroReferencia != null
            ? this.normalizeRedEnlaceReference(data.numeroReferencia)
            : providerReference,
      originMerchantReference:
        data?.origenNumeroReferencia != null
          ? String(data.origenNumeroReferencia)
          : undefined,
      amountMinor:
        transaction?.monto != null
          ? this.providerAmountToMinor(transaction.monto)
          : data?.monto != null
            ? this.providerAmountToMinor(data.monto)
            : undefined,
      currency:
        transaction?.moneda != null
          ? String(transaction.moneda).trim().toUpperCase()
          : data?.moneda != null
            ? String(data.moneda).trim().toUpperCase()
            : undefined,
      providerStatus,
      responseCode:
        data?.codigoRespuesta != null
          ? normalizeRedEnlaceStatus(data.codigoRespuesta)
          : undefined,
      responseDetail: sanitizeProviderDetail(data?.detalleRespuesta),
      achReference:
        transaction?.numeroAch != null
          ? String(transaction.numeroAch).slice(0, 80)
          : data?.achReference != null
            ? String(data.achReference).slice(0, 80)
            : null,
      paymentDate:
        transaction?.fechaHoraTransaccion != null
          ? new Date(transaction.fechaHoraTransaccion)
          : data?.fechaPago
            ? new Date(data.fechaPago)
            : null,
      statusHistory,
    };
  }

  private resolveProviderStatus(
    data: any,
    statusHistory?: Array<{ status: string; at?: Date | null }>,
  ) {
    const candidates = [
      data?.codigoRespuesta,
      data?.status,
      data?.estado,
      statusHistory?.[0]?.status,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeRedEnlaceStatus(candidate);
      if (normalized) return normalized;
    }

    throw new PaymentDomainError(
      'RED_ENLACE_INVALID_RESPONSE',
      'Respuesta invalida de Red Enlace',
      502,
    );
  }

  private parseStatusHistory(value: any) {
    if (!Array.isArray(value)) return undefined;

    return value
      .map((entry) => {
        const status = normalizeRedEnlaceStatus(entry?.estado);
        if (!status) return null;
        return {
          status,
          at: entry?.fechaHora ? new Date(entry.fechaHora) : null,
        };
      })
      .filter((entry): entry is { status: string; at: Date | null } => !!entry);
  }

  private getRequiredBaseUrl() {
    const value = this.configService.get<string>('app.redEnlace.baseUrl')?.trim();
    if (!value) {
      throw new PaymentDomainError(
        'RED_ENLACE_NOT_CONFIGURED',
        'Red Enlace no configurado',
        503,
      );
    }
    return value.replace(/\/+$/, '');
  }

  private getRequiredApiKey() {
    const value = this.configService.get<string>('app.redEnlace.apiKey')?.trim();
    if (!value) {
      throw new PaymentDomainError(
        'RED_ENLACE_NOT_CONFIGURED',
        'Red Enlace no configurado',
        503,
      );
    }
    return value;
  }

  private getTimeoutMs() {
    return this.configService.get<number>('app.redEnlace.httpTimeoutMs') ?? 5000;
  }

  private getQrTtl() {
    const ttl =
      this.configService.get<string>('app.redEnlace.qrTtl') ||
      RED_ENLACE_QR_TTL_DEFAULT;
    parseRedEnlaceQrTtl(ttl);
    return ttl;
  }

  private validateQrImage(value: unknown) {
    try {
      return validateRedEnlaceQrImage(value, this.getMaxQrImageBytes());
    } catch {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }
  }

  private getMaxQrImageBytes() {
    const value = this.configService.get<string | number>(
      'app.redEnlace.maxQrImageBytes',
    );
    if (value == null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private normalizeRedEnlaceReference(value: unknown) {
    const reference = String(value ?? '').trim();
    if (!/^[1-9]\d{0,8}$/.test(reference)) {
      throw new PaymentDomainError(
        'RED_ENLACE_REFERENCE_INVALID',
        'Referencia invalida de Red Enlace',
        502,
      );
    }
    return reference;
  }

  private minorToProviderAmount(amountMinor: string) {
    try {
      return minorToRedEnlaceDecimal(amountMinor);
    } catch {
      throw new PaymentDomainError(
        'RED_ENLACE_AMOUNT_INVALID',
        'Monto invalido para Red Enlace',
        400,
      );
    }
  }

  private providerAmountToMinor(amount: unknown) {
    try {
      return parseBobAmountToMinor(String(amount ?? ''));
    } catch {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }
  }

  private rethrowProviderError(error: any): never {
    if (error instanceof PaymentDomainError) {
      throw error;
    }
    const transportError = error as { code?: string };
    if (transportError.code === 'ECONNABORTED') {
      throw new PaymentDomainError(
        'RED_ENLACE_TIMEOUT',
        'Tiempo de espera agotado con Red Enlace',
        504,
      );
    }
    throw new PaymentDomainError(
      'RED_ENLACE_UNAVAILABLE',
      'No se pudo comunicar con Red Enlace',
      502,
    );
  }
}
