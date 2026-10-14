import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentDomainError } from '../errors/payment-domain.error';
import { RED_ENLACE_OAUTH_TOKEN_PATH } from '../payments.constants';

// Renueva el token antes de que expire para no usarlo en su ultimo segundo.
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

interface CachedAccessToken {
  value: string;
  expiresAt: number;
}

/**
 * OAuth 2.0 client credentials de Red Enlace. Mantiene el token en memoria
 * hasta poco antes de `expires_in` y comparte una sola solicitud entre
 * llamadas concurrentes.
 */
@Injectable()
export class RedEnlaceOAuthService {
  private cached: CachedAccessToken | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    if (!this.pending) {
      this.pending = this.requestAccessToken().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  /** Descarta el token rechazado por Red Enlace para forzar uno nuevo. */
  invalidate(token: string) {
    if (this.cached?.value === token) {
      this.cached = null;
    }
  }

  private async requestAccessToken(): Promise<string> {
    const credentials = Buffer.from(
      `${this.getRequired('clientId')}:${this.getRequired('clientSecret')}`,
    ).toString('base64');

    const response = await this.httpService.axiosRef.post(
      `${this.getRequiredBaseUrl()}${RED_ENLACE_OAUTH_TOKEN_PATH}`,
      '',
      {
        params: { grant_type: 'client_credentials' },
        timeout: this.getTimeoutMs(),
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        validateStatus: () => true,
      },
    );

    if (response.status >= 500) {
      throw new PaymentDomainError(
        'RED_ENLACE_UNAVAILABLE',
        'Red Enlace no disponible',
        502,
      );
    }
    if (response.status >= 400) {
      throw new PaymentDomainError(
        'RED_ENLACE_UNAUTHORIZED',
        'Red Enlace rechazo la autenticacion',
        502,
      );
    }

    const accessToken = String(response.data?.access_token ?? '').trim();
    const expiresIn = Number(response.data?.expires_in);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new PaymentDomainError(
        'RED_ENLACE_INVALID_RESPONSE',
        'Respuesta invalida de Red Enlace',
        502,
      );
    }

    const lifetimeSeconds =
      expiresIn > TOKEN_EXPIRY_SKEW_SECONDS * 2
        ? expiresIn - TOKEN_EXPIRY_SKEW_SECONDS
        : expiresIn / 2;
    this.cached = {
      value: accessToken,
      expiresAt: Date.now() + lifetimeSeconds * 1000,
    };
    return accessToken;
  }

  private getRequired(key: 'clientId' | 'clientSecret') {
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

  private getTimeoutMs() {
    return this.configService.get<number>('app.redEnlace.httpTimeoutMs') ?? 5000;
  }
}
