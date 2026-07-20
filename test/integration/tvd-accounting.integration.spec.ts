import appConfig from '@/config/app.config';
import { LoggerService } from '@/core/services/logger.service';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '@/modules/payments/schemas/payment-transaction.schema';
import { QR_PAYMENT_PROVIDER } from '@/modules/payments/payments.constants';
import { PaymentTenantAccessService } from '@/modules/payments/services/payment-tenant-access.service';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from '@/modules/tvd/schemas/token-accreditation.schema';
import {
  TvdExchangeRate,
  TvdExchangeRateSchema,
} from '@/modules/tvd/schemas/tvd-exchange-rate.schema';
import { TokenAccreditationsService } from '@/modules/tvd/services/token-accreditations.service';
import { TvdExchangeRatesService } from '@/modules/tvd/services/tvd-exchange-rates.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';

describe('TVD accounting models, snapshots and idempotency (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let rates: TvdExchangeRatesService;
  let accreditations: TokenAccreditationsService;
  let payments: PaymentTransactionsService;
  let rateModel: Model<any>;
  let paymentModel: Model<any>;
  let accreditationModel: Model<any>;
  let previousDecimals: string | undefined;

  const tenantId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const createdBy = new Types.ObjectId();
  const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  const qrProvider = {
    generateQr: jest.fn(async (input: any) => ({
      providerReference: `RED-${input.merchantReference}`,
      originMerchantReference: input.merchantReference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      providerStatus: 'PENDING',
      responseCode: 'PENDING',
      responseDetail: 'QR generado',
      qrImage: 'base64-qr',
      qrExpiresAt: input.expiresAt,
    })),
    verifyQr: jest.fn(),
  };

  const tenantAccess = {
    resolveTenantForWrite: jest.fn().mockResolvedValue({ _id: tenantId, active: true }),
    getRequesterObjectId: jest.fn().mockReturnValue(userId),
    assertTenantAccess: jest.fn().mockResolvedValue(undefined),
    resolveTenantIdsForRead: jest.fn().mockResolvedValue([tenantId]),
    resolvePaymentTargetForRequester: jest.fn().mockResolvedValue({
      targetAssignmentId: assignmentId,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
    }),
  };

  beforeAll(async () => {
    previousDecimals = process.env.TVD_DECIMALS;
    process.env.TVD_DECIMALS = '2';

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
          { name: TvdExchangeRate.name, schema: TvdExchangeRateSchema },
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
        ]),
      ],
      providers: [
        PaymentTransactionsService,
        { provide: QR_PAYMENT_PROVIDER, useValue: qrProvider },
        { provide: PaymentTenantAccessService, useValue: tenantAccess },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    rates = moduleRef.get(TvdExchangeRatesService);
    accreditations = moduleRef.get(TokenAccreditationsService);
    payments = moduleRef.get(PaymentTransactionsService);
    rateModel = moduleRef.get(getModelToken(TvdExchangeRate.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));

    await Promise.all([
      rateModel.init(),
      paymentModel.init(),
      accreditationModel.init(),
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await conn.collection('tvd_exchange_rates').deleteMany({});
    await conn.collection('token_accreditations').deleteMany({});
    await conn.collection('payment_transactions').deleteMany({});
  });

  afterAll(async () => {
    if (previousDecimals === undefined) {
      delete process.env.TVD_DECIMALS;
    } else {
      process.env.TVD_DECIMALS = previousDecimals;
    }
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function createRate(bobPerToken = '2.50') {
    return rates.createActiveRate({
      currency: 'BOB',
      bobPerToken,
      createdBy,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    });
  }

  async function createQr(idempotencyKey?: string) {
    return payments.createQrPayment(
      { amount: '10.00', currency: 'BOB', description: 'Recarga TVD' },
      { sub: String(userId), role: 'USER', tenantId: String(tenantId), active: true },
      idempotencyKey,
    );
  }

  describe('POSITIVOS', () => {
    it('P-INT-011 | POSITIVO | INTEGRACION | persiste una nueva tasa como string', async () => {
      const rate = await createRate('2.50');

      expect(rate.currency).toBe('BOB');
      expect(rate.bobPerToken).toBe('2.5');
      expect(rate.version).toBe(1);
      expect(rate.active).toBe(true);
      expect(typeof rate.bobPerToken).toBe('string');
    });

    it('P-INT-012 | POSITIVO | INTEGRACION | conserva tasa historica al activar otra', async () => {
      const first = await createRate('2.50');
      const second = await rates.createActiveRate({
        currency: 'BOB',
        bobPerToken: '5.00',
        createdBy,
        effectiveFrom: new Date('2026-07-18T10:00:00.000Z'),
      });

      const historical = await rateModel.findById(first._id).lean();
      expect(historical).toMatchObject({
        bobPerToken: '2.5',
        version: 1,
        active: false,
      });
      expect(historical?.effectiveTo).toEqual(new Date('2026-07-18T10:00:00.000Z'));
      expect(second).toMatchObject({ bobPerToken: '5', version: 2, active: true });
    });

    it('P-INT-013/P-INT-016 | POSITIVO | INTEGRACION | guarda snapshot dentro del pago y cantidades como strings', async () => {
      await createRate('2.50');

      const response = await createQr();
      const persisted = await paymentModel.findById(response.id).lean();

      expect(response.tvdQuote).toMatchObject({
        fiatAmountMinor: '1000',
        fiatCurrency: 'BOB',
        bobPerToken: '2.5',
        exchangeRateVersion: 1,
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
      });
      expect(persisted?.tvdQuote).toMatchObject({
        fiatAmountMinor: '1000',
        bobPerToken: '2.5',
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
      });
      expect(typeof persisted?.tvdQuote?.tokenAmount).toBe('string');
      expect(typeof persisted?.tvdQuote?.tokenAmountSmallestUnit).toBe('string');
    });

    it('P-INT-007 | POSITIVO | INTEGRACION | devuelve mismo snapshot ante repeticion idempotente', async () => {
      await createRate('2.50');

      const first = await createQr('same-quote');
      await rates.createActiveRate({
        currency: 'BOB',
        bobPerToken: '5',
        createdBy,
        effectiveFrom: new Date('2026-07-18T10:00:00.000Z'),
      });
      const repeated = await createQr('same-quote');

      expect(repeated.id).toBe(first.id);
      expect(repeated.tvdQuote).toEqual(first.tvdQuote);
      expect(await paymentModel.countDocuments()).toBe(1);
    });

    it('P-INT-014/P-INT-015 | POSITIVO | INTEGRACION | crea una sola acreditacion por origen y consulta por tenant', async () => {
      const sourceId = String(new Types.ObjectId());

      const first = await accreditations.createPending({
        sourceType: 'QR_PAYMENT',
        sourceId,
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        fiatAmountMinor: '1000',
        fiatCurrency: 'BOB',
        bobPerToken: '2.5',
        exchangeRateVersion: 1,
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
        createdBy,
      });
      const repeated = await accreditations.createPending({
        sourceType: 'QR_PAYMENT',
        sourceId,
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        tokenAmount: '4',
        tokenAmountSmallestUnit: '400',
        createdBy,
      });

      const rows = await accreditations.listByTenant(tenantId);
      expect(String(repeated._id)).toBe(String(first._id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sourceType: 'QR_PAYMENT',
        sourceId,
        status: 'PENDING',
        attempts: 0,
        targetWalletNormalized: wallet,
      });
    });
  });

  describe('NEGATIVOS', () => {
    it('N-INT-011 | NEGATIVO | INTEGRACION | rechaza dos tasas activas incompatibles', async () => {
      await createRate('2.50');

      await expect(
        rateModel.create({
          currency: 'BOB',
          bobPerToken: '3',
          version: 2,
          active: true,
          effectiveFrom: new Date(),
          createdBy,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('N-INT-012/N-INT-014 | NEGATIVO | INTEGRACION | evita modificar snapshot y tasa congelada', async () => {
      await createRate('2.50');
      const response = await createQr();

      await expect(
        paymentModel.updateOne(
          { _id: response.id },
          {
            $set: {
              tvdQuote: {
                fiatAmountMinor: '1000',
                fiatCurrency: 'BOB',
                bobPerToken: '99',
                exchangeRateVersion: 99,
                tokenAmount: '1',
                tokenAmountSmallestUnit: '100',
                quotedAt: new Date(),
              },
            },
          },
        ),
      ).rejects.toThrow('TVD quote snapshot is immutable');

      await rates.createActiveRate({
        currency: 'BOB',
        bobPerToken: '5',
        createdBy,
        effectiveFrom: new Date('2026-07-18T10:00:00.000Z'),
      });
      const stored = await paymentModel.findById(response.id).lean();
      expect(stored?.tvdQuote?.bobPerToken).toBe('2.5');
      expect(stored?.tvdQuote?.exchangeRateVersion).toBe(1);
    });

    it('N-INT-013 | NEGATIVO | INTEGRACION | evita dos acreditaciones con mismo sourceType y sourceId', async () => {
      const sourceId = String(new Types.ObjectId());
      await accreditations.createPending({
        sourceType: 'MANUAL_GRANT',
        sourceId,
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        tokenAmount: '1',
        tokenAmountSmallestUnit: '100',
        createdBy,
      });
      await accreditations.createPending({
        sourceType: 'MANUAL_GRANT',
        sourceId,
        tenantId,
        targetAssignmentId: assignmentId,
        targetWallet: wallet,
        tokenAmount: '2',
        tokenAmountSmallestUnit: '200',
        createdBy,
      });

      expect(await accreditationModel.countDocuments()).toBe(1);
    });

    it('N-INT-015 | NEGATIVO | INTEGRACION | rechaza un pago sin tasa aplicable', async () => {
      await expect(createQr()).rejects.toThrow('No existe tasa TVD activa vigente');
      expect(await paymentModel.countDocuments()).toBe(0);
    });

    it('N-INT-016/N-INT-017 | NEGATIVO | INTEGRACION | no crea acreditacion automatica ni ejecuta blockchain para pago no confirmado', async () => {
      await createRate('2.50');
      const response = await createQr();

      expect(response.status).toBe('QR_ACTIVE');
      expect(await accreditationModel.countDocuments()).toBe(0);
      expect(qrProvider.generateQr).toHaveBeenCalled();
      expect(qrProvider.verifyQr).not.toHaveBeenCalled();
    });

    it('N-INT-007 | NEGATIVO | INTEGRACION | rechaza moneda diferente de BOB al crear tasa', async () => {
      await expect(
        rates.createActiveRate({
          currency: 'USD' as any,
          bobPerToken: '2',
          createdBy,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
