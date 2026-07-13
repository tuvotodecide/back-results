export type PaymentDomainErrorCode =
  | 'RED_ENLACE_DISABLED'
  | 'RED_ENLACE_NOT_CONFIGURED'
  | 'RED_ENLACE_TIMEOUT'
  | 'RED_ENLACE_UNAUTHORIZED'
  | 'RED_ENLACE_UNAVAILABLE'
  | 'RED_ENLACE_INVALID_RESPONSE'
  | 'RED_ENLACE_REFERENCE_MISMATCH'
  | 'RED_ENLACE_AMOUNT_MISMATCH'
  | 'RED_ENLACE_CURRENCY_MISMATCH'
  | 'RED_ENLACE_UNKNOWN_STATUS'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_TENANT_FORBIDDEN'
  | 'PAYMENT_ALREADY_CONFIRMED'
  | 'PAYMENT_MANUAL_REVIEW_REQUIRED'
  | 'PAYMENT_IDEMPOTENCY_CONFLICT';

export class PaymentDomainError extends Error {
  constructor(
    readonly code: PaymentDomainErrorCode,
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
  }
}
