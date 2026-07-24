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

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationMobileZkAuthService } from '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service';

describe('OfficialPublicationMobileZkAuthService', () => {
  const signerUserId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const requestDoc = {
    requestId: 'req-1',
    eventId,
    tenantId,
    signerUserId,
    smartAccountAddress: '0x270cf6f9377a6d2BBE97A3dC42A1Ce90D46363f8',
  };

  let cache: any;
  let service: OfficialPublicationMobileZkAuthService;

  const modelReturning = (value: any) => ({
    findOne: jest.fn(() => ({
      lean: jest.fn().mockResolvedValue(value),
      then: (resolve: any) => resolve(value),
    })),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    cache = {
      store: new Map<string, any>(),
      get: jest.fn(async (key: string) => cache.store.get(key)),
      set: jest.fn(async (key: string, value: any) => cache.store.set(key, value)),
      del: jest.fn(async (key: string) => cache.store.delete(key)),
    };
    mockCreateAuthorizationRequest.mockImplementation((reason, audience, uri) => ({
      body: { reason, audience, callbackUrl: uri, scope: [] },
    }));
    mockFullVerify.mockResolvedValue({ from: 'did:example:admin', body: {} });
    mockNewVerifier.mockResolvedValue({ fullVerify: mockFullVerify });
    mockEthStateResolver.mockImplementation((rpcUrl, stateContract) => ({
      rpcUrl,
      stateContract,
    }));

    service = new OfficialPublicationMobileZkAuthService(
      cache,
      {
        get: jest.fn((key: string, fallback?: any) => ({
          'app.officialPublicationMobileAuth.ttlMs': 600000,
          'app.officialPublicationMobileAuth.pendingTtlMs': 180000,
          'app.officialPublicationMobileAuth.callbackUrl':
            'https://results.example/api/v1/mobile/official-publication/auth/callback',
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
            data: {
              ok: true,
              record: {
                accountAddress: requestDoc.smartAccountAddress,
              },
            },
          }),
        },
      } as any,
      modelReturning(requestDoc) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
      modelReturning({ _id: signerUserId, dni: '1234567' }) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
    );
  });

  it('crea auth request de publicacion con el mismo formato ZK existente y estado pendiente aislado', async () => {
    const result = await service.createAuthRequest('req-1');

    expect(result.apiKey).toHaveLength(64);
    expect(mockCreateAuthorizationRequest).toHaveBeenCalledWith(
      'Auth request to get api-key',
      'did:example:audience',
      expect.stringMatching(
        /^https:\/\/results\.example\/api\/v1\/mobile\/official-publication\/auth\/callback\?sessionId=[a-f0-9]{64}$/,
      ),
    );
    expect(result.request.body).toEqual({
      reason: 'Auth request to get api-key',
      audience: 'did:example:audience',
      callbackUrl: expect.stringContaining('/mobile/official-publication/auth/callback?sessionId='),
      scope: [],
    });
    expect(cache.set.mock.calls[0][0]).toContain(
      'official-publication-mobile-auth:pending:',
    );
    expect(cache.set.mock.calls[0][1]).toMatchObject({
      apiKeyHash: service.hashApiKey(result.apiKey),
      requestId: 'req-1',
      eventId: String(eventId),
      signerUserId: String(signerUserId),
      smartAccountAddress: requestDoc.smartAccountAddress.toLowerCase(),
      request: result.request,
    });
  });

  it('callback valido guarda contexto namespaced derivado de DID verificado', async () => {
    const { apiKey, request } = await service.createAuthRequest('req-1');
    const sessionId = String(request.body.callbackUrl).split('sessionId=')[1];

    await expect(service.callback(sessionId, 'proof')).resolves.toEqual({
      from: 'did:example:admin',
      body: {},
    });

    const apiKeyHash = service.hashApiKey(apiKey);
    expect(cache.set).toHaveBeenCalledWith(
      `official-publication-mobile-auth:${apiKeyHash}`,
      expect.objectContaining({
        apiKeyHash,
        requestId: 'req-1',
        eventId: String(eventId),
        did: 'did:example:admin',
        dni: '1234567',
        subjectId: String(signerUserId),
        purpose: 'OFFICIAL_PUBLICATION',
      }),
      600000,
    );
  });

  it('recupera el auth request del mismo sessionId y resuelve DID despues de verificar', async () => {
    const order: string[] = [];
    const identityHttp = {
      axiosRef: {
        get: jest.fn().mockImplementation(async () => {
          order.push('identity');
          return {
            data: {
              ok: true,
              record: { accountAddress: requestDoc.smartAccountAddress },
            },
          };
        }),
      },
    };
    mockFullVerify.mockImplementationOnce(async () => {
      order.push('verify');
      return { from: 'did:example:admin', body: {} };
    });
    const orderedService = new OfficialPublicationMobileZkAuthService(
      cache,
      (service as any).config,
      identityHttp as any,
      modelReturning(requestDoc) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
      modelReturning({ _id: signerUserId, dni: '1234567' }) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
    );
    const { request } = await orderedService.createAuthRequest('req-1');
    const sessionId = String(request.body.callbackUrl).split('sessionId=')[1];

    await orderedService.callback(sessionId, 'auth-v2-token');

    expect(mockFullVerify).toHaveBeenCalledWith(
      'auth-v2-token',
      request,
      { acceptedStateTransitionDelay: 5 * 60 * 1000 },
    );
    expect(order).toEqual(['verify', 'identity']);
  });

  it('callback invalido no guarda contexto de publicacion', async () => {
    const { request } = await service.createAuthRequest('req-1');
    const sessionId = String(request.body.callbackUrl).split('sessionId=')[1];
    mockFullVerify.mockRejectedValueOnce(new Error('bad proof'));

    await expect(service.callback(sessionId, 'bad')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(cache.set).not.toHaveBeenCalledWith(
      expect.stringContaining('official-publication-mobile-auth:'),
      expect.objectContaining({ purpose: 'OFFICIAL_PUBLICATION' }),
      expect.any(Number),
    );
  });

  it('rechaza DID verificado con wallet distinta al smart account del request', async () => {
    const mismatched = new OfficialPublicationMobileZkAuthService(
      cache,
      (service as any).config,
      {
        axiosRef: {
          get: jest.fn().mockResolvedValue({
            data: { ok: true, record: { accountAddress: '0x0000000000000000000000000000000000000001' } },
          }),
        },
      } as any,
      modelReturning(requestDoc) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
      modelReturning({ _id: signerUserId, dni: '1234567' }) as any,
      modelReturning({ _id: new Types.ObjectId() }) as any,
    );
    const { request } = await mismatched.createAuthRequest('req-1');
    const sessionId = String(request.body.callbackUrl).split('sessionId=')[1];

    await expect(mismatched.callback(sessionId, 'proof')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

});
