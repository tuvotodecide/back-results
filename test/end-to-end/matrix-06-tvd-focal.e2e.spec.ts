import { ExecutionContext, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard', () => ({
  OfficialPublicationMobileZkAuthGuard: class OfficialPublicationMobileZkAuthGuard {
    canActivate() { return true; }
  },
}));

import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { OfficialPublicationMobileRateLimitGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard';
import { OfficialPublicationMobileZkAuthGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard';
import { OfficialPublicationAdminController } from '@/modules/institutional-voting/controllers/official-publication-admin.controller';
import { OfficialPublicationMobileController } from '@/modules/institutional-voting/controllers/official-publication-mobile.controller';
import { OfficialPublicationApiService } from '@/modules/institutional-voting/services/publication/official-publication-api.service';
import { PaymentsController } from '@/modules/payments/controllers/payments.controller';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { TvdManualAssignmentsController } from '@/modules/tvd/controllers/tvd-manual-assignments.controller';
import { TvdManualAssignmentsService } from '@/modules/tvd/services/tvd-manual-assignments.service';
import {
  assertMx06TestOnlyEnvironment,
  createMx06ExternalWriteBoundary,
  expectNoMx06ExternalWrites,
  prepareMx06TestOnlyEnvironment,
} from '../utils/mx06-test-only-guard';

const institutionWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const foreignWallet = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('MX-06 TVD focal E2E backend flows', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let assignments: Map<string, Record<string, unknown>>;
  let payments: Map<string, Record<string, unknown>>;
  let publications: Map<string, Record<string, unknown>>;
  let manualService: { createManualAssignment: jest.Mock; getManualAssignment: jest.Mock };
  let paymentService: { createQrPayment: jest.Mock; getPayment: jest.Mock; listPayments: jest.Mock; regenerateQrPayment: jest.Mock; reconcilePayment: jest.Mock };
  let publicationService: Record<string, jest.Mock>;
  let externalWrites = createMx06ExternalWriteBoundary();

  beforeEach(async () => {
    prepareMx06TestOnlyEnvironment();
    assertMx06TestOnlyEnvironment();
    externalWrites = createMx06ExternalWriteBoundary();
    assignments = new Map(); payments = new Map(); publications = new Map();
    manualService = {
      createManualAssignment: jest.fn(async (dto: { tenantId: string; assignmentId: string; tokenAmount: string }, actor: { role?: string }, key: string) => {
        if (actor.role !== 'ADMIN') throw new ForbiddenException('ADMIN requerido');
        if (dto.assignmentId === foreignWallet) throw new ForbiddenException('Wallet ajena');
        const stored = { id: key, tenantId: dto.tenantId, targetWallet: institutionWallet, tokenAmount: dto.tokenAmount, status: 'CONFIRMED' };
        assignments.set(key, stored); return stored;
      }),
      getManualAssignment: jest.fn(async (id: string) => assignments.get(id) ?? null),
    };
    paymentService = {
      createQrPayment: jest.fn(), getPayment: jest.fn(async (id: string) => payments.get(id) ?? null), listPayments: jest.fn(), regenerateQrPayment: jest.fn(),
      reconcilePayment: jest.fn(async (id: string) => {
        const current = payments.get(id);
        if (!current) return null;
        if (current.accreditationStatus === 'CONFIRMED') return current;
        const confirmed = { ...current, paymentStatus: 'PAYMENT_CONFIRMED', accreditationStatus: 'CONFIRMED', receipt: { status: 'success', event: 'TvdAssigned' }, balanceEffects: 1 };
        payments.set(id, confirmed); return confirmed;
      }),
    };
    publicationService = {
      createAdminRequest: jest.fn(async (eventId: string) => {
        const existing = publications.get(eventId);
        if (existing) return { created: false, request: existing };
        const prepared = { requestId: 'publication-1', eventId, status: 'PENDING_APPROVAL', signerWallet: institutionWallet, amount: '5', destination: 'VoteManager', receipt: null };
        publications.set(eventId, prepared); return { created: true, request: prepared };
      }),
      getActiveAdminRequest: jest.fn(), getAdminRequest: jest.fn(), cancelAdminRequest: jest.fn(),
      getMobileRequest: jest.fn(async () => ({ request: publications.get('event-1') })), claimMobileRequest: jest.fn(), markMobileSigning: jest.fn(), rejectMobileRequest: jest.fn(),
      registerMobileSubmission: jest.fn(async (_requestId: string, _actor: unknown, dto: { userOpHash: string; txHash?: string }) => {
        const prepared = publications.get('event-1');
        if (!prepared) return null;
        if (prepared.status === 'CONFIRMED') return { status: 'CONFIRMED', request: prepared };
        const confirmed = { ...prepared, status: 'CONFIRMED', userOpHash: dto.userOpHash, txHash: dto.txHash ?? null, receipt: { status: 'success', sender: institutionWallet, destination: 'VoteManager', amount: '5', event: 'VoteCreated' }, finalizations: 1 };
        publications.set('event-1', confirmed); return { status: 'CONFIRMED', request: confirmed };
      }),
    };
    const moduleBuilder = Test.createTestingModule({
      controllers: [TvdManualAssignmentsController, PaymentsController, OfficialPublicationAdminController, OfficialPublicationMobileController],
      providers: [
        { provide: TvdManualAssignmentsService, useValue: manualService },
        { provide: PaymentTransactionsService, useValue: paymentService },
        { provide: OfficialPublicationApiService, useValue: publicationService },
      ],
    });
    moduleRef = await moduleBuilder
      .overrideGuard(AdminOnlyGuard).useValue({ canActivate: jest.fn((context: ExecutionContext) => { const req = context.switchToHttp().getRequest(); if (req.headers.authorization !== 'Bearer admin') throw new ForbiddenException(); req.user = { sub: 'admin-1', role: 'ADMIN' }; return true; }) })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: jest.fn((context: ExecutionContext) => { const req = context.switchToHttp().getRequest(); if (req.headers.authorization !== 'Bearer admin') throw new ForbiddenException(); req.user = { sub: 'admin-1', role: 'ADMIN' }; return true; }) })
      .overrideGuard(OfficialPublicationMobileRateLimitGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OfficialPublicationMobileZkAuthGuard).useValue({ canActivate: jest.fn((context: ExecutionContext) => { context.switchToHttp().getRequest().user = { sub: 'signer-1' }; return true; }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => { await app?.close(); await moduleRef?.close(); });
  afterEach(() => expectNoMx06ExternalWrites(externalWrites));

  it('[MX-06][TVD-ASSIGN-P0-001][E2E] recorre HTTP, guard ADMIN, controlador y persistencia aislada sin aceptar wallet ajena', async () => {
    const valid = await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer admin').set('Idempotency-Key', 'assignment-1').send({ tenantId: 'tenant-1', assignmentId: 'assignment-1', tokenAmount: '25', reason: 'Asignación MX-06' }).expect(201);
    expect(valid.body).toMatchObject({ id: 'assignment-1', targetWallet: institutionWallet, status: 'CONFIRMED' }); expect(assignments.get('assignment-1')).toMatchObject({ tenantId: 'tenant-1', tokenAmount: '25' });
    await request(app.getHttpServer()).post('/api/v1/tvd/manual-assignments').set('Authorization', 'Bearer admin').set('Idempotency-Key', 'assignment-foreign').send({ tenantId: 'tenant-1', assignmentId: foreignWallet, tokenAmount: '25', reason: 'Asignación MX-06' }).expect(403);
    expect(assignments.has('assignment-foreign')).toBe(false);
  });

  it('[MX-06][TVD-RES-P0-002][E2E] confirma una acreditación PENDING una sola vez con receipt simulado y dos reconciliaciones', async () => {
    payments.set('payment-1', { id: 'payment-1', paymentStatus: 'PAYMENT_CONFIRMED', accreditationStatus: 'PENDING', targetWallet: institutionWallet, balanceEffects: 0 });
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/payments/payment-1/reconcile').set('Authorization', 'Bearer admin').send({ mockStatus: 'SUCCESS' }),
      request(app.getHttpServer()).post('/api/v1/payments/payment-1/reconcile').set('Authorization', 'Bearer admin').send({ mockStatus: 'SUCCESS' }),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]); const stored = payments.get('payment-1'); expect(stored).toMatchObject({ accreditationStatus: 'CONFIRMED', balanceEffects: 1, receipt: { status: 'success', event: 'TvdAssigned' } }); expect(paymentService.reconcilePayment).toHaveBeenCalledTimes(2);
  });

  it('[MX-06][TVD-PUB-P0-011][E2E] prepara, registra submission, reconcilia receipt compatible y finaliza de forma idempotente', async () => {
    const prepared = await request(app.getHttpServer()).post('/api/v1/voting/events/event-1/official-publication/requests').set('Authorization', 'Bearer admin').expect(201);
    expect(prepared.body).toMatchObject({ created: true, request: { status: 'PENDING_APPROVAL', amount: '5', destination: 'VoteManager' } });
    const body = { deviceId: 'device-1', userOpHash: `0x${'1'.repeat(64)}`, txHash: `0x${'2'.repeat(64)}` };
    const submitted = await request(app.getHttpServer()).post('/api/v1/mobile/official-publication/requests/publication-1/submission').set('x-api-key', 'mobile').send(body).expect(200);
    const repeated = await request(app.getHttpServer()).post('/api/v1/mobile/official-publication/requests/publication-1/submission').set('x-api-key', 'mobile').send(body).expect(200);
    expect(submitted.body.status).toBe('CONFIRMED'); expect(repeated.body.status).toBe('CONFIRMED'); expect(publications.get('event-1')).toMatchObject({ status: 'CONFIRMED', finalizations: 1, receipt: { status: 'success', sender: institutionWallet, destination: 'VoteManager', amount: '5', event: 'VoteCreated' } }); expect(publicationService.registerMobileSubmission).toHaveBeenCalledTimes(2);
  });
});
