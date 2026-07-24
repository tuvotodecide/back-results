import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';

type IdentityResolveAccountByDniResponse = {
  registered: boolean;
  accountAddress: string | null;
};

export type InstitutionalWalletResolutionResponse = {
  registered: boolean;
  accountAddress: string | null;
  message?: string;
};

@Injectable()
export class InstitutionalWalletsService {
  private static readonly NOT_FOUND_MESSAGE =
    'No se encontró una billetera registrada para este carnet.';

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async resolveByDni(dni: string): Promise<InstitutionalWalletResolutionResponse> {
    const normalizedDni = this.normalizeDni(dni);
    const identityBaseUrl = this.configService.get<string>('app.identity.baseUrl');
    const identityApiKey = this.configService.get<string>('app.identity.apiKey');
    const timeout = this.configService.get<number>('IDENTITY_HTTP_TIMEOUT_MS', 5000);

    if (!identityBaseUrl || !identityApiKey) {
      throw new ServiceUnavailableException('No se pudo consultar Identity en este momento');
    }

    try {
      const response = await this.httpService.axiosRef.post<IdentityResolveAccountByDniResponse>(
        `${identityBaseUrl.replace(/\/$/, '')}/registry/resolve-account-by-dni`,
        { dni: normalizedDni },
        {
          headers: { 'x-api-key': identityApiKey },
          timeout,
        },
      );

      const data = response?.data;
      if (!data || typeof data.registered !== 'boolean') {
        throw new BadGatewayException('Identity devolvió una respuesta inválida');
      }

      if (!data.registered) {
        return {
          registered: false,
          accountAddress: null,
          message: InstitutionalWalletsService.NOT_FOUND_MESSAGE,
        };
      }

      if (typeof data.accountAddress !== 'string' || !data.accountAddress.trim()) {
        throw new BadGatewayException('Identity devolvió una respuesta inválida');
      }

      return {
        registered: true,
        accountAddress: data.accountAddress.trim(),
      };
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }
      if (this.isAxiosTimeout(error)) {
        throw new GatewayTimeoutException('Identity no respondió a tiempo');
      }
      if (this.isAxiosUnavailable(error)) {
        throw new ServiceUnavailableException('Identity no está disponible en este momento');
      }
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('No se pudo consultar Identity en este momento');
    }
  }

  private normalizeDni(dni: string): string {
    if (typeof dni !== 'string') {
      throw new BadRequestException('dni debe ser string');
    }
    const normalized = dni.trim();
    if (!normalized) {
      throw new BadRequestException('dni es requerido');
    }
    if (normalized.includes(',')) {
      throw new BadRequestException('dni debe contener un solo valor');
    }
    if (normalized.length < 5 || normalized.length > 20) {
      throw new BadRequestException('dni debe tener entre 5 y 20 caracteres');
    }
    if (!/^[A-Za-z0-9-]+$/.test(normalized)) {
      throw new BadRequestException('dni debe ser alfanumerico');
    }
    return normalized;
  }

  private isAxiosTimeout(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as AxiosError).code === 'ECONNABORTED',
    );
  }

  private isAxiosUnavailable(error: unknown): boolean {
    const status = (error as AxiosError | undefined)?.response?.status;
    if (typeof status === 'number' && status >= 500) {
      return true;
    }
    const code = (error as AxiosError | undefined)?.code;
    return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'].includes(String(code ?? ''));
  }
}
