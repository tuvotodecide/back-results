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
const assignmentId = new Types.ObjectId();
const targetWallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const regeneratedPaymentId = new Types.ObjectId();

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
  tvdQuotes?: Record<string, jest.Mock>;
  tvdQrAccreditations?: Record<string, jest.Mock>;
}) {
  const paymentModel = {
    create: jest.fn().mockResolvedValue(basePayment()),
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
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
    resolveTenantForWrite: jest
      .fn()
      .mockResolvedValue({ _id: tenantId, active: true }),
    getRequesterObjectId: jest.fn().mockReturnValue(userId),
    assertTenantAccess: jest.fn().mockResolvedValue(undefined),
    resolveTenantIdsForRead: jest.fn().mockResolvedValue([tenantId]),
    resolvePaymentTargetForRequester: jest.fn().mockResolvedValue({
      targetAssignmentId: assignmentId,
      targetWallet,
      targetWalletNormalized: targetWallet.toLowerCase(),
    }),
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
  const tvdQuotes = options?.tvdQuotes;
  const tvdQrAccreditations = options?.tvdQrAccreditations;

  const service = new PaymentTransactionsService(
    paymentModel as any,
    provider as any,
    tenantAccess as any,
    configService,
    logger as unknown as LoggerService,
    tvdQuotes as any,
    tvdQrAccreditations as any,
  );

  return {
    service,
    paymentModel,
    provider,
    tenantAccess,
    logger,
    tvdQrAccreditations,
  };
}

describe('PaymentTransactionsService QR payments', () => {
  it('TVD-QR-P0-001 TVD-QR-P0-002 TVD-QR-P0-003 | creates a QR payment with tenant isolation, unique reference and public contract', async () => {
    const { service, paymentModel, provider, tenantAccess } = createService();

    const result = await service.createQrPayment(
      { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
      { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
      'qr-key-create',
    );

    expect(tenantAccess.resolveTenantForWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: String(tenantId) }),
      undefined,
    );
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        requestedByUserId: userId,
        targetAssignmentId: assignmentId,
        targetWallet,
        targetWalletNormalized: targetWallet.toLowerCase(),
        amountMinor: '1050',
        currency: 'BOB',
        provider: PAYMENT_PROVIDER_RED_ENLACE,
        merchantReference: expect.any(String),
        status: 'CREATED',
      }),
    );
    expect(tenantAccess.resolvePaymentTargetForRequester).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ tenantId: String(tenantId) }),
    );
    expect(provider.generateQr).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: '1050',
        currency: 'BOB',
        glosa: '461362|BLOCKCHAIN API QR |7372|PAGO 203414',
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

  it('TVD-QR-P0-008 | sets local QR expiration from the same Red Enlace TTL configuration', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
    const { service, provider } = createService({
      config: {
        'app.redEnlace.qrTtl': '24:00:00',
      },
    });

    try {
      await service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
        'qr-key-expiration',
      );
    } finally {
      jest.useRealTimers();
    }

    expect(provider.generateQr).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date('2026-07-15T12:00:00.000Z'),
      }),
    );
  });

  it('TVD-QR-P0-004 TVD-QR-P0-010 | TVD-QR-POS-U-001/002 | POSITIVO | UNITARIO | creacion QR congela assignment wallet y tvdQuote', async () => {
    const tvdQuote = {
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.10',
      exchangeRateVersion: 3,
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
      quotedAt: new Date('2026-07-17T10:00:00.000Z'),
    };
    const { service, paymentModel } = createService({
      tvdQuotes: {
        createPaymentQuoteSnapshot: jest.fn().mockResolvedValue(tvdQuote),
      },
    });

    await service.createQrPayment(
      { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
      { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
      'qr-key-quote',
    );

    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAssignmentId: assignmentId,
        targetWallet,
        targetWalletNormalized: targetWallet.toLowerCase(),
        tvdQuote: expect.objectContaining(tvdQuote),
      }),
    );
  });

  it('TVD-QR-P0-003 | returns the original payment for the same idempotency key and same payload', async () => {
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
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
        'same-key',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('TVD-QR-P0-009 | marks the payment as unresolved when Red Enlace returns an incomplete QR response', async () => {
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
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
        'qr-key-incomplete',
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: paymentId, status: 'QR_REQUESTING' },
      {
        $set: {
          status: 'PROVIDER_STATUS_UNRESOLVED',
          providerResponseCode: 'RED_ENLACE_INVALID_RESPONSE',
          providerResponseDetail: 'PROVIDER_RESPONSE_INVALID',
        },
      },
    );
  });

  it('TVD-QR-P0-003 | rejects QR creation without Idempotency-Key before calling Red Enlace', async () => {
    const { service, paymentModel, provider } = createService();

    await expect(
      service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_IDEMPOTENCY_KEY_REQUIRED',
      }),
    });

    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('rejects an overlong Idempotency-Key without silent truncation', async () => {
    const { service, paymentModel, provider } = createService();

    await expect(
      service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
        'x'.repeat(121),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_IDEMPOTENCY_KEY_INVALID',
      }),
    });

    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('TVD-QR-P0-003 TVD-QR-P0-010 | rechecks payload hash when concurrent creation hits the idempotency unique index', async () => {
    const existing = basePayment({
      status: 'CREATED',
      idempotencyKey: 'race-key',
      idempotencyRequestHash: 'different-hash',
    });
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        create: jest.fn().mockRejectedValue({
          code: 11000,
          keyPattern: { idempotencyKey: 1 },
        }),
        findOne: jest
          .fn()
          .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
          .mockResolvedValueOnce(existing),
      },
    });

    await expect(
      service.createQrPayment(
        { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
        {
          sub: String(userId),
          role: 'TENANT_ADMIN',
          tenantId: String(tenantId),
        },
        'race-key',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      }),
    });

    expect(provider.generateQr).not.toHaveBeenCalled();
    expect(paymentModel.findOne).toHaveBeenLastCalledWith({
      tenantId,
      requestedByUserId: userId,
      idempotencyKey: 'race-key',
    });
  });

  it('TVD-QR-P0-006 TVD-QR-P0-010 | applies a successful webhook once and keeps repeated confirmations idempotent', async () => {
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
          .mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(activePayment),
          })
          .mockReturnValueOnce({
            exec: jest.fn().mockResolvedValue(confirmedPayment),
          }),
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
    ).resolves.toEqual(
      expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
    );

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1050',
        currency: 'BOB',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
    );

    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('TVD-QR-P0-006 TVD-RES-P0-001 | TVD-QR-POS-U-010/011 | POSITIVO | UNITARIO | webhook confirmado crea acreditacion sin blockchain y mantiene contrato Red Enlace', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '1511556',
    });
    const confirmedPayment = basePayment({
      status: 'PAYMENT_CONFIRMED',
      providerReference: '1511556',
      providerStatus: '00',
      providerResponseCode: '00',
      confirmationSource: 'WEBHOOK',
    });
    const tvdQrAccreditations = {
      createOrReuseForConfirmedPayment: jest.fn().mockResolvedValue({
        accreditationId: new Types.ObjectId(),
        status: 'PENDING',
        tokenAmount: '5',
        reused: false,
      }),
    };
    const { service, paymentModel } = createService({
      tvdQrAccreditations,
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activePayment),
        }),
        findOneAndUpdate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(confirmedPayment),
        }),
        findById: jest.fn().mockResolvedValue(confirmedPayment),
      },
    });

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1050',
        currency: 'BOB',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
    );

    expect(
      tvdQrAccreditations.createOrReuseForConfirmedPayment,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
      { source: 'WEBHOOK' },
    );
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      { _id: paymentId },
      expect.objectContaining({
        $set: expect.objectContaining({ tokenAccreditationStatus: 'PENDING' }),
      }),
    );
  });

  it.each([
    'EXPIRED',
    'FAILED',
    'CANCELLED',
    'MISMATCH',
    'PROVIDER_STATUS_UNRESOLVED',
    'PROVIDER_ERROR',
  ])(
    'TVD-QR-P0-007 | moves a late approved webhook over %s to reconciliation pending',
    async (terminalStatus) => {
      const terminalPayment = basePayment({
        status: terminalStatus,
        providerReference: '1511556',
      });
      const reconciliationPendingPayment = basePayment({
        status: 'RECONCILIATION_PENDING',
        providerReference: '1511556',
        providerStatus: '00',
        providerResponseCode: '00',
        achReference: '14262508014140754846',
        paymentDate: new Date('2026-07-13T11:00:00.000Z'),
      });
      const { service, paymentModel } = createService({
        paymentModel: {
          findOne: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(terminalPayment),
          }),
          findOneAndUpdate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(reconciliationPendingPayment),
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
      ).resolves.toEqual(
        expect.objectContaining({ status: 'RECONCILIATION_PENDING' }),
      );

      expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: paymentId,
          status: {
            $in: [
              'EXPIRED',
              'FAILED',
              'CANCELLED',
              'MISMATCH',
              'PROVIDER_STATUS_UNRESOLVED',
              'PROVIDER_ERROR',
            ],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'RECONCILIATION_PENDING',
            providerStatus: '00',
            achReference: '14262508014140754846',
          }),
        }),
        { new: true },
      );
    },
  );

  it.each([
    ['03', 'EXPIRED'],
    ['05', 'PROVIDER_ERROR'],
  ])(
    'TVD-QR-P0-008 TVD-QR-P0-009 | maps webhook estado %s over an active QR to %s',
    async (estado, expectedStatus) => {
      const activePayment = basePayment({
        status: 'QR_ACTIVE',
        providerReference: '1511556',
      });
      const updatedPayment = basePayment({
        status: expectedStatus,
        providerReference: '1511556',
        providerStatus: estado,
        providerResponseCode: estado,
      });
      const { service, paymentModel } = createService({
        paymentModel: {
          findOne: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(activePayment),
          }),
          findOneAndUpdate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(updatedPayment),
          }),
        },
      });

      await expect(
        service.applyWebhookConfirmation({
          providerReference: '1511556',
          providerStatus: estado,
          responseCode: estado,
        }),
      ).resolves.toEqual(expect.objectContaining({ status: expectedStatus }));

      expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: paymentId,
          status: {
            $in: [
              'QR_ACTIVE',
              'MISMATCH',
              'PROVIDER_STATUS_UNRESOLVED',
              'PROVIDER_ERROR',
              'RECONCILIATION_PENDING',
            ],
          },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: expectedStatus,
            providerStatus: estado,
          }),
        }),
        { new: true },
      );
    },
  );

  it.each(['03', '05'])(
    'TVD-QR-P0-010 | does not degrade an already confirmed payment when webhook estado %s arrives late',
    async (estado) => {
      const confirmedPayment = basePayment({
        status: 'PAYMENT_CONFIRMED',
        providerReference: '1511556',
        providerStatus: '00',
        providerResponseCode: '00',
      });
      const { service, paymentModel } = createService({
        paymentModel: {
          findOne: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(confirmedPayment),
          }),
          findOneAndUpdate: jest.fn(),
          updateOne: jest.fn(),
        },
      });

      await expect(
        service.applyWebhookConfirmation({
          providerReference: '1511556',
          providerStatus: estado,
          responseCode: estado,
          amountMinor: '1050',
          currency: 'BOB',
        }),
      ).resolves.toEqual(
        expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
      );

      expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(paymentModel.updateOne).not.toHaveBeenCalled();
    },
  );

  it('does not confirm an approved webhook when amount differs', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '1511556',
    });
    const { service, paymentModel } = createService({
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activePayment),
        }),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '9999',
        currency: 'BOB',
      }),
    ).rejects.toMatchObject({ code: 'RED_ENLACE_AMOUNT_MISMATCH' });

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      {
        _id: paymentId,
        status: {
          $in: [
            'QR_ACTIVE',
            'PROVIDER_STATUS_UNRESOLVED',
            'PROVIDER_ERROR',
            'RECONCILIATION_PENDING',
          ],
        },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'MISMATCH',
          providerStatus: '00',
        }),
      }),
    );
  });

  it('does not confirm an approved webhook when currency differs', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '1511556',
    });
    const { service } = createService({
      paymentModel: {
        findOne: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(activePayment),
        }),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await expect(
      service.applyWebhookConfirmation({
        providerReference: '1511556',
        providerStatus: '00',
        responseCode: '00',
        amountMinor: '1050',
        currency: 'USD',
      }),
    ).rejects.toMatchObject({ code: 'RED_ENLACE_CURRENCY_MISMATCH' });
  });

  it('TVD-QR-P0-009 | reports PAYMENT_NOT_FOUND for unknown webhook provider references', async () => {
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
    ).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
      httpStatus: 404,
    } satisfies Partial<PaymentDomainError>);
  });

  it('does not confirm a SUCCESS reconciliation when amount differs', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '6780',
    });
    const { service, paymentModel } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(activePayment),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
      provider: {
        verifyQr: jest.fn().mockResolvedValue({
          providerReference: '6780',
          providerStatus: 'SUCCESS',
          responseCode: 'SUCCESS',
          amountMinor: '9999',
          currency: 'BOB',
        }),
      },
    });

    await expect(
      service.reconcilePayment(String(paymentId), { role: 'ADMIN' }, {}),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_AMOUNT_MISMATCH',
    } satisfies Partial<PaymentDomainError>);
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      {
        _id: paymentId,
        status: {
          $in: [
            'QR_ACTIVE',
            'PROVIDER_STATUS_UNRESOLVED',
            'PROVIDER_ERROR',
            'RECONCILIATION_PENDING',
          ],
        },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'MISMATCH',
          providerStatus: 'SUCCESS',
        }),
      }),
    );
  });

  it('does not confirm a SUCCESS reconciliation when currency differs', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '6780',
    });
    const { service } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(activePayment),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
      provider: {
        verifyQr: jest.fn().mockResolvedValue({
          providerReference: '6780',
          providerStatus: 'SUCCESS',
          responseCode: 'SUCCESS',
          amountMinor: '1050',
          currency: 'USD',
        }),
      },
    });

    await expect(
      service.reconcilePayment(String(paymentId), { role: 'ADMIN' }, {}),
    ).rejects.toMatchObject({
      code: 'RED_ENLACE_CURRENCY_MISMATCH',
    } satisfies Partial<PaymentDomainError>);
  });

  it('moves an unknown reconciliation status to provider status unresolved', async () => {
    const activePayment = basePayment({
      status: 'QR_ACTIVE',
      providerReference: '6780',
    });
    const unresolvedPayment = basePayment({
      status: 'PROVIDER_STATUS_UNRESOLVED',
      providerReference: '6780',
      providerStatus: 'UNEXPECTED',
      providerResponseCode: 'UNEXPECTED',
    });
    const { service, paymentModel } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(activePayment),
        findOneAndUpdate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(unresolvedPayment),
        }),
      },
      provider: {
        verifyQr: jest.fn().mockResolvedValue({
          providerReference: '6780',
          providerStatus: 'UNEXPECTED',
          responseCode: 'UNEXPECTED',
          amountMinor: '1050',
          currency: 'BOB',
        }),
      },
    });

    await expect(
      service.reconcilePayment(String(paymentId), { role: 'ADMIN' }, {}),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'PROVIDER_STATUS_UNRESOLVED' }),
    );
    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: paymentId,
        status: {
          $in: [
            'QR_ACTIVE',
            'MISMATCH',
            'PROVIDER_STATUS_UNRESOLVED',
            'PROVIDER_ERROR',
            'RECONCILIATION_PENDING',
          ],
        },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'PROVIDER_STATUS_UNRESOLVED',
          providerStatus: 'UNEXPECTED',
        }),
      }),
      { new: true },
    );
  });

  it('TVD-QR-P1-005 | regenerates an expired QR with a still valid frozen quote and new references', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T10:10:00.000Z'));
    const oldQuote = {
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.10',
      exchangeRateVersion: 3,
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
      quotedAt: new Date('2026-07-13T10:00:00.000Z'),
      expiresAt: new Date('2026-07-13T10:20:00.000Z'),
    };
    const expiredPayment = basePayment({
      status: 'EXPIRED',
      providerReference: '1511556',
      targetAssignmentId: assignmentId,
      targetWallet,
      targetWalletNormalized: targetWallet.toLowerCase(),
      tvdQuote: oldQuote,
      qrExpiresAt: new Date('2026-07-13T10:05:00.000Z'),
    });
    const createdRegeneration = basePayment({
      _id: regeneratedPaymentId,
      status: 'CREATED',
      merchantReference: '303303',
      amountMinor: '1050',
      previousPaymentId: paymentId,
      tvdQuote: oldQuote,
    });
    const activeRegeneration = basePayment({
      ...createdRegeneration,
      status: 'QR_ACTIVE',
      providerReference: '909909',
      providerStatus: 'PENDING',
      qrImage: 'base64-qr',
      qrExpiresAt: new Date('2026-07-13T10:40:00.000Z'),
    });
    const tvdQuotes = {
      createPaymentQuoteSnapshot: jest.fn(),
    };
    const { service, paymentModel, provider } = createService({
      tvdQuotes,
      paymentModel: {
        findById: jest.fn().mockResolvedValue(expiredPayment),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
        create: jest.fn().mockResolvedValue(createdRegeneration),
        findOneAndUpdate: jest
          .fn()
          .mockResolvedValueOnce(expiredPayment)
          .mockResolvedValueOnce({
            ...createdRegeneration,
            status: 'QR_REQUESTING',
          })
          .mockResolvedValueOnce(activeRegeneration),
      },
      provider: {
        generateQr: jest.fn().mockResolvedValue({
          providerReference: '909909',
          originMerchantReference: '303303',
          amountMinor: '1050',
          currency: 'BOB',
          providerStatus: 'PENDING',
          responseCode: 'PENDING',
          qrImage: 'base64-qr',
        }),
      },
    });

    try {
      const result = await service.regenerateQrPayment(
        String(paymentId),
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
        'regen-key-1',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: String(regeneratedPaymentId),
          status: 'QR_ACTIVE',
          merchantReference: '303303',
          providerReference: '909909',
          previousPaymentId: String(paymentId),
        }),
      );
    } finally {
      jest.useRealTimers();
    }

    expect(tvdQuotes.createPaymentQuoteSnapshot).not.toHaveBeenCalled();
    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previousPaymentId: paymentId,
        tvdQuote: oldQuote,
        targetWallet,
      }),
    );
    expect(provider.generateQr).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantReference: '303303',
        amountMinor: '1050',
      }),
    );
  });

  it('creates a fresh quote when the expired QR quote is no longer valid', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-13T10:30:00.000Z'));
    const oldQuote = {
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.10',
      exchangeRateVersion: 3,
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
      quotedAt: new Date('2026-07-13T10:00:00.000Z'),
      expiresAt: new Date('2026-07-13T10:15:00.000Z'),
    };
    const newQuote = {
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.50',
      exchangeRateVersion: 4,
      tokenAmount: '4.2',
      tokenAmountSmallestUnit: '420',
      quotedAt: new Date('2026-07-13T10:30:00.000Z'),
    };
    const expiredPayment = basePayment({
      status: 'EXPIRED',
      targetAssignmentId: assignmentId,
      targetWallet,
      targetWalletNormalized: targetWallet.toLowerCase(),
      tvdQuote: oldQuote,
    });
    const createdRegeneration = basePayment({
      _id: regeneratedPaymentId,
      status: 'CREATED',
      merchantReference: '303303',
      previousPaymentId: paymentId,
      tvdQuote: {
        ...newQuote,
        expiresAt: new Date('2026-07-13T10:45:00.000Z'),
      },
    });
    const { service, paymentModel } = createService({
      tvdQuotes: {
        createPaymentQuoteSnapshot: jest.fn().mockResolvedValue(newQuote),
      },
      paymentModel: {
        findById: jest.fn().mockResolvedValue(expiredPayment),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
        create: jest.fn().mockResolvedValue(createdRegeneration),
        findOneAndUpdate: jest
          .fn()
          .mockResolvedValueOnce(expiredPayment)
          .mockResolvedValueOnce({
            ...createdRegeneration,
            status: 'QR_REQUESTING',
          })
          .mockResolvedValueOnce({
            ...createdRegeneration,
            status: 'QR_ACTIVE',
            providerReference: '909909',
            providerStatus: 'PENDING',
            qrImage: 'base64-qr',
          }),
      },
      provider: {
        generateQr: jest.fn().mockResolvedValue({
          providerReference: '909909',
          originMerchantReference: '303303',
          amountMinor: '1050',
          currency: 'BOB',
          providerStatus: 'PENDING',
          responseCode: 'PENDING',
          qrImage: 'base64-qr',
        }),
      },
    });

    try {
      await expect(
        service.regenerateQrPayment(
          String(paymentId),
          {
            sub: String(userId),
            role: 'TENANT_ADMIN',
            tenantId: String(tenantId),
          },
          'regen-key-quote-expired',
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          status: 'QR_ACTIVE',
        }),
      );
    } finally {
      jest.useRealTimers();
    }

    expect(paymentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tvdQuote: expect.objectContaining({
          exchangeRateVersion: 4,
          expiresAt: new Date('2026-07-13T10:45:00.000Z'),
        }),
      }),
    );
  });

  it.each(['PROVIDER_STATUS_UNRESOLVED', 'PROVIDER_ERROR', 'RECONCILIATION_PENDING'])(
    'blocks regeneration while %s requires reconciliation',
    async (status) => {
      const { service, paymentModel, provider } = createService({
        paymentModel: {
          findById: jest.fn().mockResolvedValue(
            basePayment({
              status,
              targetAssignmentId: assignmentId,
              targetWallet,
              targetWalletNormalized: targetWallet.toLowerCase(),
            }),
          ),
        },
      });

      await expect(
        service.regenerateQrPayment(
          String(paymentId),
          { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
          'regen-key-blocked',
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'PAYMENT_REGENERATION_RECONCILIATION_REQUIRED',
        }),
      });
      expect(paymentModel.create).not.toHaveBeenCalled();
      expect(provider.generateQr).not.toHaveBeenCalled();
    },
  );

  it('blocks regeneration after payment confirmation or accreditation creation', async () => {
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(
          basePayment({
            status: 'PAYMENT_CONFIRMED',
            tokenAccreditationStatus: 'PENDING',
          }),
        ),
      },
    });

    await expect(
      service.regenerateQrPayment(
        String(paymentId),
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
        'regen-key-confirmed',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_REGENERATION_NOT_ALLOWED',
      }),
    });
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('returns the same regenerated QR for repeated regeneration idempotency key', async () => {
    const existing = basePayment({
      _id: regeneratedPaymentId,
      status: 'QR_ACTIVE',
      idempotencyKey: 'regen-key-repeat',
      idempotencyRequestHash: idempotencyHash({
        tenantId: String(tenantId),
        userId: String(userId),
        amountMinor: '1050',
        currency: 'BOB',
        previousPaymentId: String(paymentId),
        quoteVersion: 'none',
        quoteExpiresAt: '',
      }),
      previousPaymentId: paymentId,
      providerReference: '909909',
      qrImage: 'base64-qr',
    });
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(
          basePayment({
            status: 'EXPIRED',
            targetAssignmentId: assignmentId,
            targetWallet,
            targetWalletNormalized: targetWallet.toLowerCase(),
          }),
        ),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(existing),
        }),
      },
    });

    await expect(
      service.regenerateQrPayment(
        String(paymentId),
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
        'regen-key-repeat',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: String(regeneratedPaymentId),
        status: 'QR_ACTIVE',
      }),
    );
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });

  it('blocks a second simultaneous regeneration when the original payment is locked', async () => {
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findById: jest.fn().mockResolvedValue(
          basePayment({
            status: 'EXPIRED',
            targetAssignmentId: assignmentId,
            targetWallet,
            targetWalletNormalized: targetWallet.toLowerCase(),
          }),
        ),
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.regenerateQrPayment(
        String(paymentId),
        { sub: String(userId), role: 'TENANT_ADMIN', tenantId: String(tenantId) },
        'regen-key-race',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'PAYMENT_REGENERATION_RECONCILIATION_REQUIRED',
      }),
    });
    expect(paymentModel.create).not.toHaveBeenCalled();
    expect(provider.generateQr).not.toHaveBeenCalled();
  });
});
