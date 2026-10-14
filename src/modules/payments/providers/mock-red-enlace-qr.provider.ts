import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerateQrInput,
  GenerateQrResult,
  QrPaymentProvider,
  VerifyQrInput,
  VerifyQrResult,
} from './qr-payment-provider.interface';

// Estados de QR Simple v2. Los nombres de v1 se aceptan como alias para no
// romper a quienes ya usan mockStatus o RED_ENLACE_MOCK_VERIFY_STATUS.
const MOCK_STATUS_ALIASES: Record<string, string> = {
  PENDIENTE: 'PENDIENTE',
  PAGADO: 'PAGADO',
  EXPIRADO: 'EXPIRADO',
  CANCELADO: 'CANCELADO',
  ERROR: 'ERROR',
  NOTFOUND: 'NOTFOUND',
  PENDING: 'PENDIENTE',
  SUCCESS: 'PAGADO',
  CLOSED: 'CLOSED',
  EXPIRED: 'EXPIRADO',
  CANCELLED: 'CANCELADO',
};

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
      providerStatus: 'PENDIENTE',
      responseCode: 'MOCK_PENDIENTE',
      responseDetail: 'MOCK Red Enlace QR generated',
      qrImage: this.buildMockQrImage(input, providerReference),
      qrExpiresAt: input.expiresAt,
    };
  }

  async verifyQr(input: VerifyQrInput): Promise<VerifyQrResult> {
    const providerStatus = this.resolveMockStatus(input);
    const merchantReference = input.providerReference.replace(/^MOCK-/, '');
    const paid = providerStatus === 'PAGADO';
    return {
      providerReference: input.providerReference,
      originMerchantReference: merchantReference,
      providerStatus,
      responseCode: providerStatus,
      responseDetail: `MOCK Red Enlace verify status ${providerStatus}`,
      achReference: paid ? `MOCK-ACH-${merchantReference.slice(-6)}` : null,
      paymentDate: paid ? new Date() : null,
    };
  }

  private buildProviderReference(merchantReference: string) {
    return `MOCK-${merchantReference}`;
  }

  private resolveMockStatus(input: VerifyQrInput): string {
    const candidates = [
      input.mockStatus,
      this.configService.get<string>('app.redEnlace.mockVerifyStatus'),
      input.providerReference.split('__').pop(),
    ];
    for (const candidate of candidates) {
      const status = MOCK_STATUS_ALIASES[String(candidate ?? '').trim().toUpperCase()];
      if (status) return status;
    }

    return 'PENDIENTE';
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
