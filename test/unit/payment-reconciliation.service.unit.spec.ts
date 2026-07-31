import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentDomainError } from '@/modules/payments/errors/payment-domain.error';
import { PAYMENT_PROVIDER_RED_ENLACE } from '@/modules/payments/payments.constants';
import { PaymentReconciliationService } from '@/modules/payments/services/payment-reconciliation.service';

const paymentId = new Types.ObjectId();
const tenantId = new Types.ObjectId();

const basePayment = (override: Record<string, any> = {}) => ({
  _id: paymentId,
  tenantId,
  requestedByUserId: new Types.ObjectId(),
  provider: PAYMENT_PROVIDER_RED_ENLACE,
  merchantReference: '203414',
  providerReference: '6780',
  amountMinor: '1050',
  currency: 'BOB',
  status: 'QR_ACTIVE',
  reconciliationAttempts: 0,
  ...override,
});

function query<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function createService(options?: {
  paymentModel?: Record<string, jest.Mock>;
  provider?: Record<string, jest.Mock>;
  payments?: Record<string, jest.Mock>;
  config?: Record<string, string | number | undefined>;
}) {
  const payment = basePayment();
  const paymentModel = {
    findOneAndUpdate: jest.fn().mockReturnValueOnce(query(payment)).mockReturnValue(query(null)),
    findOne: jest.fn().mockReturnValue(query(payment)),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    ...(options?.paymentModel ?? {}),
  };
  const provider = {
    verifyQr: jest.fn().mockResolvedValue({
      providerReference: '6780',
      providerStatus: 'SUCCESS',
      responseCode: 'SUCCESS',
      amountMinor: '1050',
      currency: 'BOB',
      achReference: 'ACH-1',
      paymentDate: new Date('2026-07-29T10:00:00.000Z'),
    }),
    ...(options?.provider ?? {}),
  };
  const payments = {
    applyReconciliationResult: jest
      .fn()
      .mockResolvedValue(basePayment({ status: 'PAYMENT_CONFIRMED' })),
    ensureAccreditationForConfirmedPayment: jest
      .fn()
      .mockResolvedValue(basePayment({ status: 'PAYMENT_CONFIRMED' })),
    ...(options?.payments ?? {}),
  };
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | number | undefined> = {
        'app.redEnlace.reconciliation.enabled': 'true',
        'app.redEnlace.reconciliation.intervalMs': '10000',
        'app.redEnlace.reconciliation.batchSize': '1',
        'app.redEnlace.reconciliation.leaseDurationMs': '60000',
        'app.redEnlace.reconciliation.maxAttempts': '3',
        'app.redEnlace.reconciliation.baseBackoffMs': '30000',
        'app.redEnlace.reconciliation.maxBackoffMs': '300000',
        ...(options?.config ?? {}),
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  const service = new PaymentReconciliationService(
    paymentModel as any,
    provider as any,
    payments as any,
    configService,
  );

  return { service, paymentModel, provider, payments };
}

describe('PaymentReconciliationService', () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-29T12:00:00.000Z'));
    loggerSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
    jest.useRealTimers();
  });

  it('TVD-QR-P0-007 VALIDACION_RUNTIME_WORKER | does not run when the worker is disabled', async () => {
    const { service, paymentModel, provider } = createService({
      config: { 'app.redEnlace.reconciliation.enabled': 'false' },
    });

    await expect(service.runOnce()).resolves.toEqual({
      processed: 0,
      claimed: 0,
      skipped: true,
    });
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(provider.verifyQr).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({ enabled: false, configValid: true }),
    );
  });

  it('does not run when reconciliation config is invalid', async () => {
    const { service, paymentModel, provider } = createService({
      config: { 'app.redEnlace.reconciliation.batchSize': '0' },
    });

    await expect(service.runOnce()).resolves.toEqual({
      processed: 0,
      claimed: 0,
      skipped: true,
    });
    expect(paymentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(provider.verifyQr).not.toHaveBeenCalled();
    expect(service.getStatus()).toEqual(
      expect.objectContaining({
        enabled: true,
        configValid: false,
        lastErrorCode: 'RED_ENLACE_RECONCILIATION_CONFIG_INVALID',
      }),
    );
  });

  it('TVD-QR-P0-007 TVD-RES-P0-002 | claims one eligible QR payment atomically with a durable lease', async () => {
    const { service, paymentModel } = createService();

    await service.runOnce();

    expect(paymentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'RED_ENLACE',
        providerReference: { $type: 'string' },
        reconciliationAttempts: { $lt: 3 },
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              { reconciliationLockExpiresAt: null },
            ]),
          }),
        ]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          reconciliationLockOwner: expect.stringContaining(
            'red-enlace-reconciliation',
          ),
          reconciliationLockedAt: new Date('2026-07-29T12:00:00.000Z'),
          reconciliationLockExpiresAt: new Date('2026-07-29T12:01:00.000Z'),
        }),
      }),
      expect.objectContaining({ new: true }),
    );
  });

  it('TVD-QR-P0-007 TVD-RES-P0-004 VALIDACION_EXTERNA_RED_ENLACE | confirms a lost callback when provider verification returns SUCCESS', async () => {
    const { service, provider, payments, paymentModel } = createService();

    await expect(service.runOnce()).resolves.toEqual({
      processed: 1,
      claimed: 1,
      skipped: false,
    });

    expect(provider.verifyQr).toHaveBeenCalledWith({ providerReference: '6780' });
    expect(payments.applyReconciliationResult).toHaveBeenCalledWith(
      expect.objectContaining({ providerReference: '6780' }),
      expect.objectContaining({ providerStatus: 'SUCCESS' }),
    );
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: paymentId,
        reconciliationLockOwner: expect.any(String),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          reconciliationNextAttemptAt: null,
          reconciliationLastProviderStatus: 'SUCCESS',
        }),
      }),
    );
  });

  it.each([
    ['PENDING', 'QR_ACTIVE'],
    ['INITIALIZE', 'QR_ACTIVE'],
    ['CLOSED', 'PROVIDER_STATUS_UNRESOLVED'],
    ['ERROR', 'PROVIDER_ERROR'],
    ['NOTFOUND', 'PROVIDER_STATUS_UNRESOLVED'],
  ])(
    'schedules retry for provider status %s mapped to %s',
    async (providerStatus, mappedStatus) => {
      const payment = basePayment();
      const { service, paymentModel } = createService({
        paymentModel: {
          findOneAndUpdate: jest.fn().mockReturnValueOnce(query(payment)),
          findOne: jest.fn().mockReturnValue(query(payment)),
          updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
        },
        provider: {
          verifyQr: jest.fn().mockResolvedValue({
            providerReference: '6780',
            providerStatus,
            responseCode: providerStatus,
            amountMinor: '1050',
            currency: 'BOB',
            statusHistory:
              providerStatus === 'CLOSED'
                ? [{ status: 'CLOSED', at: new Date() }]
                : undefined,
          }),
        },
        payments: {
          applyReconciliationResult: jest
            .fn()
            .mockResolvedValue(basePayment({ status: mappedStatus })),
        },
      });

      await service.runOnce();

      expect(paymentModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: mappedStatus,
            reconciliationAttempts: 1,
            reconciliationNextAttemptAt: new Date('2026-07-29T12:00:30.000Z'),
            reconciliationLastProviderStatus: providerStatus,
          }),
        }),
      );
    },
  );

  it.each(['EXPIRED', 'CANCELLED', 'MISMATCH'])(
    'does not retry %s terminal outcomes',
    async (terminalStatus) => {
    const { service, paymentModel } = createService({
      provider: {
        verifyQr: jest.fn().mockResolvedValue({
          providerReference: '6780',
          providerStatus: terminalStatus,
          responseCode: terminalStatus,
          amountMinor: '1050',
          currency: 'BOB',
        }),
      },
      payments: {
        applyReconciliationResult: jest
          .fn()
          .mockResolvedValue(basePayment({ status: terminalStatus })),
      },
    });

    await service.runOnce();

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          reconciliationNextAttemptAt: null,
          reconciliationLastProviderStatus: terminalStatus,
        }),
      }),
    );
    },
  );

  it('backs off exponentially and caps at maxBackoff', async () => {
    const payment = basePayment({ reconciliationAttempts: 2 });
    const { service, paymentModel } = createService({
      paymentModel: {
        findOneAndUpdate: jest.fn().mockReturnValueOnce(query(payment)),
        findOne: jest.fn().mockReturnValue(query(payment)),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
      provider: {
        verifyQr: jest
          .fn()
          .mockRejectedValue(
            new PaymentDomainError(
              'RED_ENLACE_TIMEOUT',
              'Tiempo agotado',
              504,
            ),
          ),
      },
      config: {
        'app.redEnlace.reconciliation.maxAttempts': '5',
        'app.redEnlace.reconciliation.baseBackoffMs': '30000',
        'app.redEnlace.reconciliation.maxBackoffMs': '60000',
      },
    });

    await service.runOnce();

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'PROVIDER_STATUS_UNRESOLVED',
          reconciliationAttempts: 3,
          reconciliationNextAttemptAt: new Date('2026-07-29T12:01:00.000Z'),
          reconciliationLastErrorCode: 'RED_ENLACE_TIMEOUT',
        }),
      }),
    );
  });

  it('marks unresolved as exhausted without confirming or accrediting after max attempts', async () => {
    const payment = basePayment({ reconciliationAttempts: 2 });
    const { service, paymentModel, payments } = createService({
      paymentModel: {
        findOneAndUpdate: jest.fn().mockReturnValueOnce(query(payment)),
        findOne: jest.fn().mockReturnValue(query(payment)),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
      provider: {
        verifyQr: jest
          .fn()
          .mockRejectedValue(
            new PaymentDomainError(
              'RED_ENLACE_INVALID_RESPONSE',
              'Respuesta incompleta',
              502,
            ),
          ),
      },
    });

    await service.runOnce();

    expect(payments.applyReconciliationResult).not.toHaveBeenCalled();
    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'PROVIDER_STATUS_UNRESOLVED',
          reconciliationAttempts: 3,
          reconciliationNextAttemptAt: null,
          reconciliationExhaustedAt: new Date('2026-07-29T12:00:00.000Z'),
        }),
      }),
    );
  });

  it('does not call provider when a callback already confirmed the payment during the lease', async () => {
    const confirmed = basePayment({
      status: 'PAYMENT_CONFIRMED',
      tokenAccreditationId: null,
      tokenAccreditationStatus: null,
    });
    const { service, provider, payments } = createService({
      paymentModel: {
        findOneAndUpdate: jest.fn().mockReturnValueOnce(query(confirmed)),
        findOne: jest.fn().mockReturnValue(query(confirmed)),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await service.runOnce();

    expect(provider.verifyQr).not.toHaveBeenCalled();
    expect(payments.ensureAccreditationForConfirmedPayment).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAYMENT_CONFIRMED' }),
      'RECONCILIATION',
    );
  });

  it('supports two workers by letting only one claim the payment', async () => {
    const payment = basePayment();
    const sharedModel = {
      findOneAndUpdate: jest
        .fn()
        .mockReturnValueOnce(query(payment))
        .mockReturnValueOnce(query(null)),
      findOne: jest.fn().mockReturnValue(query(payment)),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
    const first = createService({ paymentModel: sharedModel as any });
    const second = createService({ paymentModel: sharedModel as any });

    await expect(first.service.runOnce()).resolves.toEqual(
      expect.objectContaining({ claimed: 1 }),
    );
    await expect(second.service.runOnce()).resolves.toEqual(
      expect.objectContaining({ claimed: 0 }),
    );
  });

  it('does not process when the lease owner changed before processing', async () => {
    const { service, paymentModel, provider } = createService({
      paymentModel: {
        findOneAndUpdate: jest.fn().mockReturnValueOnce(query(basePayment())),
        findOne: jest.fn().mockReturnValue(query(null)),
        updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    });

    await service.runOnce();

    expect(provider.verifyQr).not.toHaveBeenCalled();
    expect(paymentModel.updateOne).not.toHaveBeenCalled();
  });

  it('keeps logs free of secrets, PII and Base64 payloads', async () => {
    const { service } = createService();

    await service.runOnce();

    const logs = JSON.stringify(loggerSpy.mock.calls);
    expect(logs).not.toContain('x-api-key');
    expect(logs).not.toContain('callback-token');
    expect(logs).not.toContain('14240008');
    expect(logs).not.toContain('1011000024');
    expect(logs).not.toContain('data:image');
  });
});
