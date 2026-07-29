import appConfig from '@/config/app.config';
import { LoggerService } from '@/core/services/logger.service';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { QR_PAYMENT_PROVIDER } from '@/modules/payments/payments.constants';
import { PaymentProviderEvent, PaymentProviderEventSchema } from '@/modules/payments/schemas/payment-provider-event.schema';
import { PaymentTransaction, PaymentTransactionSchema } from '@/modules/payments/schemas/payment-transaction.schema';
import { PaymentTenantAccessService } from '@/modules/payments/services/payment-tenant-access.service';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { RedEnlaceWebhookService } from '@/modules/payments/services/red-enlace-webhook.service';
import { TokenAccreditation } from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdExchangeRatesService } from '@/modules/tvd/services/tvd-exchange-rates.service';
import { TvdQueryService } from '@/modules/tvd/services/tvd-query.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getAddress } from 'viem';

const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

function redEnlacePayload(providerReference: string) {
  return {
    numeroReferencia: providerReference,
    estado: '00',
    transacciones: {
      monto: '10.5',
      moneda: 'BOB',
      fechaHoraTransaccion: '2026-07-17T10:30:00.000',
      numeroAch: 'ACH-QR-001',
    },
  };
}

describe('TVD QR accreditations integration', () => {
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let payments: PaymentTransactionsService;
  let webhook: RedEnlaceWebhookService;
  let rates: TvdExchangeRatesService;
  let queries: TvdQueryService;
  let tenantModel: Model<any>;
  let userModel: Model<any>;
  let assignmentModel: Model<any>;
  let paymentModel: Model<any>;
  let accreditationModel: Model<any>;
  let previousDecimals: string | undefined;

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
    verifyQr: jest.fn(async (input: any) => ({
      providerReference: input.providerReference,
      providerStatus: 'SUCCESS',
      responseCode: 'SUCCESS',
      amountMinor: '1050',
      currency: 'BOB',
      achReference: 'ACH-RECONCILED',
      paymentDate: new Date('2026-07-17T10:31:00.000Z'),
    })),
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
        JwtModule.register({ global: true, secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
          { name: PaymentProviderEvent.name, schema: PaymentProviderEventSchema },
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
          { name: RoledUser.name, schema: RoledUserSchema },
        ]),
      ],
      providers: [
        PaymentTenantAccessService,
        PaymentTransactionsService,
        RedEnlaceWebhookService,
        { provide: QR_PAYMENT_PROVIDER, useValue: qrProvider },
        {
          provide: LoggerService,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile();

    conn = moduleRef.get<Connection>(getConnectionToken());
    payments = moduleRef.get(PaymentTransactionsService);
    webhook = moduleRef.get(RedEnlaceWebhookService);
    rates = moduleRef.get(TvdExchangeRatesService);
    queries = moduleRef.get(TvdQueryService);
    tenantModel = moduleRef.get(getModelToken(InstitutionalTenant.name));
    userModel = moduleRef.get(getModelToken(RoledUser.name));
    assignmentModel = moduleRef.get(getModelToken(TenantAdminAssignment.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([
      conn.collection('payment_transactions').deleteMany({}),
      conn.collection('payment_provider_events').deleteMany({}),
      conn.collection('token_accreditations').deleteMany({}),
      conn.collection('tvd_exchange_rates').deleteMany({}),
      conn.collection('institutional_audit_events').deleteMany({}),
      conn.collection('institutional_tenants').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('roled_users').deleteMany({}),
    ]);
    await rates.createActiveRate({
      currency: 'BOB',
      bobPerToken: '2.1',
      createdBy: new Types.ObjectId(),
    });
  });

  afterAll(async () => {
    if (previousDecimals === undefined) {
      delete process.env.TVD_DECIMALS;
    } else {
      process.env.TVD_DECIMALS = previousDecimals;
    }
    await moduleRef?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedInstitutionalRequester() {
    const tenant = await tenantModel.create({
      name: `Tenant ${new Types.ObjectId().toHexString()}`,
      nameNorm: `tenant-${new Types.ObjectId().toHexString()}`,
      active: true,
    });
    const user = await userModel.create({
      dni: new Types.ObjectId().toHexString(),
      email: `${new Types.ObjectId().toHexString()}@example.test`,
      name: 'Institutional User',
      password: 'hashed',
      role: 'USER',
      active: true,
    });
    const assignment = await assignmentModel.create({
      tenantId: tenant._id,
      userId: user._id,
      status: 'APPROVED',
      active: true,
      institutionalRole: 'PRIMARY',
      accountAddress: wallet,
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
    });
    return {
      tenant,
      user,
      assignment,
      requester: {
        sub: String(user._id),
        role: 'USER',
        tenantId: String(tenant._id),
        active: true,
      },
    };
  }

  it('P-INT-001/002/003/004/005/007/008/009 | POSITIVO | INTEGRACION | QR confirmado crea una sola acreditacion QR_PAYMENT', async () => {
    const seed = await seedInstitutionalRequester();

    const created = await payments.createQrPayment(
      { amount: '10.50', currency: 'BOB', description: 'Recarga operativa' },
      seed.requester,
      'qr-key-1',
    );

    expect(created).toMatchObject({
      status: 'QR_ACTIVE',
      tvdQuote: expect.objectContaining({
        fiatAmountMinor: '1050',
        fiatCurrency: 'BOB',
        tokenAmount: '5',
        tokenAmountSmallestUnit: '500',
      }),
    });

    const storedBeforeWebhook = await paymentModel.findById(created.id).lean();
    expect(storedBeforeWebhook).toMatchObject({
      targetAssignmentId: seed.assignment._id,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
    });

    await expect(
      webhook.receiveWebhook(redEnlacePayload(String(created.providerReference))),
    ).resolves.toEqual({
      numeroReferencia: created.providerReference,
      codigoRespuesta: '00',
      detalleRespuesta: null,
    });

    const confirmed = await paymentModel.findById(created.id).lean();
    expect(confirmed).toMatchObject({
      status: 'PAYMENT_CONFIRMED',
      tokenAccreditationStatus: 'PENDING',
    });

    const accreditation = await accreditationModel.findOne({
      sourceType: 'QR_PAYMENT',
      sourceId: created.id,
    }).lean();
    expect(accreditation).toMatchObject({
      sourceType: 'QR_PAYMENT',
      sourceId: created.id,
      tenantId: seed.tenant._id,
      targetAssignmentId: seed.assignment._id,
      targetWallet: wallet,
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      bobPerToken: '2.1',
      exchangeRateVersion: 1,
      tokenAmount: '5',
      tokenAmountSmallestUnit: '500',
      status: 'PENDING',
      attempts: 0,
    });

    const paymentState = await queries.getMyPayment(created.id, seed.requester);
    expect(paymentState).toMatchObject({
      paymentId: created.id,
      paymentStatus: 'PAYMENT_CONFIRMED',
      status: 'PAYMENT_CONFIRMED',
      reconciliationStatus: 'PAYMENT_CONFIRMED',
      accreditationStatus: 'PENDING',
      blockchainStatus: 'ACCREDITATION_PENDING',
      flowStatus: 'ACCREDITATION_PENDING',
      lastAccreditationErrorCode: null,
    });

    await webhook.receiveWebhook(redEnlacePayload(String(created.providerReference)));
    await payments.reconcilePayment(created.id, { role: 'ADMIN' }, {});
    await expect(accreditationModel.countDocuments({
      sourceType: 'QR_PAYMENT',
      sourceId: created.id,
    })).resolves.toBe(1);
    await expect(accreditationModel.countDocuments({ sourceType: 'MANUAL_GRANT' })).resolves.toBe(0);
  });

  it('N-INT-002/004/008/009 | NEGATIVO | INTEGRACION | snapshot inconsistente queda bloqueado y no crea MANUAL_GRANT', async () => {
    const seed = await seedInstitutionalRequester();
    const rawPayment = await paymentModel.create({
      tenantId: seed.tenant._id,
      requestedByUserId: seed.user._id,
      targetAssignmentId: seed.assignment._id,
      targetWallet: wallet,
      targetWalletNormalized: wallet.toLowerCase(),
      provider: 'RED_ENLACE',
      merchantReference: '555111',
      providerReference: 'RED-BAD-QUOTE',
      amountMinor: '1050',
      currency: 'BOB',
      status: 'QR_ACTIVE',
      tvdQuote: {
        fiatAmountMinor: '9999',
        fiatCurrency: 'BOB',
        bobPerToken: '2.10',
        exchangeRateVersion: 1,
        tokenAmount: '5',
        tokenAmountSmallestUnit: '500',
        quotedAt: new Date(),
      },
    });

    await webhook.receiveWebhook(redEnlacePayload('RED-BAD-QUOTE'));

    const accreditation = await accreditationModel.findOne({
      sourceType: 'QR_PAYMENT',
      sourceId: String(rawPayment._id),
    }).lean();
    expect(accreditation).toMatchObject({
      status: 'BLOCKED_CONFIGURATION',
      lastErrorCode: 'TVD_QUOTE_FIAT_MISMATCH',
    });
    await expect(accreditationModel.countDocuments({ sourceType: 'MANUAL_GRANT' })).resolves.toBe(0);
  });
});
