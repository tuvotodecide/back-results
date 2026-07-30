import { HttpException } from '@nestjs/common';
import { InstitutionalPublicRateLimitGuard } from '@/modules/institutional-admin-applications/guards/institutional-public-rate-limit.guard';

function buildContext(ip = '10.0.0.1') {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        route: { path: '/api/v1/institutional-wallets/resolve-by-dni' },
        headers: {},
        ip,
        socket: { remoteAddress: ip },
      }),
    }),
  } as any;
}

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Rate limit wallet institucional', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => {
      if (key === 'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_PER_MINUTE') return 2;
      if (key === 'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_MINUTE_WINDOW_MS') return 60_000;
      if (key === 'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_PER_HOUR') return 20;
      if (key === 'INSTITUTIONAL_WALLET_RESOLUTION_RATE_LIMIT_HOUR_WINDOW_MS') return 3_600_000;
      return fallback;
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

it('D-NEW-014 | returns 429 after the configured wallet resolution limit for the same IP', () => {
    const guard = new InstitutionalPublicRateLimitGuard(configService as any);
    const context = buildContext('192.0.2.10');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toEqual({
        message: 'Se realizaron demasiados intentos. Intente nuevamente más tarde.',
      });
    }
  });
});
