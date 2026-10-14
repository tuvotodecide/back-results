import { ConfigService } from '@nestjs/config';
import { RED_ENLACE_QR_TTL_DEFAULT } from '../payments.constants';
import { parseRedEnlaceQrTtl } from '../utils/red-enlace-ttl.util';
import { MockRedEnlaceQrProvider } from './mock-red-enlace-qr.provider';
import { QrPaymentProvider } from './qr-payment-provider.interface';
import { RedEnlaceQrHttpProvider } from './red-enlace-qr-http.provider';

const RED_ENLACE_SANDBOX_HOST = 'atcgwapitest.redenlace.com.bo';

export function createQrPaymentProvider(
  configService: ConfigService,
  mockProvider: MockRedEnlaceQrProvider,
  httpProvider: RedEnlaceQrHttpProvider,
): QrPaymentProvider {
  const mode = configService.get<string>('app.redEnlace.mode') ?? 'mock';
  validateRedEnlaceConfiguration(configService, mode);
  if (mode === 'mock') return mockProvider;
  return httpProvider;
}

export function validateRedEnlaceConfiguration(
  configService: ConfigService,
  mode: string,
) {
  const normalizedMode = normalizeRedEnlaceMode(mode);
  if (!['mock', 'sandbox', 'production'].includes(normalizedMode)) {
    throw new Error('RED_ENLACE_MODE must be mock, sandbox or production');
  }

  const ttl = configService.get<string>('app.redEnlace.qrTtl') || RED_ENLACE_QR_TTL_DEFAULT;
  parseRedEnlaceQrTtl(ttl);

  if (normalizedMode === 'mock') return;

  const read = (key: string) =>
    String(configService.get<string>(`app.redEnlace.${key}`) ?? '').trim();
  const baseUrl = read('baseUrl');
  const clientId = read('clientId');
  const clientSecret = read('clientSecret');
  const establishmentId = read('establishmentId');
  const establishmentName = read('establishmentName');
  const webhookUrl = read('webhookUrl');
  const callbackToken = read('callbackToken');
  const authMode = read('webhookAuthMode').toLowerCase() || 'api-key';

  if (!baseUrl) {
    throw new Error('Red Enlace requires RED_ENLACE_BASE_URL');
  }
  if (!clientId) {
    throw new Error('Red Enlace requires RED_ENLACE_CLIENT_ID');
  }
  if (!clientSecret) {
    throw new Error('Red Enlace requires RED_ENLACE_CLIENT_SECRET');
  }
  if (!/^[1-9]\d*$/.test(establishmentId)) {
    throw new Error(
      'Red Enlace requires RED_ENLACE_ESTABLISHMENT_ID as a positive integer',
    );
  }
  if (!establishmentName) {
    throw new Error('Red Enlace requires RED_ENLACE_ESTABLISHMENT_NAME');
  }
  if (!webhookUrl) {
    throw new Error('Red Enlace requires RED_ENLACE_WEBHOOK_URL');
  }
  if (!callbackToken) {
    throw new Error('Red Enlace requires RED_ENLACE_CALLBACK_TOKEN');
  }
  if (clientSecret === callbackToken) {
    throw new Error(
      'RED_ENLACE_CLIENT_SECRET and RED_ENLACE_CALLBACK_TOKEN must differ',
    );
  }

  const url = parseRedEnlaceUrl(baseUrl, 'RED_ENLACE_BASE_URL');
  if (url.protocol !== 'https:') {
    throw new Error('RED_ENLACE_BASE_URL must use HTTPS');
  }

  // El token del callback viaja en un header; solo se entrega sobre HTTPS.
  const callbackUrl = parseRedEnlaceUrl(webhookUrl, 'RED_ENLACE_WEBHOOK_URL');
  if (callbackUrl.protocol !== 'https:') {
    throw new Error('RED_ENLACE_WEBHOOK_URL must use HTTPS');
  }

  if (normalizedMode === 'sandbox' && url.hostname !== RED_ENLACE_SANDBOX_HOST) {
    throw new Error('RED_ENLACE_BASE_URL must use the Red Enlace sandbox host');
  }

  if (normalizedMode === 'production') {
    if (url.hostname === RED_ENLACE_SANDBOX_HOST) {
      throw new Error('Production RED_ENLACE_BASE_URL must not use sandbox host');
    }
    if (authMode === 'none') {
      throw new Error('Production does not allow RED_ENLACE_WEBHOOK_AUTH_MODE=none');
    }
  }
}

function normalizeRedEnlaceMode(mode: string) {
  return String(mode ?? '').trim().toLowerCase();
}

function parseRedEnlaceUrl(value: string, name: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}
