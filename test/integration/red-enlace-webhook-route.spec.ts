import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RedEnlaceWebhookController } from '@/modules/payments/controllers/red-enlace-webhook.controller';
import { RedEnlaceWebhookGuard } from '@/modules/payments/guards/red-enlace-webhook.guard';
import { RedEnlaceWebhookService } from '@/modules/payments/services/red-enlace-webhook.service';

const CANONICAL_ROUTE = '/api/v1/qr/confirmed';
const LEGACY_ROUTE = '/api/v1/integrations/red-enlace/pay-in/webhook';

function redEnlacePayload(numeroReferencia: number | string = 1511556) {
  return {
    numeroReferencia,
    codigoRespuesta: 'SUCCESS',
    detalleRespuesta: 'Pago procesado exitosamente',
    monto: '10.00',
    moneda: 'BOB',
    fechaHoraTransaccion: '2025-08-01T16:00:57',
    clienteOrigen: {
      ciCliente: '14240008',
      nombreCliente: 'JUAN PEREZ',
      numeroCuenta: '1011000024',
    },
    bancoOrigen: {
      codigoBanco: '1016',
      nombreBanco: 'BANCO ECONOMICO',
      numeroOrdenAch: '14262508014140754846',
    },
  };
}

describe('Red Enlace webhook routes', () => {
  let app: INestApplication;
  const receiveWebhook = jest.fn();

  beforeEach(async () => {
    receiveWebhook.mockImplementation((dto) => Promise.resolve({
      numeroReferencia: String(dto.numeroReferencia),
      codigoRespuesta: '00',
      detalleRespuesta: null,
    }));

    const moduleRef = await Test.createTestingModule({
      controllers: [RedEnlaceWebhookController],
      providers: [
        RedEnlaceWebhookGuard,
        {
          provide: RedEnlaceWebhookService,
          useValue: { receiveWebhook },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                'app.redEnlace.mode': 'mock',
                'app.redEnlace.clientSecret': 'outgoing-red-enlace-client-secret',
                'app.redEnlace.callbackToken': 'valid-callback-token',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  it('POST /api/v1/qr/confirmed exists and rejects an invalid callback token', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'wrong-callback-token')
      .send(redEnlacePayload())
      .expect(401);

    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed rejects a missing callback token', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .send(redEnlacePayload())
      .expect(401);

    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed does not accept the outgoing Red Enlace client secret as callback token', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'outgoing-red-enlace-client-secret')
      .send(redEnlacePayload())
      .expect(401);

    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed accepts the correct x-api-key callback token and QR Simple v2 contract', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send(redEnlacePayload())
      .expect(200);

    expect(response.body).toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });
    expect(receiveWebhook).toHaveBeenCalledTimes(1);
    expect(receiveWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        numeroReferencia: '1511556',
        codigoRespuesta: 'SUCCESS',
        monto: '10.00',
        moneda: 'BOB',
        bancoOrigen: expect.objectContaining({
          numeroOrdenAch: '14262508014140754846',
        }),
      }),
    );
  });

  it('POST /api/v1/qr/confirmed rejects an empty body', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({})
      .expect(400);

    const validationBody = JSON.stringify(response.body);
    expect(validationBody).toContain('numeroReferencia');
    expect(validationBody).toContain('codigoRespuesta');
    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed rejects the v1 callback contract', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: 1511556,
        estado: '00',
        transacciones: { monto: '10.00', moneda: 'BOB' },
      })
      .expect(400);

    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed rejects provider references outside 1 to 9 digits', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send(redEnlacePayload('1000000000'))
      .expect(400);

    const validationBody = JSON.stringify(response.body);
    expect(validationBody).toContain('numeroReferencia');
    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it.each(['SUCCESS', 'PAGADO'])(
    'POST /api/v1/qr/confirmed requires monto and moneda when codigoRespuesta is %s',
    async (codigoRespuesta) => {
      const response = await request(app.getHttpServer())
        .post(CANONICAL_ROUTE)
        .set('x-api-key', 'valid-callback-token')
        .send({
          numeroReferencia: 1511556,
          codigoRespuesta,
          bancoOrigen: { numeroOrdenAch: '14262508014140754846' },
        })
        .expect(400);

      const validationBody = JSON.stringify(response.body);
      expect(validationBody).toContain('monto');
      expect(validationBody).toContain('moneda');
      expect(receiveWebhook).not.toHaveBeenCalled();
    },
  );

  it('POST /api/v1/qr/confirmed accepts a non paid status without banking data', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: '1511556',
        codigoRespuesta: 'EXPIRADO',
      })
      .expect(200);

    expect(receiveWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        numeroReferencia: '1511556',
        codigoRespuesta: 'EXPIRADO',
      }),
    );
  });

  it('keeps the previous webhook route as a single-call deprecated alias', async () => {
    await request(app.getHttpServer())
      .post(LEGACY_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send(redEnlacePayload('1511556'))
      .expect(200);

    expect(receiveWebhook).toHaveBeenCalledTimes(1);
  });

  it('does not expose a double-prefixed /api/v1/api/v1 route', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/api/v1/qr/confirmed')
      .set('x-api-key', 'valid-callback-token')
      .send(redEnlacePayload())
      .expect(404);
  });
});
