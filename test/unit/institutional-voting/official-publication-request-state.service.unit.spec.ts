import { ConflictException } from '@nestjs/common';

import { OfficialPublicationRequestStateService } from '@/modules/institutional-voting/services/publication/official-publication-request-state.service';

describe('OfficialPublicationRequestStateService', () => {
  let service: OfficialPublicationRequestStateService;

  beforeEach(() => {
    service = new OfficialPublicationRequestStateService();
  });

  it('recorre el camino feliz desde preparacion hasta completado', () => {
    const flow = [
      ['PREPARING', 'MARK_PREPARED', 'PENDING_APPROVAL'],
      ['PENDING_APPROVAL', 'CLAIM', 'CLAIMED'],
      ['CLAIMED', 'START_SIGNING', 'SIGNING'],
      ['SIGNING', 'SUBMIT_USER_OPERATION', 'SUBMITTED'],
      ['SUBMITTED', 'MARK_CHAIN_PENDING', 'CHAIN_PENDING'],
      ['CHAIN_PENDING', 'CONFIRM_CHAIN', 'CHAIN_CONFIRMED'],
      ['CHAIN_CONFIRMED', 'START_FINALIZING', 'FINALIZING'],
      ['FINALIZING', 'COMPLETE', 'COMPLETED'],
    ] as const;

    for (const [from, action, expectedTo] of flow) {
      expect(service.transition(from, action)).toMatchObject({
        from,
        to: expectedTo,
        action,
        changed: true,
      });
    }
    expect(service.transition('FINALIZING', 'COMPLETE')).toMatchObject({
      to: 'COMPLETED',
      terminal: true,
      recoverable: false,
    });
  });

  it('cubre rechazo, expiracion, cancelacion, fallo final y revision manual', () => {
    expect(service.transition('PENDING_APPROVAL', 'REJECT')).toMatchObject({
      to: 'REJECTED',
      terminal: true,
    });
    expect(service.transition('CLAIMED', 'EXPIRE')).toMatchObject({
      to: 'EXPIRED',
      terminal: true,
    });
    expect(service.transition('PREPARING', 'CANCEL')).toMatchObject({
      to: 'CANCELLED',
      terminal: true,
    });
    expect(service.transition('SIGNING', 'CANCEL')).toMatchObject({
      to: 'CANCELLED',
      terminal: true,
    });
    expect(service.transition('FAILED_RETRYABLE', 'CANCEL')).toMatchObject({
      to: 'CANCELLED',
      terminal: true,
    });
    expect(service.transition('SUBMITTED', 'MARK_NEEDS_REVIEW')).toMatchObject({
      to: 'NEEDS_REVIEW',
      terminal: false,
      recoverable: true,
    });
    expect(service.transition('FAILED_RETRYABLE', 'FAIL_FINAL')).toMatchObject({
      to: 'FAILED_FINAL',
      terminal: true,
    });
  });

  it('permite reintentos recuperables hacia blockchain o finalizacion local', () => {
    expect(service.transition('SUBMITTED', 'FAIL_RETRYABLE')).toMatchObject({
      to: 'FAILED_RETRYABLE',
      recoverable: true,
    });
    expect(service.transition('FAILED_RETRYABLE', 'RETRY_CHAIN_CHECK')).toMatchObject({
      to: 'CHAIN_PENDING',
      recoverable: true,
    });
    expect(service.transition('NEEDS_REVIEW', 'RETRY_FINALIZATION')).toMatchObject({
      to: 'FINALIZING',
      recoverable: true,
    });
  });

  it('libera claims vencidos hacia aprobacion pendiente', () => {
    expect(service.transition('CLAIMED', 'RELEASE_CLAIM')).toMatchObject({
      from: 'CLAIMED',
      to: 'PENDING_APPROVAL',
      changed: true,
    });
    expect(service.transition('SIGNING', 'RELEASE_CLAIM')).toMatchObject({
      from: 'SIGNING',
      to: 'PENDING_APPROVAL',
      changed: true,
    });
    expect(service.transition('PENDING_APPROVAL', 'RELEASE_CLAIM')).toMatchObject({
      to: 'PENDING_APPROVAL',
      changed: false,
    });
  });

  it('trata repeticiones esperadas como idempotentes', () => {
    expect(service.transition('PENDING_APPROVAL', 'MARK_PREPARED')).toMatchObject({
      to: 'PENDING_APPROVAL',
      changed: false,
    });
    expect(service.transition('CHAIN_CONFIRMED', 'SUBMIT_USER_OPERATION')).toMatchObject({
      to: 'CHAIN_CONFIRMED',
      changed: false,
    });
    expect(service.transition('COMPLETED', 'COMPLETE')).toMatchObject({
      to: 'COMPLETED',
      changed: false,
      terminal: true,
    });
  });

  it('bloquea transiciones invalidas desde estados terminales o saltos peligrosos', () => {
    expect(() => service.transition('COMPLETED', 'CLAIM')).toThrow(ConflictException);
    expect(() => service.transition('PENDING_APPROVAL', 'COMPLETE')).toThrow(
      ConflictException,
    );
    expect(service.canTransition('PENDING_APPROVAL', 'COMPLETE')).toBe(false);
    expect(service.canTransition('PENDING_APPROVAL', 'CLAIM')).toBe(true);
  });

  it('genera filtro atomico con requestId, estado y version', () => {
    expect(
      service.buildOptimisticTransitionFilter({
        requestId: 'request-1',
        from: 'PENDING_APPROVAL',
        version: 3,
      }),
    ).toEqual({
      requestId: 'request-1',
      status: 'PENDING_APPROVAL',
      version: 3,
    });
  });

  it('genera update atomico con historial y version para transicion real', () => {
    const at = new Date('2026-07-22T12:00:00.000Z');
    const transition = service.transition('PENDING_APPROVAL', 'CLAIM');

    expect(
      service.buildTransitionUpdate({
        transition,
        actor: 'device-1',
        at,
      }),
    ).toEqual({
      $set: {
        status: 'CLAIMED',
        updatedAt: at,
        errorCode: null,
        errorStage: null,
        safeMessage: null,
      },
      $inc: { version: 1 },
      $push: {
        statusHistory: {
          from: 'PENDING_APPROVAL',
          to: 'CLAIMED',
          action: 'CLAIM',
          actor: 'device-1',
          at,
        },
      },
    });
  });

  it('no incrementa version en repeticion idempotente', () => {
    const transition = service.transition('CLAIMED', 'CLAIM');

    expect(
      service.buildTransitionUpdate({
        transition,
        actor: 'device-1',
      }),
    ).not.toHaveProperty('$inc');
  });
});
