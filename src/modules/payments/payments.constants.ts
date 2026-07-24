export const QR_PAYMENT_PROVIDER = Symbol('QR_PAYMENT_PROVIDER');

export const PAYMENT_PROVIDER_RED_ENLACE = 'RED_ENLACE' as const;

export const paymentStatuses = [
  'CREATED',
  'QR_REQUESTING',
  'QR_ACTIVE',
  'PAYMENT_CONFIRMED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
  'MISMATCH',
  'MANUAL_REVIEW',
] as const;

export type PaymentStatus = (typeof paymentStatuses)[number];

export const confirmationSources = [
  'WEBHOOK',
  'RECONCILIATION',
  'MOCK',
] as const;
export type ConfirmationSource = (typeof confirmationSources)[number];

export const providerEventProcessingStatuses = [
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'DUPLICATE',
] as const;

export type ProviderEventProcessingStatus =
  (typeof providerEventProcessingStatuses)[number];

export const validPaymentTransitions: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ['QR_REQUESTING'],
  QR_REQUESTING: ['QR_ACTIVE', 'FAILED'],
  QR_ACTIVE: [
    'PAYMENT_CONFIRMED',
    'EXPIRED',
    'CANCELLED',
    'FAILED',
    'MISMATCH',
    'MANUAL_REVIEW',
  ],
  PAYMENT_CONFIRMED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
  MISMATCH: ['MANUAL_REVIEW'],
  MANUAL_REVIEW: [],
};

export const RED_ENLACE_REFERENCE_MAX_LENGTH = 9;
export const RED_ENLACE_QR_TTL_DEFAULT = '00:30:00';
export const RED_ENLACE_API_KEY_HEADER = 'x-api-key';
export const RED_ENLACE_GENERATE_QR_PATH = '/cobranza-0.0.1/atc/generarQr';
export const RED_ENLACE_VERIFY_QR_PATH = '/cobranza-0.0.1/atc/verificaQr';
export const RED_ENLACE_BRANCH_CODE = '461362';
export const RED_ENLACE_BRANCH_NAME = 'BLOCKCHAIN API QR ';
export const RED_ENLACE_BUSINESS_CATEGORY = '7372';
export const RED_ENLACE_CHANNEL = 'WEB';
