import { ConflictException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { LoggerService } from '@/core/services/logger.service';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { PAYMENT_PROVIDER_RED_ENLACE } from '@/modules/payments/payments.constants';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';

const tenantId = new Types.ObjectId();
const userId = new Types.ObjectId();
const paymentId = new Types.ObjectId();

const basePayment = (override: Record<string, any> = {}) => ({
  _id: paymentId,
  tenantId,
  requestedByUserId: userId,
  provider: PAYMENT_PROVIDER_RED_ENLACE,
  merchantReference: '203414',
  amountMinor: '1050',
  currency: 'BOB',
  status: 'CREATED',
  createdAt: new Date('2026-07-13T10:00:00.000Z'),
  updatedAt: new Date('2026-07-13T10:00:00.000Z'),
  ...override,
});

const idempotencyHash = (value: Record<string, string>) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function createService(options?: {
  paymentModel?: Record<string, jest.Mock>;
  provider?: Record<string, jest.Mock>;
  tenantAccess?: Record<string, jest.Mock>;
  config?: Record<string, string | number | undefined>;
}) {
  const paymentModel = {
    create: jest.fn().mockResolvedValue(basePayment()),
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    findOneAndUpdate: jest
      .fn()
      .mockResolvedValueOnce(basePayment({ status: 'QR_REQUESTING' }))
      .mockResolvedValueOnce(
        basePayment({
          status: 'QR_ACTIVE',
          providerReference: '6780',
          providerStatus: 'PENDING',
          providerResponseCode: 'PENDING',
          qrImage: 'base64-qr',
          qrExpiresAt: new Date('2026-07-13T10:30:00.000Z'),
        }),
      ),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    findById: jest.fn().mockResolvedValue(basePayment({ status: 'QR_ACTIVE' })),
    ...(options?.paymentModel ?? {}),
  };
  const provider = {
    generateQr: jest.fn().mockResolvedValue({
      providerReference: '6780',
      originMerchantReference: '203414',
      amountMinor: '1050',
      currency: 'BOB',
      providerStatus: 'PENDING',
      responseCode: 'PENDING',
      responseDetail: 'QR generado',
      qrImage: 'base64-qr',
    }),
    verifyQr: jest.fn(),
    ...(options?.provider ?? {}),
  };
  const tenantAccess = {
    resolveTenantForWrite: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    getRequesterObjectId: jest.fn().mockReturnValue(userId),
    assertTenantAccess: jest.fn().mockResolvedValue(undefined),
    resolveTenantIdsForRead: jest.fn().mockResolvedValue([tenantId]),
    ...(options?.tenantAccess ?? {}),
  };
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number | undefined> = {
        'app.redEnlace.qrTtl': '00:30:00',
        'app.redEnlace.minAmountMinor': '1',
        'app.redEnlace.maxAmountMinor': '100000000',
        ...(options?.config ?? {}),
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new PaymentTransactionsService(
    paymentModel as any,
    provider as any,
    tenantAccess as any,
    configService,
    logger as unknown as LoggerService,
  );

  return { service, paymentModel, provider, tenantAccess, logger };
}

describe('PaymentTransactionsService QR payments', () => {
  it('creates a QR payment with tenant isolation, unique reference and public contract', async () => {
    const { service, paymentModel, provider, tenantAccess } = createService();

    const result = await service.createQrPayment(
      { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
      { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
    );

    expect(tenantAccess.resolveTenantForWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: String(tenantId) }),
      undefined,
    );
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        requestedByUserId: userId,
        amountMinor: '1050',
        currency: 'BOB',
        provider: PAYMENT_PROVIDER_RED_ENLACE,
        merchantReference: expect.any(String),
        status: 'CREATED',
      }),
    );
    expect(provider.generateQr).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '1050',
        currency: 'BOB',
        glosa: '461362|BLOCKCHAIN API QR|7372|PAGO 203414',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: String(paymentId),
        tenantId: String(tenantId),
        requestedByUserId: String(userId),
        amount: '10.50',
        amountMinor: '1050',
        currency: 'BOB',
        status: 'QR_ACTIVE',
        provider: PAYMENT_PROVIDER_RED_ENLACE,
        providerReference: '6780',
        qrImage: 'base64-qr',
      }),
    );
    expect(result).not.toHaveProperty('providerResponseDetail');
  });

  it('returns the original payment for the same idempotency key and same payload', async () => {
    const existing = basePayment({
      status: 'QR_ACTIVE',
      idempotencyKey: 'same-key',
      idempotencyRequestHash: idempotencyHash({
        tenantId: String(tenantId),
        userId: String(userId),
        amountMinor: '1050',
        currency: 'BOB',
        description: 'Recarga operativa',
      }),
      providerReference: '6780',
      qrImage: 'base64-qr',
      qrExpiresAt: new Date('2026-07-13T10:30:00.000Z'),
    });
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(existing),
        }),
      },
    });

    const result = await service.createQrPayment(
      { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
      { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
      'same-key',
    );

    expect(result.status).toBe('QR_ACTIVE');
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with a different payload', async () => {
    const existing = basePayment({
      status: 'QR_ACTIVE',
      idempotencyKey: 'same-key',
      idempotencyRequestHash: 'different-hash',
    });
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(existing),
        }),
      },
    });

    await expect(
      service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
        'same-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('marks the payment as failed when Red Enlace returns an incomplete QR response', async () => {
    const { service, paymentModel } = createService({
      provider: {
        generateQr: jest.fn().mockResolvedValue({
          providerReference: '6780',
          originMerchantReference: '203414',
          amountMinor: '1050',
          currency: 'BOB',
          providerStatus: 'PENDING',
        }),
      },
    });

    await expect(
      service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: paymentId, status: 'QR_REQUESTING' },
      {
        $set: {
          status: 'FAILED',
          providerResponseDetail: 'Respuesta invalida de Red Enlace',
        },
      },
    );
  });

  it('applies a successful webhook once and keeps repeated confirmations idempotent', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '1511556',
    });
    const confirmedPayment = basePayment({
      status: 'PAYMENT_CONFIRMED',
      providerReference: '1511556',
      providerStatus: '00',
      providerResponseCode: '00',
      achReference: '14262508014140754846',
      paymentDate: new Date('2026-07-13T11:00:00.000Z'),
      confirmedAt: new Date('2026-07-13T11:00:00.000Z'),
      confirmationSource: 'WEBHOOK',
    });
    const { service, paymentModel } = createService({
      paymentModel: {
        findOne: jest
          .fn()
          .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(activePayment) })
          .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(confirmedPayment) }),
        findOneAndUpdate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(confirmedPayment),
        }),
      },
    });

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1050',
        currency: 'BOB',
        achReference: '14262508014140754846',
        paymentDate: new Date('2026-07-13T11:00:00.000Z'),
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }));

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1050',
        currency: 'BOB',
      }),
    ).resolves.toEqual(expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }));

    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports PAYMENT_NOT_FOUND for unknown webhook provider references', async () => {
    const { service } = createService({
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      },
    });

    await expect(
      service.applyWebhookConfirmation({
        providerReference: 'missing-reference',
        providerStatus: '00',
        responseCode: '00',
      }),
    ).rejects.toMatchObject(
      {
        code: 'PAYMENT_NOT_FOUND',
        httpStatus: 404,
      } satisfies Partial<PaymentDomainError>,
    );
  });
});
