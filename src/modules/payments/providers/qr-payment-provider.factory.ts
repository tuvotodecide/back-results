import { ConfigService } from '@nestjs/config';
import { RED_ENLACE_QR_TTL_DEFAULT } from '../payments.constants';
import { MockRedEnlaceQrProvider } from './mock-red-enlace-qr.provider';
import { QrPaymentProvider } from './qr-payment-provider.interface';
import { RedEnlaceQrHttpProvider } from './red-enlace-qr-http.provider';

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
  if (!['mock', 'test', 'production'].includes(normalizedMode)) {
    throw new Error('RED_ENLACE_MODE must be mock, test, sandbox or production');
  }

  if (normalizedMode === 'mock') return;

  const baseUrl = configService.get<string>('app.redEnlace.baseUrl')?.trim();
  const apiKey = configService.get<string>('app.redEnlace.apiKey')?.trim();
  if (!baseUrl || !apiKey) {
    throw new Error(
      'Red Enlace test/production requires RED_ENLACE_BASE_URL and RED_ENLACE_API_KEY',
    );
  }

  const callbackToken =
    configService.get<string>('app.redEnlace.callbackToken')?.trim() ||
    configService.get<string>('app.redEnlace.webhookSecret')?.trim() ||
    '';
  if (!callbackToken) {
    throw new Error(
      'Red Enlace test/production requires RED_ENLACE_CALLBACK_TOKEN',
    );
  }

  const ttl = configService.get<string>('app.redEnlace.qrTtl');
  if (!ttl || ttl === RED_ENLACE_QR_TTL_DEFAULT) return;
}

function normalizeRedEnlaceMode(mode: string) {
  const normalized = String(mode ?? '').toLowerCase();
  return normalized === 'sandbox' ? 'test' : normalized;
}
