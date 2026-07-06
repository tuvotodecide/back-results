import { ConfigService } from '@nestjs/config';

import { HealthService } from '@/core/services/health.service';

const mockGeminiGet = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      get: mockGeminiGet,
    },
  })),
}));

jest.mock('firebase-admin', () => ({
  apps: [{}],
}));

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    ping: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
    isOpen: true,
  })),
}));

describe('HealthService external indicators', () => {
  const baseConfig: Record<string, string | number | undefined> = {
    'app.nodeEnv': 'test',
    'app.version': 'test-version',
    'app.ai.gemini.apiKey': 'gemini-key',
    'app.ai.gemini.model': 'gemini-test-model',
    'app.zkAuth.ipfsGatewayUrl': 'https://ipfs.example.test',
    'app.blockchain.chain': 'base-sepolia',
  };

  function createService(configOverrides: Record<string, string | number | undefined> = {}) {
    const configValues = {
      ...baseConfig,
      ...configOverrides,
    };
    const configService = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    const connection = {
      readyState: 1,
      host: 'mongo.local',
      name: 'health-test',
      db: {
        admin: () => ({
          ping: jest.fn().mockResolvedValue({ ok: 1 }),
        }),
      },
    };

    return new HealthService(connection as any, configService);
  }

  beforeEach(() => {
    mockGeminiGet.mockResolvedValue({ name: 'models/gemini-test-model' });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x14a34' }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('valida Gemini, IPFS y RPC con mocks sin exponer secretos', async () => {
    const service = createService();

    const result = await service.getExternalHealthStatus();

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: expect.objectContaining({
          gemini: expect.objectContaining({ status: 'ok', configured: true }),
          ipfsGateway: expect.objectContaining({ status: 'ok', configured: true }),
          blockchainRpc: expect.objectContaining({ status: 'ok', configured: true }),
        }),
      }),
    );
    expect(mockGeminiGet).toHaveBeenCalledWith({ model: 'gemini-test-model' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('gemini-key');
  });

  it('marca externos como skipped cuando falta configuracion', async () => {
    const service = createService({
      'app.ai.gemini.apiKey': '',
      'app.zkAuth.ipfsGatewayUrl': '',
      'app.blockchain.chain': '',
    });

    const result = await service.getExternalHealthStatus();

    expect(result.status).toBe('degraded');
    expect(result.checks.gemini).toEqual(
      expect.objectContaining({ status: 'skipped', configured: false }),
    );
    expect(result.checks.ipfsGateway).toEqual(
      expect.objectContaining({ status: 'skipped', configured: false }),
    );
    expect(result.checks.blockchainRpc).toEqual(
      expect.objectContaining({ status: 'skipped', configured: false }),
    );
    expect(mockGeminiGet).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('marca degraded cuando Gemini, IPFS o RPC fallan', async () => {
    mockGeminiGet.mockRejectedValueOnce(new Error('gemini unavailable'));
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return {
        ok: false,
        json: async () => ({}),
      } as Response;
    });
    const service = createService();

    const result = await service.getExternalHealthStatus();

    expect(result.status).toBe('degraded');
    expect(result.checks.gemini).toEqual(
      expect.objectContaining({ status: 'degraded', configured: true }),
    );
    expect(result.checks.ipfsGateway).toEqual(
      expect.objectContaining({ status: 'degraded', configured: true }),
    );
    expect(result.checks.blockchainRpc).toEqual(
      expect.objectContaining({ status: 'degraded', configured: true }),
    );
  });
});
