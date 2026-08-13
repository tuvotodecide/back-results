jest.mock('@/api/account', () => ({
  executeCoinbaseOp: jest.fn().mockResolvedValue({ txHash: '0xabc123' }),
}));

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: class {
        destroy() {}
      },
    },
  };
});

jest.mock('@/modules/institutional-voting/services/core/vote-writter.service', () => ({
  VoteWritterService: class {},
}));

jest.mock('@/modules/institutional-admin-applications/services/institutional-mobile-authorization-reconciliation.worker', () => ({
  InstitutionalMobileAuthorizationReconciliationWorker: class {},
}));

jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {
    createAuthorizationRequest: jest.fn(() => ({
      id: 'institutional-auth-request',
      body: { scope: [] },
    })),
    Verifier: {
      newVerifier: jest.fn(async () => ({
        fullVerify: jest.fn(async () => ({
          from: 'did:iden3:test',
        })),
      })),
    },
  },
  resolver: {
    EthStateResolver: jest.fn(),
  },
}));

jest.mock('@/api/vote', () => ({
  VoteContractCalls: {
    createInstitution: jest.fn().mockReturnValue({ calldata: '0x' }),
    addAuthorizedAddress: jest.fn().mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x1234' }),
    removeAuthorizedAddress: jest.fn().mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x5678' }),
    changeInstitutionAdmin: jest.fn().mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x9abc' }),
  },
  VoteContractReads: {
    getInstitutionAdmin: jest.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678'),
    isAuthorizedAddress: jest.fn().mockResolvedValue(true),
  },
}));

import appConfig from '@/config/app.config';
import { HttpService } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { MailService } from '@/modules/mail/mail.service';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalAdminApplication } from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import { InstitutionalAdminApplicationsService } from '@/modules/institutional-admin-applications/services/institutional-admin-applications.service';
import { InstitutionalApplicationReviewGuard } from '@/modules/institutional-admin-applications/guards/institutional-application-review.guard';
import { InstitutionalMobileZkAuthGuard } from '@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.guard';
import { InstitutionalMobileZkAuthService } from '@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.service';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { TestLoggerModule } from '../utils/module-helpers';
import { executeCoinbaseOp } from '@/api/account';
import { VoteContractCalls, VoteContractReads } from '@/api/vote';
import { OfficialPublicationUserOperationService } from '@/modules/institutional-voting/services/publication/official-publication-user-operation.service';
import { OfficialPublicationChainVerificationService } from '@/modules/institutional-voting/services/publication/official-publication-chain-verification.service';
import {
  installMx02SyntheticChainConfig,
  restoreMx02SyntheticChainConfig,
} from '../utils/mx02-synthetic-chain-config';

const validAccountAddress = '0x1234567890abcdef1234567890abcdef12345678';
const institutionNotFoundError = () => new Error('Institution does not exist');

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Solicitudes y firma institucional', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let accessService: InstitutionalVotingAccessService;
  let applicationsService: InstitutionalAdminApplicationsService;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;
  let previousInstitutionalApplicationRateLimit: string | undefined;
  let previousInstitutionalVerifyEmailRateLimit: string | undefined;
  let previousInstitutionalMobileAuthCallbackUrl: string | undefined;
  let previousVerifierDid: string | undefined;
  let previousZkAuthRpcUrl: string | undefined;
  let previousZkAuthNetwork: string | undefined;
  let previousZkAuthStateContract: string | undefined;
  let currentReviewer: any;
  let mobileAuthorizationSequence = 0;

  const httpService = {
    axiosRef: {
      post: jest.fn(),
      get: jest.fn(),
    },
  };

  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
    createEmail: jest.fn(),
    getTemplate: jest.fn(),
  };

  const userOperationService = {
    getUserOperationByHash: jest.fn(),
    getUserOperationReceipt: jest.fn(),
    getBlockNumber: jest.fn(),
  };

  const chainVerificationService = {
    decodeSmartAccountCalls: jest.fn(),
  };

  beforeAll(async () => {
    previousIdentityBaseUrl = process.env.IDENTITY_BASE_URL;
    previousIdentityApiKey = process.env.IDENTITY_API_KEY;
    previousInstitutionalApplicationRateLimit =
      process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT;
    previousInstitutionalVerifyEmailRateLimit =
      process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT;
    previousInstitutionalMobileAuthCallbackUrl = process.env.INSTITUTIONAL_MOBILE_AUTH_CALLBACK_URL;
    previousVerifierDid = process.env.VERIFIER_DID;
    previousZkAuthRpcUrl = process.env.ZK_AUTH_RPC_URL;
    previousZkAuthNetwork = process.env.ZK_AUTH_NETWORK;
    previousZkAuthStateContract = process.env.ZK_AUTH_STATE_CONTRACT;
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';
    process.env.EMAIL_VERIFICATION_BASE_URL = 'https://front.example.test';
    process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT = '1000';
    process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT = '1000';
    process.env.INSTITUTIONAL_MOBILE_AUTH_CALLBACK_URL =
      'https://results.example/api/v1/mobile/institutional-authorizations/auth/callback';
    process.env.VERIFIER_DID = 'did:example:verifier';
    process.env.ZK_AUTH_RPC_URL = 'https://rpc.example';
    process.env.ZK_AUTH_NETWORK = 'polygon:amoy';
    process.env.ZK_AUTH_STATE_CONTRACT = '0x0000000000000000000000000000000000000001';

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{
        launchTimeout: 120000,
      }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        CacheModule.register({ isGlobal: true }),
        JwtModule.register({ global: true, secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TestLoggerModule,
        InstitutionalAdminApplicationsModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(MailService)
      .useValue(mailService)
      .overrideProvider(OfficialPublicationUserOperationService)
      .useValue(userOperationService)
      .overrideProvider(OfficialPublicationChainVerificationService)
      .useValue(chainVerificationService)
      .overrideGuard(AccessApproverGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(InstitutionalApplicationReviewGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = currentReviewer;
          return true;
        }),
      })
      .overrideGuard(InstitutionalMobileZkAuthGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            sub: currentReviewer?.sub,
            smartAccountAddress: currentReviewer?.smartAccountAddress ?? validAccountAddress,
            applicationId: req.params?.applicationId,
            authType: 'INSTITUTIONAL_MOBILE_ZK',
          };
          return true;
        }),
      })
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
    applicationsService = moduleRef.get(InstitutionalAdminApplicationsService);
    accessService = new InstitutionalVotingAccessService(
      conn.model(VotingEvent.name) as any,
      conn.model(InstitutionalTenant.name) as any,
      conn.model(TenantAdminAssignment.name) as any,
      conn.model(InstitutionalAdminApplication.name) as any,
    );
  });

  beforeEach(async () => {
    installMx02SyntheticChainConfig();
    jest.clearAllMocks();
    (executeCoinbaseOp as jest.Mock).mockReset();
    (VoteContractCalls.createInstitution as jest.Mock).mockReset();
    (VoteContractCalls.addAuthorizedAddress as jest.Mock).mockReset();
    (VoteContractCalls.removeAuthorizedAddress as jest.Mock).mockReset();
    (VoteContractCalls.changeInstitutionAdmin as jest.Mock).mockReset();
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockReset();
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockReset();
    (executeCoinbaseOp as jest.Mock).mockResolvedValue({ txHash: '0xabc123' });
    (VoteContractCalls.createInstitution as jest.Mock).mockReturnValue({ calldata: '0x' });
    (VoteContractCalls.addAuthorizedAddress as jest.Mock).mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x1234' });
    (VoteContractCalls.removeAuthorizedAddress as jest.Mock).mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x5678' });
    (VoteContractCalls.changeInstitutionAdmin as jest.Mock).mockReturnValue({ to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x9abc' });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValue(institutionNotFoundError());
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    userOperationService.getUserOperationByHash.mockReset();
    userOperationService.getUserOperationReceipt.mockReset();
    userOperationService.getBlockNumber.mockReset();
    chainVerificationService.decodeSmartAccountCalls.mockReset();
    userOperationService.getUserOperationByHash.mockResolvedValue(null);
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);
    userOperationService.getBlockNumber.mockResolvedValue(2n);
    httpService.axiosRef.post.mockResolvedValue({
      data: { registered: true, accountAddress: validAccountAddress },
    });
    httpService.axiosRef.get.mockResolvedValue({ data: { records: [{ dni: '12345678' }] } });
    currentReviewer = {
      sub: String(new Types.ObjectId('64f000000000000000000001')),
      role: 'ADMIN',
      smartAccountAddress: validAccountAddress,
    };
    await conn.collection('institutional_admin_applications').deleteMany({});
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
    await conn.collection('institutional_admin_invitations').deleteMany({});
    await conn.collection('notification_logs').deleteMany({});
    await conn.collection('official_publication_notification_outbox').deleteMany({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreMx02SyntheticChainConfig();
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
    if (previousInstitutionalApplicationRateLimit === undefined) {
      delete process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT;
    } else {
      process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT =
        previousInstitutionalApplicationRateLimit;
    }
    if (previousInstitutionalVerifyEmailRateLimit === undefined) {
      delete process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT;
    } else {
      process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT =
        previousInstitutionalVerifyEmailRateLimit;
    }
    for (const [key, previous] of [
      ['INSTITUTIONAL_MOBILE_AUTH_CALLBACK_URL', previousInstitutionalMobileAuthCallbackUrl],
      ['VERIFIER_DID', previousVerifierDid],
      ['ZK_AUTH_RPC_URL', previousZkAuthRpcUrl],
      ['ZK_AUTH_NETWORK', previousZkAuthNetwork],
      ['ZK_AUTH_STATE_CONTRACT', previousZkAuthStateContract],
    ] as const) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  const validPayload = () => ({
    dni: '12345678',
    email: `admin-${Date.now()}@example.com`,
    name: 'Admin Institucional',
    password: 'secret123',
    institutionName: 'Institucion Validada',
    accountAddress: validAccountAddress,
  });

  async function countApplications() {
    return conn.collection('institutional_admin_applications').countDocuments();
  }

  async function countUsers() {
    return conn.collection('roled_users').countDocuments();
  }

  async function createVerifiedApplication(payload = validPayload()) {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: {
        registered: true,
        accountAddress: (payload as any).accountAddress ?? validAccountAddress,
      },
    });
    const created = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(created.body.id),
    });

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token: application?.verificationToken })
      .expect(201);

    return {
      id: created.body.id as string,
      payload,
    };
  }

  async function approveAndConfirmApplication(id: string) {
    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

    await applicationsService.processInstitutionCreationOperation(id);
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValueOnce(
      application?.accountAddress,
    );
    await applicationsService.reconcileInstitutionCreationOperation(id);

    return approveRes;
  }

  const payloadFor = (
    suffix: string,
    institutionName = 'Institucion Validada',
    accountAddress = validAccountAddress,
  ) => ({
    dni: `d${suffix.replace(/[^A-Za-z0-9]/g, '').slice(0, 18)}`,
    email: `admin-${suffix}@example.com`,
    name: `Admin ${suffix}`,
    password: 'secret123',
    institutionName,
    accountAddress,
  });

  async function createActiveTenantWithPrimary(
    name = 'Institucion Invitaciones',
    primaryWallet = '0x0000000000000000000000000000000000000101',
  ) {
    const tenantId = new Types.ObjectId();
    const primaryUserId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name,
      nameNorm: name.toLowerCase(),
      stableInstitutionId: String(tenantId),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertOne({
      _id: primaryUserId,
      dni: `primary-${String(tenantId).slice(-6)}`,
      email: `primary-${String(tenantId).slice(-6)}@example.com`,
      name: 'Administrador Principal',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId: primaryUserId,
      accountAddress: primaryWallet,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    currentReviewer = { sub: String(primaryUserId), role: 'USER', smartAccountAddress: primaryWallet };
    return { tenantId, primaryUserId };
  }

  async function createPendingPrimaryTransferAuthorization(
    suffix = 'transfer',
    primaryWallet = '0x0000000000000000000000000000000000000201',
    targetWallet = '0x0000000000000000000000000000000000000202',
  ) {
    const tenantId = new Types.ObjectId();
    const primaryUserId = new Types.ObjectId();
    const targetUserId = new Types.ObjectId();
    const primaryAssignmentId = new Types.ObjectId();
    const targetAssignmentId = new Types.ObjectId();
    const applicationId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: `Institucion Transfer ${suffix}`,
      nameNorm: `institucion transfer ${suffix}`,
      stableInstitutionId: `stable-transfer-${String(tenantId)}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertMany([
      {
        _id: primaryUserId,
        dni: `primary-${suffix}`,
        email: `primary-${suffix}@example.test`,
        name: 'Principal Actual',
        password: 'hashed-primary',
        role: 'USER',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: targetUserId,
        dni: `target-${suffix}`,
        email: `target-${suffix}@example.test`,
        name: 'Destino Transferencia',
        password: 'hashed-target',
        role: 'USER',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('tenant_admin_assignments').insertMany([
      {
        _id: primaryAssignmentId,
        tenantId,
        userId: primaryUserId,
        accountAddress: primaryWallet,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: targetAssignmentId,
        tenantId,
        userId: targetUserId,
        accountAddress: targetWallet,
        institutionalRole: 'SECONDARY',
        status: 'APPROVED',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('institutional_admin_applications').insertOne({
      _id: applicationId,
      dni: `target-${suffix}`,
      email: `target-${suffix}@example.test`,
      passwordHash: 'institutional-primary-transfer',
      name: 'Destino Transferencia',
      institutionName: `Institucion Transfer ${suffix}`,
      institutionNameNorm: `institucion transfer ${suffix}`,
      accountAddress: targetWallet,
      status: 'PENDING_MOBILE_AUTHORIZATION',
      stableInstitutionId: `stable-transfer-${String(tenantId)}`,
      tenantId,
      userId: targetUserId,
      targetAssignmentId,
      approvedBy: primaryUserId,
      initiatedByAssignmentId: primaryAssignmentId,
      initiatedByWallet: primaryWallet,
      approvedAt: new Date(),
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      mobileAuthorizationRequestedAt: new Date(),
      mobileAuthorizationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    currentReviewer = {
      sub: String(primaryUserId),
      role: 'USER',
      smartAccountAddress: primaryWallet,
    };
    return {
      tenantId,
      primaryUserId,
      targetUserId,
      primaryAssignmentId,
      targetAssignmentId,
      applicationId,
      primaryWallet,
      targetWallet,
      stableInstitutionId: `stable-transfer-${String(tenantId)}`,
    };
  }

  async function submitPrimaryTransferForConfirmation(suffix: string) {
    const transfer = await createPendingPrimaryTransferAuthorization(suffix);
    const deviceId = `qa-phone-transfer-${suffix}`;
    const userOpHash = `0x${'8'.repeat(64)}`;
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/submission`)
      .send({ deviceId, userOpHash })
      .expect(200);
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: transfer.primaryWallet,
      action: 'CHANGE_INSTITUTION_ADMIN',
    });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(transfer.targetWallet);
    await applicationsService.reconcileMobileAuthorizationOperation(String(transfer.applicationId));
    return transfer;
  }

  async function createPendingMobileAuthorization(
    suffix = 'mobile-sign',
    primaryWallet = validAccountAddress,
    targetWallet = '0x0000000000000000000000000000000000000f01',
  ) {
    mobileAuthorizationSequence += 1;
    const safeSuffix = suffix.replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
    const primarySuffix = `${safeSuffix}${mobileAuthorizationSequence}p`;
    const targetSuffix = `${safeSuffix}${mobileAuthorizationSequence}t`;
    const primary = await createVerifiedApplication(
      payloadFor(primarySuffix, `Tenant ${suffix}`, primaryWallet),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });

    const target = await createVerifiedApplication(
      payloadFor(targetSuffix, `Tenant ${suffix}`, targetWallet),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER', smartAccountAddress: primaryWallet };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${target.id}/approve`)
      .expect(201);

    const targetApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    (executeCoinbaseOp as jest.Mock).mockClear();
    (VoteContractCalls.addAuthorizedAddress as jest.Mock).mockClear();
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockClear();
    return {
      primary,
      target,
      primaryApplication,
      targetApplication,
      stableInstitutionId: String(primaryApplication?.tenantId),
      primaryWallet,
      targetWallet,
    };
  }

  function mobileAuthorizationClientIp(applicationId: string) {
    return `2001:db8:${applicationId.slice(0, 4)}:${applicationId.slice(4, 8)}:${applicationId.slice(8, 12)}:${applicationId.slice(12, 16)}:${applicationId.slice(16, 20)}:${applicationId.slice(20, 24)}`;
  }

  function mockConfirmedMobileUserOperation(options: {
    userOpHash: string;
    signerWallet: string;
    action: 'ADD_AUTHORIZED_ADDRESS' | 'REMOVE_AUTHORIZED_ADDRESS' | 'CHANGE_INSTITUTION_ADMIN';
  }) {
    const dataByAction = {
      ADD_AUTHORIZED_ADDRESS: '0x1234',
      REMOVE_AUTHORIZED_ADDRESS: '0x5678',
      CHANGE_INSTITUTION_ADMIN: '0x9abc',
    } as const;
    const call = {
      to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
      value: 0n,
      data: dataByAction[options.action],
    };
    userOperationService.getUserOperationByHash.mockResolvedValue({
      userOperation: { sender: options.signerWallet, callData: '0xmocked-mobile-user-operation' },
    });
    userOperationService.getUserOperationReceipt.mockResolvedValue({
      userOpHash: options.userOpHash,
      sender: options.signerWallet,
      success: true,
      txHash: `0x${'b'.repeat(64)}`,
      receipt: {
        transactionHash: `0x${'b'.repeat(64)}`,
        status: '0x1',
        blockNumber: '0x1',
        logs: [],
      },
    });
    userOperationService.getBlockNumber.mockResolvedValue(2n);
    chainVerificationService.decodeSmartAccountCalls.mockReturnValue([call]);
  }

  async function confirmPendingMobileAuthorization(targetId: string, deviceId = 'qa-phone-add') {
    const clientIp = mobileAuthorizationClientIp(targetId);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${targetId}/claim`)
      .set('x-forwarded-for', clientIp)
      .send({ deviceId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${targetId}/submission`)
      .set('x-forwarded-for', clientIp)
      .send({ deviceId, userOpHash: `0x${'a'.repeat(64)}` })
      .expect(200);
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(targetId),
    });
    const primary = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    });
    mockConfirmedMobileUserOperation({
      userOpHash: `0x${'a'.repeat(64)}`,
      signerWallet: String(primary?.accountAddress ?? validAccountAddress),
      action: 'ADD_AUTHORIZED_ADDRESS',
    });
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    await applicationsService.reconcileMobileAuthorizationOperation(targetId);
  }

  async function createRemovalAuthorization(suffix: string) {
    const flow = await createPendingMobileAuthorization(`remove-${suffix}`);
    await confirmPendingMobileAuthorization(flow.target.id, `qa-phone-${suffix}-add`);
    (VoteContractCalls.addAuthorizedAddress as jest.Mock).mockClear();
    (VoteContractCalls.removeAuthorizedAddress as jest.Mock).mockClear();
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockClear();

    const targetAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: flow.primaryApplication?.tenantId,
      userId: flow.targetApplication?.userId,
      active: true,
    });
    expect(targetAssignment).toBeTruthy();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${flow.primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: `Salida ${suffix}` })
      .expect(201);

    return { ...flow, targetAssignment, created };
  }

  async function submitRemovalAuthorization(applicationId: string, deviceId: string) {
    const clientIp = mobileAuthorizationClientIp(applicationId);
    const userOpHash = `0x${'5'.repeat(64)}`;
    const claim = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${applicationId}/claim`)
      .set('x-forwarded-for', clientIp)
      .send({ deviceId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${applicationId}/submission`)
      .set('x-forwarded-for', clientIp)
      .send({ deviceId, userOpHash })
      .expect(200);
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(applicationId),
    });
    const primary = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    });
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: String(primary?.accountAddress ?? validAccountAddress),
      action: 'REMOVE_AUTHORIZED_ADDRESS',
    });
    return claim;
  }

