import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { LoggerService } from '@/core/services/logger.service';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { PaymentsController } from '@/modules/payments/controllers/payments.controller';
import { RedEnlaceWebhookController } from '@/modules/payments/controllers/red-enlace-webhook.controller';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { RedEnlaceWebhookGuard } from '@/modules/payments/guards/red-enlace-webhook.guard';
import { QR_PAYMENT_PROVIDER } from '@/modules/payments/payments.constants';
import { MockRedEnlaceQrProvider } from '@/modules/payments/providers/mock-red-enlace-qr.provider';
import {
  createQrPaymentProvider,
  validateRedEnlaceConfiguration,
} from '@/modules/payments/providers/qr-payment-provider.factory';
import { RedEnlaceQrHttpProvider } from '@/modules/payments/providers/red-enlace-qr-http.provider';
import { PaymentProviderEvent } from '@/modules/payments/schemas/payment-provider-event.schema';
import { PaymentTransaction } from '@/modules/payments/schemas/payment-transaction.schema';
import { PaymentTenantAccessService } from '@/modules/payments/services/payment-tenant-access.service';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { RedEnlaceWebhookService } from '@/modules/payments/services/red-enlace-webhook.service';

function redEnlacePayload(numeroReferencia: number | string = 1511556): any {
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

function createService(options?: {
  eventModel?: Record<string, jest.Mock>;
  payments?: Record<string, jest.Mock>;
}) {
  const eventModel = {
    create: jest.fn().mockResolvedValue({
      _id: 'event-id',
      processingStatus: 'RECEIVED',
    }),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn() }),
    ...(options?.eventModel ?? {}),
  };
  const payments = {
    applyWebhookConfirmation: jest
      .fn()
      .mockResolvedValue({ _id: new Types.ObjectId() }),
    ...(options?.payments ?? {}),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.redEnlace.webhookAuthMode') return 'api-key';
      return undefined;
    }),
  } as unknown as ConfigService;
  const logger = {
    warn: jest.fn(),
    log: jest.fn(),
  };

  const service = new RedEnlaceWebhookService(
    eventModel as any,
    payments as any,
    configService,
    logger as any,
  );

  return { service, eventModel, payments, logger };
}

