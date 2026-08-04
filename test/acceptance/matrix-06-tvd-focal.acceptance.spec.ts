import { BadRequestException, ExecutionContext, ForbiddenException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard', () => ({
  OfficialPublicationMobileZkAuthGuard: class OfficialPublicationMobileZkAuthGuard {
    canActivate() { return true; }
  },
}));

import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { PaymentsController } from '@/modules/payments/controllers/payments.controller';
import { RedEnlaceWebhookController } from '@/modules/payments/controllers/red-enlace-webhook.controller';
import { RedEnlaceWebhookGuard } from '@/modules/payments/guards/red-enlace-webhook.guard';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { RedEnlaceWebhookService } from '@/modules/payments/services/red-enlace-webhook.service';
import { OfficialPublicationAdminController } from '@/modules/institutional-voting/controllers/official-publication-admin.controller';
import { OfficialPublicationMobileController } from '@/modules/institutional-voting/controllers/official-publication-mobile.controller';
import { OfficialPublicationMobileRateLimitGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-rate-limit.guard';
import { OfficialPublicationMobileZkAuthGuard } from '@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard';
import { OfficialPublicationApiService } from '@/modules/institutional-voting/services/publication/official-publication-api.service';
import {
  assertMx06TestOnlyEnvironment,
  createMx06ExternalWriteBoundary,
  expectNoMx06ExternalWrites,
  prepareMx06TestOnlyEnvironment,
} from '../utils/mx06-test-only-guard';

describe('MX-06 TVD focal acceptance contracts', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let payments: Record<string, jest.Mock>;
  let webhook: { receiveWebhook: jest.Mock };
  let publication: Record<string, jest.Mock>;
  let jwtGuard: { canActivate: jest.Mock };
  let adminOnlyGuard: { canActivate: jest.Mock };
  let externalWrites = createMx06ExternalWriteBoundary();

  beforeEach(async () => {
    prepareMx06TestOnlyEnvironment();
    assertMx06TestOnlyEnvironment();
    externalWrites = createMx06ExternalWriteBoundary();
    payments = {
      createQrPayment: jest.fn(), getPayment: jest.fn(), listPayments: jest.fn(),
      regenerateQrPayment: jest.fn(), reconcilePayment: jest.fn(),
    };
    webhook = { receiveWebhook: jest.fn() };
    publication = {
      createAdminRequest: jest.fn(), getActiveAdminRequest: jest.fn(), getAdminRequest: jest.fn(),
      cancelAdminRequest: jest.fn(), getMobileRequest: jest.fn(), claimMobileRequest: jest.fn(),
      markMobileSigning: jest.fn(), rejectMobileRequest: jest.fn(), registerMobileSubmission: jest.fn(),
    };
    jwtGuard = { canActivate: jest.fn().mockImplementation((context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      if (!req.headers.authorization) throw new ForbiddenException('No autorizado');
      req.user = { sub: 'user-1', role: 'ADMIN' };
      return true;
    }) };
    adminOnlyGuard = { canActivate: jest.fn().mockReturnValue(true) };
    const builder = Test.createTestingModule({
      controllers: [PaymentsController, RedEnlaceWebhookController, OfficialPublicationAdminController, OfficialPublicationMobileController],
      providers: [
        { provide: PaymentTransactionsService, useValue: payments },
        { provide: RedEnlaceWebhookService, useValue: webhook },
        { provide: OfficialPublicationApiService, useValue: publication },
      ],
    });
    moduleRef = await builder
      .overrideGuard(JwtAuthGuard).useValue(jwtGuard)
      .overrideGuard(AdminOnlyGuard).useValue(adminOnlyGuard)
      .overrideGuard(RedEnlaceWebhookGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OfficialPublicationMobileRateLimitGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(OfficialPublicationMobileZkAuthGuard).useValue({ canActivate: jest.fn((context: ExecutionContext) => {
        context.switchToHttp().getRequest().user = { sub: 'signer-1' };
        return true;
      }) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => { if (app) await app.close(); if (moduleRef) await moduleRef.close(); });

  afterEach(() => expectNoMx06ExternalWrites(externalWrites));

  it('[MX-06][TVD-QR-P0-002][ACEPTACION] devuelve QR, referencia, monto y expiración', async () => {
    payments.createQrPayment.mockResolvedValue({ id: 'pay-1', providerReference: 'ATC-1', amount: '10.50', qrImage: 'base64', qrExpiresAt: '2026-08-04T12:00:00.000Z' });
    const response = await request(app.getHttpServer()).post('/api/v1/payments/qr').set('Idempotency-Key', 'key-1').send({ amount: '10.50', currency: 'BOB', description: 'recarga' }).expect(201);
    expect(response.body).toMatchObject({ providerReference: 'ATC-1', amount: '10.50', qrExpiresAt: '2026-08-04T12:00:00.000Z' });
    expect(response.body).toHaveProperty('qrImage', 'base64');
  });

  it('[MX-06][TVD-QR-P1-005][ACEPTACION] mantiene una transacción pendiente visible', async () => {
    payments.getPayment.mockResolvedValue({ id: 'pay-1', providerReference: 'ATC-1', amount: '10.50', status: 'QR_PENDING' });
    const response = await request(app.getHttpServer()).get('/api/v1/payments/pay-1').expect(200);
    expect(response.body).toMatchObject({ providerReference: 'ATC-1', amount: '10.50', status: 'QR_PENDING' });
  });

  it('[MX-06][TVD-QR-P0-006][ACEPTACION] acepta callback válido con respuesta segura', async () => {
    webhook.receiveWebhook.mockResolvedValue({ numeroReferencia: 'ATC-1', codigoRespuesta: '00', detalleRespuesta: null });
    const response = await request(app.getHttpServer()).post('/api/v1/qr/confirmed').send({ numeroReferencia: 'ATC-1', estado: '00', transacciones: { monto: 10.5, moneda: 'BOB' } }).expect(200);
    expect(response.body).toEqual({ numeroReferencia: 'ATC-1', codigoRespuesta: '00', detalleRespuesta: null });
    expect(JSON.stringify(response.body)).not.toContain('apiKey');
  });

  it('[MX-06][TVD-PUB-P0-002][ACEPTACION] rechaza publicación sin padrón confirmado', async () => {
    publication.createAdminRequest.mockRejectedValue(new BadRequestException({ code: 'PADRON_NOT_CONFIRMED', message: 'Padrón confirmado requerido' }));
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/event-1/official-publication/requests').set('Authorization', 'Bearer test').expect(400);
    expect(response.body.message).toBe('Padrón confirmado requerido');
  });

  it('[MX-06][TVD-PUB-P0-003][ACEPTACION] rechaza publicación sin saldo suficiente', async () => {
    publication.createAdminRequest.mockRejectedValue(new BadRequestException({ code: 'TVD_CREDITS_BALANCE_INSUFFICIENT', message: 'Saldo TVD insuficiente' }));
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/event-1/official-publication/requests').set('Authorization', 'Bearer test').expect(400);
    expect(response.body.message).toBe('Saldo TVD insuficiente');
  });

  it('[MX-06][TVD-PUB-P0-008][ACEPTACION] entrega resumen móvil activo sin secreto de firma', async () => {
    publication.getMobileRequest.mockResolvedValue({ id: 'request-1', status: 'PENDING_APPROVAL', expiresAt: '2026-08-04T12:00:00.000Z', callDataHash: '0xhash' });
    const response = await request(app.getHttpServer()).get('/api/v1/mobile/official-publication/requests/request-1').set('x-api-key', 'test').expect(200);
    expect(response.body).toMatchObject({ id: 'request-1', status: 'PENDING_APPROVAL', callDataHash: '0xhash' });
    expect(JSON.stringify(response.body)).not.toContain('privateKey');
  });

  it('[MX-06][TVD-SEC-P0-001][ACEPTACION] rechaza endpoint administrativo sin autorización', async () => {
    adminOnlyGuard.canActivate.mockImplementationOnce(() => {
      throw new ForbiddenException();
    });
    await request(app.getHttpServer()).post('/api/v1/payments/pay-1/reconcile').send({}).expect(403);
    expect(payments.reconcilePayment).not.toHaveBeenCalled();
  });

  it('[MX-06][TVD-SEC-P0-002][ACEPTACION] no expone secretos en una respuesta de pago', async () => {
    payments.getPayment.mockResolvedValue({ id: 'pay-1', status: 'QR_PENDING', providerReference: 'ATC-1' });
    const response = await request(app.getHttpServer()).get('/api/v1/payments/pay-1').expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/api.?key|authorization|private.?key|bankPayload/i);
  });

  it('[MX-06][TVD-UI-P1-001][ACEPTACION] expone estados diferenciados de pago, acreditación y publicación', async () => {
    payments.getPayment.mockResolvedValue({ id: 'pay-1', status: 'PAYMENT_CONFIRMED', tokenAccreditation: { status: 'PENDING' }, publication: { status: 'PENDING_APPROVAL' } });
    const response = await request(app.getHttpServer()).get('/api/v1/payments/pay-1').expect(200);
    expect(response.body).toMatchObject({ status: 'PAYMENT_CONFIRMED', tokenAccreditation: { status: 'PENDING' }, publication: { status: 'PENDING_APPROVAL' } });
  });

  it('[MX-06][TVD-UI-P1-003][ACEPTACION] devuelve saldo y capacidad actualizados sin confundir pago con acreditación', async () => {
    payments.listPayments.mockResolvedValue({ data: [{ id: 'pay-1', status: 'PAYMENT_CONFIRMED', tokenAccreditation: { status: 'PENDING' } }], capacity: { availableTokens: '5', requiredTokens: '10', canPublish: false } });
    const response = await request(app.getHttpServer()).get('/api/v1/payments').expect(200);
    expect(response.body.capacity).toEqual({ availableTokens: '5', requiredTokens: '10', canPublish: false });
    expect(response.body.data[0].tokenAccreditation.status).toBe('PENDING');
  });
});
