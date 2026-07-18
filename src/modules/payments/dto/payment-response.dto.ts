import { PaymentStatus } from '../payments.constants';
import { PaymentTransactionDocument } from '../schemas/payment-transaction.schema';
import { minorToDecimal } from '../utils/money.util';

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
  } | null;
  tokenAccreditation?: {
    id: string | null;
    status: string | null;
    tokenAmount: string | null;
  } | null;
  createdAt?: string;
  updatedAt?: string;
  confirmedAt?: string | null;
}

export function toPublicPaymentDto(
  payment: PaymentTransactionDocument | any,
  options: { includeQr?: boolean } = {},
): PublicPaymentDto {
  const includeQr = options.includeQr && payment.status === 'QR_ACTIVE';
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
  };
}