it('[MX-02][D-NEW-001][INTEGRACION] crea solicitud pendiente solo cuando Identity confirma wallet-DNI', async () => {
    const payload = validPayload();
    delete (payload as any).accountAddress;

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    expect(response.body.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('identity-test-key');
    expect(JSON.stringify(response.body)).not.toContain('"ok"');

    const application = await conn.collection('institutional_admin_applications').findOne({
      email: payload.email,
    });
    expect(application?.accountAddress).toBe(validAccountAddress);
    expect(application?.passwordHash).toBeTruthy();
    expect(application?.passwordHash).not.toBe(payload.password);

    const user = await conn.collection('roled_users').findOne({ email: payload.email });
    expect(user?.active).toBe(false);
    expect(user?.password).toBeTruthy();
    expect(user?.password).not.toBe(payload.password);
    expect(await conn.collection('institutional_tenants').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(0);

    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://identity.example.test/registry/resolve-account-by-dni',
      { dni: payload.dni },
      expect.objectContaining({
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );
  });

  it('[MX-02][D-NEW-005][INTEGRACION] mantiene a la primera administradora sin acceso hasta verificar su correo', async () => {
    const payload = validPayload();

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'PENDING_EMAIL_VERIFICATION',
      tenantAlreadyExists: false,
      tenantId: null,
    });
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(response.body.id),
    });
    const user = await conn.collection('roled_users').findOne({ email: payload.email });
    expect(application?.status).toBe('PENDING_EMAIL_VERIFICATION');
    expect(application?.emailVerifiedAt).toBeUndefined();
    expect(user?.active).toBe(false);
    expect(await conn.collection('institutional_tenants').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(0);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

it('registro acepta institutionId activo, resuelve nombre backend y conserva validacion wallet-DNI', async () => {
    const tenantId = new Types.ObjectId();
    const primaryUserId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Institucion Catalogada',
      nameNorm: 'institucion catalogada',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertOne({
      _id: primaryUserId,
      dni: 'primary-cat',
      email: 'primary-cat@example.com',
      name: 'Principal Catalogado',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId: primaryUserId,
      accountAddress: '0x00000000000000000000000000000000000000a1',
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const payload = {
      ...validPayload(),
      email: `catalog-${Date.now()}@example.com`,
      dni: `cat${Date.now()}`.slice(0, 20),
      institutionId: String(tenantId),
      institutionName: 'Nombre enviado por frontend que debe ignorarse',
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    expect(response.body).toMatchObject({
      tenantAlreadyExists: true,
      tenantId: String(tenantId),
    });
    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://identity.example.test/registry/resolve-account-by-dni',
      { dni: payload.dni },
      expect.objectContaining({
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(response.body.id),
    });
    expect(application).toMatchObject({
      tenantId,
      institutionName: 'Institucion Catalogada',
      institutionNameNorm: 'institucion catalogada',
      accountAddress: validAccountAddress,
    });
    expect(application?.institutionName).not.toBe(payload.institutionName);

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token: application?.verificationToken })
      .expect(201);

    currentReviewer = { sub: String(primaryUserId), role: 'USER' };
    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${response.body.id}/approve`)
      .auth('admin-token', { type: 'bearer' })
      .expect(201);
    expect(approveRes.body).toMatchObject({
      tenantId: String(tenantId),
      status: 'PENDING_MOBILE_AUTHORIZATION',
    });
  });

it('registro rechaza institutionId inexistente o inactivo antes de consultar Identity', async () => {
    const inactiveTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: inactiveTenantId,
      name: 'Institucion Inactiva',
      nameNorm: 'institucion inactiva',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        ...validPayload(),
        email: `missing-${Date.now()}@example.com`,
        institutionId: String(new Types.ObjectId()),
      })
      .expect(400);
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        ...validPayload(),
        email: `inactive-${Date.now()}@example.com`,
        institutionId: String(inactiveTenantId),
      })
      .expect(400);
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
  });

  it('D-INV-001 | crea invitación para persona registrada sin habilitar acceso ni solicitud móvil', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const invitedMobileUserId = new Types.ObjectId();
    await conn.collection('users').insertOne({
      _id: invitedMobileUserId,
      dni: 'inv001',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'inv001', name: 'Invitada Nueva' })
      .expect(201);

    expect(response.body).toMatchObject({
      dni: 'inv001',
      status: 'PENDING',
      noticeCount: 1,
      tenantId: String(tenantId),
    });
    expect(await conn.collection('institutional_admin_invitations').countDocuments()).toBe(1);
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId })).toBe(1);
    expect(await conn.collection('official_publication_notification_outbox').findOne({
      'data.type': 'INSTITUTIONAL_ADMIN_INVITATION',
      recipientMobileUserId: invitedMobileUserId,
    })).toEqual(expect.objectContaining({
      recipientTopic: `user_${invitedMobileUserId}`,
      data: expect.objectContaining({ invitationId: response.body.id }),
    }));
  });

  it('[MX-02][D3][INTEGRACION] completa ZK y registro administrativo para identidad móvil sin RoledUser', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institución D3 realista');
    const invitedMobileUserId = new Types.ObjectId();
    await conn.collection('users').insertOne({
      _id: invitedMobileUserId,
      dni: 'd3real',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'd3real', name: 'Identidad móvil D3' })
      .expect(201);
    expect(await conn.collection('roled_users').countDocuments({ dni: 'd3real' })).toBe(0);

    const authService = moduleRef.get(InstitutionalMobileZkAuthService);
    const authRequest = await authService.createInvitationAuthRequest(created.body.id);
    // The test double preserves the request contract but not the callback URL;
    // the API key is the same random session id by design.
    const sessionId = authRequest.apiKey;
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: { ok: true, record: { accountAddress: validAccountAddress } },
    });
    await authService.callback(sessionId, 'mock-zk-proof');
    const mobileContext = await authService.getContextByApiKey(authRequest.apiKey);
    expect(mobileContext).toEqual(expect.objectContaining({
      invitationId: created.body.id,
      dni: 'd3real',
      smartAccountAddress: validAccountAddress,
      purpose: 'INSTITUTIONAL_INVITATION',
    }));

    const accepted = await applicationsService.acceptInvitationFromMobile(created.body.id, {
      sub: String((mobileContext as any).did),
      dni: 'd3real',
      smartAccountAddress: validAccountAddress,
      invitationId: created.body.id,
      mobileAuthContextHash: String((mobileContext as any).apiKeyHash),
      authType: 'INSTITUTIONAL_INVITATION_MOBILE_ZK',
    });
    expect(accepted).toMatchObject({
      status: 'REQUIRES_ADMIN_ACCOUNT',
      invitationId: created.body.id,
      continuationCode: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(applicationsService.getInvitationRegistrationContext(
      created.body.id,
      accepted.continuationCode,
    )).resolves.toMatchObject({ tenant: { id: String(tenantId) } });

    const registrationPayload = {
      invitationId: created.body.id,
      registrationContinuationCode: accepted.continuationCode,
      dni: 'd3real',
      name: 'Cuenta Administrativa D3',
      email: 'd3real@example.com',
      password: 'ClaveD3Segura123',
    };
    const concurrentRegistrations = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/institutional-admin-applications')
        .send(registrationPayload),
      request(app.getHttpServer())
        .post('/api/v1/institutional-admin-applications')
        .send(registrationPayload),
    ]);
    expect(concurrentRegistrations.filter((result) => result.status === 201)).toHaveLength(1);
    expect(concurrentRegistrations.filter((result) => result.status === 409)).toHaveLength(1);
    const registered = concurrentRegistrations.find((result) => result.status === 201)!;
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(registered.body.id),
    });
    expect(application).toMatchObject({
      invitationId: new Types.ObjectId(created.body.id),
      tenantId,
      status: 'PENDING_EMAIL_VERIFICATION',
    });
    expect(await conn.collection('roled_users').findOne({ dni: 'd3real' })).toEqual(
      expect.objectContaining({ email: 'd3real@example.com' }),
    );
    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(registrationPayload)
      .expect(201);
    expect(registered.body).toEqual(expect.objectContaining({
      id: registered.body.id,
      status: 'PENDING_EMAIL_VERIFICATION',
    }));
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      invitationId: new Types.ObjectId(created.body.id),
    })).toBe(1);

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token: application?.verificationToken })
      .expect(201);
    await expect(conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(registered.body.id),
    })).resolves.toMatchObject({ status: 'PENDING_APPROVAL' });
  });

  it('D-INV-002 / D-INV-012 | reutiliza cuenta existente al aceptar y no duplica usuario', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Cuenta Existente');
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'inv002',
      email: 'existente@example.com',
      name: 'Cuenta Existente',
      password: 'hashed',
      role: 'USER',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'inv002', name: 'Cuenta Existente' })
      .expect(201);
    const invitation = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    });

    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/accept`)
      .send({
        token: invitation?.invitationToken,
        email: 'existente@example.com',
      })
      .expect(201);

    expect(accepted.body.applicationStatus).toBe('PENDING_APPROVAL');
    expect(await conn.collection('roled_users').countDocuments({ dni: 'inv002' })).toBe(1);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'inv002',
      status: 'PENDING_APPROVAL',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId })).toBe(1);
  });

  it('D-INV-003 | rechaza invitación si Identity indica persona no registrada', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const notificationLogsBefore = await conn.collection('notification_logs').countDocuments();
    const invitationOutboxesBefore = await conn
      .collection('official_publication_notification_outbox')
      .countDocuments({ type: 'INSTITUTIONAL_ADMIN_INVITATION' });
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { records: [] } });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'noexiste1', name: 'No Existe' })
      .expect(400);

    expect(await conn.collection('institutional_admin_invitations').countDocuments()).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments()).toBe(notificationLogsBefore);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.type': 'INSTITUTIONAL_ADMIN_INVITATION',
    })).toBe(0);
    expect(await conn.collection('official_publication_notification_outbox').countDocuments({
      type: 'INSTITUTIONAL_ADMIN_INVITATION',
    })).toBe(invitationOutboxesBefore);
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(1);
  });

  it('D-INV-004 | bloquea invitación si la persona ya administra la institución', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const existingUserId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: existingUserId,
      dni: 'yaadmin',
      email: 'yaadmin@example.com',
      name: 'Ya Admin',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId: existingUserId,
      accountAddress: validAccountAddress,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'yaadmin', name: 'Ya Admin' })
      .expect(409);

    expect(await conn.collection('institutional_admin_invitations').countDocuments()).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments()).toBe(0);
  });

  it('D-INV-005 | bloquea invitación vigente duplicada sin reenviar aviso', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'dup-inv', name: 'Duplicada' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'dup-inv', name: 'Duplicada' })
      .expect(409);

    expect(await conn.collection('institutional_admin_invitations').countDocuments({
      tenantId,
      dni: 'dup-inv',
    })).toBe(1);
    expect(await conn.collection('official_publication_notification_outbox').countDocuments({
      type: 'INSTITUTIONAL_ADMIN_INVITATION',
    })).toBe(0);
  });

  it('D-INV-006 | aceptar invitación crea solicitud pendiente sin acceso activo', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Aceptada');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'aceptar1', name: 'Persona Acepta' })
      .expect(201);
    const invitation = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/accept`)
      .send({
        token: invitation?.invitationToken,
        email: 'aceptar1@example.com',
        password: 'secret123',
        name: 'Persona Acepta',
      })
      .expect(201);

    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    })).toEqual(expect.objectContaining({ status: 'ACCEPTED' }));
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'aceptar1',
      status: 'PENDING_APPROVAL',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId })).toBe(1);
  });

  it('D-INV-007 | rechazar invitación invalida token y no crea solicitud', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'rechaza1', name: 'Persona Rechaza' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/reject`)
      .send({ reason: 'No acepta' })
      .expect(401);

    const authService = moduleRef.get(InstitutionalMobileZkAuthService);
    const authRequest = await authService.createInvitationAuthRequest(created.body.id);
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: { ok: true, record: { accountAddress: validAccountAddress } },
    });
    await authService.callback(authRequest.apiKey, 'mock-zk-proof');
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/invitations/${created.body.id}/reject`)
      .set('x-api-key', authRequest.apiKey)
      .expect(200);

    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    })).toEqual(expect.objectContaining({
      status: 'REJECTED',
      reason: 'Rechazada desde el teléfono',
    }));
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(0);
  });

  it('D-INV-008 | invitación vencida no puede aceptarse y conserva historial', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'vence1', name: 'Persona Vence' })
      .expect(201);
    const before = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    });
    await conn.collection('institutional_admin_invitations').updateOne(
      { _id: new Types.ObjectId(created.body.id) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/accept`)
      .send({
        token: before?.invitationToken,
        email: 'vence1@example.com',
        password: 'secret123',
      })
      .expect(400);

    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    })).toEqual(expect.objectContaining({ status: 'EXPIRED' }));
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(0);
  });

  it('D-INV-009 / D-INV-010 | cancela y reenvía sin crear invitaciones duplicadas', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Reenvio');
    const resend = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'reenvio1', name: 'Persona Reenvio' })
      .expect(201);
    const original = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(resend.body.id),
    });

    const resent = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${resend.body.id}/resend`)
      .expect(201);
    expect(resent.body.noticeCount).toBe(2);
    const afterResend = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(resend.body.id),
    });
    expect(afterResend?.invitationToken).toBe(original?.invitationToken);
    expect(afterResend?.expiresAt?.toISOString()).toBe(original?.expiresAt?.toISOString());
    expect(await conn.collection('institutional_admin_invitations').countDocuments({
      tenantId,
      dni: 'reenvio1',
    })).toBe(1);

    const cancel = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'cancel1', name: 'Persona Cancelada' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${cancel.body.id}/cancel`)
      .send({ reason: 'Se corrigió destinatario' })
      .expect(201);
    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(cancel.body.id),
    })).toEqual(expect.objectContaining({
      status: 'CANCELLED',
      reason: 'Se corrigió destinatario',
    }));
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(0);
  });

  it('D-INV-011 | aceptar con correo ocupado conserva invitación y no crea relación', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Correo Ocupado');
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'otro-dni',
      email: 'ocupado@example.com',
      name: 'Correo Ocupado',
      password: 'hashed',
      role: 'USER',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'inv011', name: 'Invitada Conflicto' })
      .expect(201);
    const invitation = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/accept`)
      .send({
        token: invitation?.invitationToken,
        email: 'ocupado@example.com',
        password: 'secret123',
      })
      .expect(409);

    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    })).toEqual(expect.objectContaining({ status: 'PENDING' }));
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId })).toBe(1);
  });

  it('D-INV-001 / D-INV-008 / D-INV-009 / D-INV-010 | lista invitaciones reales para Cuenta institucional', async () => {
    const { tenantId, primaryUserId } = await createActiveTenantWithPrimary('Institucion Lista Invitaciones');

    const pending = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'lista-pendiente', name: 'Pendiente Visible' })
      .expect(201);
    const originalPending = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(pending.body.id),
    });
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${pending.body.id}/resend`)
      .expect(201);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'lista-cancelada', name: 'Cancelada Visible' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${cancelled.body.id}/cancel`)
      .send({ reason: 'Cambio de persona invitada' })
      .expect(201);

    const expiredId = new Types.ObjectId();
    await conn.collection('institutional_admin_invitations').insertOne({
      _id: expiredId,
      tenantId,
      invitedBy: primaryUserId,
      dni: 'lista-vencida',
      name: 'Vencida Visible',
      accountAddress: '0x00000000000000000000000000000000000000a7',
      status: 'PENDING',
      invitationToken: `expired-${String(expiredId)}`,
      expiresAt: new Date(Date.now() - 1000),
      noticeCount: 1,
      lastNoticeAt: new Date(Date.now() - 1000 * 60),
      createdAt: new Date(Date.now() - 1000 * 60 * 60),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60),
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: pending.body.id,
          dni: 'lista-pendiente',
          status: 'PENDING',
          noticeCount: 2,
          expiresAt: originalPending?.expiresAt?.toISOString(),
        }),
        expect.objectContaining({
          id: cancelled.body.id,
          dni: 'lista-cancelada',
          status: 'CANCELLED',
          reason: 'Cambio de persona invitada',
        }),
        expect.objectContaining({
          id: String(expiredId),
          dni: 'lista-vencida',
          status: 'EXPIRED',
        }),
      ]),
    );
    expect(await conn.collection('institutional_admin_invitations').countDocuments({
      tenantId,
      dni: 'lista-pendiente',
    })).toBe(1);
    expect(await conn.collection('institutional_admin_invitations').countDocuments({
      tenantId,
      dni: 'lista-vencida',
      status: 'EXPIRED',
    })).toBe(1);
  });

it('[MX-02][D-NEW-004][INTEGRACION] rechaza correo duplicado antes de consultar Identity', async () => {
    const payload = validPayload();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    httpService.axiosRef.post.mockClear();
    httpService.axiosRef.get.mockClear();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(409);

    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(await countApplications()).toBe(1);
  });

  it('D-REQ-001 / D-REQ-002 | crea una solicitud de acceso vigente y bloquea duplicados', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Solicitud Acceso');
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'req001',
      email: 'req001@example.com',
      name: 'Solicitante Valida',
      password: 'hashed',
      role: 'USER',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: 'req001',
        email: 'req001@example.com',
        name: 'Solicitante Valida',
        institutionId: String(tenantId),
      })
      .expect(201);

    expect(first.body).toMatchObject({
      status: 'PENDING_APPROVAL',
      tenantAlreadyExists: true,
      tenantId: String(tenantId),
    });
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'req001',
      status: 'PENDING_APPROVAL',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId,
      active: false,
    })).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
    })).toBe(0);

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: 'req001',
        email: 'req001@example.com',
        name: 'Solicitante Valida',
        institutionId: String(tenantId),
      })
      .expect(409);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'req001',
    })).toBe(1);
  });

  it('D-REQ-003 | bloquea solicitud cuando la persona ya administra la institución', async () => {
    const { tenantId } = await createActiveTenantWithPrimary('Institucion Ya Admin');
    const userId = new Types.ObjectId();
    const notificationLogsBefore = await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.targetUserId': String(userId),
    });
    await conn.collection('roled_users').insertOne({
      _id: userId,
      dni: 'req003',
      email: 'req003@example.com',
      name: 'Administradora Existente',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId,
      accountAddress: validAccountAddress,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: 'req003',
        email: 'req003@example.com',
        name: 'Administradora Existente',
        institutionId: String(tenantId),
      })
      .expect(409);

    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'req003',
    })).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.targetUserId': String(userId),
    })).toBe(notificationLogsBefore);
  });

  it('D-REQ-004 / D-REQ-005 / D-REQ-009 | rechazo conserva historial y permite nueva solicitud', async () => {
    const { tenantId, primaryUserId } = await createActiveTenantWithPrimary('Institucion Rechazo Acceso');
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'req004',
      email: 'req004@example.com',
      name: 'Solicitante Rechazada',
      password: 'hashed',
      role: 'USER',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const first = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: 'req004',
        email: 'req004@example.com',
        name: 'Solicitante Rechazada',
        institutionId: String(tenantId),
      })
      .expect(201);

    currentReviewer = { sub: String(primaryUserId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${first.body.id}/reject`)
      .send({ reason: 'No cumple requisitos' })
      .expect(201);

    const rejected = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(first.body.id),
    });
    expect(rejected).toEqual(expect.objectContaining({
      status: 'REJECTED',
      reason: 'No cumple requisitos',
    }));

    const second = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: 'req004',
        email: 'req004@example.com',
        name: 'Solicitante Rechazada',
        institutionId: String(tenantId),
      })
      .expect(201);

    expect(second.body.id).not.toBe(first.body.id);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId,
      dni: 'req004',
    })).toBe(2);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
    })).toBe(0);
  });

