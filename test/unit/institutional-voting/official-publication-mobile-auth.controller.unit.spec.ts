jest.mock(
  '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service',
  () => ({
    OfficialPublicationMobileZkAuthService: class OfficialPublicationMobileZkAuthService {},
  }),
);

import { Logger } from '@nestjs/common';
import { OfficialPublicationMobileAuthController } from '@/modules/institutional-voting/controllers/official-publication-mobile-auth.controller';

describe('OfficialPublicationMobileAuthController', () => {
  it('callback redacta la respuesta ZK sensible y delega el token string', async () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const authService = {
      createAuthRequest: jest.fn(),
      callback: jest.fn().mockResolvedValue({ from: 'did:example:admin' }),
    };
    const controller = new OfficialPublicationMobileAuthController(authService as any);

    await expect(
      controller.callback('session-1', 'sensitive-auth-v2-response'),
    ).resolves.toEqual({ from: 'did:example:admin' });

    expect(authService.callback).toHaveBeenCalledWith(
      'session-1',
      'sensitive-auth-v2-response',
    );
    expect(logSpy).toHaveBeenCalledWith('[REDACTED_ZK_AUTH_RESPONSE]');
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('sensitive-auth-v2-response'),
    );
    logSpy.mockRestore();
  });

  it('createRequest delega requestId sin reconstruir el request en controller', async () => {
    const authService = {
      createAuthRequest: jest.fn().mockResolvedValue({
        apiKey: 'api-key',
        request: { body: { scope: [] } },
        expiresAt: '2026-07-24T04:00:00.000Z',
      }),
      callback: jest.fn(),
    };
    const controller = new OfficialPublicationMobileAuthController(authService as any);

    await expect(controller.createRequest('req-1')).resolves.toEqual({
      apiKey: 'api-key',
      request: { body: { scope: [] } },
      expiresAt: '2026-07-24T04:00:00.000Z',
    });
    expect(authService.createAuthRequest).toHaveBeenCalledWith('req-1');
  });
});
