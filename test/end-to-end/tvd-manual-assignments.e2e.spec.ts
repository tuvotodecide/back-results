import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { TokenAccreditation } from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { getAddress } from 'viem';

const endpoint = '/api/v1/tvd/manual-assignments';
const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
const txHash = `0x${'5'.repeat(64)}`;

describe('TVD manual assignments controlled e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let tenantModel: Model<any>;
  let assignmentModel: Model<any>;
  let userModel: Model<any>;
  let accreditationModel: Model<any>;
  let currentUser: any;
  let previousDecimals: string | undefined;

  const blockchain = {
    getOperatorContext: jest.fn(() => ({
      chainId: 84532,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      assignmentContractAddress: assignmentContract,
    })),
    validateAssignReadiness: jest.fn(async () => ({
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
    })),
    getPendingNonce: jest.fn(async () => '8'),
    prepareSignedAssignTransaction: jest.fn(async () => ({
      txHash,
      nonce: '8',
      serializedTransaction: `0x${'8'.repeat(64)}`,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      institutionWallet: wallet,
      amountSmallestUnit: '10000',
    })),
    broadcastSignedTransaction: jest.fn(async () => ({ txHash, alreadyKnown: false })),
    getTransactionReceipt: jest.fn(async () => ({ transactionHash: txHash })),
    validateSubmittedAssignReceipt: jest.fn(async () => ({
      blockNumber: '88',
      confirmations: 3,
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
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
          { name: RoledUser.name, schema: RoledUserSchema },
        ]),
      ],
    })
      .overrideProvider(TvdBlockchainService)
      .useValue(blockchain)
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    app.use((req: any, _res: any, next: any) => {
      req.user = currentUser;
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    tenantModel = moduleRef.get(getModelToken(InstitutionalTenant.name));
    assignmentModel = moduleRef.get(getModelToken(TenantAdminAssignment.name));
    userModel = moduleRef.get(getModelToken(RoledUser.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    blockchain.getOperatorContext.mockReturnValue({
      chainId: 84532,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      assignmentContractAddress: assignmentContract,
    });
    blockchain.validateAssignReadiness.mockResolvedValue({
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
    });
    blockchain.getPendingNonce.mockResolvedValue('8');
    blockchain.prepareSignedAssignTransaction.mockResolvedValue({
      txHash,
      nonce: '8',
      serializedTransaction: `0x${'8'.repeat(64)}`,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      institutionWallet: wallet,
      amountSmallestUnit: '10000',
    });
    blockchain.broadcastSignedTransaction.mockResolvedValue({ txHash, alreadyKnown: false });
    blockchain.getTransactionReceipt.mockResolvedValue({ transactionHash: txHash });
    blockchain.validateSubmittedAssignReceipt.mockResolvedValue({
      blockNumber: '88',
      confirmations: 3,
    });
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };
    await Promise.all([
      conn.collection('institutional_audit_events').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('institutional_tenants').deleteMany({}),
      conn.collection('roled_users').deleteMany({}),
      conn.collection('token_accreditations').deleteMany({}),
    ]);
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

  async function seedBody() {
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
      tenantId: String(tenant._id),
      assignmentId: String(assignment._id),
      tokenAmount: '100',
      reason: 'Credito promocional institucional',
    };
  }

  it('TVD-MANUAL-E2E-001 | POSITIVO | E2E | POST crea, confirma y GET devuelve resultado seguro', async () => {
    const body = await seedBody();

    const created = await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', 'e2e-key-1')
      .send(body)
      .expect(201);

    expect(created.body).toMatchObject({
      sourceType: 'MANUAL_GRANT',
      targetWallet: wallet,
      tokenAmount: '100',
      tokenAmountSmallestUnit: '10000',
      status: 'CONFIRMED',
      txHash,
    });

    const fetched = await request(app.getHttpServer())
      .get(`${endpoint}/${created.body.id}`)
      .expect(200);

    expect(fetched.body).toMatchObject({
      id: created.body.id,
      status: 'CONFIRMED',
      txHash,
    });
  });

  it('TVD-MANUAL-E2E-002 | POSITIVO | E2E | repetir POST con misma clave no invoca assign dos veces', async () => {
    const body = await seedBody();

    const first = await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', 'e2e-key-2')
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', 'e2e-key-2')
      .send(body)
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(await accreditationModel.countDocuments({ sourceType: 'MANUAL_GRANT' })).toBe(1);
    expect(blockchain.prepareSignedAssignTransaction).toHaveBeenCalledTimes(1);
  });
});
