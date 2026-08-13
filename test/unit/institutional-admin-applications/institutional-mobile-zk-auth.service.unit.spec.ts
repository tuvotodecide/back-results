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
  const invitationId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const signerUserId = new Types.ObjectId();
  const signerWallet = '0x270cf6f9377a6d2BBE97A3dC42A1Ce90D46363f8';
  const institutionalCallback =
    'https://results.example/api/v1/mobile/institutional-authorizations/auth/callback';
  const officialCallback =
    'https://results.example/api/v1/mobile/official-publication/auth/callback';

  let cache: any;
  let service: InstitutionalMobileZkAuthService;
  let roledUserModel: any;
  let invitationModel: any;
  let storedInvitation: any;

  const modelReturning = (value: any) => ({
    findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })),
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(value) })),
  });

  const createService = (
    callbackUrl: string | undefined = institutionalCallback,
    roledUser: any = { _id: signerUserId, dni: '1234567' },
  ) => {
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

    roledUserModel = modelReturning(roledUser);
    storedInvitation = {
      _id: invitationId,
      tenantId,
      dni: '1234567',
      accountAddress: signerWallet,
      status: 'PENDING',
      expiresAt: new Date('2099-01-01'),
      createdAt: new Date(),
    };
    invitationModel = {
      findById: jest.fn((id: string) => {
        const value = String(id) === String(invitationId) ? storedInvitation : null;
        const result = { lean: jest.fn().mockResolvedValue(value) };
        return { select: jest.fn(() => result), ...result };
      }),
      findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(storedInvitation) })),
      findOneAndUpdate: jest.fn(async (_filter: any, update: any) => {
        if (update.$set?.registrationContinuationState === 'CLAIMED') {
          if (storedInvitation.registrationContinuationState !== 'AVAILABLE') return null;
        }
        Object.assign(storedInvitation, update.$set ?? {});
        for (const key of Object.keys(update.$unset ?? {})) delete storedInvitation[key];
        return storedInvitation;
      }),
      updateOne: jest.fn(async (_filter: any, update: any) => {
        Object.assign(storedInvitation, update.$set ?? {});
        for (const key of Object.keys(update.$unset ?? {})) delete storedInvitation[key];
        return { modifiedCount: 1 };
      }),
    };
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
      invitationModel as any,
      modelReturning({ userId: signerUserId, accountAddress: signerWallet }) as any,
      roledUserModel as any,
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

  it('keeps a completed primary transfer bound to its historical signer', async () => {
    const initiatedByAssignmentId = new Types.ObjectId();
    (service as any).applicationModel = modelReturning({
      _id: applicationId,
      tenantId,
      status: 'APPROVED',
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      approvedBy: signerUserId,
      initiatedByAssignmentId,
      initiatedByWallet: signerWallet,
    });
    (service as any).assignmentModel = modelReturning({
      _id: initiatedByAssignmentId,
      tenantId,
      userId: signerUserId,
      accountAddress: signerWallet,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
    });

    await service.createAuthRequest(String(applicationId));

    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^institutional-mobile-auth:pending:[a-f0-9]{64}$/),
      expect.objectContaining({
        applicationId: String(applicationId),
        signerUserId: String(signerUserId),
        smartAccountAddress: signerWallet.toLowerCase(),
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

  it('emite una solicitud acotada a la invitación sin transportar un token bearer', async () => {
    const result = await service.createInvitationAuthRequest(String(invitationId));

    expect((result.request as any).body.reason).toContain('institutional invitation');
    expect(cache.set).toHaveBeenCalledWith(
      expect.stringMatching(/^institutional-mobile-auth:pending:[a-f0-9]{64}$/),
      expect.objectContaining({
        kind: 'INVITATION',
        invitationId: String(invitationId),
        tenantId: String(tenantId),
      }),
      180000,
    );
    expect(JSON.stringify(result)).not.toContain('invitationToken');
  });

  it('permite completar ZK de una identidad móvil sin RoledUser y reclama una continuación D3 una sola vez', async () => {
    createService(institutionalCallback, null);
    const { apiKey, request } = await service.createInvitationAuthRequest(String(invitationId));
    const sessionId = String((request as any).body.callbackUrl).split('sessionId=')[1];

    await service.callback(sessionId, 'auth-v2-token');
    expect(roledUserModel.findOne).not.toHaveBeenCalled();
    const continuation = await service.issueInvitationRegistrationContinuation(
      service.hashApiKey(apiKey),
    );

    expect(continuation.continuationCode).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      service.getInvitationRegistrationContinuation(
        continuation.continuationCode,
        String(invitationId),
      ),
    ).resolves.toEqual(expect.objectContaining({
      invitationId: String(invitationId),
      tenantId: String(tenantId),
      did: 'did:example:institutional-admin',
      purpose: 'D3_ADMIN_REGISTRATION',
    }));

    const claim = await service.claimInvitationRegistrationContinuation(
      continuation.continuationCode,
      String(invitationId),
    );
    expect(claim.claimId).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      service.claimInvitationRegistrationContinuation(
        continuation.continuationCode,
        String(invitationId),
      ),
    ).rejects.toThrow('already being processed');
    await service.completeInvitationRegistrationContinuation(
      continuation.continuationCode,
      String(invitationId),
      claim.claimId,
      String(applicationId),
    );
    await expect(
      service.claimInvitationRegistrationContinuation(
        continuation.continuationCode,
        String(invitationId),
      ),
    ).rejects.toThrow('already completed');
  });

  it('rechaza continuaciones expiradas o vinculadas a otra invitación', async () => {
    const { apiKey, request } = await service.createInvitationAuthRequest(String(invitationId));
    const sessionId = String((request as any).body.callbackUrl).split('sessionId=')[1];
    await service.callback(sessionId, 'auth-v2-token');
    const continuation = await service.issueInvitationRegistrationContinuation(
      service.hashApiKey(apiKey),
    );

    await expect(
      service.getInvitationRegistrationContinuation(
        continuation.continuationCode,
        String(new Types.ObjectId()),
      ),
    ).rejects.toThrow('mismatch');

    storedInvitation.registrationContinuationExpiresAt = new Date(Date.now() - 1);
    await expect(
      service.getInvitationRegistrationContinuation(
        continuation.continuationCode,
        String(invitationId),
      ),
    ).rejects.toThrow('expired');
  });

  it('reclama atómicamente una continuación cuando dos consumidores compiten', async () => {
    const { apiKey, request } = await service.createInvitationAuthRequest(String(invitationId));
    const sessionId = String((request as any).body.callbackUrl).split('sessionId=')[1];
    await service.callback(sessionId, 'auth-v2-token');
    const continuation = await service.issueInvitationRegistrationContinuation(
      service.hashApiKey(apiKey),
    );

    const results = await Promise.allSettled([
      service.claimInvitationRegistrationContinuation(continuation.continuationCode, String(invitationId)),
      service.claimInvitationRegistrationContinuation(continuation.continuationCode, String(invitationId)),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('fails clearly instead of using the official publication callback when institutional configuration is missing', async () => {
    createService('');

    await expect(service.createAuthRequest(String(applicationId))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(mockCreateAuthorizationRequest).not.toHaveBeenCalled();
  });
});
