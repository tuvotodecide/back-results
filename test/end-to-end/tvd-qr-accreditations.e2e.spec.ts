import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { LoggerService } from '@/core/services/logger.service';
import {
  RoledUser,
  RoledUserSchema,
} from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { PaymentsController } from '@/modules/payments/controllers/payments.controller';
import { RedEnlaceWebhookController } from '@/modules/payments/controllers/red-enlace-webhook.controller';
import { RedEnlaceWebhookGuard } from '@/modules/payments/guards/red-enlace-webhook.guard';
import { QR_PAYMENT_PROVIDER } from '@/modules/payments/payments.constants';
import {
  PaymentProviderEvent,
  PaymentProviderEventSchema,
} from '@/modules/payments/schemas/payment-provider-event.schema';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '@/modules/payments/schemas/payment-transaction.schema';
import { PaymentTenantAccessService } from '@/modules/payments/services/payment-tenant-access.service';
import { PaymentTransactionsService } from '@/modules/payments/services/payment-transactions.service';
import { RedEnlaceWebhookService } from '@/modules/payments/services/red-enlace-webhook.service';
import { TokenAccreditation } from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdExchangeRatesService } from '@/modules/tvd/services/tvd-exchange-rates.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { getAddress } from 'viem';

const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

describe('TVD QR accreditations controlled e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let tenantModel: Model<any>;
  let userModel: Model<any>;
  let assignmentModel: Model<any>;
  let accreditationModel: Model<any>;
  let rates: TvdExchangeRatesService;
  let currentUser: any;
  let previousDecimals: string | undefined;

  const qrProvider = {
    generateQr: jest.fn(async (input: any) => ({
      providerReference: input.merchantReference,
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
          {
            name: PaymentProviderEvent.name,
            schema: PaymentProviderEventSchema,
          },
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          {
            name: TenantAdminAssignment.name,
            schema: TenantAdminAssignmentSchema,
          },
          { name: RoledUser.name, schema: RoledUserSchema },
        ]),
      ],
      controllers: [PaymentsController, RedEnlaceWebhookController],
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
    })
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RedEnlaceWebhookGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = currentUser;
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    tenantModel = moduleRef.get(getModelToken(InstitutionalTenant.name));
    userModel = moduleRef.get(getModelToken(RoledUser.name));
    assignmentModel = moduleRef.get(getModelToken(TenantAdminAssignment.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
    rates = moduleRef.get(TvdExchangeRatesService);
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
      bobPerToken: '2.10',
      createdBy: new Types.ObjectId(),
    });
    const tenant = await tenantModel.create({
      name: 'E2E Tenant',
      nameNorm: `e2e-tenant-${new Types.ObjectId().toHexString()}`,
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
    await assignmentModel.create({
      tenantId: tenant._id,
      userId: user._id,
      status: 'APPROVED',
      active: true,
      institutionalRole: 'PRIMARY',
      accountAddress: wallet,
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
    });
    currentUser = {
      sub: String(user._id),
      role: 'USER',
      tenantId: String(tenant._id),
      active: true,
    };
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

  it('TVD-QR-E2E-001 | POSITIVO | E2E | QR confirmado crea TokenAccreditation QR_PAYMENT PENDING', async () => {
    const qr = await request(app.getHttpServer())
      .post('/api/v1/payments/qr')
      .set('Idempotency-Key', 'qr-e2e-key')
      .send({
        amount: '10.50',
        currency: 'BOB',
        description: 'Recarga operativa',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/qr/confirmed')
      .send({
        numeroReferencia: qr.body.providerReference,
        estado: '00',
        transacciones: {
          monto: 10.5,
          moneda: 'BOB',
          fechaHoraTransaccion: '2026-07-17T10:30:00.000',
          numeroAch: 'ACH-E2E-001',
        },
      })
      .expect(200, {
        numeroReferencia: qr.body.providerReference,
        codigoRespuesta: '00',
        detalleRespuesta: null,
      });

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/payments/${qr.body.id}`)
      .expect(200);

    expect(fetched.body).toMatchObject({
      status: 'PAYMENT_CONFIRMED',
      tokenAccreditation: {
        status: 'PENDING',
        tokenAmount: '5',
      },
    });
    await expect(
      accreditationModel.countDocuments({
        sourceType: 'QR_PAYMENT',
        sourceId: qr.body.id,
      }),
    ).resolves.toBe(1);
  });

  it('TVD-QR-E2E-002 | POSITIVO | E2E | webhook repetido reutiliza la misma acreditacion', async () => {
    const qr = await request(app.getHttpServer())
      .post('/api/v1/payments/qr')
      .set('Idempotency-Key', 'qr-e2e-key-duplicate-webhook')
      .send({
        amount: '10.50',
        currency: 'BOB',
        description: 'Recarga operativa',
      })
      .expect(201);

    const payload = {
      numeroReferencia: qr.body.providerReference,
      estado: '00',
      transacciones: {
        monto: 10.5,
        moneda: 'BOB',
        fechaHoraTransaccion: '2026-07-17T10:30:00.000',
        numeroAch: 'ACH-E2E-002',
      },
    };
    await request(app.getHttpServer())
      .post('/api/v1/qr/confirmed')
      .send(payload)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/qr/confirmed')
      .send(payload)
      .expect(200);

    await expect(
      accreditationModel.countDocuments({
        sourceType: 'QR_PAYMENT',
        sourceId: qr.body.id,
      }),
    ).resolves.toBe(1);
  });
});
