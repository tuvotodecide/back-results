import { ConflictException, Injectable } from '@nestjs/common';
import {
  OFFICIAL_PUBLICATION_RECOVERABLE_STATUSES,
  OFFICIAL_PUBLICATION_TERMINAL_STATUSES,
  OfficialPublicationRequestStatus,
} from '../../schemas/official-publication-request.schema';

export const OFFICIAL_PUBLICATION_STATE_ACTIONS = [
  'MARK_PREPARED',
  'CLAIM',
  'RELEASE_CLAIM',
  'START_SIGNING',
  'SUBMIT_USER_OPERATION',
  'MARK_CHAIN_PENDING',
  'CONFIRM_CHAIN',
  'START_FINALIZING',
  'COMPLETE',
  'REJECT',
  'EXPIRE',
  'CANCEL',
  'FAIL_RETRYABLE',
  'RETRY_CHAIN_CHECK',
  'RETRY_FINALIZATION',
  'FAIL_FINAL',
  'MARK_NEEDS_REVIEW',
] as const;

export type OfficialPublicationStateAction =
  (typeof OFFICIAL_PUBLICATION_STATE_ACTIONS)[number];

export type OfficialPublicationTransitionResult = {
  from: OfficialPublicationRequestStatus;
  to: OfficialPublicationRequestStatus;
  action: OfficialPublicationStateAction;
  changed: boolean;
  terminal: boolean;
  recoverable: boolean;
};

const TRANSITIONS: Record<
  OfficialPublicationRequestStatus,
  Partial<Record<OfficialPublicationStateAction, OfficialPublicationRequestStatus>>
> = {
  PREPARING: {
    MARK_PREPARED: 'PENDING_APPROVAL',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
  },
  PENDING_APPROVAL: {
    CLAIM: 'CLAIMED',
    REJECT: 'REJECTED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
  },
  CLAIMED: {
    RELEASE_CLAIM: 'PENDING_APPROVAL',
    START_SIGNING: 'SIGNING',
    REJECT: 'REJECTED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
  },
  SIGNING: {
    RELEASE_CLAIM: 'PENDING_APPROVAL',
    SUBMIT_USER_OPERATION: 'SUBMITTED',
    REJECT: 'REJECTED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
  },
  SUBMITTED: {
    MARK_CHAIN_PENDING: 'CHAIN_PENDING',
    CONFIRM_CHAIN: 'CHAIN_CONFIRMED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
    MARK_NEEDS_REVIEW: 'NEEDS_REVIEW',
  },
  CHAIN_PENDING: {
    CONFIRM_CHAIN: 'CHAIN_CONFIRMED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
    MARK_NEEDS_REVIEW: 'NEEDS_REVIEW',
  },
  CHAIN_CONFIRMED: {
    START_FINALIZING: 'FINALIZING',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
    MARK_NEEDS_REVIEW: 'NEEDS_REVIEW',
  },
  FINALIZING: {
    COMPLETE: 'COMPLETED',
    FAIL_RETRYABLE: 'FAILED_RETRYABLE',
    FAIL_FINAL: 'FAILED_FINAL',
    MARK_NEEDS_REVIEW: 'NEEDS_REVIEW',
  },
  FAILED_RETRYABLE: {
    RETRY_CHAIN_CHECK: 'CHAIN_PENDING',
    RETRY_FINALIZATION: 'FINALIZING',
    CANCEL: 'CANCELLED',
    FAIL_FINAL: 'FAILED_FINAL',
    MARK_NEEDS_REVIEW: 'NEEDS_REVIEW',
  },
  NEEDS_REVIEW: {
    RETRY_CHAIN_CHECK: 'CHAIN_PENDING',
    RETRY_FINALIZATION: 'FINALIZING',
    FAIL_FINAL: 'FAILED_FINAL',
  },
  COMPLETED: {},
  REJECTED: {},
  EXPIRED: {},
  CANCELLED: {},
  FAILED_FINAL: {},
};

const IDEMPOTENT_ACTION_TARGETS: Partial<
  Record<OfficialPublicationStateAction, readonly OfficialPublicationRequestStatus[]>
