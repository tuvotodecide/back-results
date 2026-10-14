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
  'PROVIDER_STATUS_UNRESOLVED',
  'PROVIDER_ERROR',
  'RECONCILIATION_PENDING',
  'BLOCKED_BY_INFRASTRUCTURE',
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
  QR_REQUESTING: [
    'QR_ACTIVE',
    'FAILED',
    'PROVIDER_ERROR',
    'PROVIDER_STATUS_UNRESOLVED',
  ],
  QR_ACTIVE: [
    'PAYMENT_CONFIRMED',
    'EXPIRED',
    'CANCELLED',
    'FAILED',
    'MISMATCH',
    'PROVIDER_STATUS_UNRESOLVED',
    'PROVIDER_ERROR',
    'RECONCILIATION_PENDING',
    'BLOCKED_BY_INFRASTRUCTURE',
    'MANUAL_REVIEW',
  ],
  PAYMENT_CONFIRMED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
  MISMATCH: ['RECONCILIATION_PENDING', 'MANUAL_REVIEW'],
  PROVIDER_STATUS_UNRESOLVED: ['RECONCILIATION_PENDING'],
  PROVIDER_ERROR: ['RECONCILIATION_PENDING'],
  RECONCILIATION_PENDING: [],
  BLOCKED_BY_INFRASTRUCTURE: [],
  MANUAL_REVIEW: [],
};

export const RED_ENLACE_REFERENCE_MAX_LENGTH = 9;
export const RED_ENLACE_QR_TTL_DEFAULT = '00:30:00';
export const RED_ENLACE_OAUTH_TOKEN_PATH =
  '/oauth-client-credentials/access-token';
export const RED_ENLACE_GENERATE_QR_PATH = '/qr/simple/v2/generate';
export const RED_ENLACE_VERIFY_QR_PATH = '/qr/simple/v2/verify';
export const RED_ENLACE_ACCESS_TOKEN_HEADER = 'access_token';
export const RED_ENLACE_CLIENT_ID_HEADER = 'client_id';
// Header que Red Enlace envia en el webhook (se le indica en webhook.key al generar el QR).
export const RED_ENLACE_WEBHOOK_AUTH_HEADER = 'x-api-key';
export const RED_ENLACE_TRANSACTION_NOT_FOUND_CODE = 'TRANSACCION_NO_ENCONTRADA';
// Bolivia no aplica horario de verano; Red Enlace envia fechas sin zona horaria.
export const RED_ENLACE_TIMEZONE_OFFSET = '-04:00';