it('rechaza wallet manual con formato invalido sin consultar Identity ni persistir', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({ ...validPayload(), accountAddress: '0x123' })
      .expect(400);

    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

it('[MX-02][D-NEW-002][INTEGRACION] rechaza persona no registrada sin persistencia ni efectos externos', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { records: [] } });

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(400);

    expect(response.body.message).toBe('La persona debe registrarse primero en Tu Voto Decide.');
    expect(response.body.code).toBe('IDENTITY_PERSON_NOT_REGISTERED');
    expect(JSON.stringify(response.body)).not.toContain('did');
    expect(JSON.stringify(response.body)).not.toContain('discoverableHash');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('[MX-02][D-NEW-003][INTEGRACION] rechaza persona registrada sin billetera sin guardar billetera vacia', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { records: [{ dni: '12345678' }] } });

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(400);

    expect(response.body.message).toBe(
      'La persona debe crear o registrar primero su billetera en Tu Voto Decide.',
    );
    expect(response.body.code).toBe('IDENTITY_WALLET_NOT_FOUND');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('rechaza wallet manual distinta a la resuelta por Identity sin persistir', async () => {
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: {
        registered: true,
        accountAddress: '0x00000000000000000000000000000000000000a1',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(400);

    expect(response.body.message).toBe('La billetera enviada no corresponde al CI o DNI informado.');
    expect(response.body.code).toBe('IDENTITY_WALLET_MISMATCH');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

  it('rechaza temporalmente cuando Identity no esta disponible sin persistir', async () => {
    httpService.axiosRef.post.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(503);

    expect(response.body.message).toBe('No se pudo verificar la billetera en este momento');
    expect(JSON.stringify(response.body)).not.toContain('identity-test-key');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

  it('[MX-02][D-NEW-006][INTEGRACION] aprobar inicia el procesamiento y mantiene el acceso inactivo hasta confirmación', async () => {
    const { id, payload } = await createVerifiedApplication();

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);
    expect(approveRes.body).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      chainStatus: 'SENT',
      functionalStatus: 'PROCESSING_AUTHORIZATION',
      functionalStatusLabel: 'Procesando autorización',
    });

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });

    expect(application?.status).toBe('PENDING_CHAIN_CONFIRMATION');
    expect(application?.stableInstitutionId).toBe(String(application?.tenantId));
    expect(application?.chainStatus).toBe('SENT');
    expect(await conn.collection('institutional_tenants').findOne({ _id: application?.tenantId }))
      .toEqual(expect.objectContaining({ active: false }));
    expect(assignment).toEqual(
      expect.objectContaining({
        tenantId: application?.tenantId,
        userId: application?.userId,
        accountAddress: payload.accountAddress,
        status: 'PENDING',
        active: false,
        institutionalRole: 'PRIMARY',
      }),
    );
    expect(executeCoinbaseOp).toHaveBeenCalledTimes(1);
  });

  it('[MX-02][D-STATE-001][INTEGRACION] / [MX-02][D-STATE-002][INTEGRACION] / [MX-02][D-STATE-003][INTEGRACION] / [MX-02][D-STATE-004][INTEGRACION] / [MX-02][D-STATE-005][INTEGRACION] expone estados funcionales autoritativos para solicitudes institucionales', async () => {
    const now = new Date();
    const rows = [
      ['state-review', 'PENDING_APPROVAL', null, 'PENDING_REVIEW', 'Pendiente de revisión'],
      ['state-mobile', 'PENDING_MOBILE_AUTHORIZATION', null, 'PENDING_MOBILE_SIGNATURE', 'Pendiente de firma en tu teléfono'],
      ['state-processing', 'PENDING_CHAIN_CONFIRMATION', 'SENT', 'PROCESSING_AUTHORIZATION', 'Procesando autorización'],
      ['state-retry', 'CHAIN_RETRY_PENDING', 'RETRY_PENDING', 'RECOVERABLE_ERROR', 'Error recuperable'],
      ['state-approved', 'APPROVED', 'CONFIRMED', 'ACCESS_ENABLED', 'Acceso habilitado'],
      ['state-rejected', 'REJECTED', null, 'REJECTED', 'Rechazado'],
      ['state-expired', 'MOBILE_AUTHORIZATION_EXPIRED', null, 'EXPIRED', 'Vencido'],
      ['state-revoked', 'REVOKED', 'CONFIRMED', 'ACCESS_REMOVED', 'Acceso eliminado'],
    ] as const;

    await conn.collection('institutional_admin_applications').insertMany(
      rows.map(([dni, status, chainStatus]) => ({
        _id: new Types.ObjectId(),
        dni,
        email: `${dni}@example.com`,
        passwordHash: 'hash',
        name: `Solicitud ${dni}`,
        institutionName: `Tenant ${dni}`,
        institutionNameNorm: `tenant ${dni}`,
        accountAddress: validAccountAddress,
        status,
        chainStatus,
        createdAt: now,
        updatedAt: now,
      })),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/institutional-admin-applications')
      .expect(200);

    for (const [dni, , , functionalStatus, functionalStatusLabel] of rows) {
      expect(response.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dni,
            functionalStatus,
            functionalStatusLabel,
          }),
        ]),
      );
    }
    expect(response.body.data.find((row: any) => row.dni === 'state-processing')).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      functionalStatusLabel: 'Procesando autorización',
    });
  });

  it('[MX-02][D-NEW-007][INTEGRACION] rechazar conserva historial y no crea institución, relación ni operación', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('reject-new', 'Institucion Rechazada', validAccountAddress),
    );

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/reject`)
      .send({ reason: 'Datos insuficientes' })
      .expect(201);

    expect(rejectRes.body).toMatchObject({
      id,
      status: 'REJECTED',
      reason: 'Datos insuficientes',
    });
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    expect(application).toEqual(
      expect.objectContaining({
        status: 'REJECTED',
        reason: 'Datos insuficientes',
      }),
    );
    expect(application?.tenantId).toBeUndefined();
    expect(await conn.collection('institutional_tenants').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(0);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-NEW-008][INTEGRACION] una nueva solicitud tras rechazo obtiene otro ID y no reabre la anterior', async () => {
    const payload = payloadFor('new-after-reject', 'Institucion Reintento', validAccountAddress);
    const first = await createVerifiedApplication(payload);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${first.id}/reject`)
      .send({ reason: 'Revisión funcional' })
      .expect(201);

    const secondRes = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    expect(secondRes.body.id).not.toBe(first.id);
    const firstApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(first.id),
    });
    const secondApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(secondRes.body.id),
    });

    expect(firstApplication?.status).toBe('REJECTED');
    expect(secondApplication?.status).toBe('PENDING_APPROVAL');
    expect(secondApplication?.verificationToken).toBeUndefined();
    expect(await conn.collection('institutional_tenants').countDocuments()).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(0);
  });

  it('[MX-02][D-NEW-009][INTEGRACION] la aprobación usa el ID estable de institución y no el ID de solicitud', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('stable-id', 'Institucion ID Estable', validAccountAddress),
    );

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    expect(approveRes.body.stableInstitutionId).toBe(String(application?.tenantId));
    expect(application?.stableInstitutionId).toBe(String(application?.tenantId));
    expect(application?.stableInstitutionId).not.toBe(id);

    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValueOnce(
      institutionNotFoundError(),
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValueOnce(false);
    await applicationsService.processInstitutionCreationOperation(id);

    expect(VoteContractCalls.createInstitution).toHaveBeenCalledWith(
      expect.any(String),
      String(application?.tenantId),
      validAccountAddress,
    );
    expect(VoteContractCalls.createInstitution).not.toHaveBeenCalledWith(
      expect.any(String),
      id,
      validAccountAddress,
    );
  });

  it('[MX-02][D-NEW-010][INTEGRACION] el procesamiento enviado conserva institución y relación inactivas', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('chain-pending', 'Institucion Pendiente Red', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const tenant = await conn.collection('institutional_tenants').findOne({
      _id: application?.tenantId,
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });
    expect(application).toEqual(
      expect.objectContaining({
        status: 'PENDING_CHAIN_CONFIRMATION',
        chainStatus: 'SENT',
        chainTxHash: '0xabc123',
        chainAttempts: 1,
      }),
    );
    expect(executeCoinbaseOp).toHaveBeenCalledTimes(1);
    expect(tenant?.active).toBe(false);
    expect(assignment).toEqual(expect.objectContaining({ status: 'PENDING', active: false }));
  });

  it('[MX-02][D-NEW-011][INTEGRACION] un error recuperable conserva la operación y agenda reintento sin activar acceso', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('chain-timeout', 'Institucion Timeout Red', validAccountAddress),
    );
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValueOnce(
      institutionNotFoundError(),
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValueOnce(false);
    (executeCoinbaseOp as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('network timeout'), { code: 'ETIMEDOUT' }),
    );

    const approve = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

    expect(approve.body).toMatchObject({
      status: 'CHAIN_RETRY_PENDING',
      chainStatus: 'RETRY_PENDING',
      functionalStatus: 'RECOVERABLE_ERROR',
    });
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const tenant = await conn.collection('institutional_tenants').findOne({
      _id: application?.tenantId,
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });
    expect(application).toEqual(
      expect.objectContaining({
        status: 'CHAIN_RETRY_PENDING',
        chainStatus: 'RETRY_PENDING',
        chainAttempts: 1,
      }),
    );
    expect(application?.chainNextRetryAt).toBeInstanceOf(Date);
    expect(application?.chainLastError).toBe(
      'No pudimos completar la creación en la red. El sistema volverá a intentar.',
    );
    expect(tenant?.active).toBe(false);
    expect(assignment).toEqual(expect.objectContaining({ status: 'PENDING', active: false }));
    expect(await conn.collection('institutional_admin_applications').countDocuments()).toBe(1);
  });

  it('[MX-02][D-NEW-012][INTEGRACION] la confirmación de red activa una sola institución y una relación principal', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('chain-confirmed', 'Institucion Confirmada Red', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValueOnce(
      institutionNotFoundError(),
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValueOnce(false);
    await applicationsService.processInstitutionCreationOperation(id);
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(validAccountAddress);

    await applicationsService.reconcileInstitutionCreationOperation(id);
    await applicationsService.reconcileInstitutionCreationOperation(id);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const tenant = await conn.collection('institutional_tenants').findOne({
      _id: application?.tenantId,
    });
    const assignments = await conn.collection('tenant_admin_assignments').find({
      tenantId: application?.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
    }).toArray();
    expect(application).toEqual(
      expect.objectContaining({
        status: 'APPROVED',
        chainStatus: 'CONFIRMED',
        chainTxHash: '0xabc123',
      }),
    );
    expect(tenant?.active).toBe(true);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toEqual(
      expect.objectContaining({
        userId: application?.userId,
        status: 'APPROVED',
        active: true,
      }),
    );
    expect(executeCoinbaseOp).toHaveBeenCalledTimes(1);
  });

  it('[MX-02][D-NEW-013][INTEGRACION] si la red ya confirmó y el estado local quedó incompleto, reconcilia sin reenviar', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('chain-local-fail', 'Institucion Reconciliada', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);
    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          status: 'PENDING_CHAIN_CONFIRMATION',
          chainStatus: 'SENT',
          chainTxHash: '0xdeadbeef',
        },
      },
    );
    (executeCoinbaseOp as jest.Mock).mockClear();
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(validAccountAddress);

    const processed = await applicationsService.processInstitutionCreationOperation(id);

    expect(processed).toMatchObject({
      processed: true,
      status: 'CONFIRMED',
      reusedNetworkState: true,
    });
    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const tenant = await conn.collection('institutional_tenants').findOne({
      _id: application?.tenantId,
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });
    expect(application?.status).toBe('APPROVED');
    expect(application?.chainStatus).toBe('CONFIRMED');
    expect(tenant?.active).toBe(true);
    expect(assignment).toEqual(expect.objectContaining({ status: 'APPROVED', active: true }));
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-NEW-014][INTEGRACION] dos aprobaciones y dos workers concurrentes dejan una sola operación efectiva', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('double-approve', 'Institucion Concurrencia', validAccountAddress),
    );
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValue(
      institutionNotFoundError(),
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);

    const approvals = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/institutional-admin-applications/${id}/approve`),
      request(app.getHttpServer())
        .post(`/api/v1/institutional-admin-applications/${id}/approve`),
    ]);

    const acceptedApprovalStatuses = approvals.map((result) =>
      result.status === 'fulfilled' ? result.value.status : 500,
    );
    expect(acceptedApprovalStatuses.every((status) => [201, 400, 409].includes(status))).toBe(true);

    const applicationAfterApproval = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    expect(applicationAfterApproval?.status).toBe('PENDING_CHAIN_CONFIRMATION');
    expect(await conn.collection('institutional_tenants').countDocuments({
      nameNorm: 'institucion concurrencia',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: applicationAfterApproval?.tenantId,
      userId: applicationAfterApproval?.userId,
    })).toBe(1);

    const applicationAfterWorkers = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    expect(applicationAfterWorkers?.chainAttempts).toBe(1);
    expect(applicationAfterWorkers?.chainStatus).toBe('SENT');
    expect(executeCoinbaseOp).toHaveBeenCalledTimes(1);
  });

  it('[MX-02][D-NEW-015][INTEGRACION] el backfill histórico ejecutado dos veces asigna ID estable sin duplicar operaciones', async () => {
    const pendingTenantId = new Types.ObjectId();
    const confirmedTenantId = new Types.ObjectId();
    const pendingUserId = new Types.ObjectId();
    const confirmedUserId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertMany([
      {
        _id: pendingTenantId,
        name: 'Institucion Historica Pendiente',
        nameNorm: 'institucion historica pendiente',
        active: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date(),
      },
      {
        _id: confirmedTenantId,
        name: 'Institucion Historica Confirmada',
        nameNorm: 'institucion historica confirmada',
        active: false,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('tenant_admin_assignments').insertMany([
      {
        tenantId: pendingTenantId,
        userId: pendingUserId,
        accountAddress: '0x0000000000000000000000000000000000000a15',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        tenantId: confirmedTenantId,
        userId: confirmedUserId,
        accountAddress: '0x0000000000000000000000000000000000000b15',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: false,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    (VoteContractReads.getInstitutionAdmin as jest.Mock)
      .mockRejectedValueOnce(institutionNotFoundError())
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000b15')
      .mockRejectedValue(institutionNotFoundError());
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);

    const firstRun = await applicationsService.backfillHistoricalInstitutionStableIds();
    const secondRun = await applicationsService.backfillHistoricalInstitutionStableIds();

    expect(firstRun).toMatchObject({
      updatedTenants: 2,
      createdOperations: 1,
      reconciled: 1,
    });
    expect(secondRun).toMatchObject({
      updatedTenants: 0,
      createdOperations: 0,
      reconciled: 0,
    });
    expect(await conn.collection('institutional_tenants').findOne({ _id: pendingTenantId }))
      .toEqual(expect.objectContaining({ stableInstitutionId: String(pendingTenantId) }));
    expect(await conn.collection('institutional_tenants').findOne({ _id: confirmedTenantId }))
      .toEqual(expect.objectContaining({ stableInstitutionId: String(confirmedTenantId), active: true }));
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: pendingTenantId,
      stableInstitutionId: String(pendingTenantId),
      chainStatus: 'PENDING_SEND',
    })).toBe(1);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: confirmedTenantId,
    })).toBe(0);
  });

  async function runHistoricalCompatibilityBackfill() {
    const pendingTenantId = new Types.ObjectId();
    const confirmedTenantId = new Types.ObjectId();
    const pendingUserId = new Types.ObjectId();
    const confirmedUserId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertMany([
      {
        _id: pendingTenantId,
        name: 'Compat Pendiente',
        nameNorm: 'compat pendiente',
        active: true,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date(),
      },
      {
        _id: confirmedTenantId,
        name: 'Compat Confirmada',
        nameNorm: 'compat confirmada',
        active: false,
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('roled_users').insertMany([
      {
        _id: pendingUserId,
        dni: 'compat-001',
        email: 'compat-pending@example.test',
        name: 'Admin Compat Pendiente',
        active: true,
        password: 'hash',
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: confirmedUserId,
        dni: 'compat-002',
        email: 'compat-confirmed@example.test',
        name: 'Admin Compat Confirmada',
        active: true,
        password: 'hash',
        role: 'USER',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('tenant_admin_assignments').insertMany([
      {
        tenantId: pendingTenantId,
        userId: pendingUserId,
        accountAddress: '0x0000000000000000000000000000000000000c01',
        accountAddressNormalized: '0x0000000000000000000000000000000000000c01',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        tenantId: confirmedTenantId,
        userId: confirmedUserId,
        accountAddress: '0x0000000000000000000000000000000000000c02',
        accountAddressNormalized: '0x0000000000000000000000000000000000000c02',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: false,
        approvedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    (VoteContractReads.getInstitutionAdmin as jest.Mock)
      .mockRejectedValueOnce(institutionNotFoundError())
      .mockResolvedValueOnce('0x0000000000000000000000000000000000000c02')
      .mockRejectedValue(institutionNotFoundError());
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);

    const first = await applicationsService.backfillHistoricalInstitutionStableIds();
    const second = await applicationsService.backfillHistoricalInstitutionStableIds();

    expect(first).toMatchObject({ updatedTenants: 2, createdOperations: 1, reconciled: 1 });
    expect(second).toMatchObject({ updatedTenants: 0, createdOperations: 0, reconciled: 0 });
    expect(await conn.collection('institutional_tenants').findOne({ _id: pendingTenantId }))
      .toEqual(expect.objectContaining({
        stableInstitutionId: String(pendingTenantId),
        active: false,
      }));
    expect(await conn.collection('institutional_tenants').findOne({ _id: confirmedTenantId }))
      .toEqual(expect.objectContaining({
        stableInstitutionId: String(confirmedTenantId),
        active: true,
      }));
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: pendingTenantId,
      stableInstitutionId: String(pendingTenantId),
      chainStatus: 'PENDING_SEND',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: pendingTenantId,
      institutionalRole: 'PRIMARY',
    })).toBe(1);
    return { pendingTenantId, confirmedTenantId, first, second };
  }

  it('[MX-02][D-COMPAT-001][INTEGRACION] regulariza institución histórica sin ID estable', async () => {
    const { pendingTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('institutional_tenants').findOne({ _id: pendingTenantId }))
      .resolves.toMatchObject({ stableInstitutionId: String(pendingTenantId), active: false });
  });

  it('D-INV-013 | reenviar conserva la invitación y crea una nueva generación de entrega', async () => {
    const { tenantId } = await createActiveTenantWithPrimary();
    const invitedUserId = new Types.ObjectId();
    const invitedMobileUserId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: invitedUserId, dni: 'retry-inv', email: 'retry-inv@example.com', name: 'Retry',
      password: 'hashed', role: 'USER', active: false, createdAt: new Date(), updatedAt: new Date(),
    });
    await conn.collection('users').insertOne({
      _id: invitedMobileUserId, dni: 'retry-inv', active: true, createdAt: new Date(), updatedAt: new Date(),
    });
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'retry-inv', name: 'Retry' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${created.body.id}/resend`)
      .expect(201);

    expect(await conn.collection('institutional_admin_invitations').countDocuments({ tenantId, dni: 'retry-inv' })).toBe(1);
    const outboxes = await conn.collection('official_publication_notification_outbox').find({
      'data.invitationId': created.body.id,
    }).sort({ deliveryAttempt: 1 }).toArray();
    expect(outboxes).toHaveLength(2);
    expect(outboxes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        invitationId: new Types.ObjectId(created.body.id),
        tenantId,
        recipientMobileUserId: invitedMobileUserId,
        deliveryAttempt: 1,
      }),
      expect.objectContaining({
        invitationId: new Types.ObjectId(created.body.id),
        tenantId,
        recipientMobileUserId: invitedMobileUserId,
        deliveryAttempt: 2,
      }),
    ]));
  });

  it('[MX-02][D-COMPAT-002][INTEGRACION] conserva compatibilidad de institución histórica confirmada', async () => {
    const { confirmedTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('institutional_tenants').findOne({ _id: confirmedTenantId }))
      .resolves.toMatchObject({ stableInstitutionId: String(confirmedTenantId), active: true });
  });

  it('[MX-02][D-COMPAT-003][INTEGRACION] reconcilia estado local desde la lectura on-chain mockeada', async () => {
    const { first } = await runHistoricalCompatibilityBackfill();
    expect(first.reconciled).toBe(1);
  });

  it('[MX-02][D-COMPAT-004][INTEGRACION] mantiene restringida la institución pendiente de red', async () => {
    const { pendingTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('institutional_tenants').findOne({ _id: pendingTenantId }))
      .resolves.toMatchObject({ active: false });
  });

  it('[MX-02][D-COMPAT-005][INTEGRACION] crea una sola operación para el histórico pendiente', async () => {
    const { pendingTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('institutional_admin_applications').countDocuments({ tenantId: pendingTenantId }))
      .resolves.toBe(1);
  });

  it('[MX-02][D-COMPAT-006][INTEGRACION] ejecuta el backfill repetido sin operaciones duplicadas', async () => {
    const { second } = await runHistoricalCompatibilityBackfill();
    expect(second).toMatchObject({ updatedTenants: 0, createdOperations: 0, reconciled: 0 });
  });

  it('[MX-02][D-COMPAT-007][INTEGRACION] conserva la relación histórica durante la regularización', async () => {
    const { pendingTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('tenant_admin_assignments').countDocuments({ tenantId: pendingTenantId }))
      .resolves.toBe(1);
  });

  it('[MX-02][D-COMPAT-008][INTEGRACION] no concede acceso antes de que la red confirme', async () => {
    const { pendingTenantId } = await runHistoricalCompatibilityBackfill();
    await expect(conn.collection('institutional_tenants').findOne({ _id: pendingTenantId }))
      .resolves.toMatchObject({ active: false });
  });

  it('permite a ACCESS_APPROVER crear el primer PRIMARY actual', async () => {
    currentReviewer = {
      sub: String(new Types.ObjectId('64f0000000000000000000a1')),
      role: 'ACCESS_APPROVER',
    };
    const { id } = await createVerifiedApplication(
      payloadFor('access-approver-primary', 'Tenant Access Approver', validAccountAddress),
    );

    await approveAndConfirmApplication(id);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });

    expect(assignment).toEqual(
      expect.objectContaining({
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }),
    );
  });

  it('el indice unico impide dos PRIMARY activos para el mismo tenant', async () => {
    const { id } = await createVerifiedApplication(
      payloadFor('unique-primary', 'Tenant Primary Unico', validAccountAddress),
    );
    await approveAndConfirmApplication(id);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });

    await expect(
      conn.collection('tenant_admin_assignments').insertOne({
        tenantId: application?.tenantId,
        userId: new Types.ObjectId(),
        accountAddress: '0x00000000000000000000000000000000000000aa',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });

    expect(
      await conn.collection('tenant_admin_assignments').countDocuments({
        tenantId: application?.tenantId,
        institutionalRole: 'PRIMARY',
        active: true,
      }),
    ).toBe(1);
  });

  it('D-REQ-008 / D-APR-002 | PRIMARY aprueba acceso y lo deja pendiente de autorización móvil', async () => {
    const first = await createVerifiedApplication(
      payloadFor('primary-flow', 'Tenant Principal', validAccountAddress),
    );
    await approveAndConfirmApplication(first.id);

    const firstApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(first.id),
    });
    const primaryAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: firstApplication?.tenantId,
      userId: firstApplication?.userId,
    });
    expect(primaryAssignment?.institutionalRole).toBe('PRIMARY');

    const secondWallet = '0x00000000000000000000000000000000000000a2';
    const second = await createVerifiedApplication(
      payloadFor('secondary-flow', 'Tenant Principal', secondWallet),
    );
    currentReviewer = {
      sub: String(firstApplication?.userId),
      role: 'USER',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${second.id}/approve`)
      .expect(201);

    const secondApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(second.id),
    });
    const secondaryAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: secondApplication?.tenantId,
      userId: secondApplication?.userId,
    });
    expect(secondaryAssignment).toEqual(
      expect.objectContaining({
        tenantId: firstApplication?.tenantId,
        userId: secondApplication?.userId,
        accountAddress: secondWallet,
        institutionalRole: 'SECONDARY',
        status: 'PENDING',
        active: false,
      }),
    );
    expect(secondApplication?.status).toBe('PENDING_MOBILE_AUTHORIZATION');
    expect(
      await conn.collection('notification_logs').countDocuments({
        'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
        'data.applicationId': second.id,
        topic: `user_${String(firstApplication?.userId)}`,
      }),
    ).toBe(1);

    await expect(
      accessService.resolveAdminWalletForTenant(
        String(firstApplication?.userId),
        String(firstApplication?.tenantId),
      ),
    ).resolves.toMatchObject({
      accountAddress: validAccountAddress,
      institutionalRole: 'PRIMARY',
    });
    await expect(
      accessService.resolveAdminWalletForTenant(
        String(secondApplication?.userId),
        String(secondApplication?.tenantId),
      ),
    ).rejects.toThrow('No autorizado para operar este tenant');
  });

  it('D-APR-001 / D-APR-006 | crear o rechazar solicitud no genera aviso al teléfono', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('no-mobile-before-primary', 'Tenant Sin Aviso', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const firstApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });

    const accessRequest = await createVerifiedApplication(
      payloadFor('no-mobile-before-secondary', 'Tenant Sin Aviso', '0x00000000000000000000000000000000000000e1'),
    );
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
    })).toBe(0);

    currentReviewer = { sub: String(firstApplication?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${accessRequest.id}/reject`)
      .send({ reason: 'No cumple requisitos' })
      .expect(201);

    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
    })).toBe(0);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: firstApplication?.tenantId,
      active: true,
    })).toBe(1);
  });

  it('D-APR-003 | notifica solo al administrador principal vigente', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('notify-primary', 'Tenant Notifica Principal', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });
    const extraAdminUserId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: extraAdminUserId,
      dni: 'extra-notify',
      email: 'extra-notify@example.com',
      name: 'Administrador Secundario',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId: primaryApplication?.tenantId,
      userId: extraAdminUserId,
      accountAddress: '0x00000000000000000000000000000000000000e2',
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const accessRequest = await createVerifiedApplication(
      payloadFor('notify-target', 'Tenant Notifica Principal', '0x00000000000000000000000000000000000000e3'),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${accessRequest.id}/approve`)
      .expect(201);

    expect(await conn.collection('notification_logs').countDocuments({
      topic: `user_${String(primaryApplication?.userId)}`,
      'data.applicationId': accessRequest.id,
    })).toBe(1);
    expect(await conn.collection('notification_logs').countDocuments({
      topic: `user_${String(extraAdminUserId)}`,
    })).toBe(0);
  });

  it('D-APR-004 / D-APR-005 | dos aprobaciones no duplican solicitud móvil ni notificación', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('two-tabs-primary', 'Tenant Dos Pestañas', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });
    const accessRequest = await createVerifiedApplication(
      payloadFor('two-tabs-secondary', 'Tenant Dos Pestañas', '0x00000000000000000000000000000000000000e4'),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER' };

    const responses = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/institutional-admin-applications/${accessRequest.id}/approve`),
      request(app.getHttpServer())
        .post(`/api/v1/institutional-admin-applications/${accessRequest.id}/approve`),
    ]);

    expect(responses.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      _id: new Types.ObjectId(accessRequest.id),
      status: 'PENDING_MOBILE_AUTHORIZATION',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      status: 'PENDING',
      active: false,
    })).toBe(1);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.applicationId': accessRequest.id,
    })).toBe(1);
  });

  it('[MX-02][D-SIGN-001][INTEGRACION] / [MX-02][D-SIGN-005][INTEGRACION] / [MX-02][D-SIGN-006][INTEGRACION] / [MX-02][D-SIGN-007][INTEGRACION] / [MX-02][D-SIGN-008][INTEGRACION] / [MX-02][D-SIGN-015][INTEGRACION] prepara addAuthorizedAddress con ID estable y registra una sola operación firmada', async () => {
    const {
      target,
      primaryApplication,
      targetApplication,
      stableInstitutionId,
      primaryWallet,
      targetWallet,
    } = await createPendingMobileAuthorization('sign-ok');
    const userOpHash = `0x${'1'.repeat(64)}`;

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      applicationId: target.id,
      institutionName: 'Tenant sign-ok',
      stableInstitutionId,
      targetWallet,
      signerWallet: primaryWallet,
      action: 'ADD_AUTHORIZED_ADDRESS',
      status: 'PENDING_MOBILE_AUTHORIZATION',
      functionalStatus: 'PENDING_MOBILE_SIGNATURE',
      functionalStatusLabel: 'Pendiente de firma en tu teléfono',
      canSign: true,
    });
    expect(detail.body.stableInstitutionId).not.toBe(target.id);

    const claim = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-1' })
      .expect(200);
    expect(claim.body.execution).toMatchObject({
      stableInstitutionId,
      action: 'ADD_AUTHORIZED_ADDRESS',
      signerWallet: primaryWallet,
      targetWallet,
    });
    expect(claim.body.execution.calls).toEqual([
      expect.objectContaining({
        target: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
        value: '0',
        callData: '0x1234',
        purpose: 'ADD_AUTHORIZED_ADDRESS',
      }),
    ]);
    expect(VoteContractCalls.addAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(VoteContractCalls.addAuthorizedAddress).not.toHaveBeenCalledWith(
      expect.any(String),
      target.id,
      targetWallet,
    );
    expect(executeCoinbaseOp).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/signing`)
      .send({ deviceId: 'qa-phone-1' })
      .expect(200);

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-1', userOpHash })
      .expect(200);
    expect(submitted.body).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      userOpHash,
      functionalStatus: 'PROCESSING_AUTHORIZATION',
      functionalStatusLabel: 'Procesando autorización',
      canSign: false,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-1', userOpHash })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-1', userOpHash: `0x${'2'.repeat(64)}` })
      .expect(409);

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      chainStatus: 'SENT',
      mobileAuthorizationUserOpHash: userOpHash,
    });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    })).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.applicationId': target.id,
    })).toBe(1);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][REG-MOBILE-CHAIN-001][INTEGRACION] polling posterior a submission es read-only, conserva hash y rechaza snapshots viejos', async () => {
    const { target, targetApplication } = await createPendingMobileAuthorization('post-submission-polling');
    const userOpHash = `0x${'e'.repeat(64)}`;

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-post-submission' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/signing`)
      .send({ deviceId: 'qa-phone-post-submission' })
      .expect(200);

    const beforeSubmission = await conn.collection('institutional_admin_applications').findOne({
      _id: targetApplication?._id,
    });
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-post-submission', userOpHash })
      .expect(200);
    expect(submitted.body).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      userOpHash,
      canSign: false,
    });

    for (let index = 0; index < 3; index += 1) {
      const poll = await request(app.getHttpServer())
        .get(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}`)
        .expect(200);
      expect(poll.body).toMatchObject({
        status: 'PENDING_CHAIN_CONFIRMATION',
        userOpHash,
        canSign: false,
      });
    }

    const staleWrite = await conn.collection('institutional_admin_applications').updateOne(
      {
        _id: targetApplication?._id,
        status: 'PENDING_MOBILE_AUTHORIZATION',
        mobileAuthorizationUserOpHash: null,
      },
      {
        $set: {
          status: 'PENDING_MOBILE_AUTHORIZATION',
          mobileAuthorizationUserOpHash: null,
          mobileAuthorizationExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    );
    expect(staleWrite.matchedCount).toBe(0);

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: targetApplication?._id,
    });
    expect(stored).toMatchObject({
      status: 'PENDING_CHAIN_CONFIRMATION',
      mobileAuthorizationUserOpHash: userOpHash,
    });
    expect(stored?.mobileAuthorizationExpiresAt?.getTime()).toBe(
      beforeSubmission?.mobileAuthorizationExpiresAt?.getTime(),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-post-submission' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/signing`)
      .send({ deviceId: 'qa-phone-post-submission' })
      .expect(409);
  });

  it('[MX-02][D-SIGN-004][INTEGRACION] bloquea la firma con billetera distinta sin preparar operación', async () => {
    const { target } = await createPendingMobileAuthorization('sign-wallet-mismatch');
    currentReviewer.smartAccountAddress = '0x0000000000000000000000000000000000000bad';

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-2' })
      .expect(403);

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored?.status).toBe('PENDING_MOBILE_AUTHORIZATION');
    expect(stored?.mobileAuthorizationDeviceId).toBeUndefined();
    expect(stored?.mobileAuthorizationUserOpHash).toBeUndefined();
    expect(VoteContractCalls.addAuthorizedAddress).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-005][INTEGRACION] prepara changeInstitutionAdmin con el stableInstitutionId y crea la firma móvil', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('claim');

    const claim = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer' })
      .expect(200);

    expect(claim.body.execution).toMatchObject({
      stableInstitutionId: transfer.stableInstitutionId,
      action: 'CHANGE_INSTITUTION_ADMIN',
      signerWallet: transfer.primaryWallet,
      targetWallet: transfer.targetWallet,
    });
    expect(claim.body.execution.calls).toEqual([
      expect.objectContaining({
        target: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
        value: '0',
        callData: '0x9abc',
        purpose: 'CHANGE_INSTITUTION_ADMIN',
      }),
    ]);
    expect(VoteContractCalls.changeInstitutionAdmin).toHaveBeenCalledWith(
      expect.any(String),
      transfer.stableInstitutionId,
      transfer.targetWallet,
    );
    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalledWith(
      expect.any(String),
      String(transfer.applicationId),
      transfer.targetWallet,
    );
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-006][INTEGRACION] conserva los roles originales antes de la confirmación on-chain', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('roles-pending');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-roles' })
      .expect(200);

    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      userId: transfer.primaryUserId,
      active: true,
      status: 'APPROVED',
    })).resolves.toBe(1);
    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'SECONDARY',
      userId: transfer.targetUserId,
      active: true,
      status: 'APPROVED',
    })).resolves.toBe(1);
    await expect(conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    })).resolves.toMatchObject({
      status: 'PENDING_MOBILE_AUTHORIZATION',
      mobileAuthorizationClaimedAt: expect.any(Date),
    });
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('D-TRF-ZK-A/F: usa metadata persistida del iniciador y omite payload manipulado del cliente', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('binding-valid');

    const claim = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({
        deviceId: 'qa-phone-transfer-binding',
        initiatedByUserId: String(new Types.ObjectId()),
        initiatedByWallet: '0x0000000000000000000000000000000000000bad',
        tenantId: String(new Types.ObjectId()),
        stableInstitutionId: 'client-stable-id',
        targetWallet: '0x0000000000000000000000000000000000000bad',
      })
      .expect(200);

    expect(claim.body.execution).toMatchObject({
      stableInstitutionId: transfer.stableInstitutionId,
      signerWallet: transfer.primaryWallet,
      targetWallet: transfer.targetWallet,
      action: 'CHANGE_INSTITUTION_ADMIN',
    });
    expect(VoteContractCalls.changeInstitutionAdmin).toHaveBeenCalledWith(
      expect.any(String),
      transfer.stableInstitutionId,
      transfer.targetWallet,
    );
    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalledWith(
      expect.any(String),
      'client-stable-id',
      '0x0000000000000000000000000000000000000bad',
    );
  });

  it('D-TRF-ZK-B: bloquea a otro administrador que intenta reclamar la solicitud iniciada por el principal', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('binding-other');
    currentReviewer = {
      sub: String(new Types.ObjectId()),
      role: 'USER',
      smartAccountAddress: '0x0000000000000000000000000000000000000b02',
    };

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-other' })
      .expect(403);

    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalled();
    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      userId: transfer.primaryUserId,
      active: true,
    })).resolves.toBe(1);
  });

  it('D-TRF-ZK-C/D: invalida la solicitud antigua si el iniciador dejó de ser principal', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('binding-stale');
    const newPrimaryUserId = new Types.ObjectId();
    const newPrimaryWallet = '0x0000000000000000000000000000000000000b03';
    await conn.collection('roled_users').insertOne({
      _id: newPrimaryUserId,
      dni: 'new-primary-binding',
      email: 'new-primary-binding@example.test',
      name: 'Nuevo Principal',
      password: 'hashed-new-primary',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: transfer.primaryAssignmentId },
      { $set: { institutionalRole: 'SECONDARY' } },
    );
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: new Types.ObjectId(),
      tenantId: transfer.tenantId,
      userId: newPrimaryUserId,
      accountAddress: newPrimaryWallet,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    currentReviewer = {
      sub: String(transfer.primaryUserId),
      role: 'USER',
      smartAccountAddress: transfer.primaryWallet,
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-old-primary' })
      .expect(409);

    currentReviewer = {
      sub: String(newPrimaryUserId),
      role: 'USER',
      smartAccountAddress: newPrimaryWallet,
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-new-primary' })
      .expect(409);

    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalled();
    await expect(conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    })).resolves.toMatchObject({ status: 'PENDING_MOBILE_AUTHORIZATION' });
  });

  it('D-TRF-ZK-E: bloquea sujeto o billetera distinta aunque la credencial sea válida', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('binding-wallet');

    currentReviewer = {
      sub: String(transfer.primaryUserId),
      role: 'USER',
      smartAccountAddress: '0x0000000000000000000000000000000000000b04',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-wallet' })
      .expect(403);

    currentReviewer = {
      sub: String(new Types.ObjectId()),
      role: 'USER',
      smartAccountAddress: transfer.primaryWallet,
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-subject' })
      .expect(403);

    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalled();
  });

  it.each([
    ['suspendido', { status: 'APPROVED', active: false, institutionalRole: 'SECONDARY' }],
    ['revocado', { status: 'REVOKED', active: false, institutionalRole: 'SECONDARY' }],
    ['principal', { status: 'APPROVED', active: true, institutionalRole: 'PRIMARY' }],
    ['pendiente', { status: 'PENDING_MOBILE_AUTHORIZATION', active: false, institutionalRole: 'SECONDARY' }],
  ])('D-TRF-ZK-G: bloquea solicitud antigua si el destino queda %s', async (_label, targetPatch) => {
    const transfer = await createPendingPrimaryTransferAuthorization(`binding-target-${_label}`);
    if (_label === 'principal') {
      await conn.collection('tenant_admin_assignments').updateOne(
        { _id: transfer.primaryAssignmentId },
        { $set: { institutionalRole: 'SECONDARY' } },
      );
    }
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: transfer.targetAssignmentId },
      { $set: targetPatch },
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: `qa-phone-transfer-${_label}` })
      .expect(409);

    expect(VoteContractCalls.changeInstitutionAdmin).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-008][INTEGRACION] confirma la transferencia con receipt válido sin reenviar la operación', async () => {
    const transfer = await submitPrimaryTransferForConfirmation('confirm-chain');

    expect(userOperationService.getUserOperationByHash).toHaveBeenCalledWith(`0x${'8'.repeat(64)}`);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(`0x${'8'.repeat(64)}`);
    expect(await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    })).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-009][INTEGRACION] asigna al destino como único principal después de confirmar la red', async () => {
    const transfer = await submitPrimaryTransferForConfirmation('confirm-target-primary');

    await expect(conn.collection('tenant_admin_assignments').findOne({
      _id: transfer.targetAssignmentId,
    })).resolves.toMatchObject({
      institutionalRole: 'PRIMARY',
      accountAddress: transfer.targetWallet,
      active: true,
      status: 'APPROVED',
    });
    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    })).resolves.toBe(1);
  });

  it('[MX-02][D-TRF-010][INTEGRACION] conserva al principal anterior como secundario después de confirmar la red', async () => {
    const transfer = await submitPrimaryTransferForConfirmation('confirm-previous-secondary');

    await expect(conn.collection('tenant_admin_assignments').findOne({
      _id: transfer.primaryAssignmentId,
    })).resolves.toMatchObject({
      institutionalRole: 'SECONDARY',
      accountAddress: transfer.primaryWallet,
      active: true,
      status: 'APPROVED',
    });
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-007][INTEGRACION] un error recuperable conserva la firma y agenda un reintento', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('retry');
    const userOpHash = `0x${'9'.repeat(64)}`;

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/submission`)
      .send({ deviceId: 'qa-phone-transfer-retry', userOpHash })
      .expect(200);

    userOperationService.getUserOperationReceipt.mockRejectedValueOnce(new Error('bundler timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId));
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    let stored = await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    });
    expect(stored).toMatchObject({
      status: 'CHAIN_RETRY_PENDING',
      chainStatus: 'RETRY_PENDING',
      mobileAuthorizationUserOpHash: userOpHash,
    });
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-TRF-011][INTEGRACION] workers concurrentes confirman una única transferencia sin operaciones duplicadas', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('retry-concurrent');
    const userOpHash = `0x${'a'.repeat(64)}`;

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-retry-concurrent' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/submission`)
      .send({
        deviceId: 'qa-phone-transfer-retry-concurrent',
        userOpHash,
      })
      .expect(200);

    userOperationService.getUserOperationReceipt.mockRejectedValueOnce(new Error('bundler timeout'));
    await applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId));

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: transfer.applicationId },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: transfer.primaryWallet,
      action: 'CHANGE_INSTITUTION_ADMIN',
    });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(transfer.targetWallet);
    await Promise.allSettled([
      applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId)),
      applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId)),
    ]);
    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    });
    expect(stored).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    })).toBe(1);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-SIGN-003][INTEGRACION] rechazo móvil cierra la autorización sin firma ni acceso', async () => {
    const { target, primaryApplication, targetApplication } =
      await createPendingMobileAuthorization('sign-reject');

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/reject`)
      .send({ reasonCode: 'ADMIN_REJECTED_FROM_PHONE' })
      .expect(200);

    expect(rejected.body.status).toBe('REJECTED');
    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
    });
    expect(stored).toMatchObject({ status: 'REJECTED', reason: 'ADMIN_REJECTED_FROM_PHONE' });
    expect(stored?.mobileAuthorizationUserOpHash).toBeUndefined();
    expect(assignment).toMatchObject({ status: 'REJECTED', active: false });
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('[MX-02][D-SIGN-002][INTEGRACION] / [MX-02][D-SIGN-014][INTEGRACION] autorización vencida no permite firmar y exige una nueva autorización móvil', async () => {
    const { target, targetApplication } =
      await createPendingMobileAuthorization('sign-expired');
    const expiredAt = new Date(Date.now() - 60_000);
    await conn.collection('institutional_admin_applications').updateOne(
      { _id: targetApplication?._id },
      {
        $set: {
          mobileAuthorizationRequestedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          mobileAuthorizationExpiresAt: expiredAt,
        },
      },
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      status: 'MOBILE_AUTHORIZATION_EXPIRED',
      canSign: false,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-expired' })
      .expect(409);

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored?.status).toBe('MOBILE_AUTHORIZATION_EXPIRED');
    expect(stored?.mobileAuthorizationUserOpHash).toBeUndefined();
    expect(VoteContractCalls.addAuthorizedAddress).not.toHaveBeenCalled();
  });

  it('[MX-02][D-SIGN-009][INTEGRACION] / [MX-02][D-SIGN-011][INTEGRACION] / [MX-02][D-SIGN-012][INTEGRACION] / [MX-02][D-SIGN-013][INTEGRACION] confirma por receipt y reconcilia sin reenviar', async () => {
    const { target, primaryApplication, targetApplication } =
      await createPendingMobileAuthorization('sign-confirm');
    const userOpHash = `0x${'3'.repeat(64)}`;
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-confirm' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-confirm', userOpHash })
      .expect(200);

    const pending = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    expect(pending.reconciled).toBe(false);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    })).toBe(0);

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(target.id) },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: String(primaryApplication?.accountAddress),
      action: 'ADD_AUTHORIZED_ADDRESS',
    });
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    const confirmed = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    const confirmedAgain = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    expect(confirmed.reconciled).toBe(true);
    expect(confirmedAgain.reconciled).toBe(true);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
    })).toBe(1);
  });

  it('[MX-02][REC-02][REC-05][REC-06][REC-07][REC-08][REC-09][REC-10][INTEGRACION] reconcilia ADD por postestado on-chain aunque el bundler no conozca el hash', async () => {
    const { target, primaryApplication, targetApplication, stableInstitutionId, targetWallet } =
      await createPendingMobileAuthorization('onchain-state');
    const userOpHash = `0x${'9'.repeat(64)}`;
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-onchain-state' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-onchain-state', userOpHash })
      .expect(200);

    userOperationService.getUserOperationByHash.mockResolvedValue(null);
    userOperationService.getUserOperationReceipt.mockResolvedValue(null);
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);

    const first = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    const second = await applicationsService.reconcileMobileAuthorizationOperation(target.id);

    expect(first.reconciled).toBe(true);
    expect(second.reconciled).toBe(true);
    expect(VoteContractReads.isAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(VoteContractReads.isAuthorizedAddress).not.toHaveBeenCalledWith(
      expect.any(String),
      target.id,
      expect.anything(),
    );
    expect(executeCoinbaseOp).not.toHaveBeenCalled();

    const stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({
      status: 'APPROVED',
      chainStatus: 'CONFIRMED',
      mobileAuthorizationUserOpHash: userOpHash,
    });
    expect(stored?.mobileAuthorizationTxHash ?? stored?.chainTxHash ?? null).toBeNull();
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
    })).toBe(1);
  });

  it('[MX-02][D-SIGN-010][INTEGRACION] / [MX-02][D-RETRY-001][INTEGRACION] / [MX-02][D-RETRY-002][INTEGRACION] / [MX-02][D-RETRY-003][INTEGRACION] / [MX-02][D-RETRY-005][INTEGRACION] / [MX-02][D-RETRY-007][INTEGRACION] reintenta la consulta de receipt sin reenviar', async () => {
    const { target, primaryApplication, targetApplication } =
      await createPendingMobileAuthorization('retry-flow');
    const userOpHash = `0x${'4'.repeat(64)}`;
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-retry', userOpHash })
      .expect(200);

    userOperationService.getUserOperationReceipt.mockRejectedValueOnce(new Error('bundler timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(target.id);
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    let stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({
      status: 'CHAIN_RETRY_PENDING',
      chainStatus: 'RETRY_PENDING',
      mobileAuthorizationUserOpHash: userOpHash,
    });
    expect(stored?.chainAttempts).toBeGreaterThanOrEqual(2);
    expect(stored?.chainNextRetryAt).toBeInstanceOf(Date);

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(target.id) },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: String(primaryApplication?.accountAddress),
      action: 'ADD_AUTHORIZED_ADDRESS',
    });
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    const workers = await Promise.allSettled([
      applicationsService.processMobileAuthorizationRetry(target.id),
      applicationsService.processMobileAuthorizationRetry(target.id),
    ]);
    expect(workers).toHaveLength(2);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();

    stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    })).toBe(1);
  });

  it('[MX-02][D-RETRY-006][INTEGRACION] doble notificación conserva una sola autorización móvil activa', async () => {
    const { target } = await createPendingMobileAuthorization('retry-notice');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${target.id}/approve`)
      .expect(201);

    expect(await conn.collection('institutional_admin_applications').countDocuments({
      _id: new Types.ObjectId(target.id),
      status: 'PENDING_MOBILE_AUTHORIZATION',
    })).toBe(1);
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.applicationId': target.id,
    })).toBe(1);
  });

  it('[MX-02][D-REV-001][INTEGRACION] inicia la eliminación desde la administradora principal sin revocar acceso aún', async () => {
    const { created, targetAssignment, stableInstitutionId, targetWallet } = await createRemovalAuthorization('initiate');
    const stored = await conn.collection('institutional_admin_applications').findOne({ _id: new Types.ObjectId(created.body.applicationId) });

    expect(created.body).toMatchObject({ action: 'REMOVE_AUTHORIZED_ADDRESS', status: 'PENDING_MOBILE_AUTHORIZATION', stableInstitutionId, targetWallet, canSign: true });
    expect(stored).toMatchObject({ mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS', status: 'PENDING_MOBILE_AUTHORIZATION' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: true, status: 'APPROVED' })).toBe(1);
    expect(VoteContractCalls.removeAuthorizedAddress).not.toHaveBeenCalled();
  });

  it('[MX-02][D-REV-002][INTEGRACION] genera un único aviso móvil para la eliminación pendiente', async () => {
    const { created, primaryApplication, targetAssignment } = await createRemovalAuthorization('notification');
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Doble clic' })
      .expect(201);

    expect(repeated.body.applicationId).toBe(created.body.applicationId);
    expect(await conn.collection('notification_logs').countDocuments({ 'data.event': 'MOBILE_AUTHORIZATION_REQUESTED', 'data.applicationId': created.body.applicationId, 'data.action': 'REMOVE_AUTHORIZED_ADDRESS' })).toBe(1);
    expect(VoteContractCalls.removeAuthorizedAddress).not.toHaveBeenCalled();
  });

  it('[MX-02][D-REV-003][INTEGRACION] firma desde el teléfono la operación removeAuthorizedAddress preparada', async () => {
    const { created, stableInstitutionId, targetWallet, targetAssignment } = await createRemovalAuthorization('sign');
    const claim = await submitRemovalAuthorization(created.body.applicationId, 'qa-phone-remove-sign');
    const stored = await conn.collection('institutional_admin_applications').findOne({ _id: new Types.ObjectId(created.body.applicationId) });

    expect(claim.body.execution).toMatchObject({ action: 'REMOVE_AUTHORIZED_ADDRESS', stableInstitutionId, targetWallet });
    expect(claim.body.execution.calls).toEqual([expect.objectContaining({ callData: '0x5678', purpose: 'REMOVE_AUTHORIZED_ADDRESS' })]);
    expect(VoteContractCalls.removeAuthorizedAddress).toHaveBeenCalledWith(expect.any(String), stableInstitutionId, targetWallet);
    expect(stored).toMatchObject({ mobileAuthorizationUserOpHash: `0x${'5'.repeat(64)}` });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: true })).toBe(1);
  });

  it('[MX-02][D-REV-004][INTEGRACION] revoca el acceso solo después de un receipt válido de eliminación', async () => {
    const { created, targetAssignment } = await createRemovalAuthorization('confirmed');
    await submitRemovalAuthorization(created.body.applicationId, 'qa-phone-remove-confirmed');
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    const reconciled = await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);

    expect(reconciled).toMatchObject({ reconciled: true });
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(`0x${'5'.repeat(64)}`);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: false, status: 'REVOKED' })).toBe(1);
  });

  it('[MX-02][D-REV-005][INTEGRACION] conserva acceso mientras la confirmación on-chain continúa pendiente', async () => {
    const { created, targetAssignment } = await createRemovalAuthorization('pending');
    await submitRemovalAuthorization(created.body.applicationId, 'qa-phone-remove-pending');
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    const pending = await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);
    const stored = await conn.collection('institutional_admin_applications').findOne({ _id: new Types.ObjectId(created.body.applicationId) });

    expect(pending).toMatchObject({ reconciled: false });
    expect(stored?.chainStatus).not.toBe('CONFIRMED');
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: true, status: 'APPROVED' })).toBe(1);
  });

  it('[MX-02][D-REV-008][INTEGRACION] deja inactivo el acceso y conserva al principal tras confirmar la eliminación', async () => {
    const { created, primaryApplication, targetAssignment } = await createRemovalAuthorization('access-revoked');
    await submitRemovalAuthorization(created.body.applicationId, 'qa-phone-remove-access');
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);

    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: false, status: 'REVOKED' })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId: primaryApplication?.tenantId, institutionalRole: 'PRIMARY', active: true })).toBe(1);
  });

  it('[MX-02][D-REV-009][INTEGRACION] no modifica la relación de otra institución al revocar la autorización objetivo', async () => {
    const { created, primaryApplication, targetApplication, targetAssignment } = await createRemovalAuthorization('other-tenant');
    const otherTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: otherTenantId,
      name: `Institución conservada ${String(otherTenantId).slice(-6)}`,
      nameNorm: `institucion conservada ${String(otherTenantId).slice(-6)}`,
      stableInstitutionId: String(otherTenantId),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId: otherTenantId,
      userId: targetApplication?.userId,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      accountAddress: targetApplication?.accountAddress,
      accountAddressNormalized: targetApplication?.accountAddress?.toLowerCase(),
      requestedAt: new Date(),
      approvedAt: new Date(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
    });
    await submitRemovalAuthorization(created.body.applicationId, 'qa-phone-remove-other-tenant');
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);

    expect(await conn.collection('tenant_admin_assignments').countDocuments({ _id: targetAssignment?._id, active: false, status: 'REVOKED' })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId: otherTenantId, userId: targetApplication?.userId, active: true, status: 'APPROVED' })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({ tenantId: primaryApplication?.tenantId, institutionalRole: 'PRIMARY', active: true })).toBe(1);
  });

  it('[MX-02][D-REV-011][INTEGRACION] dos solicitudes de eliminación para la misma relación reutilizan una sola operación', async () => {
    const { created, primaryApplication, targetAssignment } = await createRemovalAuthorization('duplicate');
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Repetida' })
      .expect(201);

    expect(repeated.body.applicationId).toBe(created.body.applicationId);
    expect(await conn.collection('institutional_admin_applications').countDocuments({ tenantId: primaryApplication?.tenantId, mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS' })).toBe(1);
    expect(await conn.collection('notification_logs').countDocuments({ 'data.applicationId': created.body.applicationId, 'data.action': 'REMOVE_AUTHORIZED_ADDRESS' })).toBe(1);
    expect(VoteContractCalls.removeAuthorizedAddress).not.toHaveBeenCalled();
  });

  it('[MX-02][D-REV-006][INTEGRACION] / [MX-02][D-REV-007][INTEGRACION] error recuperable de eliminación conserva acceso y reintenta sin duplicar operación', async () => {
    const { target, primaryApplication, targetApplication } =
      await createPendingMobileAuthorization('remove-retry');
    const userOpHash = `0x${'6'.repeat(64)}`;
    await confirmPendingMobileAuthorization(target.id, 'qa-phone-remove-retry-add');
    (VoteContractCalls.removeAuthorizedAddress as jest.Mock).mockClear();

    const targetAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    });
    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Salida temporal' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${created.body.applicationId}/claim`)
      .set('x-forwarded-for', mobileAuthorizationClientIp(created.body.applicationId))
      .send({ deviceId: 'qa-phone-remove-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${created.body.applicationId}/submission`)
      .set('x-forwarded-for', mobileAuthorizationClientIp(created.body.applicationId))
      .send({ deviceId: 'qa-phone-remove-retry', userOpHash })
      .expect(200);

    userOperationService.getUserOperationReceipt.mockRejectedValueOnce(new Error('bundler timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(created.body.applicationId);
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: true,
      status: 'APPROVED',
    })).toBe(1);
    expect(userOperationService.getUserOperationReceipt).toHaveBeenCalledWith(userOpHash);

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(created.body.applicationId) },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    mockConfirmedMobileUserOperation({
      userOpHash,
      signerWallet: String(primaryApplication?.accountAddress),
      action: 'REMOVE_AUTHORIZED_ADDRESS',
    });
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    const confirmed = await applicationsService.processMobileAuthorizationRetry(created.body.applicationId);
    expect(confirmed).toMatchObject({ processed: true, status: 'CONFIRMED', reusedNetworkState: true });
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: false,
      status: 'REVOKED',
    })).toBe(1);
  });

  it('[MX-02][D-REV-010][INTEGRACION] bloquea eliminación definitiva del administrador principal', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('remove-primary', 'Tenant Eliminar Principal', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });
    currentReviewer = {
      sub: String(primaryApplication?.userId),
      role: 'USER',
      smartAccountAddress: validAccountAddress,
    };
    const primaryAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: primaryApplication?.tenantId,
      userId: primaryApplication?.userId,
      institutionalRole: 'PRIMARY',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${primaryAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Eliminar principal' })
      .expect(409);
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      mobileAuthorizationAction: 'REMOVE_AUTHORIZED_ADDRESS',
    })).toBe(0);
    expect(VoteContractCalls.removeAuthorizedAddress).not.toHaveBeenCalled();
  });

