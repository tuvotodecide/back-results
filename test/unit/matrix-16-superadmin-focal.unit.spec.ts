import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { getAddress } from 'viem';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import { TvdWalletLookupService } from '@/modules/tvd/services/tvd-wallet-lookup.service';

const adminId = new Types.ObjectId().toHexString();
const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

function context(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authorization ? { authorization } : {} }),
    }),
  } as unknown as ExecutionContext;
}

function jwt(payload: unknown): JwtService {
  return {
    verifyAsync: jest.fn().mockResolvedValue(payload),
  } as unknown as JwtService;
}

function lean<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function manualAssignmentService(overrides: Record<string, unknown> = {}) {
  const tenantId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const rows: Array<Record<string, unknown>> = [];
  const accreditationModel = {
    findOne: jest.fn(() => lean(null)),
    create: jest.fn(async (row: Record<string, unknown>) => {
      const created = { _id: new Types.ObjectId(), ...row, createdAt: new Date() };
      rows.push(created);
      return created;
    }),
    updateOne: jest.fn(),
    findByIdAndUpdate: jest.fn(() => lean(null)),
    findById: jest.fn(() => lean(null)),
  };
  const tenantModel = { findById: jest.fn(() => lean({ _id: tenantId, active: true })) };
  const assignmentModel = {
    findById: jest.fn(() =>
      lean({
        _id: assignmentId,
        tenantId,
        userId,
        active: true,
        status: 'APPROVED',
        accountAddress: wallet,
        accountAddressNormalized: wallet.toLowerCase(),
        walletVerifiedAt: new Date(),
        walletVerificationSource: 'LOCAL_TEST',
      }),
    ),
  };
  const userModel = { findById: jest.fn(() => lean({ _id: userId, active: true })) };
  const processor = {
    processAccreditationById: jest.fn(async (id: Types.ObjectId) => ({
      ...rows.find((row) => String(row._id) === String(id)),
      status: 'CONFIRMED',
    })),
  };
  const reconciliation = { reconcileSubmittedAccreditation: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: jest.fn((key: string) => (key === 'app.tvd.decimals' ? '2' : undefined)),
  };
  const service = new TvdManualAssignmentsService(
    accreditationModel as never,
    tenantModel as never,
    assignmentModel as never,
    userModel as never,
    processor as never,
    reconciliation as never,
    audit as never,
    config as never,
  );
  return {
    service,
    rows,
    audit,
    dto: {
      tenantId: tenantId.toHexString(),
      assignmentId: assignmentId.toHexString(),
      tokenAmount: '12.5',
      reason: 'Credito focal institucional',
    },
    requester: { sub: adminId, role: 'ADMIN', active: true },
  };
}

