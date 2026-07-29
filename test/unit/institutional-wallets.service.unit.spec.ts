import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InstitutionalWalletsService } from '@/modules/institutional-wallets/services/institutional-wallets.service';

describe('InstitutionalWalletsService', () => {
  const httpService = {
    axiosRef: {
      post: jest.fn(),
      get: jest.fn(),
    },
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'app.identity.baseUrl') return 'https://identity.example.test/';
      if (key === 'app.identity.apiKey') return 'identity-secret-key';
      if (key === 'IDENTITY_HTTP_TIMEOUT_MS') return 2500;
      return fallback;
    }),
  };
  let service: InstitutionalWalletsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InstitutionalWalletsService(httpService as any, configService as any);
  });

  it('resolves a DNI through Identity without exposing the API key in the response', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: {
        registered: true,
        accountAddress: ' 0x1234567890abcdef1234567890abcdef12345678 ',
      },
    });

    const result = await service.resolveByDni(' 12345678 ');

    expect(result).toEqual({
      registered: true,
      accountAddress: '0x1234567890abcdef1234567890abcdef12345678',
    });
    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://identity.example.test/registry/resolve-account-by-dni',
      { dni: '12345678' },
      {
        headers: { 'x-api-key': 'identity-secret-key' },
        timeout: 2500,
      },
    );
    expect(JSON.stringify(result)).not.toContain('identity-secret-key');
  });

  it('returns a controlled not registered response when Identity has no wallet', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: { records: [{ dni: '12345678', did: 'did:example:123' }] },
    });

    await expect(service.resolveByDni('12345678')).resolves.toEqual({
      registered: false,
      accountAddress: null,
      reason: 'WALLET_NOT_FOUND',
      message: 'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
    });
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/get-by-dni',
      {
        params: { dnis: '12345678' },
        headers: { 'x-api-key': 'identity-secret-key' },
        timeout: 2500,
      },
    );
  });

  it('rejects CSV values before calling Identity', async () => {
    await expect(service.resolveByDni('123456,789012')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
  });

  it('maps Identity invalid responses to BadGatewayException', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({ data: { ok: true } });

    await expect(service.resolveByDni('12345678')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('maps Identity timeouts to GatewayTimeoutException', async () => {
    httpService.axiosRef.post.mockRejectedValueOnce({ code: 'ECONNABORTED' });

    await expect(service.resolveByDni('12345678')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
  });

  it('maps Identity unavailability to ServiceUnavailableException without leaking secrets', async () => {
    httpService.axiosRef.post.mockRejectedValueOnce(
      Object.assign(new Error('identity-secret-key ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    await expect(service.resolveByDni('12345678')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
