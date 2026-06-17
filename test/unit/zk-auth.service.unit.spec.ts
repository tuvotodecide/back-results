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

import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

describe('ZkAuthService (unit)', () => {
  let service: ZkAuthService;
  let cache: { set: jest.Mock; get: jest.Mock };

  const configValues: Record<string, string | number> = {
    'app.zkAuth.zkAuthTtl': 60,
    'app.zkAuth.callbackUrl': 'https://api.example.com/zk-auth/callback',
    'app.zkAuth.voteCallbackUrl': 'https://api.example.com/vote/callback',
    'app.zkAuth.audience': 'did:example:audience',
    'app.zkAuth.rpcUrl': 'https://mock-rpc.local',
    'app.zkAuth.network': 'polygon:amoy',
    'app.zkAuth.stateContract': '0xState',
    'app.zkAuth.ipfsGatewayUrl': 'https://mock-ipfs.local',
    'app.zkAuth.credContext': 'https://example.com/context.jsonld',
    'app.zkAuth.credType': 'VoteCredential',
    'app.issuer.did': 'did:example:issuer',
  };

  async function buildService(overrides: Record<string, string | number | undefined> = {}) {
    cache = {
      set: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ZkAuthService,
        { provide: CACHE_MANAGER, useValue: cache },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => ({
              ...configValues,
              ...overrides,
            })[key]),
          },
        },
      ],
    }).compile();

    return moduleRef.get(ZkAuthService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreateAuthorizationRequest.mockImplementation(
      (reason: string, audience: string, uri: string) => ({
        id: `${reason}:${uri}`,
        body: {
          reason,
          audience,
          callbackUrl: uri,
          scope: [],
        },
      }),
    );
    mockFullVerify.mockResolvedValue({ body: { scope: [] } });
    mockNewVerifier.mockResolvedValue({ fullVerify: mockFullVerify });
    mockEthStateResolver.mockImplementation((rpcUrl: string, stateContract: string) => ({
      rpcUrl,
      stateContract,
    }));

    service = await buildService();
  });

  it('genera request de autenticación con apiKey y callback sessionId', () => {
    const result = service.getAuthRequest();

    expect(result.apiKey).toEqual(expect.any(String));
    expect(result.apiKey).toHaveLength(64);
    expect(result.request.body.callbackUrl).toContain(
      'https://api.example.com/zk-auth/callback?sessionId=',
    );
    expect(mockCreateAuthorizationRequest).toHaveBeenCalledWith(
      'Auth request to get api-key',
      'did:example:audience',
      expect.stringContaining('sessionId='),
    );
  });

  it('genera request de voto con pruebas de eventId y nullifier', () => {
    const result = service.getVoteRequest();

    expect(result.request.body.scope).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ]),
    );
  });

  it('callback válido verifica proof, guarda apiKey y devuelve respuesta', async () => {
    const { apiKey } = service.getAuthRequest();
    mockFullVerify.mockResolvedValueOnce({ body: { scope: ['ok'] } });

    await expect(service.zkAuthCallback(apiKey, 'mock-proof')).resolves.toEqual({
      body: { scope: ['ok'] },
    });
    expect(mockNewVerifier).toHaveBeenCalledWith(
      expect.objectContaining({
        ipfsGatewayURL: 'https://mock-ipfs.local',
      }),
    );
    expect(mockFullVerify).toHaveBeenCalledWith(
      'mock-proof',
      expect.any(Object),
      { acceptedStateTransitionDelay: 5 * 60 * 1000 },
    );
    expect(cache.set).toHaveBeenCalledWith(`zk-auth:api-key:${apiKey}`, true, 60);
  });

  it('callback con sessionId inválido lanza BadRequestException', async () => {
    await expect(
      service.zkAuthCallback('missing-session', 'mock-proof'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('callback con verificación fallida lanza UnauthorizedException', async () => {
    const { apiKey } = service.getAuthRequest();
    mockFullVerify.mockRejectedValueOnce(new Error('invalid proof'));

    await expect(service.zkAuthCallback(apiKey, 'bad-proof')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('valida apiKey desde cache mockeado', async () => {
    cache.get.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined);

    await expect(service.isApiKeyValid('key-ok')).resolves.toBe(true);
    await expect(service.isApiKeyValid('key-missing')).resolves.toBe(false);
    expect(cache.get).toHaveBeenNthCalledWith(1, 'zk-auth:api-key:key-ok');
    expect(cache.get).toHaveBeenNthCalledWith(2, 'zk-auth:api-key:key-missing');
  });

  it('falla al construir si falta configuración ZK obligatoria', async () => {
    await expect(buildService({ 'app.zkAuth.rpcUrl': undefined })).rejects.toThrow(
      'ZK Auth env variables are not configured',
    );
  });
});