describe('PaymentsModule integration surface', () => {
  it('compiles the payments surface in mock mode without real Red Enlace credentials', async () => {
    const mockModel = {};
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController, RedEnlaceWebhookController],
      providers: [
        PaymentTenantAccessService,
        PaymentTransactionsService,
        RedEnlaceWebhookService,
        RedEnlaceWebhookGuard,
        MockRedEnlaceQrProvider,
        RedEnlaceQrHttpProvider,
        {
          provide: QR_PAYMENT_PROVIDER,
          inject: [
            ConfigService,
            MockRedEnlaceQrProvider,
            RedEnlaceQrHttpProvider,
          ],
          useFactory: createQrPaymentProvider,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                'app.redEnlace.mode': 'mock',
              };
              return values[key];
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
        { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
        { provide: HttpService, useValue: { axiosRef: {} } },
        {
          provide: getModelToken(PaymentTransaction.name),
          useValue: mockModel,
        },
        {
          provide: getModelToken(PaymentProviderEvent.name),
          useValue: mockModel,
        },
        {
          provide: getModelToken(InstitutionalTenant.name),
          useValue: mockModel,
        },
        {
          provide: getModelToken(TenantAdminAssignment.name),
          useValue: mockModel,
        },
        {
          provide: getModelToken(RoledUser.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    expect(moduleRef.get(PaymentTransactionsService)).toBeInstanceOf(
      PaymentTransactionsService,
    );
    await moduleRef.close();
  });
});

describe('RedEnlaceWebhookService', () => {
  it('processes the nested Red Enlace contract without storing bank client payload', async () => {
    const { service, eventModel, payments } = createService();

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });

    expect(payments.applyWebhookConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1000',
        currency: 'BOB',
        achReference: '14262508014140754846',
        paymentDate: expect.any(Date),
      }),
    );

    const persistedEvent = eventModel.create.mock.calls[0][0];
    expect(persistedEvent).toEqual(
      expect.objectContaining({
        providerReference: '1511556',
        providerStatus: '00',
        amountMinor: '1000',
        currency: 'BOB',
        achReference: '14262508014140754846',
      }),
    );
    expect(JSON.stringify(persistedEvent)).not.toContain('14240008');
    expect(JSON.stringify(persistedEvent)).not.toContain('1011000024');
    expect(JSON.stringify(persistedEvent)).not.toContain('BANCO ECONOMICO');
    expect(eventModel.updateOne).toHaveBeenLastCalledWith(
      { _id: 'event-id' },
      {
        $set: expect.objectContaining({
          processingStatus: 'PROCESSED',
          processingResult: 'PROCESSED',
          paymentId: expect.any(Types.ObjectId),
        }),
      },
    );
  });

  it('returns a controlled 05 response when the provider reference is unknown', async () => {
    const { service, eventModel, payments } = createService({
      payments: {
        applyWebhookConfirmation: jest
          .fn()
          .mockRejectedValue(
            new PaymentDomainError(
              'PAYMENT_NOT_FOUND',
              'Pago no encontrado',
              404,
            ),
          ),
      },
    });

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '05',
      detalleRespuesta: 'PAYMENT_NOT_FOUND',
    });

    expect(payments.applyWebhookConfirmation).toHaveBeenCalledTimes(1);
    expect(eventModel.updateOne).toHaveBeenCalledTimes(1);
    expect(eventModel.updateOne).toHaveBeenCalledWith(
      { _id: 'event-id' },
      { $set: { processingStatus: 'PROCESSING' }, $inc: { attemptCount: 1 } },
    );
    expect(eventModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: '1511556',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          processingStatus: 'FAILED',
          lastErrorCode: 'PAYMENT_NOT_FOUND',
        }),
      }),
      { sort: { receivedAt: -1 } },
    );
  });

  it('does not confirm when Red Enlace reports a different amount', async () => {
    const { service, eventModel, payments } = createService({
      payments: {
        applyWebhookConfirmation: jest
          .fn()
          .mockRejectedValue(
            new PaymentDomainError(
              'RED_ENLACE_AMOUNT_MISMATCH',
              'Monto de Red Enlace no coincide',
              409,
            ),
          ),
      },
    });

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '05',
      detalleRespuesta: 'AMOUNT_MISMATCH',
    });

    expect(payments.applyWebhookConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '1000',
        currency: 'BOB',
      }),
    );
    expect(eventModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('persists callback evidence before ACK 05 when amount format is invalid', async () => {
    const { service, eventModel, payments } = createService();
    const payload = redEnlacePayload();
    payload.transacciones.monto = '10.001';

    await expect(service.receiveWebhook(payload)).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '05',
      detalleRespuesta: 'RED_ENLACE_AMOUNT_INVALID',
    });

    expect(eventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: '1511556',
        providerStatus: '00',
        amountMinor: null,
        currency: 'BOB',
      }),
    );
    expect(eventModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: '1511556',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          processingStatus: 'FAILED',
          lastErrorCode: 'RED_ENLACE_AMOUNT_INVALID',
        }),
      }),
      { sort: { receivedAt: -1 } },
    );
    expect(payments.applyWebhookConfirmation).not.toHaveBeenCalled();
  });

  it('does not confirm when Red Enlace reports a different currency', async () => {
    const { service, eventModel, payments } = createService({
      payments: {
        applyWebhookConfirmation: jest
          .fn()
          .mockRejectedValue(
            new PaymentDomainError(
              'RED_ENLACE_CURRENCY_MISMATCH',
              'Moneda de Red Enlace no coincide',
              409,
            ),
          ),
      },
    });

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '05',
      detalleRespuesta: 'CURRENCY_MISMATCH',
    });

    expect(payments.applyWebhookConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '1000',
        currency: 'BOB',
      }),
    );
    expect(eventModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('detects a duplicate inbox event and does not apply payment processing again', async () => {
    const duplicateEvent = { _id: 'event-id', processingStatus: 'RECEIVED' };
    const { service, eventModel, payments } = createService({
      eventModel: {
        create: jest.fn().mockRejectedValue({ code: 11000 }),
        findOne: jest.fn().mockResolvedValue(duplicateEvent),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });

    expect(eventModel.findOne).toHaveBeenCalledWith({
      eventFingerprint: expect.any(String),
    });
    expect(payments.applyWebhookConfirmation).not.toHaveBeenCalled();
    expect(eventModel.updateOne).not.toHaveBeenCalled();
    expect(duplicateEvent.processingStatus).toBe('DUPLICATE');
  });

  it('treats a repeated ACH reference as a persisted duplicate event', async () => {
    const duplicateEvent = {
      _id: 'event-id',
      processingStatus: 'PROCESSED',
      lastErrorCode: null,
    };
    const { service, eventModel, payments } = createService({
      eventModel: {
        create: jest.fn().mockRejectedValue({ code: 11000 }),
        findOne: jest.fn((query) => {
          if (query.eventFingerprint) return Promise.resolve(null);
          if (query.achReference === '14262508014140754846') {
            return Promise.resolve(duplicateEvent);
          }
          return Promise.resolve(null);
        }),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await expect(service.receiveWebhook(redEnlacePayload())).resolves.toEqual({
      numeroReferencia: '1511556',
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });

    expect(eventModel.findOne).toHaveBeenCalledWith({
      provider: 'RED_ENLACE',
      achReference: '14262508014140754846',
    });
    expect(payments.applyWebhookConfirmation).not.toHaveBeenCalled();
    expect(eventModel.updateOne).not.toHaveBeenCalled();
    expect(duplicateEvent.processingStatus).toBe('DUPLICATE');
  });
});

describe('RedEnlaceQrHttpProvider', () => {
  it('generates QR with the PDF contract, official glosa and outgoing x-api-key only', async () => {
    const post = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        moneda: 'BOB',
        monto: '20.00',
        origenNumeroReferencia: '203414',
        numeroReferencia: '6780',
        codigoRespuesta: 'PENDING',
        detalleRespuesta: 'QR generado',
        imagen: 'UVI=',
      },
    });
    const provider = new RedEnlaceQrHttpProvider(
      { axiosRef: { post } } as any,
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string | number> = {
            'app.redEnlace.baseUrl': 'https://red-enlace.test',
            'app.redEnlace.apiKey': 'red-enlace-outgoing-test-key',
            'app.redEnlace.httpTimeoutMs': 5000,
            'app.redEnlace.qrTtl': '00:30:00',
          };
          return values[key];
        }),
      } as unknown as ConfigService,
    );

    await expect(
      provider.generateQr({
        merchantReference: '203414',
        amountMinor: '2000',
        currency: 'BOB',
        glosa: '461362|BLOCKCHAIN API QR |7372|PAGO 203414',
        description: 'no debe salir en glosa',
        expiresAt: new Date('2025-08-01T16:30:57.286Z'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        providerReference: '6780',
        originMerchantReference: '203414',
        amountMinor: '2000',
        currency: 'BOB',
        providerStatus: 'PENDING',
        responseCode: 'PENDING',
        qrImage: 'UVI=',
      }),
    );

    expect(post).toHaveBeenCalledWith(
      'https://red-enlace.test/cobranza-0.0.1/atc/generarQr',
      {
        numeroReferencia: 203414,
        glosa: '461362|BLOCKCHAIN API QR |7372|PAGO 203414',
        monto: '20.00',
        moneda: 'BOB',
        canal: 'WEB',
        tiempoQr: '00:30:00',
        campoExtra: '',
      },
      expect.objectContaining({
        timeout: 5000,
        headers: { 'x-api-key': 'red-enlace-outgoing-test-key' },
      }),
    );
  });

  it('verifies QR with the PDF URL and outgoing x-api-key', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        numeroReferenciaAtc: '6780',
        codigoRespuesta: 'SUCCESS',
        moneda: 'BOB',
        monto: 20,
      },
    });
    const provider = new RedEnlaceQrHttpProvider(
      { axiosRef: { get } } as any,
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string | number> = {
            'app.redEnlace.baseUrl': 'https://red-enlace.test/',
            'app.redEnlace.apiKey': 'red-enlace-outgoing-test-key',
            'app.redEnlace.httpTimeoutMs': 5000,
          };
          return values[key];
        }),
      } as unknown as ConfigService,
    );

    await provider.verifyQr({ providerReference: '6780' });

    expect(get).toHaveBeenCalledWith(
      'https://red-enlace.test/cobranza-0.0.1/atc/verificaQr/6780',
      expect.objectContaining({
        headers: { 'x-api-key': 'red-enlace-outgoing-test-key' },
      }),
    );
  });
});

