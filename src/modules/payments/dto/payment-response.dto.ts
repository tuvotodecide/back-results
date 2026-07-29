import { PaymentStatus } from '../payments.constants';
import { PaymentTransactionDocument } from '../schemas/payment-transaction.schema';
import { minorToDecimal } from '../utils/money.util';

export type PaymentRegenerationStatus =
  | 'REGENERABLE'
  | 'NOT_REGENERABLE'
  | 'RECONCILIATION_REQUIRED';

export interface PublicPaymentDto {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  amount: string;
  amountMinor: string;
  currency: 'BOB';
  status: PaymentStatus;
  provider: 'RED_ENLACE';
  merchantReference: string;
  providerReference?: string | null;
  qrImage?: string | null;
  qrExpiresAt?: string | null;
  confirmationSource?: string | null;
  tvdQuote?: {
    fiatAmountMinor: string;
    fiatCurrency: 'BOB';
    bobPerToken: string;
    exchangeRateVersion: number;
    tokenAmount: string;
    tokenAmountSmallestUnit?: string | null;
    quotedAt: string;
    expiresAt?: string | null;
  } | null;
  tokenAccreditation?: {
    id: string | null;
    status: string | null;
    tokenAmount: string | null;
  } | null;
  createdAt?: string;
  updatedAt?: string;
  confirmedAt?: string | null;
  previousPaymentId?: string | null;
  regeneratedToPaymentId?: string | null;
  regenerationStatus: PaymentRegenerationStatus;
  regenerationReason: string;
}

export function toPublicPaymentDto(
  payment: PaymentTransactionDocument | any,
  options: { includeQr?: boolean } = {},
): PublicPaymentDto {
  const includeQr = options.includeQr && payment.status === 'QR_ACTIVE';
  const regeneration = getPaymentRegenerationDecision(payment);
  return {
    id: String(payment._id),
    tenantId: String(payment.tenantId),
    requestedByUserId: String(payment.requestedByUserId),
    amount: minorToDecimal(payment.amountMinor),
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    merchantReference: payment.merchantReference,
    providerReference: payment.providerReference ?? null,
    qrImage: includeQr ? payment.qrImage ?? null : undefined,
    qrExpiresAt: payment.qrExpiresAt?.toISOString?.() ?? null,
    confirmationSource: payment.confirmationSource ?? null,
    tvdQuote: payment.tvdQuote
      ? {
          fiatAmountMinor: payment.tvdQuote.fiatAmountMinor,
          fiatCurrency: payment.tvdQuote.fiatCurrency,
          bobPerToken: payment.tvdQuote.bobPerToken,
          exchangeRateVersion: payment.tvdQuote.exchangeRateVersion,
          tokenAmount: payment.tvdQuote.tokenAmount,
          tokenAmountSmallestUnit:
            payment.tvdQuote.tokenAmountSmallestUnit ?? null,
          quotedAt:
            payment.tvdQuote.quotedAt?.toISOString?.() ??
            new Date(payment.tvdQuote.quotedAt).toISOString(),
          expiresAt:
            payment.tvdQuote.expiresAt?.toISOString?.() ??
            (payment.tvdQuote.expiresAt
              ? new Date(payment.tvdQuote.expiresAt).toISOString()
              : null),
        }
      : null,
    tokenAccreditation: payment.tokenAccreditationId || payment.tokenAccreditationStatus
      ? {
          id: payment.tokenAccreditationId
            ? String(payment.tokenAccreditationId)
            : null,
          status: payment.tokenAccreditationStatus ?? null,
          tokenAmount: payment.tvdQuote?.tokenAmount ?? null,
        }
      : null,
    createdAt: payment.createdAt?.toISOString?.(),
    updatedAt: payment.updatedAt?.toISOString?.(),
    confirmedAt: payment.confirmedAt?.toISOString?.() ?? null,
    previousPaymentId: payment.previousPaymentId
      ? String(payment.previousPaymentId)
      : null,
    regeneratedToPaymentId: payment.regeneratedToPaymentId
      ? String(payment.regeneratedToPaymentId)
      : null,
    regenerationStatus: regeneration.status,
    regenerationReason: regeneration.reason,
  };
}

export function getPaymentRegenerationDecision(
  payment: PaymentTransactionDocument | any,
): { status: PaymentRegenerationStatus; reason: string } {
  if (payment.regenerationLockExpiresAt) {
    const lockExpiresAt = new Date(payment.regenerationLockExpiresAt).getTime();
    if (!Number.isNaN(lockExpiresAt) && lockExpiresAt > Date.now()) {
      return {
        status: 'RECONCILIATION_REQUIRED',
        reason: 'PAYMENT_REGENERATION_IN_PROGRESS',
      };
    }
  }

  if (payment.regeneratedToPaymentId) {
    return {
      status: 'NOT_REGENERABLE',
      reason: 'PAYMENT_ALREADY_REGENERATED',
    };
  }

  if (
    payment.status === 'RECONCILIATION_PENDING' ||
    payment.status === 'PROVIDER_STATUS_UNRESOLVED' ||
    payment.status === 'PROVIDER_ERROR'
  ) {
    return {
      status: 'RECONCILIATION_REQUIRED',
      reason: 'PAYMENT_REGENERATION_RECONCILIATION_REQUIRED',
    };
  }

  if (
    payment.status === 'PAYMENT_CONFIRMED' ||
    payment.tokenAccreditationId ||
    payment.tokenAccreditationStatus
  ) {
    return {
      status: 'NOT_REGENERABLE',
      reason: 'PAYMENT_ALREADY_CONFIRMED',
    };
  }

  if (payment.status === 'EXPIRED') {
    const quoteExpiresAt = payment.tvdQuote?.expiresAt
      ? new Date(payment.tvdQuote.expiresAt).getTime()
      : null;
    if (quoteExpiresAt && quoteExpiresAt > Date.now()) {
      return {
        status: 'REGENERABLE',
        reason: 'QR_EXPIRED_QUOTE_VALID',
      };
    }
    return {
      status: 'REGENERABLE',
      reason: 'QR_EXPIRED_QUOTE_EXPIRED',
    };
  }

  if (payment.status === 'CANCELLED' || payment.status === 'FAILED') {
    return {
      status: 'REGENERABLE',
      reason: `QR_${payment.status}`,
    };
  }

  return {
    status: 'NOT_REGENERABLE',
    reason: `PAYMENT_STATUS_${payment.status}`,
  };
}
