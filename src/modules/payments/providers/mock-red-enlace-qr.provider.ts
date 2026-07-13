import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerateQrInput,
  GenerateQrResult,
  QrPaymentProvider,
  VerifyQrInput,
  VerifyQrResult,
} from './qr-payment-provider.interface';

const SUPPORTED_MOCK_STATUSES = new Set([
  'PENDING',
  'SUCCESS',
  'CLOSED',
  'EXPIRED',
  'CANCELLED',
  'ERROR',
  'NOTFOUND',
]);

@Injectable()
export class MockRedEnlaceQrProvider implements QrPaymentProvider {
  constructor(private readonly configService: ConfigService) {}

  async generateQr(input: GenerateQrInput): Promise<GenerateQrResult> {
    const providerReference = this.buildProviderReference(input.merchantReference);
    return {
      providerReference,
      originMerchantReference: input.merchantReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      providerStatus: 'PENDING',
      responseCode: 'MOCK_PENDING',
      responseDetail: 'MOCK Red Enlace QR generated',
      qrImage: this.buildMockQrImage(input, providerReference),
      qrExpiresAt: input.expiresAt,
    };
  }

  async verifyQr(input: VerifyQrInput): Promise<VerifyQrResult> {
    const providerStatus = this.resolveMockStatus(input);
    const merchantReference = input.providerReference.replace(/^MOCK-/, '');
    return {
      providerReference: input.providerReference,
      originMerchantReference: merchantReference,
      providerStatus,
      responseCode: providerStatus === 'SUCCESS' ? '00' : 'MOCK_STATUS',
      responseDetail: `MOCK Red Enlace verify status ${providerStatus}`,
      achReference:
        providerStatus === 'SUCCESS'
          ? `MOCK-ACH-${merchantReference.slice(-6)}`
          : null,
      paymentDate: providerStatus === 'SUCCESS' ? new Date() : null,
    };
  }

  private buildProviderReference(merchantReference: string) {
    return `MOCK-${merchantReference}`;
  }

  private resolveMockStatus(input: VerifyQrInput): string {
    const explicit = String(input.mockStatus ?? '').trim().toUpperCase();
    if (SUPPORTED_MOCK_STATUSES.has(explicit)) return explicit;

    const configured = String(
      this.configService.get<string>('app.redEnlace.mockVerifyStatus') ?? '',
    )
      .trim()
      .toUpperCase();
    if (SUPPORTED_MOCK_STATUSES.has(configured)) return configured;

    const suffix = input.providerReference.split('__').pop()?.toUpperCase();
    if (suffix && SUPPORTED_MOCK_STATUSES.has(suffix)) return suffix;

    return 'PENDING';
  }

  private buildMockQrImage(input: GenerateQrInput, providerReference: string) {
    const label = `MOCK RED ENLACE ${providerReference}`;
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">',
      '<rect width="320" height="320" fill="#fff"/>',
      '<rect x="24" y="24" width="272" height="272" fill="none" stroke="#111" stroke-width="8"/>',
      '<rect x="52" y="52" width="64" height="64" fill="#111"/>',
      '<rect x="204" y="52" width="64" height="64" fill="#111"/>',
      '<rect x="52" y="204" width="64" height="64" fill="#111"/>',
      '<path d="M144 144h24v24h-24zM184 144h24v24h-24zM144 184h64v24h-64zM224 184h24v64h-24zM144 224h24v24h-24z" fill="#111"/>',
      `<text x="160" y="294" text-anchor="middle" font-family="monospace" font-size="12">${label}</text>`,
      `<desc>Mock QR only. merchantReference=${input.merchantReference}</desc>`,
      '</svg>',
    ].join('');

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
}