it('D-REV-010 / D-COMPAT-006 | revoca PRIMARY como inactivo sin promover automaticamente a SECONDARY', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('revoke-primary-real', 'Tenant Revocacion Real', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });

    const secondary = await createVerifiedApplication(
      payloadFor(
        'revoke-primary-secondary',
        'Tenant Revocacion Real',
        '0x00000000000000000000000000000000000000bb',
      ),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${secondary.id}/approve`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/revoke`)
      .send({ reason: 'Cierre de soporte' })
      .expect(201);

    const revokedPrimary = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: primaryApplication?.tenantId,
      userId: primaryApplication?.userId,
    });
    expect(revokedPrimary).toEqual(
      expect.objectContaining({
        institutionalRole: 'PRIMARY',
        status: 'REVOKED',
        active: false,
      }),
    );

    const secondaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(secondary.id),
    });
    const secondaryAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: secondaryApplication?.tenantId,
      userId: secondaryApplication?.userId,
    });
    expect(secondaryAssignment).toEqual(
      expect.objectContaining({
        institutionalRole: 'SECONDARY',
        status: 'PENDING',
        active: false,
      }),
    );
    expect(
      await conn.collection('tenant_admin_assignments').countDocuments({
        tenantId: primaryApplication?.tenantId,
        institutionalRole: 'PRIMARY',
        active: true,
      }),
    ).toBe(0);

    const next = await createVerifiedApplication(
      payloadFor(
        'after-real-primary-revoke',
        'Tenant Revocacion Real',
        '0x00000000000000000000000000000000000000bc',
      ),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${next.id}/approve`)
      .expect(403);

    const pending = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(next.id),
    });
    expect(pending?.status).toBe('PENDING_APPROVAL');
  });

  it('D-REQ-007 | rechaza aprobación por administrador sin permiso o de otra institución', async () => {
    const tenantA = await createVerifiedApplication(
      payloadFor('tenant-a-primary', 'Tenant A', validAccountAddress),
    );
    await approveAndConfirmApplication(tenantA.id);
    const primaryA = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(tenantA.id),
    });

    const tenantASecondary = await createVerifiedApplication(
      payloadFor('tenant-a-secondary', 'Tenant A', '0x00000000000000000000000000000000000000a3'),
    );
    currentReviewer = { sub: String(primaryA?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantASecondary.id}/approve`)
      .expect(201);
    const secondaryA = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(tenantASecondary.id),
    });

    currentReviewer = {
      sub: '64f000000000000000000001',
      role: 'ADMIN',
    };
    const tenantB = await createVerifiedApplication(
      payloadFor('tenant-b-primary', 'Tenant B', '0x00000000000000000000000000000000000000b1'),
    );
    await approveAndConfirmApplication(tenantB.id);

    const tenantBExtra = await createVerifiedApplication(
      payloadFor('tenant-b-extra', 'Tenant B', '0x00000000000000000000000000000000000000b2'),
    );
    currentReviewer = { sub: String(secondaryA?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantBExtra.id}/approve`)
      .expect(403);

    currentReviewer = { sub: String(primaryA?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantBExtra.id}/approve`)
      .expect(403);

    const pending = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(tenantBExtra.id),
    });
    expect(pending?.status).toBe('PENDING_APPROVAL');
  });

  it('D-REQ-006 | bloquea a SUPERADMIN al aprobar acceso interno y mantiene autoaprobacion bloqueada', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('support-primary', 'Tenant Soporte', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);

    const secondary = await createVerifiedApplication(
      payloadFor('support-secondary', 'Tenant Soporte', '0x00000000000000000000000000000000000000c2'),
    );
    currentReviewer = {
      sub: '64f000000000000000000001',
      role: 'ADMIN',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${secondary.id}/approve`)
      .expect(403);
    const secondaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(secondary.id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: secondaryApplication?.tenantId,
      userId: secondaryApplication?.userId,
    });
    expect(assignment).toBeNull();

    const self = await createVerifiedApplication(
      payloadFor('self-review', 'Tenant Auto', '0x00000000000000000000000000000000000000d1'),
    );
    const selfApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(self.id),
    });
    currentReviewer = { sub: String(selfApplication?.userId), role: 'ADMIN' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${self.id}/approve`)
      .expect(403);

    expect(
      await conn.collection('tenant_admin_assignments').findOne({
        userId: selfApplication?.userId,
      }),
    ).toBeNull();
  });

