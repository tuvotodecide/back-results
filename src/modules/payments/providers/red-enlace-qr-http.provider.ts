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
          numeroReferencia: Number(input.merchantReference),
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

    try {
      const response = await this.httpService.axiosRef.get(
        `${baseUrl}${RED_ENLACE_VERIFY_QR_PATH}/${encodeURIComponent(
          input.providerReference,
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
          providerReference: input.providerReference,
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

      return this.normalizeVerifyResponse(response.data, input.providerReference);
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

    if (!providerReference || !qrImage) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }

    return {
      providerReference: String(providerReference),
      originMerchantReference:
        data?.origenNumeroReferencia != null
          ? String(data.origenNumeroReferencia)
          : input.merchantReference,
      amountMinor:
        data?.monto != null ? this.providerAmountToMinor(String(data.monto)) : undefined,
      currency: data?.moneda != null ? String(data.moneda) : undefined,
      providerStatus: String(data?.estado ?? data?.status ?? 'PENDING'),
      responseCode:
        data?.codigoRespuesta != null ? String(data.codigoRespuesta) : undefined,
      responseDetail: sanitizeProviderDetail(data?.detalleRespuesta),
      qrImage: String(qrImage),
      qrExpiresAt: input.expiresAt,
    };
  }

  private normalizeVerifyResponse(
    data: any,
    providerReference: string,
  ): VerifyQrResult {
    return {
      providerReference:
        data?.numeroReferenciaAtc != null
          ? String(data.numeroReferenciaAtc)
          : providerReference,
      originMerchantReference:
        data?.origenNumeroReferencia != null
          ? String(data.origenNumeroReferencia)
          : undefined,
      amountMinor:
        data?.monto != null ? this.providerAmountToMinor(String(data.monto)) : undefined,
      currency: data?.moneda != null ? String(data.moneda) : undefined,
      providerStatus: String(data?.estado ?? data?.status ?? 'NOTFOUND'),
      responseCode:
        data?.codigoRespuesta != null ? String(data.codigoRespuesta) : undefined,
      responseDetail: sanitizeProviderDetail(data?.detalleRespuesta),
      achReference:
        data?.achReference != null ? String(data.achReference).slice(0, 80) : null,
      paymentDate: data?.fechaPago ? new Date(data.fechaPago) : null,
    };
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
    return (
      this.configService.get<string>('app.redEnlace.qrTtl') ||
      RED_ENLACE_QR_TTL_DEFAULT
    );
  }

  private minorToProviderAmount(amountMinor: string) {
    const padded = amountMinor.padStart(3, '0');
    return Number(`${padded.slice(0, -2)}.${padded.slice(-2)}`);
  }

  private providerAmountToMinor(amount: string) {
    const [whole, decimals = ''] = String(amount).trim().split('.');
    return `${whole}${decimals.padEnd(2, '0').slice(0, 2)}`.replace(
      /^0+(?=\d)/,
      '',
    );
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
