import {
  TvdAdminOperationStatus,
  TvdAdminOperationTotalBucket,
  TvdAdminOperationType,
  canAffectTvdAdminAssignedTotal,
  canAffectTvdAdminConsumedTotal,
  getTvdAdminOperationTotalBucket,
} from '@/modules/tvd/types/tvd-admin-operations.types';

describe('TVD admin operations accounting rules', () => {
  it('clasifica asignaciones manuales confirmadas con monto e institucion como total asignado', () => {
    const operation = {
      operationType: TvdAdminOperationType.MANUAL_ASSIGNMENT,
      status: TvdAdminOperationStatus.CONFIRMED,
      tenantId: 'tenant-1',
      amountSmallestUnit: '1000000000000000000',
    };

    expect(canAffectTvdAdminAssignedTotal(operation)).toBe(true);
    expect(canAffectTvdAdminConsumedTotal(operation)).toBe(false);
    expect(getTvdAdminOperationTotalBucket(operation)).toBe(
      TvdAdminOperationTotalBucket.ASSIGNED,
    );
  });

  it('clasifica recargas QR confirmadas con monto e institucion como total asignado', () => {
    const operation = {
      operationType: TvdAdminOperationType.QR_RECHARGE,
      status: TvdAdminOperationStatus.CONFIRMED,
      tenantId: 'tenant-1',
      amount: '25.5',
    };

    expect(getTvdAdminOperationTotalBucket(operation)).toBe(
      TvdAdminOperationTotalBucket.ASSIGNED,
    );
  });

  it('clasifica consumos por voto confirmados con monto e institucion como total consumido', () => {
    const operation = {
      operationType: TvdAdminOperationType.VOTE_CONSUMPTION,
      status: TvdAdminOperationStatus.CONFIRMED,
      tenantId: 'tenant-1',
      amountSmallestUnit: '1250000000000000000',
    };

    expect(canAffectTvdAdminAssignedTotal(operation)).toBe(false);
    expect(canAffectTvdAdminConsumedTotal(operation)).toBe(true);
    expect(getTvdAdminOperationTotalBucket(operation)).toBe(
      TvdAdminOperationTotalBucket.CONSUMED,
    );
  });

  it.each([
    ['pendiente', TvdAdminOperationStatus.PENDING, '1', 'tenant-1'],
    ['fallida', TvdAdminOperationStatus.FAILED, '1', 'tenant-1'],
    ['sin monto', TvdAdminOperationStatus.CONFIRMED, null, 'tenant-1'],
    ['sin institucion', TvdAdminOperationStatus.CONFIRMED, '1', null],
  ])(
    'no contabiliza una operacion %s',
    (_caseName, status, amountSmallestUnit, tenantId) => {
      expect(
        getTvdAdminOperationTotalBucket({
          operationType: TvdAdminOperationType.MANUAL_ASSIGNMENT,
          status,
          tenantId,
          amountSmallestUnit,
        }),
      ).toBe(TvdAdminOperationTotalBucket.NONE);
    },
  );
});