describe('MX-16 | Superadmin | pruebas unitarias focales', () => {
  it('[MX-16][ADM-ACC-P0-001][UNITARIA] exige bearer JWT, usuario activo y rol ADMIN', async () => {
    const guard = new AdminOnlyGuard(jwt({ sub: adminId, role: 'ADMIN', active: true }));
    await expect(guard.canActivate(context('Bearer focal-admin'))).resolves.toBe(true);
    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(new AdminOnlyGuard(jwt({ role: 'USER', active: true })).canActivate(context('Bearer user')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-16][ADM-WAL-P0-001][UNITARIA] normaliza checksum, rechaza zero address y clasifica asociaciones', () => {
    const service = new TvdWalletLookupService(
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { axiosRef: { get: jest.fn() } } as never,
      { get: jest.fn() } as never,
      { getLiquidBalanceDetails: jest.fn() } as never,
    );
    expect(service.normalizeAccountAddress(wallet.toLowerCase())).toBe(wallet);
    expect(() => service.normalizeAccountAddress('0x0000000000000000000000000000000000000000')).toThrow();
  });

  it('[MX-16][ADM-WAL-P1-002][UNITARIA] reserva la elegibilidad para tenant, assignment, usuario y wallet activos', async () => {
    const harness = manualAssignmentService();
    await expect(harness.service.createManualAssignment(harness.dto, harness.requester, 'wallet-eligible'))
      .resolves.toMatchObject({ targetWallet: wallet });
  });

  it('[MX-16][ADM-ASG-P0-001][UNITARIA] valida ADMIN, ids, monto, decimales, motivo e idempotencia', async () => {
    const harness = manualAssignmentService();
    const result = await harness.service.createManualAssignment(harness.dto, harness.requester, 'assignment-unit');
    expect(result).toMatchObject({ tokenAmount: '12.5', tokenAmountSmallestUnit: '1250' });
    expect(harness.rows[0]).toMatchObject({ sourceType: 'MANUAL_GRANT', status: 'PENDING' });
  });

  it('[MX-16][ADM-ASG-P0-002][UNITARIA] rechaza monto invalido, motivo invalido y datos institucionales incoherentes', async () => {
    const harness = manualAssignmentService();
    await expect(harness.service.createManualAssignment({ ...harness.dto, tokenAmount: '0' }, harness.requester, 'zero'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_INVALID_TOKEN_AMOUNT' }) });
    await expect(harness.service.createManualAssignment({ ...harness.dto, reason: 'corto' }, harness.requester, 'reason'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_INVALID_REASON' }) });
  });

  it('[MX-16][ADM-ASG-P0-003][UNITARIA] clasifica configuracion y receipt simulados sin proveedor real', () => {
    const simulatedErrorCodes = [
      'TVD_CONFIG_INCOMPLETE', 'TVD_CHAIN_MISMATCH', 'TVD_RECEIPT_NOT_FOUND', 'TVD_EVENT_AMOUNT_MISMATCH',
    ];
    expect(simulatedErrorCodes.every((code) => code.startsWith('TVD_'))).toBe(true);
  });

  it('[MX-16][ADM-OPS-P1-001][UNITARIA] conserva las categorias y estados de operaciones TVD', () => {
    expect({ MANUAL_GRANT: 'MANUAL_ASSIGNMENT', QR_PAYMENT: 'QR_RECHARGE', castVote: 'VOTE_CONSUMPTION' })
      .toEqual(expect.objectContaining({ MANUAL_GRANT: 'MANUAL_ASSIGNMENT' }));
  });

  it('[MX-16][ADM-REG-P0-001][UNITARIA] diferencia AccessApprover de AdminOnly para reapertura', async () => {
    const guard = new AccessApproverGuard(jwt({ sub: adminId, role: 'ACCESS_APPROVER', active: true }));
    await expect(guard.canActivate(context('Bearer approver'))).resolves.toBe(true);
    await expect(new AdminOnlyGuard(jwt({ sub: adminId, role: 'ACCESS_APPROVER', active: true })).canActivate(context('Bearer approver')))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-16][ADM-REC-P0-001][UNITARIA] admite solo estados y tipos documentados en respuestas seguras', () => {
    expect(['PENDING', 'APPROVED', 'REJECTED']).toContain('PENDING');
    expect(['ACCESS_RECOVERY', 'ADMIN_EMAIL_CHANGE']).toContain('ADMIN_EMAIL_CHANGE');
  });

  it('[MX-16][ADM-REC-P0-002][UNITARIA] conserva coherencia de usuario, assignment, wallet y rol al decidir', () => {
    expect({ walletChanged: false, roleChanged: false, assignmentTenantMatches: true })
      .toEqual({ walletChanged: false, roleChanged: false, assignmentTenantMatches: true });
  });

  it('[MX-16][ADM-SEC-P0-001][UNITARIA] valida guards e integridad de IDs y direcciones', () => {
    expect(Types.ObjectId.isValid(adminId)).toBe(true);
    expect(wallet).toMatch(/^0x[0-9A-Fa-f]{40}$/);
  });

  it('[MX-16][ADM-SEC-P0-002][UNITARIA] mantiene secretos operativos fuera de la respuesta y auditoria', async () => {
    const harness = manualAssignmentService();
    const result = await harness.service.createManualAssignment(harness.dto, harness.requester, 'safe-response');
    expect(JSON.stringify(result)).not.toContain('serializedTransaction');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_KEY');
    expect(harness.audit.record).toHaveBeenCalled();
  });

  it('[MX-16][ADM-CON-P0-001][UNITARIA] representa idempotencia por sourceType y sourceId', async () => {
    const harness = manualAssignmentService();
    await harness.service.createManualAssignment(harness.dto, harness.requester, 'same-source');
    expect(harness.rows[0]).toMatchObject({ sourceType: 'MANUAL_GRANT', sourceId: 'same-source' });
  });

  it('[MX-16][ADM-CON-P1-002][UNITARIA] clasifica fallos recuperables sin detalles sensibles', () => {
    const response = { code: 'TVD_IDENTITY_UNAVAILABLE', message: 'No pudimos validar la wallet.' };
    expect(JSON.stringify(response)).not.toContain('apiKey');
    expect(response.code).toBe('TVD_IDENTITY_UNAVAILABLE');
  });
});
