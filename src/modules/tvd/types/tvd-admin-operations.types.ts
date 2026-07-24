import { HistoryOperationKey } from '../../history/dto/create-history.dto';
import {
  TokenAccreditationSourceType,
  TokenAccreditationStatus,
} from '../tvd.constants';

export enum TvdAdminOperationType {
  MANUAL_ASSIGNMENT = 'MANUAL_ASSIGNMENT',
  QR_RECHARGE = 'QR_RECHARGE',
  VOTE_CONSUMPTION = 'VOTE_CONSUMPTION',
}

export enum TvdOperationDirection {
  IN = 'IN',
  OUT = 'OUT',
  NEUTRAL = 'NEUTRAL',
}

export enum TvdAdminOperationStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

export enum TvdAdminOperationSource {
  TOKEN_ACCREDITATION = 'TOKEN_ACCREDITATION',
  HISTORY = 'HISTORY',
}

export enum TvdAdminOperationTotalBucket {
  ASSIGNED = 'ASSIGNED',
  CONSUMED = 'CONSUMED',
  NONE = 'NONE',
}

export const tvdAdminOperationLabels: Record<TvdAdminOperationType, string> = {
  [TvdAdminOperationType.MANUAL_ASSIGNMENT]: 'Asignación manual',
  [TvdAdminOperationType.QR_RECHARGE]: 'Recarga mediante QR',
  [TvdAdminOperationType.VOTE_CONSUMPTION]: 'Consumo por voto',
};

export const tvdAdminOperationStatusLabels: Record<
  TvdAdminOperationStatus,
  string
> = {
  [TvdAdminOperationStatus.PENDING]: 'Pendiente',
  [TvdAdminOperationStatus.PROCESSING]: 'En proceso',
  [TvdAdminOperationStatus.CONFIRMED]: 'Confirmada',
  [TvdAdminOperationStatus.FAILED]: 'Fallida',
  [TvdAdminOperationStatus.CANCELLED]: 'Cancelada',
  [TvdAdminOperationStatus.NEEDS_REVIEW]: 'Requiere revisión',
};

export const tokenAccreditationSourceToAdminOperationType: Partial<
  Record<TokenAccreditationSourceType, TvdAdminOperationType>
> = {
  MANUAL_GRANT: TvdAdminOperationType.MANUAL_ASSIGNMENT,
  QR_PAYMENT: TvdAdminOperationType.QR_RECHARGE,
};

export const historyOperationKeyToAdminOperationType: Partial<
  Record<keyof typeof HistoryOperationKey, TvdAdminOperationType>
> = {
  castVote: TvdAdminOperationType.VOTE_CONSUMPTION,
};

export const historyOperationNameToAdminOperationType: Partial<
  Record<HistoryOperationKey, TvdAdminOperationType>
> = {
  [HistoryOperationKey.castVote]: TvdAdminOperationType.VOTE_CONSUMPTION,
};

export const tokenAccreditationStatusToAdminStatus: Record<
  TokenAccreditationStatus,
  TvdAdminOperationStatus
> = {
  PENDING: TvdAdminOperationStatus.PENDING,
  SUBMITTING: TvdAdminOperationStatus.PROCESSING,
  SUBMITTED: TvdAdminOperationStatus.PROCESSING,
  CONFIRMED: TvdAdminOperationStatus.CONFIRMED,
  FAILED: TvdAdminOperationStatus.FAILED,
  NEEDS_REVIEW: TvdAdminOperationStatus.NEEDS_REVIEW,
};

export type TvdAdminOperationDefinition = {
  source: TvdAdminOperationSource;
  direction: TvdOperationDirection;
  affectsTotalWhenConfirmed: TvdAdminOperationTotalBucket;
};

export const tvdAdminOperationDefinitions: Record<
  TvdAdminOperationType,
  TvdAdminOperationDefinition
> = {
  [TvdAdminOperationType.MANUAL_ASSIGNMENT]: {
    source: TvdAdminOperationSource.TOKEN_ACCREDITATION,
    direction: TvdOperationDirection.IN,
    affectsTotalWhenConfirmed: TvdAdminOperationTotalBucket.ASSIGNED,
  },
  [TvdAdminOperationType.QR_RECHARGE]: {
    source: TvdAdminOperationSource.TOKEN_ACCREDITATION,
    direction: TvdOperationDirection.IN,
    affectsTotalWhenConfirmed: TvdAdminOperationTotalBucket.ASSIGNED,
  },
  [TvdAdminOperationType.VOTE_CONSUMPTION]: {
    source: TvdAdminOperationSource.HISTORY,
    direction: TvdOperationDirection.OUT,
    affectsTotalWhenConfirmed: TvdAdminOperationTotalBucket.CONSUMED,
  },
};

export type TvdAdminOperationAccountingInput = {
  operationType: TvdAdminOperationType;
  status: TvdAdminOperationStatus;
  tenantId?: string | null;
  amount?: string | null;
  amountSmallestUnit?: string | null;
};

const hasVerifiableAmount = ({
  amount,
  amountSmallestUnit,
}: TvdAdminOperationAccountingInput) =>
  Boolean(amountSmallestUnit && amountSmallestUnit !== '0') ||
  Boolean(amount && amount !== '0');

export const canAffectTvdAdminAssignedTotal = (
  operation: TvdAdminOperationAccountingInput,
) =>
  operation.status === TvdAdminOperationStatus.CONFIRMED &&
  Boolean(operation.tenantId) &&
  hasVerifiableAmount(operation) &&
  tvdAdminOperationDefinitions[operation.operationType]
    .affectsTotalWhenConfirmed === TvdAdminOperationTotalBucket.ASSIGNED;

export const canAffectTvdAdminConsumedTotal = (
  operation: TvdAdminOperationAccountingInput,
) =>
  operation.status === TvdAdminOperationStatus.CONFIRMED &&
  Boolean(operation.tenantId) &&
  hasVerifiableAmount(operation) &&
  tvdAdminOperationDefinitions[operation.operationType]
    .affectsTotalWhenConfirmed === TvdAdminOperationTotalBucket.CONSUMED;

export const getTvdAdminOperationTotalBucket = (
  operation: TvdAdminOperationAccountingInput,
) => {
  if (canAffectTvdAdminAssignedTotal(operation)) {
    return TvdAdminOperationTotalBucket.ASSIGNED;
  }

  if (canAffectTvdAdminConsumedTotal(operation)) {
    return TvdAdminOperationTotalBucket.CONSUMED;
  }

  return TvdAdminOperationTotalBucket.NONE;
};

export type TvdAdminOperation = {
  id: string;
  tenantId: string;
  institutionName: string;
  operationType: TvdAdminOperationType;
  operationLabel: string;
  economicDirection: TvdOperationDirection;
  status: TvdAdminOperationStatus;
  statusLabel: string;
  amount: string | null;
  amountSmallestUnit: string | null;
  txHash: string | null;
  date: string;
  explorerUrl: string | null;
  source: TvdAdminOperationSource;
};

export type TvdAdminOperationsSummary = {
  totalOperations: number;
  totalAssigned: string;
  totalConsumed: string;
};

export type TvdAdminOperationsResponse = {
  items: TvdAdminOperation[];
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
  summary: TvdAdminOperationsSummary;
};
