import { ConfigService } from '@nestjs/config';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { RedEnlaceOAuthService } from '@/modules/payments/providers/red-enlace-oauth.service';

const defaultConfig: Record<string, string | number> = {
  'app.redEnlace.baseUrl': 'https://red-enlace.test/sandbox/',
  'app.redEnlace.clientId': 'client-id-test',
  'app.redEnlace.clientSecret': 'client-secret-test',
  'app.redEnlace.httpTimeoutMs': 5000,
};

function tokenResponse(accessToken = 'token-1', expiresIn: unknown = 3600) {
  return {
    status: 200,
    data: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      scope: 'api.qr',
    },
  };
}

function createService(
  post: jest.Mock,
  config: Record<string, string | number> = {},
) {
  return new RedEnlaceOAuthService(
    { axiosRef: { post } } as any,
    {
      get: jest.fn((key: string) => ({ ...defaultConfig, ...config })[key]),
    } as unknown as ConfigService,
  );
}

describe('RedEnlaceOAuthService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('requests a client credentials token with Basic authentication', async () => {
    const post = jest.fn().mockResolvedValue(tokenResponse());

    await expect(createService(post).getAccessToken()).resolves.toBe('token-1');

    expect(post).toHaveBeenCalledWith(
      'https://red-enlace.test/sandbox/oauth-client-credentials/access-token',
      '',
      expect.objectContaining({
        params: { grant_type: 'client_credentials' },
        timeout: 5000,
        headers: {
          Authorization: `Basic ${Buffer.from(
            'client-id-test:client-secret-test',
          ).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }),
    );
  });

  it('reuses the cached token until shortly before expires_in', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-14T12:00:00.000Z') });
    const post = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(tokenResponse('token-2'));
    const service = createService(post);

    await expect(service.getAccessToken()).resolves.toBe('token-1');
    jest.setSystemTime(new Date('2026-07-14T12:58:00.000Z'));
    await expect(service.getAccessToken()).resolves.toBe('token-1');
    jest.setSystemTime(new Date('2026-07-14T12:59:01.000Z'));
    await expect(service.getAccessToken()).resolves.toBe('token-2');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('shares a single token request between concurrent callers', async () => {
    const post = jest.fn().mockResolvedValue(tokenResponse());
    const service = createService(post);

    await expect(
      Promise.all([service.getAccessToken(), service.getAccessToken()]),
    ).resolves.toEqual(['token-1', 'token-1']);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('requests a new token after invalidating the cached one', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('token-1'))
      .mockResolvedValueOnce(tokenResponse('token-2'));
    const service = createService(post);

    await service.getAccessToken();
    service.invalidate('other-token');
    await expect(service.getAccessToken()).resolves.toBe('token-1');
    service.invalidate('token-1');
    await expect(service.getAccessToken()).resolves.toBe('token-2');
  });

  it('retries the token request after a failure instead of caching it', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ status: 503, data: {} })
      .mockResolvedValueOnce(tokenResponse());
    const service = createService(post);

    await expect(service.getAccessToken()).rejects.toMatchObject({
      code: 'RED_ENLACE_UNAVAILABLE',
    } satisfies Partial<PaymentDomainError>);
    await expect(service.getAccessToken()).resolves.toBe('token-1');
  });

  it.each([400, 401, 403])(
    'maps HTTP %s from the token endpoint to RED_ENLACE_UNAUTHORIZED',
    async (status) => {
      const post = jest.fn().mockResolvedValue({ status, data: {} });

      await expect(createService(post).getAccessToken()).rejects.toMatchObject({
        code: 'RED_ENLACE_UNAUTHORIZED',
      } satisfies Partial<PaymentDomainError>);
    },
  );

  it.each([
    ['missing access_token', tokenResponse('', 3600)],
    [
      'missing expires_in',
      { status: 200, data: { access_token: 'token-1', token_type: 'Bearer' } },
    ],
    ['non positive expires_in', tokenResponse('token-1', 0)],
  ])('rejects a token response with %s', async (_label, response) => {
    const post = jest.fn().mockResolvedValue(response);

    await expect(createService(post).getAccessToken()).rejects.toMatchObject({
      code: 'RED_ENLACE_INVALID_RESPONSE',
    } satisfies Partial<PaymentDomainError>);
  });

  it('does not call Red Enlace without client credentials', async () => {
    const post = jest.fn();

    await expect(
      createService(post, { 'app.redEnlace.clientSecret': '' }).getAccessToken(),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_NOT_CONFIGURED',
    } satisfies Partial<PaymentDomainError>);
    expect(post).not.toHaveBeenCalled();
  });
});
