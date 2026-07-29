import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
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
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '@/modules/payments/schemas/payment-transaction.schema';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from '@/modules/tvd/schemas/token-accreditation.schema';
import {
  TvdExchangeRate,
  TvdExchangeRateSchema,
} from '@/modules/tvd/schemas/tvd-exchange-rate.schema';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
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

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const walletC = getAddress('0xcccccccccccccccccccccccccccccccccccccccc');
const assignmentContract = getAddress(
  '0x2222222222222222222222222222222222222222',
);
const tokenContract = getAddress('0x4444444444444444444444444444444444444444');
const txHash = `0x${'7'.repeat(64)}`;

describe('TVD query endpoints (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let tenantModel: Model<any>;
  let assignmentModel: Model<any>;
  let userModel: Model<any>;
  let paymentModel: Model<any>;
  let accreditationModel: Model<any>;
  let rateModel: Model<any>;
  let currentUser: any;
  let seed: Awaited<ReturnType<typeof seedData>>;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;
  let previousTvdDecimals: string | undefined;

  const httpService = {
    axiosRef: {
      get: jest.fn(),
    },
  };

  const blockchain = {
    getTotalBalance: jest.fn(async () => ({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '11000000000000000000',
      totalBalanceSmallestUnit: '11000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '11',
      totalBalanceFormatted: '11',
      isUnlocked: false,
      unlockTime: '0',
    })),
    getLiquidBalance: jest.fn(async () => '11000000000000000000'),
    getTokenDecimals: jest.fn(async () => 18),
    getTokenSymbol: jest.fn(async () => 'TVD'),
    getTokenAddressFromAssignmentContract: jest.fn(async () => tokenContract),
    getOperatorContext: jest.fn(() => ({
      chainId: 84532,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      assignmentContractAddress: assignmentContract,
    })),
  };

  beforeAll(async () => {
    previousIdentityBaseUrl = process.env.IDENTITY_BASE_URL;
    previousIdentityApiKey = process.env.IDENTITY_API_KEY;
    previousTvdDecimals = process.env.TVD_DECIMALS;
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';
    process.env.TVD_DECIMALS = '18';

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
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          {
            name: TenantAdminAssignment.name,
            schema: TenantAdminAssignmentSchema,
          },
          { name: RoledUser.name, schema: RoledUserSchema },
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
          { name: TvdExchangeRate.name, schema: TvdExchangeRateSchema },
        ]),
      ],
    })
      .overrideProvider(TvdBlockchainService)
      .useValue(blockchain)
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) {
            throw new UnauthorizedException();
          }
          req.user = currentUser;
          return true;
        }),
      })
      .overrideGuard(AdminOnlyGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) {
            throw new UnauthorizedException('Missing token');
          }
          if (currentUser?.role !== 'ADMIN') {
            throw new ForbiddenException('Admin role required');
          }
          req.user = currentUser;
          return true;
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    tenantModel = moduleRef.get(getModelToken(InstitutionalTenant.name));
    assignmentModel = moduleRef.get(getModelToken(TenantAdminAssignment.name));
    userModel = moduleRef.get(getModelToken(RoledUser.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
    rateModel = moduleRef.get(getModelToken(TvdExchangeRate.name));
    await Promise.all([
      tenantModel.init(),
      assignmentModel.init(),
      userModel.init(),
      paymentModel.init(),
      accreditationModel.init(),
      rateModel.init(),
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.get.mockResolvedValue({
      data: {
        ok: true,
        record: {
          accountAddress: walletA,
          discoverableHash: '0x-sensitive-hash',
          guardianContractAddress: '0x-sensitive-guardian',
        },
      },
    });
    blockchain.getTotalBalance.mockResolvedValue({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '11000000000000000000',
      totalBalanceSmallestUnit: '11000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '11',
      totalBalanceFormatted: '11',
      isUnlocked: false,
      unlockTime: '0',
    });
    blockchain.getLiquidBalance.mockResolvedValue('11000000000000000000');
    blockchain.getTokenDecimals.mockResolvedValue(18);
    await Promise.all([
      conn.collection('institutional_tenants').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('roled_users').deleteMany({}),
      conn.collection('payment_transactions').deleteMany({}),
      conn.collection('token_accreditations').deleteMany({}),
      conn.collection('tvd_exchange_rates').deleteMany({}),
    ]);
    seed = await seedData();
    currentUser = {
      sub: String(seed.userA._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantA._id),
    };
  });

  afterAll(async () => {
    if (previousIdentityBaseUrl === undefined) {
      delete process.env.IDENTITY_BASE_URL;
    } else {
      process.env.IDENTITY_BASE_URL = previousIdentityBaseUrl;
    }
    if (previousIdentityApiKey === undefined) {
      delete process.env.IDENTITY_API_KEY;
    } else {
      process.env.IDENTITY_API_KEY = previousIdentityApiKey;
    }
    if (previousTvdDecimals === undefined) {
      delete process.env.TVD_DECIMALS;
    } else {
      process.env.TVD_DECIMALS = previousTvdDecimals;
    }
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedData() {
    const [tenantA, tenantB] = await tenantModel.create([
      { name: 'Tenant A', nameNorm: 'tenant-a', active: true },
      { name: 'Tenant B', nameNorm: 'tenant-b', active: true },
    ]);
    const [userA, userB] = await userModel.create([
      {
        dni: '111',
        email: 'a@example.test',
        name: 'User A',
        password: 'hash',
        role: 'USER',
        active: true,
      },
      {
        dni: '222',
        email: 'b@example.test',
        name: 'User B',
        password: 'hash',
        role: 'USER',
        active: true,
      },
    ]);
    const [assignmentA, assignmentB] = await assignmentModel.create([
      {
        tenantId: tenantA._id,
        userId: userA._id,
        status: 'APPROVED',
        active: true,
        institutionalRole: 'PRIMARY',
        accountAddress: walletA,
        accountAddressNormalized: walletA.toLowerCase(),
        walletVerifiedAt: new Date(),
        walletVerificationSource: 'TEST',
      },
      {
        tenantId: tenantB._id,
        userId: userB._id,
        status: 'APPROVED',
        active: true,
        institutionalRole: 'PRIMARY',
        accountAddress: walletB,
        accountAddressNormalized: walletB.toLowerCase(),
        walletVerifiedAt: new Date(),
        walletVerificationSource: 'TEST',
      },
    ]);
    const paymentA = await paymentModel.create({
      tenantId: tenantA._id,
      requestedByUserId: userA._id,
      targetAssignmentId: assignmentA._id,
      targetWallet: walletA,
      targetWalletNormalized: walletA.toLowerCase(),
      provider: 'RED_ENLACE',
      merchantReference: '100000001',
      providerReference: 'RED-100000001',
      amountMinor: '1000',
      currency: 'BOB',
      status: 'PAYMENT_CONFIRMED',
      confirmationSource: 'WEBHOOK',
      confirmedAt: new Date(),
      tvdQuote: {
        fiatAmountMinor: '1000',
        fiatCurrency: 'BOB',
        bobPerToken: '1',
        exchangeRateVersion: 1,
        tokenAmount: '10',
        tokenAmountSmallestUnit: '10000000000000000000',
        quotedAt: new Date(),
      },
    });
    const accreditationA = await accreditationModel.create({
      sourceType: 'QR_PAYMENT',
      sourceId: String(paymentA._id),
      tenantId: tenantA._id,
      targetAssignmentId: assignmentA._id,
      targetWallet: walletA,
      targetWalletNormalized: walletA.toLowerCase(),
      fiatAmountMinor: '1000',
      fiatCurrency: 'BOB',
      bobPerToken: '1',
      exchangeRateVersion: 1,
      tokenAmount: '10',
      tokenAmountSmallestUnit: '10000000000000000000',
      status: 'CONFIRMED',
      attempts: 1,
      txHash,
      chainId: 84532,
      contractAddress: assignmentContract,
      blockNumber: '123',
      createdBy: userA._id,
      submittedAt: new Date(),
      confirmedAt: new Date(),
    });
    await paymentModel.updateOne(
      { _id: paymentA._id },
      {
        $set: {
          tokenAccreditationId: accreditationA._id,
          tokenAccreditationStatus: 'CONFIRMED',
        },
      },
    );
    const paymentB = await paymentModel.create({
      tenantId: tenantB._id,
      requestedByUserId: userB._id,
      targetAssignmentId: assignmentB._id,
      targetWallet: walletB,
      targetWalletNormalized: walletB.toLowerCase(),
      provider: 'RED_ENLACE',
      merchantReference: '100000002',
      providerReference: 'RED-100000002',
      amountMinor: '100',
      currency: 'BOB',
      status: 'PAYMENT_CONFIRMED',
    });
    const accreditationB = await accreditationModel.create({
      sourceType: 'QR_PAYMENT',
      sourceId: String(paymentB._id),
      tenantId: tenantB._id,
      targetAssignmentId: assignmentB._id,
      targetWallet: walletB,
      targetWalletNormalized: walletB.toLowerCase(),
      tokenAmount: '1',
      tokenAmountSmallestUnit: '1000000000000000000',
      status: 'CONFIRMED',
      attempts: 1,
      createdBy: userB._id,
    });

    return {
      tenantA,
      tenantB,
      userA,
      userB,
      assignmentA,
      assignmentB,
      paymentA,
      paymentB,
      accreditationA,
      accreditationB,
    };
  }

  it('TVD-QUERY-POS-I-001 | POSITIVO | INTEGRACION | summary usa assignedBalance on-chain y datos seguros', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer institutional')
      .expect(200);

    expect(blockchain.getTotalBalance).toHaveBeenCalledWith(walletA);
    expect(res.body).toMatchObject({
      tenantId: String(seed.tenantA._id),
      assignmentId: String(seed.assignmentA._id),
      wallet: walletA,
      walletStatus: 'VERIFIED',
      tokenSymbol: 'TVD',
      chainId: 84532,
      contractAddress: tokenContract,
      assignmentContractAddress: assignmentContract,
      assignedBalance: {
        smallestUnit: '11000000000000000000',
        formatted: '11',
        decimals: 18,
      },
      pendingAccreditationsCount: 0,
    });
    expect(JSON.stringify(res.body)).not.toContain('serializedTransaction');
  });

  it('TVD-QUERY-POS-I-002/003 | POSITIVO | INTEGRACION | historial y detalle institucional estan aislados por tenant', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/accreditations')
      .set('Authorization', 'Bearer institutional')
      .query({ sourceType: 'QR_PAYMENT', status: 'CONFIRMED' })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      id: String(seed.accreditationA._id),
      sourceType: 'QR_PAYMENT',
      paymentId: String(seed.paymentA._id),
      tokenAmount: '10',
      status: 'CONFIRMED',
      txHash,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tvd/me/accreditations/${seed.accreditationA._id}`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(detail.body.id).toBe(String(seed.accreditationA._id));

    await request(app.getHttpServer())
      .get(`/api/v1/tvd/me/accreditations/${seed.accreditationB._id}`)
      .set('Authorization', 'Bearer institutional')
      .expect(404);
  });

  it('TVD-QUERY-POS-I-004/005 | POSITIVO | INTEGRACION | historial y detalle de pagos QR no exponen payload bancario', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/payments')
      .set('Authorization', 'Bearer institutional')
      .query({ status: 'PAYMENT_CONFIRMED' })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      paymentId: String(seed.paymentA._id),
      amount: '10.00',
      currency: 'BOB',
      status: 'PAYMENT_CONFIRMED',
      accreditationId: String(seed.accreditationA._id),
      accreditationStatus: 'CONFIRMED',
      txHash,
    });
    expect(JSON.stringify(list.body)).not.toContain('achReference');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tvd/me/payments/${seed.paymentA._id}`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(detail.body.tvdQuote).toMatchObject({
      bobPerToken: '1',
      tokenAmount: '10',
      tokenAmountSmallestUnit: '10000000000000000000',
    });

    await request(app.getHttpServer())
      .get(`/api/v1/tvd/me/payments/${seed.paymentB._id}`)
      .set('Authorization', 'Bearer institutional')
      .expect(404);
  });

  it('TVD-QUOTE-POS-I-001 | POSITIVO | INTEGRACION | admin institucional consulta cotizacion BOB/TVD read-only', async () => {
    await rateModel.create({
      currency: 'BOB',
      bobPerToken: '2.5',
      version: 1,
      active: true,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      createdBy: seed.userA._id,
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/quote')
      .set('Authorization', 'Bearer institutional')
      .query({ amount: '10.50', currency: 'bob' })
      .expect(200);

    expect(res.body).toMatchObject({
      fiatAmount: '10.50',
      fiatAmountMinor: '1050',
      fiatCurrency: 'BOB',
      estimatedTvd: '4.2',
      estimatedTvdSmallestUnit: '4200000000000000000',
      bobPerToken: '2.5',
      exchangeRateVersion: 1,
    });
    expect(typeof res.body.quotedAt).toBe('string');
    expect(res.body).not.toHaveProperty('validUntil');
    expect(res.body).not.toHaveProperty('wallet');
    expect(res.body).not.toHaveProperty('balance');
    expect(blockchain.getTotalBalance).not.toHaveBeenCalled();
  });

  it('TVD-QUOTE-NEG-I-001/002/003 | NEGATIVO | INTEGRACION | cotizacion valida monto moneda y wallet institucional', async () => {
    await rateModel.create({
      currency: 'BOB',
      bobPerToken: '2.5',
      version: 1,
      active: true,
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      createdBy: seed.userA._id,
    });

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/quote')
      .set('Authorization', 'Bearer institutional')
      .query({ amount: '0', currency: 'BOB' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/quote')
      .set('Authorization', 'Bearer institutional')
      .query({ amount: '10.123', currency: 'BOB' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/quote')
      .set('Authorization', 'Bearer institutional')
      .query({ amount: '10.50', currency: 'USD' })
      .expect(400);

    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      { $set: { walletVerifiedAt: null, walletVerificationSource: null } },
    );

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/quote')
      .set('Authorization', 'Bearer institutional')
      .query({ amount: '10.50', currency: 'BOB' })
      .expect(400);
  });

  it('TVD-CAPACITY-EST-POS-I-001 | POSITIVO | INTEGRACION | calcula capacidad estimada sin efectos economicos', async () => {
    blockchain.getLiquidBalance.mockResolvedValueOnce('80000000000000000000');

    const beforePayments = await paymentModel.countDocuments({});
    const beforeAccreditations = await accreditationModel.countDocuments({});
    const res = await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional')
      .send({ estimatedParticipants: 100 })
      .expect(201);

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletA);
    expect(res.body).toMatchObject({
      estimatedParticipants: '100',
      tokensPerParticipant: '1',
      estimatedRequiredTokens: '100',
      estimatedRequiredSmallestUnit: '100000000000000000000',
      availableTokens: '80',
      availableSmallestUnit: '80000000000000000000',
      estimatedMissingTokens: '20',
      estimatedMissingSmallestUnit: '20000000000000000000',
      hasEstimatedCapacity: false,
      reasonCode: 'INSUFFICIENT_TVD_BALANCE',
      balanceSource: 'BLOCKCHAIN',
      usableBalanceField: 'liquidBalanceSmallestUnit',
      walletAddress: walletA,
    });
    expect(await paymentModel.countDocuments({})).toBe(beforePayments);
    expect(await accreditationModel.countDocuments({})).toBe(beforeAccreditations);
  });

  it('TVD-CAPACITY-EST-NEG-I-001 | NEGATIVO | INTEGRACION | rechaza inputs invalidos y campos autoritativos del frontend', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional')
      .send({ estimatedParticipants: '   ' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional')
      .send({ estimatedParticipants: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional')
      .send({ estimatedParticipants: 10.5 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional')
      .send({
        estimatedParticipants: 10,
        walletAddress: walletB,
        availableTokens: '999',
        canPublish: true,
      })
      .expect(400);

    expect(blockchain.getLiquidBalance).not.toHaveBeenCalled();
  });

  it('TVD-CAPACITY-EST-POS-I-002 | POSITIVO | INTEGRACION | dos admins del mismo tenant conservan wallets independientes', async () => {
    const userC = await userModel.create({
      dni: '333',
      email: 'c@example.test',
      name: 'User C',
      password: 'hash',
      role: 'USER',
      active: true,
    });
    await assignmentModel.create({
      tenantId: seed.tenantA._id,
      userId: userC._id,
      status: 'APPROVED',
      active: true,
      institutionalRole: 'SECONDARY',
      accountAddress: walletB,
      accountAddressNormalized: walletB.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
    });
    currentUser = {
      sub: String(userC._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantA._id),
    };
    blockchain.getLiquidBalance.mockResolvedValueOnce('100000000000000000000');

    const res = await request(app.getHttpServer())
      .post('/api/v1/tvd/me/estimated-capacity')
      .set('Authorization', 'Bearer institutional-c')
      .send({ estimatedParticipants: 100 })
      .expect(201);

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletB);
    expect(blockchain.getLiquidBalance).not.toHaveBeenCalledWith(walletA);
    expect(res.body).toMatchObject({
      walletAddress: walletB,
      availableTokens: '100',
      hasEstimatedCapacity: true,
      reasonCode: null,
    });
  });

  it('TVD-QUERY-POS-I-006/007 | POSITIVO | INTEGRACION | ADMIN lista instituciones y wallets elegibles', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };

    const institutions = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/institutions')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(institutions.body.total).toBe(2);
    expect(institutions.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: String(seed.tenantA._id),
          eligibleWalletsCount: 1,
        }),
      ]),
    );

    const wallets = await request(app.getHttpServer())
      .get(`/api/v1/tvd/admin/institutions/${seed.tenantA._id}/wallets`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(wallets.body.wallets[0]).toMatchObject({
      assignmentId: String(seed.assignmentA._id),
      wallet: walletA,
      walletStatus: 'VERIFIED',
      eligible: true,
    });
  });

  it('TVD-QUERY-POS-I-008 | POSITIVO | INTEGRACION | ADMIN consulta acreditaciones globales', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };

    const list = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/accreditations')
      .set('Authorization', 'Bearer admin')
      .query({ tenantId: String(seed.tenantA._id) })
      .expect(200);
    expect(list.body.total).toBe(1);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/tvd/admin/accreditations/${seed.accreditationA._id}`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(detail.body.id).toBe(String(seed.accreditationA._id));
  });

  it('TVD-WALLET-LOOKUP-POS-I-001 | POSITIVO | INTEGRACION | ADMIN consulta wallet asociada con contrato seguro', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };

    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: walletA.toLowerCase() })
      .expect(200);

    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/by-account',
      expect.objectContaining({
        params: { accountAddress: walletA },
        headers: { 'x-api-key': 'identity-test-key' },
        timeout: 5000,
      }),
    );
    expect(res.body).toMatchObject({
      accountAddress: walletA,
      registeredInIdentity: true,
      identityStatus: 'REGISTERED',
      associationStatus: 'ASSOCIATED',
      canUse: true,
      reasonCode: 'WALLET_ASSOCIATED',
      associations: [
        {
          tenantId: String(seed.tenantA._id),
          tenantName: 'Tenant A',
          assignmentId: String(seed.assignmentA._id),
          userId: String(seed.userA._id),
          institutionalRole: 'PRIMARY',
          assignmentStatus: 'APPROVED',
          assignmentActive: true,
          userActive: true,
          walletStatus: 'VERIFIED',
        },
      ],
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('identity-test-key');
    expect(serialized).not.toContain('discoverableHash');
    expect(serialized).not.toContain('guardianContractAddress');
    expect(serialized).not.toContain('dni');
    expect(serialized).not.toContain('password');
  });

  it('TVD-WALLET-LOOKUP-POS-I-002 | POSITIVO | INTEGRACION | ADMIN recibe wallet no registrada sin datos sensibles', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: { ok: false, error: 'not-found' },
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: walletC })
      .expect(200);

    expect(res.body).toMatchObject({
      accountAddress: walletC,
      registeredInIdentity: false,
      identityStatus: 'NOT_REGISTERED',
      associationStatus: 'UNASSOCIATED',
      canUse: false,
      reasonCode: 'WALLET_NOT_REGISTERED',
      associations: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('identity-test-key');
  });

  it('TVD-WALLET-LOOKUP-NEG-I-001 | NEGATIVO | INTEGRACION | bloquea lookup global sin JWT o sin rol ADMIN', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .query({ accountAddress: walletA })
      .expect(401);

    currentUser = { sub: String(seed.userA._id), role: 'USER', active: true };
    await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer institutional')
      .query({ accountAddress: walletA })
      .expect(403);
  });

  it('TVD-WALLET-LOOKUP-NEG-I-002 | NEGATIVO | INTEGRACION | valida direccion y normaliza errores de Identity', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };

    await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: 'not-a-wallet' })
      .expect(400);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    httpService.axiosRef.get.mockRejectedValueOnce(
      new Error(
        'ECONNREFUSED https://identity.internal.local identity-test-key',
      ),
    );
    const unavailable = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: walletA })
      .expect(503);
    expect(unavailable.body).toMatchObject({
      code: 'TVD_IDENTITY_UNAVAILABLE',
    });
    expect(JSON.stringify(unavailable.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(unavailable.body)).not.toContain('identity-test-key');

    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: true } });
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: walletA })
      .expect(502);
    expect(invalid.body).toMatchObject({
      code: 'TVD_IDENTITY_INVALID_RESPONSE',
    });
  });

  it('TVD-WALLET-LOOKUP-NEG-I-003 | NEGATIVO | INTEGRACION | identifica wallet local deshabilitada sin combinar wallets del tenant', async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };
    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      { $set: { active: false } },
    );

    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/wallet-lookup')
      .set('Authorization', 'Bearer admin')
      .query({ accountAddress: walletA })
      .expect(200);

    expect(res.body).toMatchObject({
      accountAddress: walletA,
      associationStatus: 'DISABLED',
      canUse: false,
      reasonCode: 'WALLET_DISABLED',
    });
    expect(res.body.associations).toHaveLength(1);
    expect(res.body.associations[0].assignmentId).toBe(
      String(seed.assignmentA._id),
    );
    expect(JSON.stringify(res.body)).not.toContain(
      String(seed.assignmentB._id),
    );
    expect(JSON.stringify(res.body)).not.toContain(walletB);
  });

  it('TVD-QUERY-NEG-I-001/002/003 | NEGATIVO | INTEGRACION | bloquea sin JWT rol incorrecto y usuario sin assignment', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .expect(401);

    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'USER',
      active: true,
    };
    await request(app.getHttpServer())
      .get('/api/v1/tvd/admin/institutions')
      .set('Authorization', 'Bearer institutional')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer no-assignment')
      .expect(403);
  });

  it('TVD-QUERY-NEG-I-004/005/006 | NEGATIVO | INTEGRACION | valida filtros y no inventa saldo ante RPC caido', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/accreditations')
      .set('Authorization', 'Bearer institutional')
      .query({ status: 'UNKNOWN' })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/accreditations')
      .set('Authorization', 'Bearer institutional')
      .query({
        dateFrom: '2026-07-18T10:00:00.000Z',
        dateTo: '2026-07-18T09:00:00.000Z',
      })
      .expect(400);

    blockchain.getTotalBalance.mockRejectedValueOnce(
      new Error('rpc unavailable with secret'),
    );
    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer institutional')
      .expect(503);
    expect(res.body).toMatchObject({
      code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
    });
    expect(JSON.stringify(res.body)).not.toContain(
      'rpc unavailable with secret',
    );
  });

  it('TVD-QUERY-POS-I-009 | POSITIVO | INTEGRACION | summary informa assignment sin wallet sin consultar balance', async () => {
    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      { $set: { walletVerifiedAt: null, walletVerificationSource: null } },
    );

    const balanceReadsBefore = blockchain.getTotalBalance.mock.calls.length;
    const summary = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(blockchain.getTotalBalance.mock.calls.length).toBe(balanceReadsBefore);
    expect(summary.body).toMatchObject({
      tenantId: String(seed.tenantA._id),
      assignmentId: String(seed.assignmentA._id),
      wallet: null,
      walletStatus: 'MISSING',
      assignedBalance: null,
      liquidBalance: null,
      totalBalance: null,
    });

    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };
    const wallets = await request(app.getHttpServer())
      .get(`/api/v1/tvd/admin/institutions/${seed.tenantA._id}/wallets`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(wallets.body.wallets[0]).toMatchObject({
      walletStatus: 'MISSING',
      eligible: false,
    });
  });
});
