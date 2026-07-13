export interface GenerateQrInput {
  merchantReference: string;
  amountMinor: string;
  currency: 'BOB';
  glosa: string;
  description: string;
  expiresAt: Date;
}

export interface GenerateQrResult {
  providerReference: string;
  originMerchantReference?: string;
  amountMinor?: string;
  currency?: string;
  providerStatus: string;
  responseCode?: string;
  responseDetail?: string | null;
  qrImage: string;
  qrExpiresAt?: Date;
}

export interface VerifyQrInput {
  providerReference: string;
  mockStatus?: string;
}

export interface VerifyQrResult {
  providerReference: string;
  originMerchantReference?: string;
  amountMinor?: string;
  currency?: string;
  providerStatus: string;
  responseCode?: string;
  responseDetail?: string | null;
  achReference?: string | null;
  paymentDate?: Date | null;
}

export interface QrPaymentProvider {
  generateQr(input: GenerateQrInput): Promise<GenerateQrResult>;
  verifyQr(input: VerifyQrInput): Promise<VerifyQrResult>;
}
