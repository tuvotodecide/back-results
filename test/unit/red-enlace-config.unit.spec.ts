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

  it('allows mock mode without URL or API key', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({ 'app.redEnlace.qrTtl': '00:30:00' }),
        'mock',
      ),
    ).not.toThrow();
  });

  it('requires sandbox URL', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('RED_ENLACE_BASE_URL');
  });

  it('requires sandbox API key', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('RED_ENLACE_API_KEY');
  });

  it('TVD-QR-P0-006 | requires sandbox callback token', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('RED_ENLACE_CALLBACK_TOKEN');
  });

  it('rejects HTTP sandbox URL', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'http://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('HTTPS');
  });

  it('rejects production-like host in sandbox mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://cobranza.redenlace.com.bo',
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('sandbox host');
  });

  it('rejects sandbox host in production mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.webhookAuthMode': 'api-key',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'production',
      ),
    ).toThrow('sandbox host');
  });

  it('rejects webhook auth mode none in production', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://cobranza.redenlace.com.bo',
          'app.redEnlace.apiKey': 'api-key',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.webhookAuthMode': 'none',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'production',
      ),
    ).toThrow('WEBHOOK_AUTH_MODE');
  });

  it('rejects using the same value for outgoing API key and callback token', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': 'same-token',
          'app.redEnlace.callbackToken': 'same-token',
          'app.redEnlace.qrTtl': '00:30:00',
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
          'app.redEnlace.baseUrl': 'http://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': apiSecret,
          'app.redEnlace.callbackToken': callbackSecret,
          'app.redEnlace.qrTtl': '00:30:00',
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
