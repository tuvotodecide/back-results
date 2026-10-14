import { PaymentStatus } from '../payments.constants';

// Estados de QR Simple v2 (PENDIENTE, PAGADO, ...) junto a los de v1, que
// siguen guardados en pagos generados antes de la migracion.
export const RED_ENLACE_ACTIVE_QR_STATUSES = new Set([
  'PENDIENTE',
  'PENDING',
  'INITIALIZE',
]);
export const RED_ENLACE_SUCCESS_STATUSES = new Set(['PAGADO', 'SUCCESS']);
const RED_ENLACE_EXPIRED_STATUSES = new Set(['EXPIRADO', 'EXPIRED']);
const RED_ENLACE_CANCELLED_STATUSES = new Set(['CANCELADO', 'CANCELLED']);

export function normalizeRedEnlaceStatus(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase();
}

export function collectRedEnlaceObservedStatuses(
  providerStatus?: string | null,
  statusHistory?: Array<{ status?: string | null }> | null,
): string[] {
  const statuses = [
    normalizeRedEnlaceStatus(providerStatus),
    ...(statusHistory ?? []).map((entry) =>
      normalizeRedEnlaceStatus(entry.status),
    ),
  ].filter(Boolean);
  return Array.from(new Set(statuses));
}

export function hasRedEnlaceSuccessEvidence(
  providerStatus?: string | null,
  statusHistory?: Array<{ status?: string | null }> | null,
): boolean {
  return collectRedEnlaceObservedStatuses(providerStatus, statusHistory).some(
    (status) => RED_ENLACE_SUCCESS_STATUSES.has(status),
  );
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

  // Codigos del callback v1; v2 envia el estado en codigoRespuesta.
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
        status: providerStatus ? 'PROVIDER_ERROR' : 'PROVIDER_STATUS_UNRESOLVED',
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
  if (RED_ENLACE_SUCCESS_STATUSES.has(providerStatus)) {
    return {
      status: 'PAYMENT_CONFIRMED',
      requiresConfirmationValidation: true,
      ambiguous: true,
    };
  }
  if (providerStatus === 'CLOSED') {
    return {
      status: input.hasSuccessEvidence
        ? 'PAYMENT_CONFIRMED'
        : 'PROVIDER_STATUS_UNRESOLVED',
      requiresConfirmationValidation: !!input.hasSuccessEvidence,
      ambiguous: !input.hasSuccessEvidence,
    };
  }
  if (RED_ENLACE_EXPIRED_STATUSES.has(providerStatus)) {
    return {
      status: 'EXPIRED',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (RED_ENLACE_CANCELLED_STATUSES.has(providerStatus)) {
    return {
      status: 'CANCELLED',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'ERROR') {
    return {
      status: 'PROVIDER_ERROR',
      requiresConfirmationValidation: false,
      ambiguous: false,
    };
  }
  if (providerStatus === 'NOTFOUND') {
    return {
      status: 'PROVIDER_STATUS_UNRESOLVED',
      requiresConfirmationValidation: false,
      ambiguous: true,
    };
  }

  return {
    status: 'PROVIDER_STATUS_UNRESOLVED',
    requiresConfirmationValidation: false,
    ambiguous: true,
  };
}
