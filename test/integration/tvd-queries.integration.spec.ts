import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
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
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { getAddress } from 'viem';

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
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
  let currentUser: any;
  let seed: Awaited<ReturnType<typeof seedData>>;

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
    getTokenSymbol: jest.fn(async () => 'TVD'),
    getOperatorContext: jest.fn(() => ({
      chainId: 84532,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      assignmentContractAddress: assignmentContract,
    })),
  };

  beforeAll(async () => {
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
          { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
          { name: RoledUser.name, schema: RoledUserSchema },
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
        ]),
      ],
    })
      .overrideProvider(TvdBlockchainService)
      .useValue(blockchain)
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
    await Promise.all([
      tenantModel.init(),
      assignmentModel.init(),
      userModel.init(),
      paymentModel.init(),
      accreditationModel.init(),
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
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
    await Promise.all([
      conn.collection('institutional_tenants').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('roled_users').deleteMany({}),
      conn.collection('payment_transactions').deleteMany({}),
      conn.collection('token_accreditations').deleteMany({}),
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
      contractAddress: assignmentContract,
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

  it('TVD-QUERY-POS-I-006/007 | POSITIVO | INTEGRACION | ADMIN lista instituciones y wallets elegibles', async () => {
    currentUser = { sub: new Types.ObjectId().toHexString(), role: 'ADMIN', active: true };

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
    currentUser = { sub: new Types.ObjectId().toHexString(), role: 'ADMIN', active: true };

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

  it('TVD-QUERY-NEG-I-001/002/003 | NEGATIVO | INTEGRACION | bloquea sin JWT rol incorrecto y usuario sin assignment', async () => {
    await request(app.getHttpServer()).get('/api/v1/tvd/me/summary').expect(401);

    currentUser = { sub: new Types.ObjectId().toHexString(), role: 'USER', active: true };
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

    blockchain.getTotalBalance.mockRejectedValueOnce(new Error('rpc unavailable with secret'));
    const res = await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer institutional')
      .expect(503);
    expect(res.body).toMatchObject({
      code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
    });
    expect(JSON.stringify(res.body)).not.toContain('rpc unavailable with secret');
  });

  it('TVD-QUERY-NEG-I-007 | NEGATIVO | INTEGRACION | wallet sin metadata no es elegible ni consultable por me', async () => {
    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      { $set: { walletVerifiedAt: null, walletVerificationSource: null } },
    );

    await request(app.getHttpServer())
      .get('/api/v1/tvd/me/summary')
      .set('Authorization', 'Bearer institutional')
      .expect(400);

    currentUser = { sub: new Types.ObjectId().toHexString(), role: 'ADMIN', active: true };
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
