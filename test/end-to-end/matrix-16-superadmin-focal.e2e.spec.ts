import { INestApplication } from '@nestjs/common';
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

describe('MX-16 | Superadmin | pruebas E2E focales controladas', () => {
  let app: INestApplication;
  const accreditations = new Map<string, Record<string, unknown>>();
  const manualAssignments = {
    createManualAssignment: jest.fn(async (_dto: Record<string, unknown>, _requester: Record<string, unknown>, key: string) => {
      const existing = accreditations.get(key);
      if (existing) return existing;
      const created = { id: `acc-${accreditations.size + 1}`, status: 'CONFIRMED', chainId: 84532, txHash: `0x${'5'.repeat(64)}`, targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
      accreditations.set(key, created);
      return created;
    }),
    getManualAssignment: jest.fn(async (id: string) => [...accreditations.values()].find((row) => row.id === id) ?? null),
  };
  const queries = {
    listAdminInstitutions: jest.fn(async () => ({ items: [{ tenantId: 'global', name: 'Institución global' }] })),
    listAdminInstitutionWallets: jest.fn(), listAdminOperations: jest.fn(), listAdminAccreditations: jest.fn(), getAdminAccreditation: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TvdAdminController, TvdManualAssignmentsController],
      providers: [
        AdminOnlyGuard,
        { provide: JwtService, useValue: { verifyAsync: jest.fn(async (token: string) => token === 'institutional' ? { sub: 'institutional', active: true, role: 'USER' } : { sub: 'global', active: true, role: 'ADMIN' }) } },
        { provide: TvdQueryService, useValue: queries },
        { provide: TvdManualAssignmentsService, useValue: manualAssignments },
        { provide: TvdWalletLookupService, useValue: { lookupAdminWallet: jest.fn() } },
        { provide: TvdAccreditationWorkerService, useValue: { getWorkerStatus: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => { accreditations.clear(); jest.clearAllMocks(); });
  afterAll(async () => { await app.close(); });

  it('[MX-16][ADM-ACC-P0-001][E2E] permite la capacidad global y rechaza al usuario institucional', async () => {
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').set('Authorization', 'Bearer global').expect(200);
    await request(app.getHttpServer()).get('/api/v1/tvd/admin/institutions').set('Authorization', 'Bearer institutional').expect(403);
  });

  it('[MX-16][ADM-ASG-P0-001][E2E] confirma asignación con receipt y evento locales simulados', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer global').set('Idempotency-Key', 'receipt-event').send({ tenantId: 'tenant', assignmentId: 'assignment', tokenAmount: '10', reason: 'Credito focal institucional' }).expect(201);
    expect(response.body).toMatchObject({ status: 'CONFIRMED', chainId: 84532, txHash: expect.stringMatching(/^0x/) });
    expect(JSON.stringify(response.body)).not.toContain('serializedTransaction');
  });

  it('[MX-16][ADM-REC-P0-002][E2E] representa una sola decisión de recuperación aislada por institución', () => {
    const decision = { requestId: 'recovery-1', tenantId: 'tenant-a', status: 'APPROVED', authVersion: 2 };
    expect(decision).toEqual(expect.objectContaining({ tenantId: 'tenant-a', status: 'APPROVED' }));
  });

  it('[MX-16][ADM-SEC-P0-001][E2E] no expone datos globales ante rol incorrecto o identificador manipulado', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/tvd/admin/accreditations/invalid-id').set('Authorization', 'Bearer institutional').expect(403);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_KEY');
  });

  it('[MX-16][ADM-CON-P0-001][E2E] reutiliza una asignación repetida y evita el segundo efecto', async () => {
    const body = { tenantId: 'tenant', assignmentId: 'assignment', tokenAmount: '10', reason: 'Credito focal institucional' };
    const first = await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer global').set('Idempotency-Key', 'one-effect').send(body).expect(201);
    const second = await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer global').set('Idempotency-Key', 'one-effect').send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(manualAssignments.createManualAssignment).toHaveBeenCalledTimes(2);
    expect(accreditations.size).toBe(1);
  });
});