> = {
  MARK_PREPARED: ['PENDING_APPROVAL'],
  CLAIM: ['CLAIMED'],
  RELEASE_CLAIM: ['PENDING_APPROVAL'],
  START_SIGNING: ['SIGNING'],
  SUBMIT_USER_OPERATION: ['SUBMITTED', 'CHAIN_PENDING', 'CHAIN_CONFIRMED', 'FINALIZING', 'COMPLETED'],
  MARK_CHAIN_PENDING: ['CHAIN_PENDING', 'CHAIN_CONFIRMED', 'FINALIZING', 'COMPLETED'],
  CONFIRM_CHAIN: ['CHAIN_CONFIRMED', 'FINALIZING', 'COMPLETED'],
  START_FINALIZING: ['FINALIZING', 'COMPLETED'],
  COMPLETE: ['COMPLETED'],
  REJECT: ['REJECTED'],
  EXPIRE: ['EXPIRED'],
  CANCEL: ['CANCELLED'],
  FAIL_FINAL: ['FAILED_FINAL'],
  MARK_NEEDS_REVIEW: ['NEEDS_REVIEW'],
};

@Injectable()
export class OfficialPublicationRequestStateService {
  transition(
    from: OfficialPublicationRequestStatus,
    action: OfficialPublicationStateAction,
  ): OfficialPublicationTransitionResult {
    const to = TRANSITIONS[from]?.[action];
    if (to) {
      return this.result(from, to, action, true);
    }

    if (IDEMPOTENT_ACTION_TARGETS[action]?.includes(from)) {
      return this.result(from, from, action, false);
    }

    throw new ConflictException({
      code: 'OFFICIAL_PUBLICATION_INVALID_TRANSITION',
      message: 'Transición de publicación oficial no permitida',
      from,
      action,
    });
  }

  canTransition(
    from: OfficialPublicationRequestStatus,
    action: OfficialPublicationStateAction,
  ) {
    try {
      this.transition(from, action);
      return true;
    } catch {
      return false;
    }
  }

  isTerminal(status: OfficialPublicationRequestStatus) {
    return OFFICIAL_PUBLICATION_TERMINAL_STATUSES.includes(status);
  }

  isRecoverable(status: OfficialPublicationRequestStatus) {
    return OFFICIAL_PUBLICATION_RECOVERABLE_STATUSES.includes(status);
  }

  buildOptimisticTransitionFilter(input: {
    requestId: string;
    from: OfficialPublicationRequestStatus;
    version: number;
  }) {
    return {
      requestId: input.requestId,
      status: input.from,
      version: input.version,
    };
  }

  buildTransitionUpdate(input: {
    transition: OfficialPublicationTransitionResult;
    actor: string;
    at?: Date;
    errorCode?: string | null;
    errorStage?: string | null;
    safeMessage?: string | null;
  }) {
    const at = input.at ?? new Date();
    const terminalAt = input.transition.terminal ? at : null;
    const update: Record<string, unknown> = {
      $set: {
        status: input.transition.to,
        updatedAt: at,
        errorCode: input.errorCode ?? null,
        errorStage: input.errorStage ?? null,
        safeMessage: input.safeMessage ?? null,
        ...(input.errorCode ? { lastErrorAt: at } : {}),
        ...(terminalAt ? { terminalAt } : {}),
      },
      $inc: { version: 1 },
      $push: {
        statusHistory: {
          from: input.transition.from,
          to: input.transition.to,
          action: input.transition.action,
          actor: input.actor,
          at,
        },
      },
    };

    if (!input.transition.changed) {
      delete update.$inc;
    }

    return update;
  }

  private result(
    from: OfficialPublicationRequestStatus,
    to: OfficialPublicationRequestStatus,
    action: OfficialPublicationStateAction,
    changed: boolean,
  ): OfficialPublicationTransitionResult {
    return {
      from,
      to,
      action,
      changed,
      terminal: this.isTerminal(to),
      recoverable: this.isRecoverable(to),
    };
  }
}
