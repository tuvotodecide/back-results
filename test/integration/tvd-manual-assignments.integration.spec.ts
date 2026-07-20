import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { RoledUser, RoledUserSchema } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalAuditEvent } from '@/modules/institutional-audit/schemas/institutional-audit-event.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { PaymentTransaction, PaymentTransactionSchema } from '@/modules/payments/schemas/payment-transaction.schema';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { getAddress } from 'viem';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_INTEGRATION = 'INTEGRACION';

const endpoint = '/api/v1/tvd/manual-assignments';
const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const assignmentContract = getAddress('0x2222222222222222222222222222222222222222');
const txHash = `0x${'6'.repeat(64)}`;

describe('TVD manual assignments endpoint (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let tenantModel: Model<any>;
  let assignmentModel: Model<any>;
  let userModel: Model<any>;
  let accreditationModel: Model<any>;
  let auditModel: Model<any>;
  let paymentModel: Model<any>;
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
    getPendingNonce: jest.fn(async () => '7'),
    prepareSignedAssignTransaction: jest.fn(async () => ({
      txHash,
      nonce: '7',
      serializedTransaction: `0x${'9'.repeat(64)}`,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      institutionWallet: wallet,
      amountSmallestUnit: '2500',
    })),
    broadcastSignedTransaction: jest.fn(async () => ({ txHash, alreadyKnown: false })),
    getTransactionReceipt: jest.fn(async () => ({ transactionHash: txHash })),
    validateSubmittedAssignReceipt: jest.fn(async () => ({
      blockNumber: '44',
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
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          { name: TenantAdminAssignment.name, schema: TenantAdminAssignmentSchema },
          { name: RoledUser.name, schema: RoledUserSchema },
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
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
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
    auditModel = moduleRef.get(getModelToken(InstitutionalAuditEvent.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));

    await Promise.all([
      tenantModel.init(),
      assignmentModel.init(),
      userModel.init(),
      accreditationModel.init(),
      auditModel.init(),
      paymentModel.init(),
    ]);
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
    blockchain.getPendingNonce.mockResolvedValue('7');
    blockchain.prepareSignedAssignTransaction.mockResolvedValue({
      txHash,
      nonce: '7',
      serializedTransaction: `0x${'9'.repeat(64)}`,
      chainId: 84532,
      contractAddress: assignmentContract,
      operatorAddress: getAddress('0x3333333333333333333333333333333333333333'),
      institutionWallet: wallet,
      amountSmallestUnit: '2500',
    });
    blockchain.broadcastSignedTransaction.mockResolvedValue({ txHash, alreadyKnown: false });
    blockchain.getTransactionReceipt.mockResolvedValue({ transactionHash: txHash });
    blockchain.validateSubmittedAssignReceipt.mockResolvedValue({
      blockNumber: '44',
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
      conn.collection('payment_transactions').deleteMany({}),
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

  async function seedValidAssignment(overrides: Record<string, any> = {}) {
    const tenant = await tenantModel.create({
      name: `Tenant ${new Types.ObjectId().toHexString()}`,
      nameNorm: `tenant-${new Types.ObjectId().toHexString()}`,
      active: overrides.tenantActive ?? true,
    });
    const user = await userModel.create({
      dni: new Types.ObjectId().toHexString(),
      email: `${new Types.ObjectId().toHexString()}@example.test`,
      name: 'Institutional User',
      password: 'hashed',
      role: 'USER',
      active: overrides.userActive ?? true,
    });
    const assignment = await assignmentModel.create({
      tenantId: overrides.assignmentTenantId ?? tenant._id,
      userId: user._id,
      status: overrides.status ?? 'APPROVED',
      active: overrides.assignmentActive ?? true,
      institutionalRole: 'PRIMARY',
      accountAddress: Object.prototype.hasOwnProperty.call(overrides, 'accountAddress')
        ? overrides.accountAddress
        : wallet,
      walletVerifiedAt: Object.prototype.hasOwnProperty.call(overrides, 'walletVerifiedAt')
        ? overrides.walletVerifiedAt
        : new Date(),
      walletVerificationSource: 'TEST',
    });
    return { tenant, user, assignment };
  }

  function validBody(seed: { tenant: any; assignment: any }) {
    return {
      tenantId: String(seed.tenant._id),
      assignmentId: String(seed.assignment._id),
      tokenAmount: '25',
      reason: 'Credito promocional institucional',
    };
  }

  describe('CASOS POSITIVOS', () => {
    it(`TVD-MANUAL-POS-I-001/003/004/005/012/013/014/015 | ${CASE_TYPE_POSITIVE} | ${LEVEL_INTEGRATION} | endpoint protegido crea acreditacion confirmada`, async () => {
      const seed = await seedValidAssignment();

      const response = await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-key-1')
        .send(validBody(seed))
        .expect(201);

      expect(response.body).toMatchObject({
        sourceType: 'MANUAL_GRANT',
        tenantId: String(seed.tenant._id),
        targetAssignmentId: String(seed.assignment._id),
        targetWallet: wallet,
        tokenAmount: '25',
        tokenAmountSmallestUnit: '2500',
        status: 'CONFIRMED',
        txHash,
      });
      expect(blockchain.prepareSignedAssignTransaction).toHaveBeenCalledWith({
        institutionWallet: wallet,
        amountSmallestUnit: '2500',
        nonce: '7',
      });
      expect(await accreditationModel.countDocuments({ sourceType: 'QR_PAYMENT' })).toBe(0);
      expect(await paymentModel.countDocuments({})).toBe(0);
    });

    it(`TVD-MANUAL-POS-I-006 | ${CASE_TYPE_POSITIVE} | ${LEVEL_INTEGRATION} | idempotencia devuelve mismo registro y no repite assign`, async () => {
      const seed = await seedValidAssignment();
      const body = validBody(seed);

      const first = await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-key-2')
        .send(body)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-key-2')
        .send(body)
        .expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(blockchain.prepareSignedAssignTransaction).toHaveBeenCalledTimes(1);
    });

    it(`TVD-MANUAL-POS-I-005/012 | ${CASE_TYPE_POSITIVE} | ${LEVEL_INTEGRATION} | auditoria queda registrada`, async () => {
      const seed = await seedValidAssignment();

      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-key-3')
        .send(validBody(seed))
        .expect(201);

      await expect(auditModel.countDocuments({
        action: { $in: ['TVD_MANUAL_ASSIGNMENT_REQUESTED', 'TVD_MANUAL_ASSIGNMENT_CONFIRMED'] },
      })).resolves.toBe(2);
    });
  });

  describe('CASOS NEGATIVOS', () => {
    it(`TVD-MANUAL-NEG-I-002 | ${CASE_TYPE_NEGATIVE} | ${LEVEL_INTEGRATION} | endpoint rechaza rol no ADMIN`, async () => {
      currentUser = {
        sub: new Types.ObjectId().toHexString(),
        role: 'PRIMARY',
        active: true,
      };
      const seed = await seedValidAssignment();

      const response = await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-forbidden')
        .send(validBody(seed))
        .expect(403);

      expect(JSON.stringify(response.body)).toContain('TVD_MANUAL_ASSIGNMENT_UNAUTHORIZED');
      expect(blockchain.prepareSignedAssignTransaction).not.toHaveBeenCalled();
    });

    it(`TVD-MANUAL-NEG-I-007/008/009/010 | ${CASE_TYPE_NEGATIVE} | ${LEVEL_INTEGRATION} | rechaza payload conflictivo, cross-tenant, inactivo y wallet no verificada`, async () => {
      const seed = await seedValidAssignment();
      const body = validBody(seed);
      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-conflict')
        .send(body)
        .expect(201);

      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-conflict')
        .send({ ...body, reason: 'Otro motivo institucional' })
        .expect(409);

      const otherTenant = await tenantModel.create({
        name: 'Other Tenant',
        nameNorm: 'other-tenant',
        active: true,
      });
      const crossTenant = await seedValidAssignment({ assignmentTenantId: otherTenant._id });
      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-cross')
        .send(validBody(crossTenant))
        .expect(409);

      const inactive = await seedValidAssignment({ assignmentActive: false });
      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-inactive')
        .send(validBody(inactive))
        .expect(400);

      const unverified = await seedValidAssignment({ walletVerifiedAt: null });
      await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-unverified')
        .send(validBody(unverified))
        .expect(400);
    });

    it(`TVD-MANUAL-NEG-I-011/015 | ${CASE_TYPE_NEGATIVE} | ${LEVEL_INTEGRATION} | error blockchain deja FAILED sin RPC real`, async () => {
      blockchain.validateAssignReadiness.mockRejectedValueOnce(new TvdBlockchainError('TVD_CONFIG_INCOMPLETE'));
      const seed = await seedValidAssignment();

      const response = await request(app.getHttpServer())
        .post(endpoint)
        .set('Idempotency-Key', 'integration-blockchain-error')
        .send(validBody(seed))
        .expect(503);

      expect(JSON.stringify(response.body)).toContain('TVD_MANUAL_ASSIGNMENT_FAILED');
      expect(JSON.stringify(response.body)).toContain('TVD_CONFIG_INCOMPLETE');
      const stored = await accreditationModel.findOne({ sourceId: 'integration-blockchain-error' }).lean();
      expect(stored).toMatchObject({
        status: 'FAILED',
        lastErrorCode: 'TVD_CONFIG_INCOMPLETE',
      });
      expect(blockchain.prepareSignedAssignTransaction).not.toHaveBeenCalled();
    });
  });
});
