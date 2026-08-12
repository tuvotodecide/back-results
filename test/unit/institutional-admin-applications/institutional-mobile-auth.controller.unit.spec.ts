jest.mock(
  '@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.service',
  () => ({
    InstitutionalMobileZkAuthService: class InstitutionalMobileZkAuthService {},
  }),
);

import { Logger } from '@nestjs/common';
import { InstitutionalMobileAuthController } from '@/modules/institutional-admin-applications/controllers/institutional-mobile-auth.controller';

describe('InstitutionalMobileAuthController', () => {
  it('delegates the institutional callback session to the institutional auth service', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const authService = {
      createAuthRequest: jest.fn(),
      callback: jest.fn().mockResolvedValue({ from: 'did:example:institutional-admin' }),
    };
    const controller = new InstitutionalMobileAuthController(authService as any);

    await expect(controller.callback('institutional-session', 'auth-v2-token')).resolves.toEqual({
      from: 'did:example:institutional-admin',
    });

    expect(authService.callback).toHaveBeenCalledWith('institutional-session', 'auth-v2-token');
    expect(logSpy).toHaveBeenCalledWith('[REDACTED_INSTITUTIONAL_ZK_AUTH_RESPONSE]');
    logSpy.mockRestore();
  });
});
