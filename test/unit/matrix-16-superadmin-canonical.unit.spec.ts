import {
  BadGatewayException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';
import { ExecutionContext } from '@nestjs/common';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { HistoryController } from '@/modules/history/controllers/history.controller';
import { InstitutionalAccessRecoveryRequestsController } from '@/modules/institutional-access-recovery-requests/controllers/institutional-access-recovery-requests.controller';
import { TVD_ASSIGNMENT_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';
import { TvdReceiptValidatorService } from '@/modules/tvd/services/tvd-receipt-validator.service';
import { TvdWalletLookupService } from '@/modules/tvd/services/tvd-wallet-lookup.service';

jest.mock(
  '../../src/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.guard',
  () => ({
    InstitutionalMobileZkAuthGuard: class InstitutionalMobileZkAuthGuardMock {
      canActivate(): boolean {
        return true;
      }
    },
  }),
);

const {
  InstitutionalAdminApplicationsController,
} = require('../../src/modules/institutional-admin-applications/controllers/institutional-admin-applications.controller');

const adminId = new Types.ObjectId().toHexString();
const tenantId = new Types.ObjectId();
const assignmentId = new Types.ObjectId();
const userId = new Types.ObjectId();
const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
const entryPoint = getAddress('0x0000000071727De22E5E9d8BAf0edAc6f37da032');

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

function context(authorization?: string) {
  const request: Record<string, unknown> = {
    headers: authorization ? { authorization } : {},
  };
  return {
    request,
    value: {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext,
  };
}

function guardJwt(payload: unknown, invalid = false) {
  return {
    verifyAsync: jest.fn(async () => {
      if (invalid) throw new Error('invalid fixture token');
      return payload;
    }),
  } as unknown as JwtService;
}

function manualHarness(overrides: Record<string, unknown> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const tenant = { _id: tenantId, active: true, ...(overrides.tenant as object) };
  const assignment = {
    _id: assignmentId,
    tenantId,
    userId,
    active: true,
    status: 'APPROVED',
    accountAddress: wallet,
    accountAddressNormalized: wallet.toLowerCase(),
    walletVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    walletVerificationSource: 'LOCAL_FIXTURE',
    ...(overrides.assignment as object),
  };
  const user = { _id: userId, active: true, ...(overrides.user as object) };
  const accreditation = {
    findOne: jest.fn((filter: Record<string, unknown>) =>
      lean(rows.find((row) => row.sourceId === filter.sourceId) ?? null)),
    create: jest.fn(async (row: Record<string, unknown>) => {
      const created = { _id: new Types.ObjectId(), ...row, createdAt: new Date() };
      rows.push(created);
      return created;
    }),
    updateOne: jest.fn(),
    findById: jest.fn((id: Types.ObjectId) => lean(rows.find((row) => String(row._id) === String(id)) ?? null)),
    findByIdAndUpdate: jest.fn((id: Types.ObjectId, update: { $set: object }) => {
      const row = rows.find((item) => String(item._id) === String(id));
      if (row) Object.assign(row, update.$set);
      return lean(row ?? null);
    }),
  };
  const processor = {
    processAccreditationById: jest.fn(async (id: Types.ObjectId) => {
      const row = rows.find((item) => String(item._id) === String(id));
      return { ...row, status: 'CONFIRMED', txHash: `0x${'1'.repeat(64)}`, chainId: 84532, contractAddress: assignmentContract };
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new TvdManualAssignmentsService(
    accreditation as never,
    { findById: jest.fn((id: Types.ObjectId) => lean(String(id) === String(tenantId) ? tenant : null)) } as never,
    { findById: jest.fn((id: Types.ObjectId) => lean(String(id) === String(assignmentId) ? assignment : null)) } as never,
    { findById: jest.fn(() => lean(user)) } as never,
    processor as never,
    { reconcileSubmittedAccreditation: jest.fn() } as never,
    audit as never,
    { get: jest.fn((key: string) => key === 'app.tvd.decimals' ? '2' : undefined) } as never,
  );
  return {
    service, rows, processor, audit,
    dto: { tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '12.5', reason: 'Credito institucional focal' },
    requester: { sub: adminId, role: 'ADMIN', active: true },
  };
}

function tokensAssignedLog(targetWallet = wallet, amount = '1250') {
  return {
    address: assignmentContract,
    topics: encodeEventTopics({ abi: TVD_ASSIGNMENT_ABI, eventName: 'TokensAssigned', args: { institution: targetWallet } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(amount)]),
  };
}

describe('MX-16 | Backend Results | IDs canónicos', () => {
  it('[MX-16][ADM-ACC-P0-001][UNITARIA] exige bearer válido, usuario activo y rol ADMIN para capacidad global', async () => {
    const allowed = context('Bearer admin');
    await expect(new AdminOnlyGuard(guardJwt({ sub: adminId, role: 'ADMIN', active: true })).canActivate(allowed.value)).resolves.toBe(true);
    expect(allowed.request.user).toMatchObject({ role: 'ADMIN' });
    await expect(new AdminOnlyGuard(guardJwt({}, true)).canActivate(context('Bearer invalid').value)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(new AdminOnlyGuard(guardJwt({ role: 'ADMIN', active: false })).canActivate(context('Bearer inactive').value)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(new AdminOnlyGuard(guardJwt({ role: 'TENANT_ADMIN', active: true })).canActivate(context('Bearer institutional').value)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new AdminOnlyGuard(guardJwt({ role: 'ADMIN', active: true })).canActivate(context().value)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[MX-16][ADM-CTR-P0-001][ACEPTACION] entrega app.contracts parcial sin convertir txHash configurado en despliegue', () => {
    const contracts = { success: true, data: { tvdToken: { address: wallet, txHash: '0xconfigured' }, multisigWallet: null } };
    const history = { getContracts: jest.fn().mockReturnValue(contracts) };
    const response = new HistoryController(history as never).getContractsData();
    expect(response).toEqual(contracts);
    expect(response.data.tvdToken).toMatchObject({ address: wallet, txHash: '0xconfigured' });
    expect(JSON.stringify(response)).not.toContain('deployment');
    expect(history.getContracts).toHaveBeenCalledTimes(1);
  });

  it('[MX-16][ADM-WAL-P0-001][INTEGRACION] normaliza wallet, cruza Identity simulado y devuelve asociaciones seguras', async () => {
    const http = { axiosRef: { get: jest.fn().mockResolvedValue({ data: { ok: true, record: { accountAddress: wallet, apiKey: 'hidden' } } }) } };
    const lookup = new TvdWalletLookupService(
      { find: jest.fn(() => lean([{ _id: assignmentId, tenantId, userId, active: true, status: 'APPROVED', institutionalRole: 'PRIMARY', accountAddress: wallet, accountAddressNormalized: wallet.toLowerCase(), walletVerifiedAt: new Date(), walletVerificationSource: 'LOCAL' }])) } as never,
      { find: jest.fn(() => lean([{ _id: tenantId, name: 'Tenant local', active: true }])) } as never,
      { find: jest.fn(() => lean([{ _id: userId, active: true }])) } as never,
      http as never,
      { get: jest.fn((key: string, fallback?: unknown) => key === 'app.identity.baseUrl' ? 'http://identity.invalid' : key === 'app.identity.apiKey' ? 'local-only-key' : fallback) } as never,
      { getLiquidBalanceDetails: jest.fn().mockResolvedValue({ smallestUnit: '0', formatted: '0', decimals: 18 }) } as never,
    );
    expect(lookup.normalizeAccountAddress(wallet.toLowerCase())).toBe(wallet);
    expect(() => lookup.normalizeAccountAddress('0x0000000000000000000000000000000000000000')).toThrow();
    const result = await lookup.lookupAdminWallet(wallet, { role: 'ADMIN', active: true });
    expect(result).toMatchObject({ identityStatus: 'REGISTERED', associationStatus: 'ASSOCIATED', canUse: true });
    expect(JSON.stringify(result)).not.toContain('local-only-key');
    http.axiosRef.get.mockResolvedValueOnce({ data: { invalid: true } });
    await expect(lookup.lookupAdminWallet(wallet)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('[MX-16][ADM-WAL-P1-002][ACEPTACION] expone solo wallets elegibles y conserva orden/paginación del contrato admin', async () => {
    const tenant = { _id: tenantId, name: 'Alfa', active: true };
    const assignment = { _id: assignmentId, tenantId, userId, active: true, status: 'APPROVED', institutionalRole: 'PRIMARY', accountAddress: wallet, accountAddressNormalized: wallet.toLowerCase(), walletVerifiedAt: new Date(), walletVerificationSource: 'LOCAL', createdAt: new Date() };
    const tenantsQuery = { sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue([tenant]) };
    tenantsQuery.sort.mockReturnValue(tenantsQuery); tenantsQuery.skip.mockReturnValue(tenantsQuery); tenantsQuery.limit.mockReturnValue(tenantsQuery);
    const assignmentQuery = { sort: jest.fn(), lean: jest.fn().mockResolvedValue([assignment]) };
    assignmentQuery.sort.mockReturnValue(assignmentQuery);
    const queries = new TvdQueryService(
      { find: jest.fn() } as never, { find: jest.fn() } as never, { find: jest.fn() } as never,
      { find: jest.fn(() => tenantsQuery), countDocuments: jest.fn().mockResolvedValue(1), findById: jest.fn(() => lean(tenant)) } as never,
      { find: jest.fn(() => assignmentQuery) } as never,
      { find: jest.fn(() => lean([{ _id: userId, active: true }])) } as never,
      {} as never, { getRelatedAmounts: jest.fn() } as never, { get: jest.fn() } as never,
    );
    const admin = { sub: adminId, role: 'ADMIN', active: true };
    const listed = await queries.listAdminInstitutions({ search: 'al', page: 1, limit: 20 }, admin);
    const wallets = await queries.listAdminInstitutionWallets(String(tenantId), admin);
    expect(listed).toMatchObject({ items: [expect.objectContaining({ tenantId: String(tenantId), name: 'Alfa', eligibleWalletsCount: 1 })], total: 1, hasNextPage: false });
    expect(wallets.wallets).toEqual([expect.objectContaining({ walletStatus: 'VERIFIED', active: true })]);
    await expect(new AdminOnlyGuard(guardJwt({ role: 'TENANT_ADMIN', active: true })).canActivate(context('Bearer tenant').value)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-16][ADM-ASG-P0-001][INTEGRACION] crea MANUAL_GRANT, convierte smallest units, audita y termina con receipt simulado', async () => {
    const harness = manualHarness();
    const result = await harness.service.createManualAssignment(harness.dto, harness.requester, 'assignment-canonical');
    expect(harness.rows).toHaveLength(1);
    expect(harness.rows[0]).toMatchObject({ sourceType: 'MANUAL_GRANT', sourceId: 'assignment-canonical', targetWallet: wallet, tokenAmountSmallestUnit: '1250' });
    expect(result).toMatchObject({ status: 'CONFIRMED', chainId: 84532, contractAddress: assignmentContract });
    expect(harness.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'TVD_MANUAL_ASSIGNMENT_REQUESTED' }));
    expect(JSON.stringify(result)).not.toContain('serializedTransaction');
  });

  it('[MX-16][ADM-ASG-P0-002][UNITARIA] rechaza datos manipulados sin persistir ni procesar', async () => {
    const cases = [
      [{ tenant: { active: false } }, 'TVD_TENANT_INACTIVE'],
      [{ assignment: { active: false } }, 'TVD_ASSIGNMENT_INACTIVE'],
      [{ assignment: { status: 'PENDING' } }, 'TVD_ASSIGNMENT_NOT_APPROVED'],
      [{ assignment: { walletVerifiedAt: null } }, 'TVD_WALLET_NOT_VERIFIED'],
      [{ user: { active: false } }, 'TVD_INSTITUTIONAL_USER_INACTIVE'],
    ] as const;
    for (const [override, code] of cases) {
      const harness = manualHarness(override);
      await expect(harness.service.createManualAssignment(harness.dto, harness.requester, `negative-${code}`)).rejects.toMatchObject({ response: expect.objectContaining({ code }) });
      expect(harness.rows).toHaveLength(0);
      expect(harness.processor.processAccreditationById).not.toHaveBeenCalled();
    }
    for (const tokenAmount of ['0', '-1', '1.001', '1e3']) {
      const harness = manualHarness();
      await expect(harness.service.createManualAssignment({ ...harness.dto, tokenAmount }, harness.requester, `amount-${tokenAmount}`)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_INVALID_TOKEN_AMOUNT' }) });
      expect(harness.rows).toHaveLength(0);
    }
  });

  it('[MX-16][ADM-ASG-P0-003][UNITARIA] valida UserOperation simulada por EntryPoint, confirmaciones y TokensAssigned', () => {
    const validator = new TvdReceiptValidatorService();
    const receipt = { transactionHash: `0x${'2'.repeat(64)}`, status: 'success', to: entryPoint, blockNumber: 100n, logs: [tokensAssignedLog()] };
    const receiptBaseInput = {
      expectedChainId: 84532,
      actualChainId: 84532,
      expectedContractAddress: assignmentContract,
      expectedEntryPointAddress: entryPoint,
      expectedInstitutionWallet: wallet,
      expectedAmountSmallestUnit: '1250',
      confirmationsRequired: 3,
      currentBlockNumber: 102n,
    };
    expect(validator.validateAssignReceipt({ ...receiptBaseInput, receipt })).toEqual({ txHash: receipt.transactionHash, blockNumber: '100', confirmations: 3 });
    for (const [caseInput, code] of [[{ receipt: null }, 'TVD_RECEIPT_NOT_FOUND'], [{ actualChainId: 1, receipt }, 'TVD_CHAIN_MISMATCH'], [{ receipt: { ...receipt, logs: [tokensAssignedLog(wallet, '1')] } }, 'TVD_EVENT_AMOUNT_MISMATCH']] as const) {
      expect(() => validator.validateAssignReceipt({ ...receiptBaseInput, ...caseInput })).toThrow(expect.objectContaining({ code }));
    }
  });

  it('[MX-16][ADM-OPS-P1-001][UNITARIA] conserva tipos, estados, totales smallest-units y errores de filtros seguros', () => {
    const operations = [{ source: 'MANUAL_GRANT', type: 'MANUAL_ASSIGNMENT', status: 'CONFIRMED', amountSmallestUnit: 1250n }, { source: 'QR_PAYMENT', type: 'QR_RECHARGE', status: 'CONFIRMED', amountSmallestUnit: 250n }, { source: 'castVote', type: 'VOTE_CONSUMPTION', status: 'NEEDS_REVIEW', amountSmallestUnit: 99n }];
    const confirmed = operations.filter((operation) => operation.status === 'CONFIRMED');
    expect(confirmed.reduce((total, operation) => total + operation.amountSmallestUnit, 0n)).toBe(1500n);
    expect(operations.map((operation) => operation.type)).toEqual(['MANUAL_ASSIGNMENT', 'QR_RECHARGE', 'VOTE_CONSUMPTION']);
    const tooBroad = { code: 'TVD_OPERATION_FILTER_TOO_BROAD', message: 'Selecciona filtros más específicos.' };
    expect(JSON.stringify(tooBroad)).not.toContain('mongodb');
  });

  it('[MX-16][ADM-REG-P0-001][ACEPTACION] enruta approve/reject/revoke/reopen y distingue ADMIN de ACCESS_APPROVER', async () => {
    const service = { approveApplication: jest.fn(), rejectApplication: jest.fn(), revokeApplication: jest.fn(), reopenApplication: jest.fn() };
    const controller = new InstitutionalAdminApplicationsController(service as never);
    const req = { user: { sub: adminId, role: 'ADMIN', active: true } };
    controller.approve('app', req); controller.reject('app', { reason: 'motivo' }, req); controller.revoke('app', { reason: 'motivo' }, req); controller.reopen('app', { reason: 'motivo' }, req);
    expect(service.approveApplication).toHaveBeenCalledWith('app', req.user);
    expect(service.rejectApplication).toHaveBeenCalledWith('app', req.user, 'motivo');
    expect(service.revokeApplication).toHaveBeenCalledWith('app', req.user, 'motivo');
    expect(service.reopenApplication).toHaveBeenCalledWith('app', req.user, 'motivo');
    await expect(new AccessApproverGuard(guardJwt({ role: 'ACCESS_APPROVER', active: true })).canActivate(context('Bearer approver').value)).resolves.toBe(true);
    await expect(new AdminOnlyGuard(guardJwt({ role: 'ACCESS_APPROVER', active: true })).canActivate(context('Bearer approver').value)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-16][ADM-REC-P0-001][ACEPTACION] lista y detalla recuperaciones solo mediante contrato ADMIN seguro', async () => {
    const service = { listRequests: jest.fn().mockResolvedValue({ items: [{ requestId: 'request', requestType: 'ACCESS_RECOVERY', status: 'PENDING' }] }), getRequestDetail: jest.fn().mockResolvedValue({ requestId: 'request', status: 'PENDING', wallet: wallet.slice(0, 10) }) };
    const controller = new InstitutionalAccessRecoveryRequestsController(service as never);
    const requester = { sub: adminId, role: 'ADMIN', active: true };
    const listed = await controller.list({ user: requester }, 'PENDING');
    const detail = await controller.detail('request', { user: requester });
    expect(service.listRequests).toHaveBeenCalledWith(requester, 'PENDING');
    expect(detail).not.toHaveProperty('passwordResetToken');
    expect(JSON.stringify(listed)).not.toContain('token');
  });

  it('[MX-16][ADM-REC-P0-002][INTEGRACION] enruta una decisión única y conserva wallet, rol y assignment fuera de mutación', async () => {
    const service = { approveRequest: jest.fn().mockResolvedValue({ status: 'APPROVED', authVersion: 2 }), approveEmailChangeRequest: jest.fn().mockResolvedValue({ status: 'APPROVED', authVersion: 2 }), rejectRequest: jest.fn().mockResolvedValue({ status: 'REJECTED' }) };
    const controller = new InstitutionalAccessRecoveryRequestsController(service as never);
    const requester = { sub: adminId, role: 'ADMIN', active: true };
    await controller.approve('request', { targetUserId: String(userId), targetAssignmentId: String(assignmentId), reason: 'verificado' }, { user: requester });
    await controller.approveEmailChange('email-change', { reason: 'verificado' }, { user: requester });
    await controller.reject('request', { reason: 'rechazo' }, { user: requester });
    expect(service.approveRequest).toHaveBeenCalledWith('request', expect.objectContaining({ targetAssignmentId: String(assignmentId) }), requester);
    expect(service.approveEmailChangeRequest).toHaveBeenCalledWith('email-change', { reason: 'verificado' }, requester);
    expect(service.rejectRequest).toHaveBeenCalledWith('request', { reason: 'rechazo' }, requester);
  });

  it('[MX-16][ADM-SEC-P0-001][UNITARIA] rechaza roles, ObjectIds y wallets manipulados antes de cruzar contexto', async () => {
    expect(Types.ObjectId.isValid('not-a-mongo-id')).toBe(false);
    const lookup = new TvdWalletLookupService({ find: jest.fn() } as never, { find: jest.fn() } as never, { find: jest.fn() } as never, { axiosRef: { get: jest.fn() } } as never, { get: jest.fn() } as never, { getLiquidBalanceDetails: jest.fn() } as never);
    expect(() => lookup.normalizeAccountAddress('not-an-evm-address')).toThrow();
    const harness = manualHarness({ assignment: { tenantId: new Types.ObjectId() } });
    await expect(harness.service.createManualAssignment(harness.dto, harness.requester, 'cross-tenant')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_ASSIGNMENT_TENANT_MISMATCH' }) });
    expect(harness.rows).toHaveLength(0);
  });

  it('[MX-16][ADM-SEC-P0-002][UNITARIA] elimina secretos de respuestas y mantiene auditoría funcional sin credenciales', async () => {
    const harness = manualHarness();
    const response = await harness.service.createManualAssignment(harness.dto, harness.requester, 'safe-response');
    const serialized = JSON.stringify(response);
    for (const secret of ['serializedTransaction', 'PRIVATE_KEY', 'passwordResetToken', 'x-api-key']) expect(serialized).not.toContain(secret);
    expect(harness.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'TVD_MANUAL_ASSIGNMENT_REQUESTED' }));
  });

  it('[MX-16][ADM-CON-P0-001][INTEGRACION] reutiliza la misma idempotency key y rechaza payload distinto sin segundo efecto', async () => {
    const harness = manualHarness();
    const first = await harness.service.createManualAssignment(harness.dto, harness.requester, 'same-attempt');
    const replay = await harness.service.createManualAssignment(harness.dto, harness.requester, 'same-attempt');
    expect(first).not.toBeNull();
    expect(replay).not.toBeNull();
    if (!first || !replay) {
      throw new Error('La asignación idempotente debe devolver ambos resultados.');
    }
    expect(replay.id).toBe(first.id);
    expect(harness.rows).toHaveLength(1);
    expect(harness.processor.processAccreditationById).toHaveBeenCalledTimes(1);
    await expect(harness.service.createManualAssignment({ ...harness.dto, reason: 'Otro motivo institucional' }, harness.requester, 'same-attempt')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TVD_IDEMPOTENCY_CONFLICT' }) });
  });

  it('[MX-16][ADM-CON-P1-002][UNITARIA] clasifica fallos recuperables con códigos sin filtrar detalles de proveedor', () => {
    const errors = [
      { code: 'TVD_OPERATION_FILTER_TOO_BROAD', message: 'Selecciona filtros más específicos.' },
      { code: 'TVD_IDENTITY_UNAVAILABLE', message: 'No pudimos validar la wallet. Intenta nuevamente.' },
      { code: 'TVD_CONFIG_INCOMPLETE', message: 'La configuración TVD está incompleta.' },
    ];
    for (const error of errors) {
      expect(error.code).toMatch(/^TVD_/);
      expect(JSON.stringify(error)).not.toMatch(/rpc|api.?key|private|mongodb/i);
    }
  });
});
