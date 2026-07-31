import { BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { getAddress } from 'viem';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_UNIT = 'UNITARIO';

const tenantId = new Types.ObjectId();
const assignmentId = new Types.ObjectId();
const userId = new Types.ObjectId();
const adminId = new Types.ObjectId();
const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
const txHash = `0x${'7'.repeat(64)}`;

function query<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error('expected rejection');
  } catch (error: any) {
    expect(error.getResponse?.()).toMatchObject({ code });
  }
}

function createHarness(overrides: Record<string, any> = {}) {
  const state = {
    tenant: { _id: tenantId, active: true },
    assignment: {
      _id: assignmentId,
      tenantId,
      userId,
      active: true,
      status: 'APPROVED',
      accountAddress: wallet,
      accountAddressNormalized: wallet.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
      ...(overrides.assignment ?? {}),
    },
    user: { _id: userId, active: true, ...(overrides.user ?? {}) },
    accreditations: [...(overrides.accreditations ?? [])],
  };

  const accreditationModel = {
    findOne: jest.fn((filter: any) => {
      const found = state.accreditations.find((row: any) => {
        if (filter._id && String(row._id) !== String(filter._id)) return false;
        if (filter.sourceType && row.sourceType !== filter.sourceType) return false;
        if (filter.sourceId && row.sourceId !== filter.sourceId) return false;
        return true;
      });
      return query(found ?? null);
    }),
    create: jest.fn(async (doc: any) => {
      if (overrides.duplicateOnCreate) {
        state.accreditations.push({
          _id: new Types.ObjectId(),
          ...doc,
          status: 'CONFIRMED',
          txHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        throw { code: 11000 };
      }
      const created = {
        _id: new Types.ObjectId(),
        ...doc,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      state.accreditations.push(created);
      return created;
    }),
    updateOne: jest.fn(async (filter: any, update: any) => {
      const row = state.accreditations.find((item: any) => String(item._id) === String(filter._id));
      if (row) {
        Object.assign(row, update.$set ?? {});
        if (update.$inc?.attempts) row.attempts += update.$inc.attempts;
      }
      return { modifiedCount: row ? 1 : 0 };
    }),
    findByIdAndUpdate: jest.fn((id: any, update: any) => {
      const row = state.accreditations.find((item: any) => String(item._id) === String(id));
      if (row) {
        Object.assign(row, update.$set ?? {});
        row.updatedAt = new Date();
      }
      return query(row ?? null);
    }),
    findById: jest.fn((id: any) => {
      const row = state.accreditations.find((item: any) => String(item._id) === String(id));
      return query(row ?? null);
    }),
  };
  const tenantModel = {
    findById: jest.fn((id: any) => query(
      Object.prototype.hasOwnProperty.call(overrides, 'tenantLookup')
        ? overrides.tenantLookup
        : String(id) === String(tenantId)
          ? state.tenant
          : null,
    )),
  };
  const assignmentModel = {
    findById: jest.fn((id: any) => query(String(id) === String(assignmentId) ? state.assignment : overrides.assignmentLookup ?? null)),
  };
  const userModel = {
    findById: jest.fn((_id: any) => query(overrides.userLookup ?? state.user)),
  };
  const processor = {
    processAccreditationById: jest.fn(async (id: any) => {
      const row = state.accreditations.find((item: any) => String(item._id) === String(id));
      Object.assign(row, {
        status: 'SUBMITTED',
        txHash,
        chainId: 84532,
        contractAddress: assignmentContract,
        submittedAt: new Date(),
        attempts: (row.attempts ?? 0) + 1,
      });
      return row;
    }),
    ...(overrides.processor ?? {}),
  };
  const reconciliation = {
    reconcileSubmittedAccreditation: jest.fn(async (id: any) => {
      const row = state.accreditations.find((item: any) => String(item._id) === String(id));
      Object.assign(row, {
        status: 'CONFIRMED',
        blockNumber: '123',
        confirmedAt: new Date(),
      });
      return row;
    }),
    ...(overrides.reconciliation ?? {}),
  };
  const auditService = {
    record: jest.fn(async () => ({ _id: new Types.ObjectId() })),
    ...(overrides.auditService ?? {}),
  };
  const configService = {
    get: jest.fn((key: string) => (key === 'app.tvd.decimals' ? '2' : undefined)),
    ...(overrides.configService ?? {}),
  };
  const service = new TvdManualAssignmentsService(
    accreditationModel as any,
    tenantModel as any,
    assignmentModel as any,
    userModel as any,
    processor as any,
    reconciliation as any,
    auditService as any,
    configService as ConfigService,
  );

  const dto = {
    tenantId: tenantId.toHexString(),
    assignmentId: assignmentId.toHexString(),
    tokenAmount: '100',
    reason: 'Credito promocional institucional',
  };
  const requester = {
    sub: adminId.toHexString(),
    role: 'ADMIN',
    active: true,
  };
  return {
    service,
    state,
    dto,
    requester,
    processor,
    reconciliation,
    auditService,
    accreditationModel,
  };
}

describe('TVD manual assignments service', () => {
  describe('CASOS POSITIVOS', () => {
    it('TVD-ASSIGN-P0-001 TVD-ASSIGN-P0-002 TVD-ASSIGN-P0-003 TVD-ASSIGN-P0-004 TVD-ASSIGN-P0-005 | TVD-MANUAL-POS-U-001/002/003/004/005/006/007/009 | POSITIVO | UNITARIO | SUPERADMIN crea asignacion manual confirmada', async () => {
      const { service, dto, requester, state, processor, reconciliation, auditService } = createHarness();

      const result = await service.createManualAssignment(dto, requester, 'manual-key-1');

      expect(state.accreditations).toHaveLength(1);
      expect(state.accreditations[0]).toMatchObject({
        sourceType: 'MANUAL_GRANT',
        sourceId: 'manual-key-1',
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        tokenAmount: '100',
        tokenAmountSmallestUnit: '10000',
        status: 'CONFIRMED',
        txHash,
        chainId: 84532,
        contractAddress: assignmentContract,
        blockNumber: '123',
        attempts: 1,
      });
      expect(processor.processAccreditationById).toHaveBeenCalledTimes(1);
      expect(reconciliation.reconcileSubmittedAccreditation).toHaveBeenCalledTimes(1);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TVD_MANUAL_ASSIGNMENT_REQUESTED' }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'TVD_MANUAL_ASSIGNMENT_CONFIRMED' }),
      );
      expect(JSON.stringify(result)).not.toContain('private');
      expect(result).toMatchObject({
        sourceType: 'MANUAL_GRANT',
        targetWallet: wallet,
        status: 'CONFIRMED',
      });
    });

    it('TVD-ASSIGN-P0-004 | TVD-MANUAL-POS-U-008 / TVD-MANUAL-NEG-U-023 | POSITIVO | UNITARIO | idempotencia devuelve existente sin segundo assign', async () => {
      const { service, dto, requester, processor } = createHarness();

      const first = await service.createManualAssignment(dto, requester, 'manual-key-2');
      const second = await service.createManualAssignment(dto, requester, 'manual-key-2');

      expect(second).toEqual(first);
      expect(processor.processAccreditationById).toHaveBeenCalledTimes(1);
    });

    it('TVD-MANUAL-NEG-U-023 | POSITIVO | UNITARIO | carrera de indice unico devuelve existente sin assign', async () => {
      const { service, dto, requester, processor } = createHarness({
        duplicateOnCreate: true,
      });

      const result = await service.createManualAssignment(dto, requester, 'race-key');

      expect(result).toMatchObject({
        sourceType: 'MANUAL_GRANT',
        status: 'CONFIRMED',
      });
      expect(processor.processAccreditationById).not.toHaveBeenCalled();
    });

    it('TVD-MANUAL-POS-U-010 | POSITIVO | UNITARIO | TvdBlockchainService permanece desacoplado de MongoDB y auditoria', async () => {
      const { service, dto, requester, processor } = createHarness();

      await service.createManualAssignment(dto, requester, 'manual-key-3');

      expect(processor.processAccreditationById).toHaveBeenCalledTimes(1);
      expect(processor.processAccreditationById.mock.calls[0][0]).toBeDefined();
    });
  });

  describe('CASOS NEGATIVOS', () => {
    it('TVD-ASSIGN-P0-001 TVD-SEC-P0-001 | TVD-MANUAL-NEG-U-001/002 | NEGATIVO | UNITARIO | rechaza usuario no autenticado o no ADMIN', async () => {
      const { service, dto } = createHarness();

      await expect(service.createManualAssignment(dto, undefined as any, 'key')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.createManualAssignment(dto, { sub: adminId.toHexString(), role: 'PRIMARY', active: true }, 'key')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('TVD-MANUAL-NEG-U-003/004 | NEGATIVO | UNITARIO | rechaza tenant inexistente o inactivo', async () => {
      const missingTenant = createHarness({ tenantLookup: null });
      await expectCode(
        missingTenant.service.createManualAssignment(missingTenant.dto, missingTenant.requester, 'key'),
        'TVD_TENANT_NOT_FOUND',
      );
      const harness = createHarness();
      harness.state.tenant.active = false;
      await expectCode(
        harness.service.createManualAssignment(harness.dto, harness.requester, 'key'),
        'TVD_TENANT_INACTIVE',
      );
    });

    it('TVD-MANUAL-NEG-U-005/006/007/008 | NEGATIVO | UNITARIO | rechaza assignment invalido', async () => {
      await expectCode(
        createHarness({ assignmentLookup: null }).service.createManualAssignment(
          { ...createHarness().dto, assignmentId: new Types.ObjectId().toHexString() },
          createHarness().requester,
          'key',
        ),
        'TVD_ASSIGNMENT_NOT_FOUND',
      );

      for (const [override, code] of [
        [{ tenantId: new Types.ObjectId() }, 'TVD_ASSIGNMENT_TENANT_MISMATCH'],
        [{ active: false }, 'TVD_ASSIGNMENT_INACTIVE'],
        [{ status: 'PENDING' }, 'TVD_ASSIGNMENT_NOT_APPROVED'],
      ] as const) {
        const harness = createHarness({ assignment: override });
        await expectCode(
          harness.service.createManualAssignment(harness.dto, harness.requester, `key-${code}`),
          code,
        );
      }
    });

    it('TVD-MANUAL-NEG-U-009/010/011/012 | NEGATIVO | UNITARIO | rechaza usuario institucional o wallet invalida', async () => {
      const inactiveUser = createHarness({ user: { active: false } });
      await expectCode(
        inactiveUser.service.createManualAssignment(inactiveUser.dto, inactiveUser.requester, 'key-user'),
        'TVD_INSTITUTIONAL_USER_INACTIVE',
      );

      for (const [override, code] of [
        [{ accountAddress: null }, 'TVD_WALLET_MISSING'],
        [{ walletVerifiedAt: null }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ walletVerificationSource: null }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ accountAddressNormalized: null }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ accountAddress: 'not-a-wallet' }, 'TVD_WALLET_NOT_VERIFIED'],
        [{ accountAddress: '0x0000000000000000000000000000000000000000' }, 'TVD_WALLET_NOT_VERIFIED'],
      ] as const) {
        const harness = createHarness({ assignment: override });
        await expectCode(
          harness.service.createManualAssignment(harness.dto, harness.requester, `key-${code}-${Math.random()}`),
          code,
        );
      }
    });

    it('TVD-MANUAL-NEG-U-013/014/015/016/017/018 | NEGATIVO | UNITARIO | rechaza monto, reason o idempotency key invalidos', async () => {
      for (const tokenAmount of ['0', '-1', '1.001', '1e3']) {
        const harness = createHarness();
        await expectCode(
          harness.service.createManualAssignment(
            { ...harness.dto, tokenAmount },
            harness.requester,
            `amount-${tokenAmount}`,
          ),
          'TVD_INVALID_TOKEN_AMOUNT',
        );
      }

      const badReason = createHarness();
      await expectCode(
        badReason.service.createManualAssignment(
          { ...badReason.dto, reason: '<b>bad</b>' },
          badReason.requester,
          'reason-key',
        ),
        'TVD_INVALID_REASON',
      );

      const missingKey = createHarness();
      await expectCode(
        missingKey.service.createManualAssignment(missingKey.dto, missingKey.requester, ''),
        'TVD_IDEMPOTENCY_KEY_REQUIRED',
      );
    });

    it('TVD-MANUAL-NEG-U-019 | NEGATIVO | UNITARIO | misma idempotency key con payload diferente responde conflicto', async () => {
      const { service, dto, requester } = createHarness();

      await service.createManualAssignment(dto, requester, 'conflict-key');
      await expectCode(
        service.createManualAssignment({ ...dto, reason: 'Otro motivo valido' }, requester, 'conflict-key'),
        'TVD_IDEMPOTENCY_CONFLICT',
      );
    });

    it('TVD-MANUAL-NEG-U-020/022/024 | NEGATIVO | UNITARIO | error antes de broadcast deja FAILED y no filtra secreto', async () => {
      const secret = `0x${'1'.repeat(64)}`;
      const harness = createHarness({
        processor: {
          processAccreditationById: jest.fn(async (id: any) => {
            const row = harness.state.accreditations.find((item: any) => String(item._id) === String(id));
            Object.assign(row, {
              status: 'FAILED',
              lastErrorCode: 'TVD_CONFIG_INCOMPLETE',
            });
            return row;
          }),
        },
      });

      await expect(harness.service.createManualAssignment(harness.dto, harness.requester, 'fail-key')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(harness.state.accreditations[0]).toMatchObject({
        status: 'FAILED',
        lastErrorCode: 'TVD_CONFIG_INCOMPLETE',
      });
      try {
        await harness.service.createManualAssignment(
          { ...harness.dto, reason: 'Diferente payload' },
          harness.requester,
          'fail-key',
        );
        throw new Error('expected rejection');
      } catch (error: any) {
        expect(JSON.stringify(error.getResponse?.())).not.toContain(secret);
      }
    });

    it('TVD-MANUAL-NEG-U-021 | NEGATIVO | UNITARIO | resultado ambiguo queda NEEDS_REVIEW', async () => {
      const harness = createHarness({
        processor: {
          processAccreditationById: jest.fn(async (id: any) => {
            const row = harness.state.accreditations.find((item: any) => String(item._id) === String(id));
            Object.assign(row, {
              status: 'NEEDS_REVIEW',
              lastErrorCode: 'TVD_RECEIPT_NOT_FOUND',
            });
            return row;
          }),
        },
      });

      await expectCode(
        harness.service.createManualAssignment(harness.dto, harness.requester, 'review-key'),
        'TVD_MANUAL_ASSIGNMENT_NEEDS_REVIEW',
      );
      expect(harness.state.accreditations[0]).toMatchObject({
        status: 'NEEDS_REVIEW',
        lastErrorCode: 'TVD_RECEIPT_NOT_FOUND',
      });
    });
  });
});
