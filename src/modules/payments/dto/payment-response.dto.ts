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
    createdAt: payment.createdAt?.toISOString?.(),
    updatedAt: payment.updatedAt?.toISOString?.(),
    confirmedAt: payment.confirmedAt?.toISOString?.() ?? null,
  };
}