describe('Red Enlace configuration validation', () => {
  function config(values: Record<string, string | undefined>) {
    return {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;
  }

  it('allows mock mode without real Red Enlace credentials', () => {
    expect(() =>
      validateRedEnlaceConfiguration(config({}), 'mock'),
    ).not.toThrow();
  });

  it('requires callback token in sandbox mode', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://appcobranzacert.redenlace.com.bo',
          'app.redEnlace.apiKey': 'red-enlace-outgoing-test-key',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'sandbox',
      ),
    ).toThrow('RED_ENLACE_CALLBACK_TOKEN');
  });

  it('does not accept callback token as substitute for outgoing API key in production', () => {
    expect(() =>
      validateRedEnlaceConfiguration(
        config({
          'app.redEnlace.baseUrl': 'https://red-enlace.prod',
          'app.redEnlace.callbackToken': 'callback-token',
          'app.redEnlace.qrTtl': '00:30:00',
        }),
        'production',
      ),
    ).toThrow('RED_ENLACE_API_KEY');
  });
});

describe('PaymentTransactionsService Red Enlace QR generation', () => {
  it('builds the official non-PII glosa before calling Red Enlace', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    const basePayment = {
      _id: paymentId,
      tenantId,
      requestedByUserId: userId,
      provider: 'RED_ENLACE',
      merchantReference: '203414',
      amountMinor: '2000',
      currency: 'BOB',
      status: 'CREATED',
    };
    const activePayment = {
      ...basePayment,
      status: 'QR_ACTIVE',
      providerReference: '6780',
      providerStatus: 'PENDING',
      providerResponseCode: 'PENDING',
      qrImage: 'base64-qr',
      qrExpiresAt: new Date('2025-08-01T16:30:57.286Z'),
    };
    const paymentModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
      create: jest.fn().mockResolvedValue(basePayment),
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce({ ...basePayment, status: 'QR_REQUESTING' })
        .mockResolvedValueOnce(activePayment),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const provider = {
      generateQr: jest.fn().mockResolvedValue({
        providerReference: '6780',
        originMerchantReference: '203414',
        amountMinor: '2000',
        currency: 'BOB',
        providerStatus: 'PENDING',
        responseCode: 'PENDING',
        qrImage: 'base64-qr',
      }),
    };
    const tenantAccess = {
      resolveTenantForWrite: jest.fn().mockResolvedValue({
        _id: tenantId,
        name: 'Tenant Con Datos Que No Deben Ir En Glosa',
      }),
      getRequesterObjectId: jest.fn().mockReturnValue(userId),
      resolvePaymentTargetForRequester: jest.fn().mockResolvedValue({
        targetAssignmentId: new Types.ObjectId(),
        targetWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        targetWalletNormalized: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    };
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'app.redEnlace.qrTtl': '00:30:00',
          'app.redEnlace.minAmountMinor': '1',
          'app.redEnlace.maxAmountMinor': '100000000',
        };
        return values[key];
      }),
    };
    const service = new PaymentTransactionsService(
      paymentModel as any,
      provider as any,
      tenantAccess as any,
      configService as unknown as ConfigService,
      { log: jest.fn(), warn: jest.fn() } as any,
    );

    await service.createQrPayment(
      {
        amount: '20.00',
        currency: 'BOB',
        description: 'Compra con CI 14240008',
      },
      { sub: String(userId), role: 'ADMIN' },
      'red-enlace-glosa-key',
    );

    expect(provider.generateQr).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantReference: '203414',
        amountMinor: '2000',
        currency: 'BOB',
        glosa: '461362|BLOCKCHAIN API QR |7372|PAGO 203414',
      }),
    );
    expect(provider.generateQr.mock.calls[0][0].glosa).not.toContain(
      '14240008',
    );
    expect(provider.generateQr.mock.calls[0][0].glosa).not.toContain('Tenant');
  });
});
