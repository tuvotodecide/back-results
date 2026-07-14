import { ConfigService } from '@nestjs/config';
import { RED_ENLACE_QR_TTL_DEFAULT } from '../payments.constants';
import { parseRedEnlaceQrTtl } from '../utils/red-enlace-ttl.util';
import { MockRedEnlaceQrProvider } from './mock-red-enlace-qr.provider';
import { QrPaymentProvider } from './qr-payment-provider.interface';
import { RedEnlaceQrHttpProvider } from './red-enlace-qr-http.provider';

const RED_ENLACE_SANDBOX_HOST = 'appcobranzacert.redenlace.com.bo';

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

  const baseUrl = configService.get<string>('app.redEnlace.baseUrl')?.trim();
  const apiKey = configService.get<string>('app.redEnlace.apiKey')?.trim();
  const callbackToken =
    configService.get<string>('app.redEnlace.callbackToken')?.trim() || '';
  const authMode =
    configService.get<string>('app.redEnlace.webhookAuthMode')?.trim().toLowerCase() ||
    'api-key';

  if (!baseUrl) {
    throw new Error('Red Enlace requires RED_ENLACE_BASE_URL');
  }
  if (!apiKey) {
    throw new Error('Red Enlace requires RED_ENLACE_API_KEY');
  }
  if (!callbackToken) {
    throw new Error('Red Enlace requires RED_ENLACE_CALLBACK_TOKEN');
  }
  if (apiKey === callbackToken) {
    throw new Error('RED_ENLACE_API_KEY and RED_ENLACE_CALLBACK_TOKEN must differ');
  }

  const url = parseRedEnlaceUrl(baseUrl);
  if (url.protocol !== 'https:') {
    throw new Error('RED_ENLACE_BASE_URL must use HTTPS');
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

function parseRedEnlaceUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    throw new Error('RED_ENLACE_BASE_URL must be a valid URL');
  }
}
