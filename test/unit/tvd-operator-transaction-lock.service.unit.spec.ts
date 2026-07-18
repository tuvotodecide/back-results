import { getAddress } from 'viem';
import { TvdOperatorTransactionLockService } from '@/modules/tvd/services/tvd-operator-transaction-lock.service';

describe('TVD operator transaction lock service', () => {
  function createHarness() {
    const locks = new Map<string, any>();
    const model = {
      findOneAndUpdate: jest.fn(async (filter: any, update: any) => {
        const existing = locks.get(filter.lockKey);
        const now = update.$set.acquiredAt;
        const canAcquire =
          !existing ||
          existing.expiresAt <= now ||
          existing.ownerId === update.$set.ownerId;
        if (!canAcquire) return null;
        const next = { ...(existing ?? {}), ...update.$set };
        locks.set(filter.lockKey, next);
        return next;
      }),
      deleteOne: jest.fn(async (filter: any) => {
        const existing = locks.get(filter.lockKey);
        if (existing?.ownerId === filter.ownerId) locks.delete(filter.lockKey);
        return { deletedCount: existing?.ownerId === filter.ownerId ? 1 : 0 };
      }),
    };
    return { service: new TvdOperatorTransactionLockService(model as any), model, locks };
  }

  it('TVD-PROC-POS-U-003 | POSITIVO | UNITARIO | adquiere lock por chain y operator', async () => {
    const { service } = createHarness();
    const lockKey = service.buildLockKey({
      chainId: 84532,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
    });

    const lock = await service.acquire({
      lockKey,
      ownerId: 'worker-a',
      ttlMs: 60000,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(lock).toMatchObject({ lockKey, ownerId: 'worker-a' });
  });

  it('TVD-PROC-NEG-U-005/006 | NEGATIVO | UNITARIO | lock ocupado no se libera por otra instancia', async () => {
    const { service } = createHarness();
    const lockKey = '84532:0x3333333333333333333333333333333333333333';
    await service.acquire({
      lockKey,
      ownerId: 'worker-a',
      ttlMs: 60000,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.acquire({
      lockKey,
      ownerId: 'worker-b',
      ttlMs: 60000,
      now: new Date('2026-01-01T00:00:01.000Z'),
    })).resolves.toBeNull();
    await service.release({ lockKey, ownerId: 'worker-b' });
    await expect(service.acquire({
      lockKey,
      ownerId: 'worker-b',
      ttlMs: 60000,
      now: new Date('2026-01-01T00:00:02.000Z'),
    })).resolves.toBeNull();
  });

  it('TVD-PROC-POS-U-014 | POSITIVO | UNITARIO | lock vencido se recupera', async () => {
    const { service } = createHarness();
    const lockKey = '84532:0x3333333333333333333333333333333333333333';
    await service.acquire({
      lockKey,
      ownerId: 'worker-a',
      ttlMs: 1000,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    const recovered = await service.acquire({
      lockKey,
      ownerId: 'worker-b',
      ttlMs: 1000,
      now: new Date('2026-01-01T00:00:02.000Z'),
    });

    expect(recovered).toMatchObject({ ownerId: 'worker-b' });
  });
});