it('D-PERM-008 / D-COMPAT-007 | bloquea aprobaciones con principal revocado y tenants heredados sin rol explicito', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('revoked-primary', 'Tenant Revocado', validAccountAddress),
    );
    await approveAndConfirmApplication(primary.id);
    const primaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(primary.id),
    });
    await conn.collection('tenant_admin_assignments').updateOne(
      { tenantId: primaryApplication?.tenantId, userId: primaryApplication?.userId },
      { $set: { active: false, status: 'REVOKED', revokedAt: new Date() } },
    );

    const next = await createVerifiedApplication(
      payloadFor('after-revoked-primary', 'Tenant Revocado', '0x00000000000000000000000000000000000000e2'),
    );
    currentReviewer = { sub: String(primaryApplication?.userId), role: 'USER' };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${next.id}/approve`)
      .expect(403);

    const legacyTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: legacyTenantId,
      name: 'Tenant Legacy Sin Rol',
      nameNorm: 'tenant legacy sin rol',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId: legacyTenantId,
      userId: new Types.ObjectId(),
      accountAddress: '0x00000000000000000000000000000000000000f1',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const legacy = await createVerifiedApplication(
      payloadFor('legacy-role', 'Tenant Legacy Sin Rol', '0x00000000000000000000000000000000000000f2'),
    );
    currentReviewer = {
      sub: '64f000000000000000000001',
      role: 'ADMIN',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${legacy.id}/approve`)
      .expect(409);

    const legacyApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(legacy.id),
    });
    expect(legacyApplication?.status).toBe('PENDING_APPROVAL');
  });

