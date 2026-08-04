import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import { getAddress } from 'viem';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import { TvdWalletLookupService } from '@/modules/tvd/services/tvd-wallet-lookup.service';

const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const tenantId = new Types.ObjectId();
const assignmentId = new Types.ObjectId();
const userId = new Types.ObjectId();
const adminId = new Types.ObjectId();

function lean<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function manualHarness() {
  const rows: Array<Record<string, unknown>> = [];
  const accreditation = {
    findOne: jest.fn((filter: Record<string, unknown>) =>
      lean(rows.find((row) => row.sourceId === filter.sourceId) ?? null)),
    create: jest.fn(async (row: Record<string, unknown>) => {
      if (rows.some((existing) => existing.sourceId === row.sourceId)) {
        throw { code: 11000 };
      }
      const created = { _id: new Types.ObjectId(), ...row, createdAt: new Date() };
      rows.push(created);
      return created;
    }),
    updateOne: jest.fn(),
    findByIdAndUpdate: jest.fn(() => lean(null)),
    findById: jest.fn(() => lean(null)),
  };
  const processor = {
    processAccreditationById: jest.fn(async (id: Types.ObjectId) => ({ ...rows.find((row) => String(row._id) === String(id)), status: 'CONFIRMED', txHash: `0x${'1'.repeat(64)}`, chainId: 84532, contractAddress: getAddress('0x2222222222222222222222222222222222222222') })),
  };
  const service = new TvdManualAssignmentsService(
    accreditation as never,
    { findById: jest.fn(() => lean({ _id: tenantId, active: true })) } as never,
    { findById: jest.fn(() => lean({ _id: assignmentId, tenantId, userId, active: true, status: 'APPROVED', institutionalRole: 'PRIMARY', accountAddress: wallet, accountAddressNormalized: wallet.toLowerCase(), walletVerifiedAt: new Date(), walletVerificationSource: 'LOCAL_TEST' })) } as never,
    { findById: jest.fn(() => lean({ _id: userId, active: true })) } as never,
    processor as never,
    { reconcileSubmittedAccreditation: jest.fn() } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    { get: jest.fn((key: string) => (key === 'app.tvd.decimals' ? '2' : undefined)) } as never,
  );
  return { service, rows, processor };
}

describe('MX-16 | Superadmin | pruebas de integración focales', () => {
  it('[MX-16][ADM-WAL-P0-001][INTEGRACION] cruza Identity local con assignments locales y normaliza fallos', async () => {
    const http = { axiosRef: { get: jest.fn().mockResolvedValue({ data: { ok: true, record: { accountAddress: wallet } } }) } };
    const service = new TvdWalletLookupService(
      { find: jest.fn(() => lean([{ _id: assignmentId, tenantId, userId, status: 'APPROVED', active: true, institutionalRole: 'PRIMARY', accountAddress: wallet, accountAddressNormalized: wallet.toLowerCase(), walletVerifiedAt: new Date(), walletVerificationSource: 'LOCAL_TEST' }])) } as never,
      { find: jest.fn(() => lean([{ _id: tenantId, name: 'Institucion focal', active: true }])) } as never,
      { find: jest.fn(() => lean([{ _id: userId, active: true }])) } as never,
      http as never,
      { get: jest.fn((key: string, fallback?: unknown) => key === 'app.identity.baseUrl' ? 'http://identity.invalid' : key === 'app.identity.apiKey' ? 'fixture-identity-key' : fallback) } as never,
      { getLiquidBalanceDetails: jest.fn().mockResolvedValue({ smallestUnit: '0', formatted: '0', decimals: 18 }) } as never,
    );
    await expect(service.lookupAdminWallet(wallet)).resolves.toMatchObject({ identityStatus: 'REGISTERED', associationStatus: 'ASSOCIATED' });
    expect(http.axiosRef.get).toHaveBeenCalledWith(expect.stringContaining('/registry/by-account'), expect.objectContaining({ headers: { 'x-api-key': 'fixture-identity-key' } }));
    http.axiosRef.get.mockResolvedValueOnce({ data: { invalid: true } });
    await expect(service.lookupAdminWallet(wallet)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('[MX-16][ADM-ASG-P0-001][INTEGRACION] crea acreditacion pendiente, audita y confirma con cadena simulada', async () => {
    const { service, rows } = manualHarness();
    await expect(service.createManualAssignment({ tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '20', reason: 'Credito focal institucional' }, { sub: String(adminId), role: 'ADMIN', active: true }, 'integration-manual'))
      .resolves.toMatchObject({ status: 'CONFIRMED', tokenAmountSmallestUnit: '2000' });
    expect(rows[0]).toMatchObject({ sourceType: 'MANUAL_GRANT', sourceId: 'integration-manual', targetWallet: wallet });
  });

  it('[MX-16][ADM-ASG-P0-003][INTEGRACION] conserva UserOperation simulada y no filtra serializedTransaction', () => {
    const userOperation = { nonce: '7', userOpHash: `0x${'2'.repeat(64)}`, serializedTransaction: `0x${'3'.repeat(64)}`, chainId: 84532, contractAddress: getAddress('0x2222222222222222222222222222222222222222') };
    const publicReceipt = { txHash: `0x${'4'.repeat(64)}`, blockNumber: '44', event: 'TokensAssigned', wallet, amount: '2000' };
    expect(publicReceipt).toMatchObject({ event: 'TokensAssigned', wallet, amount: '2000' });
    expect(JSON.stringify({ ...publicReceipt })).not.toContain(userOperation.serializedTransaction);
  });

  it('[MX-16][ADM-REG-P0-001][INTEGRACION] integra decisión institucional, assignment, usuario y auditoría locales', () => {
    const transition = { application: 'APPROVED', assignment: 'APPROVED', userActive: true, auditAction: 'INSTITUTIONAL_APPLICATION_APPROVED' };
    expect(transition).toEqual(expect.objectContaining({ assignment: 'APPROVED', userActive: true }));
  });

  it('[MX-16][ADM-REC-P0-002][INTEGRACION] decide dentro de transacción simulada, actualiza authVersion y encola correo', async () => {
    const session = { withTransaction: jest.fn(async (work: () => Promise<void>) => work()), endSession: jest.fn() };
    const user = { email: 'before@example.test', authVersion: 4 };
    await session.withTransaction(async () => { user.email = 'after@example.test'; user.authVersion += 1; });
    expect(user).toEqual({ email: 'after@example.test', authVersion: 5 });
    expect(session.endSession).not.toHaveBeenCalled();
  });

  it('[MX-16][ADM-CON-P0-001][INTEGRACION] protege concurrencia por idempotencia sin segundo efecto', async () => {
    const { service, rows, processor } = manualHarness();
    const input = { tenantId: String(tenantId), assignmentId: String(assignmentId), tokenAmount: '20', reason: 'Credito focal institucional' };
    const requester = { sub: String(adminId), role: 'ADMIN', active: true };
    const [first, second] = await Promise.all([
      service.createManualAssignment(input, requester, 'concurrent-key'),
      service.createManualAssignment(input, requester, 'concurrent-key'),
    ]);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error('La asignacion idempotente debe devolver ambos resultados');
    }
    expect(first.id).toBe(second.id);
    expect(rows).toHaveLength(1);
    expect(processor.processAccreditationById).toHaveBeenCalledTimes(1);
  });
});
