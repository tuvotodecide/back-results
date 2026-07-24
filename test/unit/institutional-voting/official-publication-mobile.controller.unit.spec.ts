jest.mock(
  '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard',
  () => ({
    OfficialPublicationMobileZkAuthGuard: class OfficialPublicationMobileZkAuthGuard {},
  }),
);

jest.mock(
  '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard',
  () => ({
    OfficialPublicationMobileRateLimitGuard: class OfficialPublicationMobileRateLimitGuard {},
  }),
);

import { OfficialPublicationMobileController } from '@/modules/institutional-voting/controllers/official-publication-mobile.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '@/core/decorators/public.decorator';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { OfficialPublicationMobileZkAuthGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard';
import { OfficialPublicationMobileRateLimitGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard';

describe('OfficialPublicationMobileController', () => {
  let api: any;
  let controller: OfficialPublicationMobileController;
  const requester = { sub: 'admin-1' };

  beforeEach(() => {
    api = {
      getMobileRequest: jest.fn().mockResolvedValue({ request: { requestId: 'r1' } }),
      claimMobileRequest: jest.fn().mockResolvedValue({ requestId: 'r1' }),
      markMobileSigning: jest.fn().mockResolvedValue({ request: { status: 'SIGNING' } }),
      rejectMobileRequest: jest.fn().mockResolvedValue({ request: { status: 'REJECTED' } }),
      registerMobileSubmission: jest.fn().mockResolvedValue({ request: { status: 'SUBMITTED' } }),
      markChainConfirmed: jest.fn(),
    };
    controller = new OfficialPublicationMobileController(api);
  });

  it('usa guard movil ZK aislado y rate limit, no JwtAuthGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, OfficialPublicationMobileController);

    expect(guards).toEqual([
      OfficialPublicationMobileRateLimitGuard,
      OfficialPublicationMobileZkAuthGuard,
    ]);
    expect(guards).not.toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, OfficialPublicationMobileController)).toBe(true);
  });

  it('no aplica JwtAuthGuard individualmente en los endpoints moviles protegidos por x-api-key', () => {
    const methods = ['getRequest', 'claim', 'signing', 'reject', 'submit'];

    for (const method of methods) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        OfficialPublicationMobileController.prototype[method],
      ) ?? [];
      expect(guards).not.toContain(JwtAuthGuard);
    }
  });

  it('consulta, reclama y marca signing para el usuario autenticado', async () => {
    await controller.getRequest('request-1', { user: requester } as any);
    await controller.claim('request-1', { deviceId: 'device-1' }, { user: requester } as any);
    await controller.signing('request-1', { deviceId: 'device-1' }, { user: requester } as any);

    expect(api.getMobileRequest).toHaveBeenCalledWith('request-1', requester);
    expect(api.claimMobileRequest).toHaveBeenCalledWith(
      'request-1',
      requester,
      { deviceId: 'device-1' },
    );
    expect(api.markMobileSigning).toHaveBeenCalledWith(
      'request-1',
      requester,
      { deviceId: 'device-1' },
    );
  });

  it('rechaza y registra submission sin endpoint para CHAIN_CONFIRMED', async () => {
    await controller.reject(
      'request-1',
      { deviceId: 'device-1', reasonCode: 'USER_REJECTED' } as any,
      { user: requester } as any,
    );
    await controller.submit(
      'request-1',
      {
        deviceId: 'device-1',
        userOpHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      { user: requester } as any,
    );

    expect(api.rejectMobileRequest).toHaveBeenCalled();
    expect(api.registerMobileSubmission).toHaveBeenCalled();
    expect((controller as any).markChainConfirmed).toBeUndefined();
    expect(api.markChainConfirmed).not.toHaveBeenCalled();
  });
});