it('D-COMPAT-008 | rechaza aprobar solicitud heredada sin wallet y no crea relacion', async () => {
    const applicationId = new Types.ObjectId();
    await conn.collection('institutional_admin_applications').insertOne({
      _id: applicationId,
      dni: 'legacy-1',
      email: 'legacy@example.com',
      passwordHash: 'hashed',
      name: 'Legacy Admin',
      institutionName: 'Legacy Tenant',
      institutionNameNorm: 'legacy tenant',
      status: 'PENDING_APPROVAL',
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${applicationId}/approve`)
      .expect(400);

    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(0);
    expect(await conn.collection('institutional_admin_applications').findOne({ _id: applicationId }))
      .toEqual(expect.objectContaining({ status: 'PENDING_APPROVAL' }));
  });

it('rechaza wallet ya usada por otro usuario sin escrituras parciales de aprobacion', async () => {
    const tenantId = new Types.ObjectId();
    const otherUserId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Tenant Existente',
      nameNorm: 'tenant existente',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertOne({
      _id: otherUserId,
      dni: 'other-dni',
      email: 'other@example.com',
      name: 'Other Admin',
      password: 'hashed',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId: otherUserId,
      accountAddress: validAccountAddress.toUpperCase(),
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { id } = await createVerifiedApplication({
      ...validPayload(),
      dni: 'wallet-conflict',
      email: 'wallet-conflict@example.com',
      institutionName: 'Tenant Nuevo',
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(409);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    expect(application?.status).toBe('PENDING_APPROVAL');
    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(1);
  });

it('reintento de aprobacion no duplica assignment', async () => {
    const { id } = await createVerifiedApplication();

    await approveAndConfirmApplication(id);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(400);

    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(1);
  });

it('D-LIST-004 | resolveAdminWalletForTenant devuelve wallet correcta y rechaza tenant incorrecto', async () => {
    const { id, payload } = await createVerifiedApplication();
    await approveAndConfirmApplication(id);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    await expect(
      accessService.resolveAdminWalletForTenant(
        String(application?.userId),
        String(application?.tenantId),
      ),
    ).resolves.toEqual({
      userId: String(application?.userId),
      tenantId: String(application?.tenantId),
      accountAddress: payload.accountAddress,
      institutionalRole: 'PRIMARY',
    });

    const otherTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: otherTenantId,
      name: 'Otro Tenant',
      nameNorm: 'otro tenant',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      accessService.resolveAdminWalletForTenant(String(application?.userId), String(otherTenantId)),
    ).rejects.toThrow('No autorizado para operar este tenant');
  });

  it('resolveAdminWalletForTenant ignora assignment inactivo', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Tenant Inactivo Assignment',
      nameNorm: 'tenant inactivo assignment',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId,
      accountAddress: validAccountAddress,
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      accessService.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow('No autorizado para operar este tenant');
  });

it('D-COMPAT-008 | cuenta heredada aprobada sin wallet no recibe wallet ficticia ni queda lista', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Tenant Legacy',
      nameNorm: 'tenant legacy',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId,
      userId,
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      accessService.resolveAdminWalletForTenant(String(userId), String(tenantId)),
    ).rejects.toThrow('La relacion institucional no tiene wallet operativa');

    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId,
      userId,
    });
    expect(assignment?.accountAddress).toBeUndefined();
  });
});
