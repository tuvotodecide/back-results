import { PaymentStatus } from '../payments.constants';

export const RED_ENLACE_ACTIVE_QR_STATUSES = new Set(['PENDING', 'INITIALIZE']);

export function normalizeRedEnlaceStatus(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase();
}

export interface ProviderStatusMappingInput {
  providerStatus?: string | null;
  responseCode?: string | null;
  source: 'WEBHOOK' | 'RECONCILIATION';
  hasSuccessEvidence?: boolean;
}

export interface ProviderStatusMappingResult {
  status: PaymentStatus;
  requiresConfirmationValidation: boolean;
  ambiguous: boolean;
}

export function mapRedEnlaceStatus(
  input: ProviderStatusMappingInput,
): ProviderStatusMappingResult {
  const responseCode = String(input.responseCode ?? '').trim();
  const providerStatus = normalizeRedEnlaceStatus(input.providerStatus);

  if (input.source === 'WEBHOOK') {
    if (responseCode === '00') {
      return {
        status: 'PAYMENT_CONFIRMED',
        requiresConfirmationValidation: true,
        ambiguous: true,
      };
    }
    if (responseCode === '03') {
      return {
        status: 'EXPIRED',
        requiresConfirmationValidation: false,
        ambiguous: false,
      };
    }
    if (responseCode === '05') {
      return {
        status: providerStatus ? 'FAILED' : 'MANUAL_REVIEW',
        requiresConfirmationValidation: false,
        ambiguous: !providerStatus,
      };
    }
  }

  if (RED_ENLACE_ACTIVE_QR_STATUSES.has(providerStatus)) {
    return {
      status: 'QR_ACTIVE',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'SUCCESS') {
    return {
      status: 'PAYMENT_CONFIRMED',
      requiresConfirmationValidation: true,
      ambiguous: true,
    };
  }
  if (providerStatus === 'CLOSED') {
    return {
      status: input.hasSuccessEvidence ? 'PAYMENT_CONFIRMED' : 'MANUAL_REVIEW',
      requiresConfirmationValidation: !!input.hasSuccessEvidence,
      ambiguous: !input.hasSuccessEvidence,
    };
  }
  if (providerStatus === 'EXPIRED') {
    return {
      status: 'EXPIRED',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'CANCELLED') {
    return {
      status: 'CANCELLED',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'ERROR') {
    return {
      status: 'FAILED',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'NOTFOUND') {
    return {
      status: 'MANUAL_REVIEW',
      requiresConfirmationValidation: false,
      ambiguous: true,
    };
  }

  return {
    status: 'MANUAL_REVIEW',
    requiresConfirmationValidation: false,
    ambiguous: true,
  };
}
