import { ConfigService } from '@nestjs/config';
import { validateRedEnlaceConfiguration } from '@/modules/payments/providers/qr-payment-provider.factory';
import { parseRedEnlaceQrTtl } from '@/modules/payments/utils/red-enlace-ttl.util';

function config(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('Red Enlace configuration hardening', () => {
  it.each([
    ['00:30:00', 1800],
    ['24:00:00', 86400],
    ['8760:00:00', 31536000],
  ])('accepts contractual TTL %s', (ttl, seconds) => {
    expect(parseRedEnlaceQrTtl(ttl)).toEqual({
      seconds,
      milliseconds: seconds * 1000,
    });
  });

  it.each([
    '00:00:00',
    '00:60:00',
    '00:00:60',
    '-01:00:00',
    'abc',
    '1:30',
    '8760:00:01',
  ])(
    'rejects invalid TTL %s',
    (ttl) => {
      expect(() => parseRedEnlaceQrTtl(ttl)).toThrow('RED_ENLACE_QR_TTL');
    },
  );

  const sandboxConfig = {
    'app.redEnlace.baseUrl': 'https://atcgwapitest.redenlace.com.bo/sandbox',
    'app.redEnlace.clientId': 'client-id',
    'app.redEnlace.clientSecret': 'client-secret',
    'app.redEnlace.establishmentId': '461362',
    'app.redEnlace.establishmentName': 'BLOCKCHAIN API QR',
    'app.redEnlace.webhookUrl': 'https://api.example.test/api/v1/qr/confirmed',
    'app.redEnlace.callbackToken': 'callback-token',
    'app.redEnlace.qrTtl': '00:30:00',
  };
  const productionConfig = {
    ...sandboxConfig,
    'app.redEnlace.baseUrl': 'https://api.redenlace.com.bo',
    'app.redEnlace.webhookAuthMode': 'api-key',
  };

  it('allows mock mode without URL or client credentials', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({ 'app.redEnlace.qrTtl': '00:30:00' }),
        'mock',
      ),
    ).not.toThrow();
  });

  it('accepts a complete sandbox configuration with the /sandbox base path', () => {
    expect(() =>
      validateRedEnlaceConfiguration(config(sandboxConfig), 'sandbox'),
    ).not.toThrow();
  });

  it('accepts a complete production configuration', () => {
    expect(() =>
      validateRedEnlaceConfiguration(config(productionConfig), 'production'),
    ).not.toThrow();
  });

  it.each([
    ['app.redEnlace.baseUrl', 'RED_ENLACE_BASE_URL'],
    ['app.redEnlace.clientId', 'RED_ENLACE_CLIENT_ID'],
    ['app.redEnlace.clientSecret', 'RED_ENLACE_CLIENT_SECRET'],
    ['app.redEnlace.establishmentId', 'RED_ENLACE_ESTABLISHMENT_ID'],
    ['app.redEnlace.establishmentName', 'RED_ENLACE_ESTABLISHMENT_NAME'],
    ['app.redEnlace.webhookUrl', 'RED_ENLACE_WEBHOOK_URL'],
    ['app.redEnlace.callbackToken', 'RED_ENLACE_CALLBACK_TOKEN'],
  ])('TVD-QR-P0-006 | requires %s in sandbox', (key, envName) => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({ ...sandboxConfig, [key]: undefined }),
        'sandbox',
      ),
    ).toThrow(envName);
  });

  it.each(['0', '-1', '12.5', 'abc'])(
    'rejects establishment id %s',
    (establishmentId) => {
      expect(() =>
        validateRedEnlaceConfiguration(
          config({
            ...sandboxConfig,
            'app.redEnlace.establishmentId': establishmentId,
          }),
          'sandbox',
        ),
      ).toThrow('RED_ENLACE_ESTABLISHMENT_ID');
    },
  );

  it('rejects HTTP sandbox URL', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...sandboxConfig,
          'app.redEnlace.baseUrl': 'http://atcgwapitest.redenlace.com.bo/sandbox',
        }),
        'sandbox',
      ),
    ).toThrow('HTTPS');
  });

  it('rejects HTTP production URL', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...productionConfig,
          'app.redEnlace.baseUrl': 'http://api.redenlace.com.bo',
        }),
        'production',
      ),
    ).toThrow('RED_ENLACE_BASE_URL must use HTTPS');
  });

  it('rejects an HTTP webhook URL', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...sandboxConfig,
          'app.redEnlace.webhookUrl': 'http://api.example.test/api/v1/qr/confirmed',
        }),
        'sandbox',
      ),
    ).toThrow('RED_ENLACE_WEBHOOK_URL must use HTTPS');
  });

  it('rejects production-like host in sandbox mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...sandboxConfig,
          'app.redEnlace.baseUrl': 'https://api.redenlace.com.bo',
        }),
        'sandbox',
      ),
    ).toThrow('sandbox host');
  });

  it('rejects sandbox host in production mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...productionConfig,
          'app.redEnlace.baseUrl': 'https://atcgwapitest.redenlace.com.bo/sandbox',
        }),
        'production',
      ),
    ).toThrow('sandbox host');
  });

  it('rejects webhook auth mode none in production', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...productionConfig,
          'app.redEnlace.webhookAuthMode': 'none',
        }),
        'production',
      ),
    ).toThrow('WEBHOOK_AUTH_MODE');
  });

  it('rejects using the same value for client secret and callback token', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          ...sandboxConfig,
          'app.redEnlace.clientSecret': 'same-token',
          'app.redEnlace.callbackToken': 'same-token',
        }),
        'sandbox',
      ),
    ).toThrow('must differ');
  });

  it('rejects unknown mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({ 'app.redEnlace.qrTtl': '00:30:00' }),
        'test',
      ),
    ).toThrow('RED_ENLACE_MODE');
  });

  it('TVD-SEC-P0-002 | does not expose secret values in validation errors', () => {
    const apiSecret = 'real-api-secret-value';
    const callbackSecret = 'real-callback-secret-value';

    try {
      validateRedEnlaceConfiguration(
        config({
          ...sandboxConfig,
          'app.redEnlace.baseUrl': 'http://atcgwapitest.redenlace.com.bo/sandbox',
          'app.redEnlace.clientSecret': apiSecret,
          'app.redEnlace.callbackToken': callbackSecret,
        }),
        'sandbox',
      );
      throw new Error('expected validation to fail');
    } catch (error: any) {
      expect(String(error.message)).not.toContain(apiSecret);
      expect(String(error.message)).not.toContain(callbackSecret);
    }
  });
});
