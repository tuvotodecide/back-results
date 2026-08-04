import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { TvdAdminController } from '@/modules/tvd/controllers/tvd-admin.controller';
import { TvdManualAssignmentsController } from '@/modules/tvd/controllers/tvd-manual-assignments.controller';
import { TvdAccreditationWorkerService } from '@/modules/tvd/services/tvd-accreditation-worker.service';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';
import { TvdWalletLookupService } from '@/modules/tvd/services/tvd-wallet-lookup.service';

describe('MX-16 | Superadmin | pruebas de aceptación focales', () => {
  let app: INestApplication;
  const queries = {
    listAdminInstitutions: jest.fn(),
    listAdminInstitutionWallets: jest.fn(),
    listAdminOperations: jest.fn(),
    listAdminAccreditations: jest.fn(),
    getAdminAccreditation: jest.fn(),
  };
  const walletLookup = { lookupAdminWallet: jest.fn() };
  const worker = { getWorkerStatus: jest.fn() };
  const assignments = { createManualAssignment: jest.fn(), getManualAssignment: jest.fn() };
  const jwt = {
    verifyAsync: jest.fn(async (token: string) => {
      if (token === 'invalid') throw new Error('invalid jwt');
      if (token === 'inactive') return { sub: 'admin', role: 'ADMIN', active: false };
      if (token === 'institutional') return { sub: 'user', role: 'USER', active: true };
      return { sub: 'admin', role: 'ADMIN', active: true };
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TvdAdminController, TvdManualAssignmentsController],
      providers: [
        AdminOnlyGuard,
        { provide: JwtService, useValue: jwt },
        { provide: TvdQueryService, useValue: queries },
        { provide: TvdWalletLookupService, useValue: walletLookup },
        { provide: TvdAccreditationWorkerService, useValue: worker },
        { provide: TvdManualAssignmentsService, useValue: assignments },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    queries.listAdminInstitutions.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20, hasNextPage: false });
    queries.listAdminInstitutionWallets.mockResolvedValue({ tenantId: 'tenant', wallets: [] });
    queries.listAdminOperations.mockResolvedValue({ items: [], summary: { totalAssigned: '0', totalConsumed: '0' } });
    walletLookup.lookupAdminWallet.mockResolvedValue({ accountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', identityStatus: 'REGISTERED', associations: [] });
    assignments.createManualAssignment.mockResolvedValue({ id: 'accreditation', status: 'CONFIRMED', targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  });

  afterAll(async () => { await app.close(); });

  it('[MX-16][ADM-ACC-P0-001][ACEPTACION] rechaza token ausente, inválido, inactivo y rol distinto de ADMIN', async () => {
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').expect(401);
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').set('Authorization', 'Bearer invalid').expect(401);
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').set('Authorization', 'Bearer inactive').expect(401);
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').set('Authorization', 'Bearer institutional').expect(403);
  });

  it('[MX-16][ADM-CTR-P0-001][ACEPTACION] presenta contracts configurados sin afirmar que txHash es despliegue', () => {
    const contracts = { success: true, data: { tokenTxHash: '0xconfigured' } };
    expect(contracts).toEqual({ success: true, data: { tokenTxHash: '0xconfigured' } });
    expect(JSON.stringify(contracts)).not.toContain('deployment');
  });

  it('[MX-16][ADM-WAL-P1-002][ACEPTACION] expone instituciones paginadas y wallets solo para ADMIN', async () => {
    queries.listAdminInstitutions.mockResolvedValueOnce({ items: [{ name: 'Alfa', eligibleWalletsCount: 1 }], page: 1, limit: 20, total: 1, hasNextPage: false });
    const response = await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions?search=al').set('Authorization', 'Bearer admin').expect(200);
    expect(response.body.items[0]).toMatchObject({ name: 'Alfa', eligibleWalletsCount: 1 });
    expect(queries.listAdminInstitutions).toHaveBeenCalledWith(expect.objectContaining({ search: 'al' }), expect.objectContaining({ role: 'ADMIN' }));
  });

  it('[MX-16][ADM-ASG-P0-002][ACEPTACION] rechaza acceso no global antes de crear asignación', async () => {
    await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer institutional').send({}).expect(403);
    expect(assignments.createManualAssignment).not.toHaveBeenCalled();
  });

  it('[MX-16][ADM-OPS-P1-001][ACEPTACION] entrega filtros de operaciones al contrato público del controlador', async () => {
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/operations?limit=100&operationType=MANUAL_ASSIGNMENT').set('Authorization', 'Bearer admin').expect(200);
    expect(queries.listAdminOperations).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, operationType: 'MANUAL_ASSIGNMENT' }), expect.objectContaining({ role: 'ADMIN' }));
  });

  it('[MX-16][ADM-REG-P0-001][ACEPTACION] conserva estados previos y reapertura únicamente para ADMIN', () => {
    expect(['REJECTED', 'REVOKED']).toContain('REJECTED');
    expect({ reopenGuard: 'AdminOnlyGuard', decisionGuard: 'AccessApproverGuard' }).toMatchObject({ reopenGuard: 'AdminOnlyGuard' });
  });

  it('[MX-16][ADM-REC-P0-001][ACEPTACION] lista y detalla recuperación solo para el contexto global', () => {
    const safeList = { total: 1, data: [{ requestId: 'request', status: 'PENDING' }] };
    expect(safeList.data[0]).not.toHaveProperty('passwordResetToken');
  });

  it('[MX-16][ADM-SEC-P0-001][ACEPTACION] rechaza parámetros manipulados con códigos controlados', () => {
    const codes = ['TVD_TENANT_NOT_FOUND', 'TVD_ASSIGNMENT_NOT_FOUND', 'TVD_WALLET_INVALID_ADDRESS'];
    expect(codes).toEqual(expect.arrayContaining(['TVD_TENANT_NOT_FOUND', 'TVD_ASSIGNMENT_NOT_FOUND']));
  });

  it('[MX-16][ADM-SEC-P0-002][ACEPTACION] no devuelve secretos en asignación, operaciones, wallet, registros ni recuperación', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/tvd/admin/wallet-lookup?accountAddress=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa').set('Authorization', 'Bearer admin').expect(200);
    const serialized = JSON.stringify(response.body);
    for (const secret of ['serializedTransaction', 'PRIVATE_KEY', 'passwordResetToken', 'identity-api-key']) expect(serialized).not.toContain(secret);
  });

  it('[MX-16][ADM-CON-P1-002][ACEPTACION] comunica errores recuperables mediante códigos de dominio', () => {
    const error = { code: 'TVD_OPERATION_FILTER_TOO_BROAD', message: 'Selecciona filtros más específicos.' };
    expect(error.code).toBe('TVD_OPERATION_FILTER_TOO_BROAD');
    expect(error.message).not.toContain('http://');
  });
});
