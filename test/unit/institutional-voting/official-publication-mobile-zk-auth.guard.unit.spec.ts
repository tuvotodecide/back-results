import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock(
  '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service',
  () => ({
    OfficialPublicationMobileZkAuthService: class OfficialPublicationMobileZkAuthService {},
  }),
);

import { OfficialPublicationMobileZkAuthGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard';

describe('OfficialPublicationMobileZkAuthGuard', () => {
  const signerUserId = new Types.ObjectId();
  const requestDoc = {
    requestId: 'req-1',
    eventId: new Types.ObjectId(),
    signerUserId,
    smartAccountAddress: '0x270cf6f9377a6d2bbe97a3dc42a1ce90d46363f8',
  };

  const makeContext = (
    headers: Record<string, string> = { 'x-api-key': 'publication-key' },
    params = { requestId: 'req-1' },
  ) => ({
    switchToHttp: () => ({
      getRequest: () => ({ headers, params }),
    }),
  } as any);

  const model = (doc: any) => ({
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(doc) })),
  });

  it('rechaza request sin x-api-key con 401', async () => {
    const guard = new OfficialPublicationMobileZkAuthGuard(
      { getContextByApiKey: jest.fn() } as any,
      model(requestDoc) as any,
    );

    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza api key inexistente o de otro flujo con 401', async () => {
    const guard = new OfficialPublicationMobileZkAuthGuard(
      { getContextByApiKey: jest.fn().mockResolvedValue(null) } as any,
      model(requestDoc) as any,
    );

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza api key valida para otro request con 403', async () => {
    const guard = new OfficialPublicationMobileZkAuthGuard(
      {
        getContextByApiKey: jest.fn().mockResolvedValue({
          requestId: 'other',
          eventId: String(requestDoc.eventId),
          subjectId: String(signerUserId),
          dni: '1234567',
          smartAccountAddress: requestDoc.smartAccountAddress,
          purpose: 'OFFICIAL_PUBLICATION',
        }),
      } as any,
      model(requestDoc) as any,
    );

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('construye req.user institucional para request correcto', async () => {
    const req: any = {
      headers: { 'x-api-key': 'publication-key' },
      params: { requestId: 'req-1' },
    };
    const guard = new OfficialPublicationMobileZkAuthGuard(
      {
        getContextByApiKey: jest.fn().mockResolvedValue({
          requestId: 'req-1',
          eventId: String(requestDoc.eventId),
          subjectId: String(signerUserId),
          dni: '1234567',
          smartAccountAddress: requestDoc.smartAccountAddress,
          purpose: 'OFFICIAL_PUBLICATION',
        }),
      } as any,
      model(requestDoc) as any,
    );

    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as any),
    ).resolves.toBe(true);
    expect(req.user).toEqual({
      sub: String(signerUserId),
      dni: '1234567',
      smartAccountAddress: requestDoc.smartAccountAddress,
      requestId: 'req-1',
      authType: 'OFFICIAL_PUBLICATION_MOBILE_ZK',
    });
  });

  it('rechaza signer distinto con 403', async () => {
    const guard = new OfficialPublicationMobileZkAuthGuard(
      {
        getContextByApiKey: jest.fn().mockResolvedValue({
          requestId: 'req-1',
          eventId: String(requestDoc.eventId),
          subjectId: String(new Types.ObjectId()),
          dni: '1234567',
          smartAccountAddress: requestDoc.smartAccountAddress,
          purpose: 'OFFICIAL_PUBLICATION',
        }),
      } as any,
      model(requestDoc) as any,
    );

    await expect(guard.canActivate(makeContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
