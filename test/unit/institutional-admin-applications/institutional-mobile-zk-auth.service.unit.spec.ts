const mockCreateAuthorizationRequest = jest.fn();
const mockNewVerifier = jest.fn();
const mockFullVerify = jest.fn();
const mockEthStateResolver = jest.fn();

jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {
    createAuthorizationRequest: (...args: any[]) =>
      mockCreateAuthorizationRequest(...args),
    Verifier: {
      newVerifier: (...args: any[]) => mockNewVerifier(...args),
    },
  },
  resolver: {
    EthStateResolver: mockEthStateResolver,
  },
}));

import { InternalServerErrorException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalMobileZkAuthService } from '@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.service';

describe('InstitutionalMobileZkAuthService', () => {
  const applicationId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const signerUserId = new Types.ObjectId();
  const signerWallet = '0x270cf6f9377a6d2BBE97A3dC42A1Ce90D46363f8';
  const institutionalCallback =
    'https://results.example/api/v1/mobile/institutional-authorizations/auth/callback';
  const officialCallback =
    'https://results.example/api/v1/mobile/official-publication/auth/callback';

  let cache: any;
  let service: InstitutionalMobileZkAuthService;

  const modelReturning = (value: any) => ({
    findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })),
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })),
  });

  const createService = (callbackUrl: string | undefined = institutionalCallback) => {
    cache = {
      store: new Map<string, any>(),
      get: jest.fn(async (key: string) => cache.store.get(key)),
      set: jest.fn(async (key: string, value: any) => cache.store.set(key, value)),
      del: jest.fn(async (key: string) => cache.store.delete(key)),
    };
    mockCreateAuthorizationRequest.mockImplementation((reason, audience, uri) => ({
      body: { reason, audience, callbackUrl: uri, scope: [] },
    }));
    mockFullVerify.mockResolvedValue({ from: 'did:example:institutional-admin', body: {} });
    mockNewVerifier.mockResolvedValue({ fullVerify: mockFullVerify });
    mockEthStateResolver.mockImplementation((rpcUrl, stateContract) => ({ rpcUrl, stateContract }));

    service = new InstitutionalMobileZkAuthService(
      cache,
      {
        get: jest.fn((key: string, fallback?: any) => ({
          'app.institutionalMobileAuth.ttlMs': 600000,
          'app.institutionalMobileAuth.pendingTtlMs': 180000,
          'app.institutionalMobileAuth.callbackUrl': callbackUrl,
          'app.officialPublicationMobileAuth.callbackUrl': officialCallback,
          'app.zkAuth.audience': 'did:example:audience',
          'app.zkAuth.rpcUrl': 'https://rpc.example',
          'app.zkAuth.network': 'polygon:amoy',
          'app.zkAuth.stateContract': '0xState',
          'app.zkAuth.ipfsGatewayUrl': 'https://ipfs.example',
          'app.identity.baseUrl': 'https://identity.example',
          'app.identity.apiKey': 'identity-key',
        } as any)[key] ?? fallback),
      } as any,
      {
        axiosRef: {
          get: jest.fn().mockResolvedValue({
            data: { ok: true, record: { accountAddress: signerWallet } },
          }),
        },
      } as any,
      modelReturning({ _id: applicationId, tenantId }) as any,
      modelReturning({ userId: signerUserId, accountAddress: signerWallet }) as any,
      modelReturning({ _id: signerUserId, dni: '1234567' }) as any,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    createService();
  });

  it('does not fall back to official publication callback for institutional authorization', async () => {
    const result = await service.createAuthRequest(String(applicationId));
    const callbackUrl = String((result.request as any).body.callbackUrl);

    expect(callbackUrl).toMatch(
      /^https:\/\/results\.example\/api\/v1\/mobile\/institutional-authorizations\/auth\/callback\?sessionId=[a-f0-9]{64}$/,
    );
    expect(callbackUrl).not.toContain('/mobile/official-publication/auth/callback');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^institutional-mobile-auth:pending:[a-f0-9]{64}$/),
      expect.objectContaining({
        applicationId: String(applicationId),
        tenantId: String(tenantId),
        signerUserId: String(signerUserId),
      }),
      180000,
    );
  });

  it('resolves an institutional pending session through the institutional callback', async () => {
    const { apiKey, request } = await service.createAuthRequest(String(applicationId));
    const sessionId = String((request as any).body.callbackUrl).split('sessionId=')[1];

    await expect(service.callback(sessionId, 'auth-v2-token')).resolves.toEqual({
      from: 'did:example:institutional-admin',
      body: {},
    });

    expect(mockFullVerify).toHaveBeenCalledWith(
      'auth-v2-token',
      request,
      { acceptedStateTransitionDelay: 5 * 60 * 1000 },
    );
    expect(cache.set).toHaveBeenCalledWith(
      `institutional-mobile-auth:${service.hashApiKey(apiKey)}`,
      expect.objectContaining({
        applicationId: String(applicationId),
        purpose: 'INSTITUTIONAL_AUTHORIZATION',
      }),
      600000,
    );
    expect(cache.del).toHaveBeenCalledWith(
      `institutional-mobile-auth:pending:${sessionId}`,
    );
  });

  it('fails clearly instead of using the official publication callback when institutional configuration is missing', async () => {
    createService('');

    await expect(service.createAuthRequest(String(applicationId))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(mockCreateAuthorizationRequest).not.toHaveBeenCalled();
  });
});
