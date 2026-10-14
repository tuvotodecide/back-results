import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { LoggerService } from '@/core/services/logger.service';
import { PaymentDomainError } from '../errors/payment-domain.error';
import {
  RED_ENLACE_ACCESS_TOKEN_HEADER,
  RED_ENLACE_CLIENT_ID_HEADER,
  RED_ENLACE_GENERATE_QR_PATH,
  RED_ENLACE_QR_TTL_DEFAULT,
  RED_ENLACE_TRANSACTION_NOT_FOUND_CODE,
  RED_ENLACE_VERIFY_QR_PATH,
  RED_ENLACE_WEBHOOK_AUTH_HEADER,
} from '../payments.constants';
import { parseRedEnlaceDateTime } from '../utils/red-enlace-datetime.util';
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
import { RedEnlaceOAuthService } from './red-enlace-oauth.service';

@Injectable()
export class RedEnlaceQrHttpProvider implements QrPaymentProvider {
  private readonly context = 'RedEnlaceQrHttpProvider';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly oauth: RedEnlaceOAuthService,
    private readonly logger: LoggerService,
  ) {}

  async generateQr(input: GenerateQrInput): Promise<GenerateQrResult> {
    const baseUrl = this.getRequiredBaseUrl();
    const timeout = this.getTimeoutMs();
    const body = {
      numeroReferencia: this.normalizeRedEnlaceReference(input.merchantReference),
      glosa: input.glosa,
      monto: this.minorToProviderAmount(input.amountMinor),
      moneda: input.currency,
      vigencia: this.getQrTtlSeconds(),
      idEstablecimiento: this.getRequiredEstablishmentId(),
      nombreEstablecimiento: this.getRequiredConfig('establishmentName'),
      webhook: {
        url: this.getRequiredConfig('webhookUrl'),
        key: RED_ENLACE_WEBHOOK_AUTH_HEADER,
        value: this.getRequiredConfig('callbackToken'),
      },
    };

    try {
      const response = await this.sendAuthorized((headers) =>
        this.httpService.axiosRef.post(
          `${baseUrl}${RED_ENLACE_GENERATE_QR_PATH}`,
          body,
          { timeout, headers, validateStatus: () => true },
        ),
      );

      if (response.status >= 400 || response.data?.success !== true) {
        this.logRejectedResponse('generate', body.numeroReferencia, response);
      }
      this.assertHttpStatus(response, 'Red Enlace rechazo la solicitud');
      if (response.data?.success !== true) {
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
    const timeout = this.getTimeoutMs();
    const providerReference = this.normalizeRedEnlaceReference(
      input.providerReference,
    );

    try {
      const response = await this.sendAuthorized((headers) =>
        this.httpService.axiosRef.get(
          `${baseUrl}${RED_ENLACE_VERIFY_QR_PATH}/${encodeURIComponent(
            providerReference,
          )}`,
          { timeout, headers, validateStatus: () => true },
        ),
      );

      if (response.status === 404 || this.isTransactionNotFound(response.data)) {
        return {
          providerReference,
          providerStatus: 'NOTFOUND',
          responseCode: '404',
          responseDetail: 'Referencia no encontrada en Red Enlace',
        };
      }
      if (response.status >= 400 || response.data?.success !== true) {
        this.logRejectedResponse('verify', providerReference, response);
      }
      this.assertHttpStatus(response, 'Red Enlace rechazo la consulta');
      if (response.data?.success !== true) {
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

  /**
   * Envia la solicitud con el token OAuth vigente. Si Red Enlace responde 401
   * (token revocado o expirado antes de lo previsto) obtiene uno nuevo y
   * reintenta una sola vez.
   */
  private async sendAuthorized(
    send: (headers: Record<string, string>) => Promise<AxiosResponse>,
  ) {
    const clientId = this.getRequiredConfig('clientId');
    const buildHeaders = (token: string) => ({
      [RED_ENLACE_ACCESS_TOKEN_HEADER]: token,
      [RED_ENLACE_CLIENT_ID_HEADER]: clientId,
    });

    const token = await this.oauth.getAccessToken();
    const response = await send(buildHeaders(token));
    if (response.status !== 401) return response;

    this.oauth.invalidate(token);
    return send(buildHeaders(await this.oauth.getAccessToken()));
  }

  private assertHttpStatus(response: AxiosResponse, rejectedMessage: string) {
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
        rejectedMessage,
        502,
      );
    }
  }

  /**
   * Registra por que Red Enlace rechazo una solicitud. Solo incluye status,
   * message, errors[] y los nombres de campos del body: nunca el token, la
   * imagen QR ni los datos del cliente pagador.
   */
  private logRejectedResponse(
    operation: 'generate' | 'verify',
    reference: string,
    response: AxiosResponse,
  ) {
    const body = response.data;
    const isObject = body != null && typeof body === 'object';

    this.logger.warn(
      JSON.stringify({
        event: 'red_enlace_request_rejected',
        operation,
        reference,
        httpStatus: response.status,
        success: isObject ? (body.success ?? null) : null,
        message: sanitizeProviderDetail(isObject ? body.message : body),
        errors: Array.isArray(body?.errors)
          ? body.errors.slice(0, 10).map((error: any) => ({
              field: sanitizeProviderDetail(error?.field),
              code: sanitizeProviderDetail(error?.code),
              message: sanitizeProviderDetail(error?.message),
            }))
          : null,
        bodyKeys: isObject ? Object.keys(body).slice(0, 20) : typeof body,
      }),
      this.context,
    );
  }

  private isTransactionNotFound(body: any) {
    return (
      Array.isArray(body?.errors) &&
      body.errors.some(
        (error: any) =>
          normalizeRedEnlaceStatus(error?.code) ===
          RED_ENLACE_TRANSACTION_NOT_FOUND_CODE,
      )
    );
  }

  private normalizeGenerateResponse(
    body: any,
    input: GenerateQrInput,
  ): GenerateQrResult {
    const data = body?.data;
    const providerStatus = this.resolveProviderStatus(data?.estado);
    const normalizedQrImage = RED_ENLACE_ACTIVE_QR_STATUSES.has(providerStatus)
      ? this.validateQrImage(data?.qr)
      : data?.qr != null
        ? String(data.qr)
        : '';

    if (!this.hasValue(data?.numeroReferencia)) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }

    const result: GenerateQrResult = {
      providerReference: this.normalizeRedEnlaceReference(data.numeroReferencia),
      originMerchantReference: this.hasValue(data.numeroReferenciaOriginante)
        ? this.normalizeRedEnlaceReference(data.numeroReferenciaOriginante)
        : input.merchantReference,
      amountMinor: this.hasValue(data.monto)
        ? this.providerAmountToMinor(data.monto)
        : undefined,
      currency: this.hasValue(data.moneda)
        ? String(data.moneda).trim().toUpperCase()
        : undefined,
      providerStatus,
      responseCode: providerStatus,
      responseDetail: sanitizeProviderDetail(body?.message),
      qrImage: normalizedQrImage,
      qrExpiresAt: parseRedEnlaceDateTime(data.fechaExpiracion) ?? input.expiresAt,
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
    body: any,
    providerReference: string,
  ): VerifyQrResult {
    const data = body?.data;
    const providerStatus = this.resolveProviderStatus(data?.estado);
    const bank = data?.bancoOrigen;

    return {
      providerReference: this.hasValue(data.numeroReferencia)
        ? this.normalizeRedEnlaceReference(data.numeroReferencia)
        : providerReference,
      originMerchantReference: this.hasValue(data.numeroReferenciaOriginante)
        ? String(data.numeroReferenciaOriginante).trim()
        : undefined,
      amountMinor: this.hasValue(data.importe)
        ? this.providerAmountToMinor(data.importe)
        : undefined,
      currency: this.hasValue(data.moneda)
        ? String(data.moneda).trim().toUpperCase()
        : undefined,
      providerStatus,
      responseCode: providerStatus,
      responseDetail: sanitizeProviderDetail(data.mensaje ?? body?.message),
      achReference: this.hasValue(bank?.numeroOrdenAch)
        ? String(bank.numeroOrdenAch).trim().slice(0, 80)
        : null,
      paymentDate: parseRedEnlaceDateTime(bank?.fechaTransaccion),
    };
  }

  private resolveProviderStatus(value: unknown) {
    const normalized = normalizeRedEnlaceStatus(value as string);
    if (normalized) return normalized;

    throw new PaymentDomainError(
      'RED_ENLACE_INVALID_RESPONSE',
      'Respuesta invalida de Red Enlace',
      502,
    );
  }

  // Red Enlace devuelve cadenas vacias en los campos que aun no aplican.
  private hasValue(value: unknown) {
    return value != null && String(value).trim() !== '';
  }

  private getRequiredBaseUrl() {
    return this.getRequiredConfig('baseUrl').replace(/\/+$/, '');
  }

  private getRequiredConfig(
    key:
      | 'baseUrl'
      | 'clientId'
      | 'establishmentName'
      | 'webhookUrl'
      | 'callbackToken',
  ) {
    const value = this.configService.get<string>(`app.redEnlace.${key}`)?.trim();
    if (!value) {
      throw new PaymentDomainError(
        'RED_ENLACE_NOT_CONFIGURED',
        'Red Enlace no configurado',
        503,
      );
    }
    return value;
  }

  private getRequiredEstablishmentId() {
    const value = Number(
      this.configService.get<string | number>('app.redEnlace.establishmentId'),
    );
    if (!Number.isSafeInteger(value) || value <= 0) {
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

  private getQrTtlSeconds() {
    const ttl =
      this.configService.get<string>('app.redEnlace.qrTtl') ||
      RED_ENLACE_QR_TTL_DEFAULT;
    return parseRedEnlaceQrTtl(ttl).seconds;
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

  // Red Enlace espera monto como Decimal JSON. El limite decimal(10,2) que
  // valida minorToRedEnlaceDecimal cabe exacto en un Number.
  private minorToProviderAmount(amountMinor: string) {
    try {
      return Number(minorToRedEnlaceDecimal(amountMinor));
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
