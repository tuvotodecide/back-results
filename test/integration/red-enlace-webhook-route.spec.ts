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
    estado: '00',
    transacciones: {
      monto: '10.00',
      moneda: 'BOB',
      fechaHoraTransaccion: '2025-08-01T16:00:57.286',
      cliente: {
        nombreCliente: 'JUAN PEREZ',
        ciCliente: '14240008',
        numeroCuenta: '1011000024',
      },
      numeroAch: '14262508014140754846',
      banco: {
        descripcion: 'BANCO ECONOMICO',
        sigla: 'BEC',
        codigoParticipante: '1016',
      },
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
                'app.redEnlace.apiKey': 'outgoing-red-enlace-api-key',
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

  it('POST /api/v1/qr/confirmed does not accept the outgoing Red Enlace API key as callback token', async () => {
    await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'outgoing-red-enlace-api-key')
      .send(redEnlacePayload())
      .expect(401);

    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed accepts the correct x-api-key callback token and nested Red Enlace contract', async () => {
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
        estado: '00',
        transacciones: expect.objectContaining({
          monto: '10.00',
          moneda: 'BOB',
          numeroAch: '14262508014140754846',
        }),
      }),
    );
  });

  it('POST /api/v1/qr/confirmed rejects an empty body without requiring codigoRespuesta', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({})
      .expect(400);

    const validationBody = JSON.stringify(response.body);
    expect(validationBody).toContain('numeroReferencia');
    expect(validationBody).toContain('estado');
    expect(validationBody).not.toContain('codigoRespuesta');
    expect(receiveWebhook).not.toHaveBeenCalled();
  });

  it('POST /api/v1/qr/confirmed rejects callback states outside 00, 03 and 05', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: 1511556,
        estado: '99',
      })
      .expect(400);

    const validationBody = JSON.stringify(response.body);
    expect(validationBody).toContain('estado');
    expect(validationBody).not.toContain('codigoRespuesta');
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

  it('POST /api/v1/qr/confirmed accepts estado 03 without full banking data', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: 1511556,
        estado: '03',
      })
      .expect(200);

    expect(response.body).toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });
    expect(receiveWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        numeroReferencia: '1511556',
        estado: '03',
      }),
    );
  });

  it('POST /api/v1/qr/confirmed accepts estado 05 without full banking data', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: '1511556',
        estado: '05',
        transacciones: {
          fechaHoraTransaccion: '2025-08-01T16:00:57.286',
        },
      })
      .expect(200);

    expect(response.body).toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });
    expect(receiveWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        numeroReferencia: '1511556',
        estado: '05',
        transacciones: expect.objectContaining({
          fechaHoraTransaccion: '2025-08-01T16:00:57.286',
        }),
      }),
    );
  });

  it('POST /api/v1/qr/confirmed requires monto and moneda for estado 00', async () => {
    const response = await request(app.getHttpServer())
      .post(CANONICAL_ROUTE)
      .set('x-api-key', 'valid-callback-token')
      .send({
        numeroReferencia: 1511556,
        estado: '00',
        transacciones: {
          numeroAch: '14262508014140754846',
        },
      })
      .expect(400);

    const validationBody = JSON.stringify(response.body);
    expect(validationBody).toContain('transacciones');
    expect(validationBody).toContain('monto');
    expect(validationBody).toContain('moneda');
    expect(validationBody).not.toContain('codigoRespuesta');
    expect(receiveWebhook).not.toHaveBeenCalled();
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
