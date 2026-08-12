jest.mock('@/api/account', () => ({
  executeCoinbaseOp: jest.fn().mockResolvedValue({ txHash: '0xabc123' }),
}));

jest.mock('@/api/vote', () => ({
  VoteContractCalls: {
    createInstitution: jest.fn().mockReturnValue({ calldata: '0x' }),
  },
  VoteContractReads: {
    getInstitutionAdmin: jest.fn().mockRejectedValue(new Error('Institution does not exist')),
    isAuthorizedAddress: jest.fn().mockResolvedValue(false),
  },
}));

// Tenant access does not exercise vote emission.  Isolate this incidental
// provider so its ZK-voting graph is not constructed by InstitutionalVotingModule.
jest.mock('@/modules/institutional-voting/services/participation/emit-vote.service', () => ({
  EmitVoteService: class EmitVoteService {},
}));

// InstitutionalVotingModule also registers VoteWritterService, whose constructor
// initializes a Coinbase smart account and performs an external eth_call. Tenant
// access scenarios do not exercise voting or blockchain writes.
jest.mock('@/modules/institutional-voting/services/core/vote-writter.service', () => ({
  VoteWritterService: class VoteWritterService {},
}));

import appConfig from '@/config/app.config';
import { HttpService } from '@nestjs/axios';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { ContractsModule } from '@/modules/contracts/contracts.module';
import { MailService } from '@/modules/mail/mail.service';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalAdminApplicationsService } from '@/modules/institutional-admin-applications/services/institutional-admin-applications.service';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { VoteContractReads } from '@/api/vote';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { seedAdmin, seedUsers } from '../utils/seeds/usersSeed';
import { TestLoggerModule } from '../utils/module-helpers';
import {
  installMx02SyntheticChainConfig,
  restoreMx02SyntheticChainConfig,
} from '../utils/mx02-synthetic-chain-config';
import { IncentiveCampaignsService } from '@/modules/users/services/incentive-campaigns.service';

jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: jest.fn().mockImplementation(() => ({
    generateRequest: jest.fn().mockReturnValue({ apiKey: 'mock-api-key', request: {} }),
    zkAuthCallback: jest.fn().mockResolvedValue({}),
    saveApiKey: jest.fn().mockResolvedValue(undefined),
    isApiKeyValid: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.service', () => ({
  InstitutionalMobileZkAuthService: jest.fn().mockImplementation(() => ({
    createAuthRequest: jest.fn().mockResolvedValue({
      apiKey: 'institutional-mobile-api-key',
      request: {},
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    getContextByApiKey: jest.fn().mockResolvedValue(null),
  })),
}));

jest.mock('@/modules/institutional-admin-applications/auth/institutional-mobile-zk-auth.guard', () => ({
  InstitutionalMobileZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard', () => ({
  OfficialPublicationMobileZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service', () => ({
  OfficialPublicationMobileZkAuthService: jest.fn().mockImplementation(() => ({
    createAuthRequest: jest.fn().mockResolvedValue({
      apiKey: 'mock-official-publication-mobile-api-key',
      request: {},
      expiresAt: '2026-07-28T00:00:00.000Z',
    }),
    callback: jest.fn().mockResolvedValue({}),
    getContextByApiKey: jest.fn().mockResolvedValue(null),
    hashApiKey: jest.fn((apiKey: string) => `mock-hash-${apiKey}`),
  })),
}));

const MailMockService = {
  sendEmail: jest.fn(),
  createEmail: jest.fn(),
  getTemplate: jest.fn(),
};

const mockIncentiveCampaignsService = {
  giveIncentive: jest.fn(),
  isAlreadyReceivedError: jest.fn().mockReturnValue(false),
  isUngrantableError: jest.fn().mockReturnValue(false),
};

const IdentityHttpMockService = {
  axiosRef: {
    get: jest.fn().mockResolvedValue({ data: { ok: true } }),
    post: jest.fn((_url: string, body?: any) =>
      Promise.resolve({
        data: {
          registered: true,
          accountAddress: testAccountAddress(`${body?.dni ?? 'identity'}-wallet`),
        },
      }),
    ),
  },
};

function testAccountAddress(seed: string): string {
  const hex = Array.from(seed)
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  return `0x${hex.padEnd(40, '0').slice(0, 40)}`;
}

async function seedMinimalVotingLocations(conn: Connection) {
  const now = new Date();
  await conn.collection('departments').updateOne(
    { name: 'La Paz' },
    {
      $setOnInsert: {
        _id: new Types.ObjectId('650000000000000000000001'),
        name: 'La Paz',
        active: true,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
  await conn.collection('municipalities').updateOne(
    { name: 'Cochabamba' },
    {
      $setOnInsert: {
        _id: new Types.ObjectId('650000000000000000000002'),
        name: 'Cochabamba',
        active: true,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true },
  );
}

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Acceso tenant E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let applicationsService: InstitutionalAdminApplicationsService;
  let adminToken: string;
  let accessApproverToken: string;
  let governorToken: string;
  let mayorToken: string;
  let governorUserId: string;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;

  beforeAll(async () => {
    previousIdentityBaseUrl = process.env.IDENTITY_BASE_URL;
    previousIdentityApiKey = process.env.IDENTITY_API_KEY;
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{
        launchTimeout: 120000,
      }],
    });
    await mongod.waitUntilRunning();
    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        TestLoggerModule,
        AuthModule,
        ContractsModule,
        InstitutionalTenantsModule,
        InstitutionalAdminApplicationsModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    })
      .overrideProvider(MailService)
      .useValue(MailMockService)
      .overrideProvider(HttpService)
      .useValue(IdentityHttpMockService)
      .overrideProvider(IncentiveCampaignsService)
      .useValue(mockIncentiveCampaignsService)
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
    installMx02SyntheticChainConfig();
    await seedMinimalVotingLocations(conn);
    const users = await seedUsers(conn);
    const admin = await seedAdmin(conn);
    await conn.collection('roled_users').insertOne({
      dni: '7',
      active: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      passwordResetToken: null,
      passwordResetTokenExpiresAt: null,
      email: 'access.approver@example.com',
      name: 'Access Approver',
      password: '$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu',
      role: 'ACCESS_APPROVER',
      votingDepartmentId: null,
      votingMunicipalityId: null,
    });
    governorUserId = users.get('governorLaPaz')._id.toString();

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: admin?.email, password: 'secret123' })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    const accessApproverLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'access.approver@example.com', password: 'secret123' })
      .expect(200);
    accessApproverToken = accessApproverLogin.body.accessToken;

    const governorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: users.get('governorLaPaz').email, password: 'secret123' })
      .expect(200);
    governorToken = governorLogin.body.accessToken;

    const mayorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: users.get('mayorCbba').email, password: 'secret123' })
      .expect(200);
    mayorToken = mayorLogin.body.accessToken;
  }, 240000);

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
    restoreMx02SyntheticChainConfig();
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function confirmInstitutionCreation(applicationId: string) {
    await applicationsService.processInstitutionCreationOperation(applicationId);
    const applicationDoc = await conn
      .collection('institutional_admin_applications')
      .findOne({ _id: new Types.ObjectId(applicationId) });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValueOnce(
      applicationDoc?.accountAddress,
    );
    await applicationsService.reconcileInstitutionCreationOperation(applicationId);
  }

  function getLastMailToken() {
    const lastCall =
      MailMockService.sendEmail.mock.calls[
        MailMockService.sendEmail.mock.calls.length - 1
      ];
    const verificationLink: string = lastCall?.[3]?.verificationLink;
    const url = new URL(verificationLink);
    return url.searchParams.get('token');
  }

  async function createAndVerifyApplication(payload: {
    dni: string;
    email: string;
    name: string;
    institutionName: string;
    accountAddress?: string;
  }) {
    MailMockService.sendEmail.mockClear();

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        ...payload,
        password: 'secret123',
      })
      .expect(201);

    const token = getLastMailToken();
    expect(token).toBeTruthy();

    const verifyRes = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token })
      .expect(201);

    return {
      createRes,
      verifyRes,
    };
  }

  async function createUnverifiedApplication(payload: {
    dni: string;
    email: string;
    name: string;
    institutionName: string;
    accountAddress?: string;
  }) {
    MailMockService.sendEmail.mockClear();

    return request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        ...payload,
        password: 'secret123',
      })
      .expect(201);
  }

  async function registerAndApproveTerritorialUser(payload: {
    dni: string;
    email: string;
    name: string;
    departmentId?: string;
    municipalityId?: string;
  }) {
    MailMockService.sendEmail.mockClear();

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        dni: payload.dni,
        email: payload.email,
        name: payload.name,
        password: 'secret123',
        votingDepartmentId: payload.departmentId,
        votingMunicipalityId: payload.municipalityId,
      })
      .expect(201);

    const verifyToken = getLastMailToken();
    expect(verifyToken).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: verifyToken })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${registerRes.body._id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({ approve: true, reason: 'Territorial aprobado' })
      .expect(201);

    return registerRes.body;
  }

  async function registerPendingTerritorialUser(payload: {
    dni: string;
    email: string;
    name: string;
    departmentId?: string;
    municipalityId?: string;
  }) {
    MailMockService.sendEmail.mockClear();

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        dni: payload.dni,
        email: payload.email,
        name: payload.name,
        password: 'secret123',
        votingDepartmentId: payload.departmentId,
        votingMunicipalityId: payload.municipalityId,
      })
      .expect(201);

    const verifyToken = getLastMailToken();
    expect(verifyToken).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: verifyToken })
      .expect(200);

    return registerRes.body;
  }

it('D-PERM-001 | login de ACCESS_APPROVER devuelve contexto de aprobaciones', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'access.approver@example.com', password: 'secret123' })
      .expect(200);

    expect(loginRes.body.role).toBe('ACCESS_APPROVER');
    expect(loginRes.body.availableContexts).toEqual([
      expect.objectContaining({
        type: 'ACCESS_APPROVALS',
        role: 'ACCESS_APPROVER',
      }),
    ]);
    expect(loginRes.body.requiresContextSelection).toBe(false);
    expect(loginRes.body.defaultContext).toEqual(
      expect.objectContaining({ type: 'ACCESS_APPROVALS' }),
    );
  });

it('D-MULTI-001 / D-MULTI-002 | login devuelve contextos múltiples para usuario territorial con acceso tenant aprobado', async () => {
    const tenantRes = await request(app.getHttpServer())
      .post('/api/v1/institutional-tenants')
      .auth(adminToken, { type: 'bearer' })
      .send({
        name: `Tenant Context ${Date.now()}`,
        description: 'Tenant de contexto',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${tenantRes.body.id}/admins`)
      .auth(adminToken, { type: 'bearer' })
      .send({ userId: governorUserId, active: true })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'glp@example.com', password: 'secret123' })
      .expect(200);

    expect(loginRes.body.availableContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TERRITORIAL', role: 'GOVERNOR' }),
        expect.objectContaining({
          type: 'TENANT',
          tenantId: tenantRes.body.id,
          tenantName: expect.any(String),
          hasWallet: false,
          requiresWalletUpdate: true,
          walletStatus: 'MISSING',
        }),
      ]),
    );
    expect(JSON.stringify(loginRes.body)).not.toContain('accountAddressNormalized');
    expect(loginRes.body.requiresContextSelection).toBe(true);
    expect(loginRes.body.defaultContext).toBeNull();

    const statusRes = await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .auth(loginRes.body.accessToken, { type: 'bearer' })
      .expect(200);

    expect(statusRes.body.tenant.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: tenantRes.body.id,
          hasWallet: false,
          requiresWalletUpdate: true,
          walletStatus: 'MISSING',
        }),
      ]),
    );
    expect(JSON.stringify(statusRes.body)).not.toContain('accountAddressNormalized');
  });

it('D-REQ-001 | mantiene solicitud tenant pendiente y la lista para ADMIN', async () => {
    const email = `pending-${Date.now()}@example.com`;
    const created = await createAndVerifyApplication({
      dni: `P${Date.now()}`,
      email,
      name: 'Pending Tenant',
      institutionName: `Institution Pending ${Date.now()}`,
    });

    const pendingRes = await request(app.getHttpServer())
      .get('/api/v1/institutional-admin-applications/pending')
      .auth(adminToken, { type: 'bearer' })
      .expect(200);

    expect(pendingRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.createRes.body.id,
          email,
          status: 'PENDING_APPROVAL',
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('La solicitud institucional está pendiente de aprobación');
        expect(res.body.code).toBe('TENANT_ACCESS_PENDING');
      });
  });

it('D-MAIL-006 | bloquea login de solicitud institucional pendiente de verificación de correo sin consultar Identity', async () => {
    const email = `pending-email-${Date.now()}@example.com`;
    await createUnverifiedApplication({
      dni: `PE${Date.now()}`,
      email,
      name: 'Pending Email Tenant',
      institutionName: `Institution Pending Email ${Date.now()}`,
    });

    IdentityHttpMockService.axiosRef.get.mockClear();

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('El correo electrónico no ha sido verificado');
        expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
        expect(res.body).not.toHaveProperty('accessToken');
      });

    expect(IdentityHttpMockService.axiosRef.get).not.toHaveBeenCalled();
  });

it('D-APR-001 | aprueba acceso tenant y login devuelve contexto tenant por defecto', async () => {
    const email = `approved-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `A${Date.now()}`,
      email,
      name: 'Approved Tenant',
      institutionName: `Institution Approved ${Date.now()}`,
    });

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    expect(loginRes.body.availableContexts).toEqual([
      expect.objectContaining({
        type: 'TENANT',
        tenantId: approveRes.body.tenantId,
      }),
    ]);
    expect(loginRes.body.requiresContextSelection).toBe(false);
    expect(loginRes.body.defaultContext).toEqual(
      expect.objectContaining({
        type: 'TENANT',
        tenantId: approveRes.body.tenantId,
        hasWallet: true,
        requiresWalletUpdate: false,
        walletStatus: 'VERIFIED',
      }),
    );
    expect(loginRes.body.accessStatus.tenant.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: approveRes.body.tenantId,
          hasWallet: true,
          requiresWalletUpdate: false,
          walletStatus: 'VERIFIED',
        }),
      ]),
    );
    expect(JSON.stringify(loginRes.body)).not.toContain('accountAddressNormalized');
    expect(loginRes.body.tenantId).toBe(approveRes.body.tenantId);
  });

it('D-STATE-001 | access-status no marca VERIFIED si la wallet aprobada no tiene metadata de verificacion', async () => {
    const email = `approved-unverified-wallet-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `UW${Date.now()}`,
      email,
      name: 'Approved Tenant Unverified Wallet',
      institutionName: `Institution Unverified Wallet ${Date.now()}`,
    });

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    await conn.collection('tenant_admin_assignments').updateOne(
      { tenantId: new Types.ObjectId(approveRes.body.tenantId) },
      {
        $set: {
          walletVerifiedAt: null,
          walletVerificationSource: null,
        },
      },
    );

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    expect(loginRes.body.defaultContext).toEqual(
      expect.objectContaining({
        type: 'TENANT',
        tenantId: approveRes.body.tenantId,
        hasWallet: true,
        requiresWalletUpdate: true,
        walletStatus: 'MISSING',
      }),
    );
    expect(loginRes.body.accessStatus.tenant.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: approveRes.body.tenantId,
          hasWallet: true,
          requiresWalletUpdate: true,
          walletStatus: 'MISSING',
        }),
      ]),
    );
    expect(JSON.stringify(loginRes.body)).not.toContain('accountAddressNormalized');
  });

it('D-DIS-001 | bloquea login de usuario institucional aprobado pero deshabilitado', async () => {
    const email = `disabled-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `D${Date.now()}`,
      email,
      name: 'Disabled Tenant',
      institutionName: `Institution Disabled ${Date.now()}`,
    });

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    await conn.collection('roled_users').updateOne(
      { _id: new Types.ObjectId(approveRes.body.userId) },
      { $set: { active: false } },
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.code).toBe('USER_INACTIVE');
        expect(res.body).not.toHaveProperty('accessToken');
      });
  });

it('D-DIS-004 | bloquea login cuando assignment o tenant institucional dejan de estar activos', async () => {
    const email = `inactive-assignment-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `IA${Date.now()}`,
      email,
      name: 'Inactive Assignment Tenant',
      institutionName: `Institution Inactive Assignment ${Date.now()}`,
    });

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    await conn.collection('tenant_admin_assignments').updateOne(
      {
        tenantId: new Types.ObjectId(approveRes.body.tenantId),
        userId: new Types.ObjectId(approveRes.body.userId),
      },
      { $set: { active: false, status: 'REVOKED' } },
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.code).toBe('TENANT_ACCESS_REVOKED');
        expect(res.body).not.toHaveProperty('accessToken');
      });

    await conn.collection('tenant_admin_assignments').updateOne(
      {
        tenantId: new Types.ObjectId(approveRes.body.tenantId),
        userId: new Types.ObjectId(approveRes.body.userId),
      },
      { $set: { active: true, status: 'APPROVED' } },
    );
    await conn.collection('institutional_tenants').updateOne(
      { _id: new Types.ObjectId(approveRes.body.tenantId) },
      { $set: { active: false } },
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.code).toBe('TENANT_ACCESS_REVOKED');
        expect(res.body).not.toHaveProperty('accessToken');
      });
  });

it('D-APR-003 | rechaza solicitud tenant y bloquea el login del solicitante', async () => {
    const email = `rejected-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `R${Date.now()}`,
      email,
      name: 'Rejected Tenant',
      institutionName: `Institution Rejected ${Date.now()}`,
    });

    const rejectRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/reject`)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'Documentación incompleta' })
      .expect(201);

    expect(rejectRes.body.status).toBe('REJECTED');

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401);

    expect(loginRes.body.message).toBe('La solicitud institucional fue rechazada');
  });

it('REG-ACCESS-STATUS-001 | una invitación posterior reemplaza el rechazo histórico en el login', async () => {
    const suffix = Date.now();
    const institutionName = `Institution Retry ${suffix}`;
    const primaryEmail = `primary-retry-${suffix}@example.com`;
    const targetEmail = `target-retry-${suffix}@example.com`;
    const targetDni = `T${suffix}`;
    const primary = await createAndVerifyApplication({
      dni: `P${suffix}`,
      email: primaryEmail,
      name: 'Primary Retry',
      institutionName,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);
    await confirmInstitutionCreation(primary.createRes.body.id);

    const primaryLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: primaryEmail, password: 'secret123' })
      .expect(200);
    const rejected = await createAndVerifyApplication({
      dni: targetDni,
      email: targetEmail,
      name: 'Target Retry',
      institutionName,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${rejected.createRes.body.id}/reject`)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'Rechazo histórico' })
      .expect(201);

    const rejectedApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(rejected.createRes.body.id),
    });
    expect(rejectedApplication).toEqual(expect.objectContaining({ status: 'REJECTED' }));
    const rejectedAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: rejectedApplication?.tenantId,
      userId: rejectedApplication?.userId,
    });
    expect(rejectedAssignment).toEqual(expect.objectContaining({
      status: 'REJECTED',
      active: false,
    }));

    const invitationCreated = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${rejectedApplication?.tenantId}/invitations`)
      .auth(primaryLogin.body.accessToken, { type: 'bearer' })
      .send({ dni: targetDni, name: 'Target Retry' })
      .expect(201);
    const invitation = await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(invitationCreated.body.id),
    });
    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/invitations/${invitationCreated.body.id}/accept`)
      .send({ token: invitation?.invitationToken, email: targetEmail })
      .expect(201);
    expect(accepted.body.applicationStatus).toBe('PENDING_APPROVAL');

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: 'secret123' })
      .expect(401)
      .expect((res) => {
        expect(res.body.code).toBe('TENANT_ACCESS_PENDING');
        expect(res.body.code).not.toBe('TENANT_ACCESS_REJECTED');
      });
  });

it('D-REV-001 | revoca acceso tenant aprobado y bloquea el login del solicitante', async () => {
    const email = `revoked-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `V${Date.now()}`,
      email,
      name: 'Revoked Tenant',
      institutionName: `Institution Revoked ${Date.now()}`,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    const revokeRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/revoke`)
      .auth(adminToken, { type: 'bearer' })
      .send({ reason: 'Acceso retirado por auditoría' })
      .expect(201);

    expect(revokeRes.body.status).toBe('REVOKED');

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401);

    expect(loginRes.body.message).toBe('El acceso institucional fue revocado');
  });

it('D-PERM-001 / D-REQ-002 | ACCESS_APPROVER gestiona solicitudes institucionales sin poder crear tenants manualmente', async () => {
    const email = `approver-tenant-${Date.now()}@example.com`;
    const application = await createAndVerifyApplication({
      dni: `AT${Date.now()}`,
      email,
      name: 'Approver Tenant',
      institutionName: `Institution Approver ${Date.now()}`,
    });

    const pendingRes = await request(app.getHttpServer())
      .get('/api/v1/institutional-admin-applications/pending')
      .auth(accessApproverToken, { type: 'bearer' })
      .expect(200);

    expect(pendingRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: application.createRes.body.id,
          email,
          status: 'PENDING_APPROVAL',
        }),
      ]),
    );

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/institutional-admin-applications/${application.createRes.body.id}`)
      .auth(accessApproverToken, { type: 'bearer' })
      .expect(200);

    expect(detailRes.body).toEqual(
      expect.objectContaining({
        id: application.createRes.body.id,
        email,
        status: 'PENDING_APPROVAL',
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(accessApproverToken, { type: 'bearer' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/institutional-tenants')
      .auth(accessApproverToken, { type: 'bearer' })
      .send({
        name: `Forbidden Tenant ${Date.now()}`,
        description: 'No debe poder crear tenants manualmente',
      })
      .expect(403);
  });

  it('ACCESS_APPROVER gestiona solicitudes territoriales', async () => {
    const lapaz = await conn.collection<Department>('departments').findOne({ name: 'La Paz' });
    const territorialUser = await registerPendingTerritorialUser({
      dni: `AP${Date.now()}`,
      email: `approver-territorial-${Date.now()}@example.com`,
      name: 'Approver Territorial',
      departmentId: lapaz?._id.toString(),
    });

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/contracts/territorial-access-requests')
      .query({ status: 'PENDING_APPROVAL' })
      .auth(accessApproverToken, { type: 'bearer' })
      .expect(200);

    expect(listRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: territorialUser._id,
          territorialAccessStatus: 'PENDING_APPROVAL',
        }),
      ]),
    );

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/contracts/territorial-access-requests/${territorialUser._id}`)
      .auth(accessApproverToken, { type: 'bearer' })
      .expect(200);

    expect(detailRes.body).toEqual(
      expect.objectContaining({
        id: territorialUser._id,
        territorialAccessStatus: 'PENDING_APPROVAL',
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${territorialUser._id}/approve`)
      .auth(accessApproverToken, { type: 'bearer' })
      .send({ approve: true, reason: 'Aprobado por ACCESS_APPROVER' })
      .expect(201);

    const revokeRes = await request(app.getHttpServer())
      .post(`/api/v1/contracts/territorial-access-requests/${territorialUser._id}/revoke`)
      .auth(accessApproverToken, { type: 'bearer' })
      .send({ reason: 'Revocado por ACCESS_APPROVER' })
      .expect(201);

    expect(revokeRes.body.user).toEqual(
      expect.objectContaining({
        id: territorialUser._id,
        territorialAccessStatus: 'REVOKED',
      }),
    );
  });

it('D-PERM-006 | MAYOR y GOVERNOR no pueden consumir endpoints de aprobaciones y el admin tenant solo ve su propia institución', async () => {
    const institutionName = `Institution Scope Own ${Date.now()}`;
    const ownEmail = `tenant-scope-own-${Date.now()}@example.com`;
    const ownApplication = await createAndVerifyApplication({
      dni: `TS${Date.now()}`,
      email: ownEmail,
      name: 'Tenant Scope Own',
      institutionName,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${ownApplication.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(ownApplication.createRes.body.id);

    const ownLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownEmail, password: 'secret123' })
      .expect(200);

    const secondAdminForOwnTenant = await createAndVerifyApplication({
      dni: `TS2${Date.now()}`,
      email: `tenant-scope-second-${Date.now()}@example.com`,
      name: 'Tenant Scope Second Admin',
      institutionName,
    });

    const otherTenantApplication = await createAndVerifyApplication({
      dni: `TO${Date.now()}`,
      email: `tenant-scope-other-${Date.now()}@example.com`,
      name: 'Tenant Scope Other',
      institutionName: `Institution Scope Other ${Date.now()}`,
    });

    const scopedPendingRes = await request(app.getHttpServer())
      .get('/api/v1/institutional-admin-applications/pending')
      .auth(ownLogin.body.accessToken, { type: 'bearer' })
      .expect(200);

    expect(scopedPendingRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: secondAdminForOwnTenant.createRes.body.id }),
      ]),
    );
    expect(scopedPendingRes.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: otherTenantApplication.createRes.body.id }),
      ]),
    );

    for (const token of [mayorToken, governorToken]) {
      const forbiddenRes = await request(app.getHttpServer())
        .get('/api/v1/institutional-admin-applications/pending')
        .auth(token, { type: 'bearer' })
        .expect(403);

      expect(forbiddenRes.body.message).toBe(
        'No autorizado para revisar esta solicitud institucional',
      );
    }
  });

  it('crea un usuario territorial nuevo sin duplicar y lo deja pendiente hasta aprobación ADMIN', async () => {
    const lapaz = await conn.collection<Department>('departments').findOne({ name: 'La Paz' });
    const email = `territorial-${Date.now()}@example.com`;

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        dni: `T${Date.now()}`,
        email,
        name: 'Territorial Pending',
        password: 'secret123',
        votingDepartmentId: lapaz?._id.toString(),
      })
      .expect(201);

    expect(registerRes.body.role).toBe('GOVERNOR');
    expect(registerRes.body.territorialAccessStatus).toBe('PENDING_EMAIL_VERIFICATION');

    const token = getLastMailToken();
    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token })
      .expect(200);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(401);

    expect(loginRes.body.code).toBe('TERRITORIAL_ACCESS_PENDING');
  });

  it('reutiliza el mismo usuario territorial existente cuando solicita acceso tenant', async () => {
    const lapaz = await conn.collection<Department>('departments').findOne({ name: 'La Paz' });
    const email = `both-a-${Date.now()}@example.com`;
    const dni = `BT${Date.now()}`;

    const territorialUser = await registerAndApproveTerritorialUser({
      dni,
      email,
      name: 'Both Access User',
      departmentId: lapaz?._id.toString(),
    });

    const tenantCreate = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni,
        email,
        name: 'Both Access User',
        password: 'secret123',
        institutionName: `Institution Both ${Date.now()}`,
      })
      .expect(201);

    expect(tenantCreate.body.userId).toBe(territorialUser._id);
    expect(tenantCreate.body.status).toBe('PENDING_APPROVAL');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantCreate.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(tenantCreate.body.id);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    expect(loginRes.body.availableContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TERRITORIAL', role: 'GOVERNOR' }),
        expect.objectContaining({ type: 'TENANT' }),
      ]),
    );
  });

  it('reutiliza el mismo usuario tenant aprobado cuando solicita acceso territorial', async () => {
    const cochabamba = await conn
      .collection<Municipality>('municipalities')
      .findOne({ name: 'Cochabamba' });
    const email = `both-b-${Date.now()}@example.com`;
    const dni = `TB${Date.now()}`;

    const tenantApplication = await createAndVerifyApplication({
      dni,
      email,
      name: 'Tenant First User',
      institutionName: `Institution First ${Date.now()}`,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantApplication.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(tenantApplication.createRes.body.id);

    const territorialRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        dni,
        email,
        name: 'Tenant First User',
        password: 'secret123',
        votingMunicipalityId: cochabamba?._id.toString(),
      })
      .expect(201);

    expect(territorialRes.body._id).toBe(tenantApplication.createRes.body.userId);
    expect(territorialRes.body.territorialAccessStatus).toBe('PENDING_APPROVAL');

    await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${territorialRes.body._id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({ approve: true, reason: 'Territorial aprobado' })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    expect(loginRes.body.availableContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'TENANT' }),
        expect.objectContaining({ type: 'TERRITORIAL', role: 'MAYOR' }),
      ]),
    );
  });

it('D-RETRY-001 | no duplica la solicitud tenant si ya existe pendiente para la misma institución', async () => {
    const email = `dup-pending-${Date.now()}@example.com`;
    const dni = `DP${Date.now()}`;
    const institutionName = `Institution Duplicate ${Date.now()}`;

    const application = await createAndVerifyApplication({
      dni,
      email,
      name: 'Duplicate Pending',
      institutionName,
    });

    const retryRes = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni,
        email,
        name: 'Duplicate Pending',
        password: 'secret123',
        institutionName,
      });

    expect(retryRes.status).toBe(409);
    expect(retryRes.body.message).toBe('Ya tienes una solicitud pendiente para esta institución.');
  });


  it('D-STATE-004 | access-status informa cuando un usuario territorial no tiene acceso tenant todavía', async () => {
    const lapaz = await conn.collection<Department>('departments').findOne({ name: 'La Paz' });
    const email = `territorial-only-${Date.now()}@example.com`;
    const dni = `TO${Date.now()}`;

    await registerAndApproveTerritorialUser({
      dni,
      email,
      name: 'Territorial Only',
      departmentId: lapaz?._id.toString(),
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    const statusRes = await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .auth(loginRes.body.accessToken, { type: 'bearer' })
      .expect(200);

    expect(statusRes.body.tenant.hasApprovedAccess).toBe(false);
    expect(statusRes.body.tenant.canRequest).toBe(true);
    expect(statusRes.body.tenant.message).toBe('El usuario no tiene acceso institucional aprobado');
  });

  it('access-status informa cuando un usuario tenant no tiene acceso territorial todavía', async () => {
    const email = `tenant-only-${Date.now()}@example.com`;
    const dni = `TN${Date.now()}`;

    const application = await createAndVerifyApplication({
      dni,
      email,
      name: 'Tenant Only',
      institutionName: `Institution Tenant Only ${Date.now()}`,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${application.createRes.body.id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);

    await confirmInstitutionCreation(application.createRes.body.id);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'secret123' })
      .expect(200);

    const statusRes = await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .auth(loginRes.body.accessToken, { type: 'bearer' })
      .expect(200);

    expect(statusRes.body.territorial.hasApprovedAccess).toBe(false);
    expect(statusRes.body.territorial.canRequest).toBe(true);
    expect(statusRes.body.territorial.message).toBe('El usuario no tiene acceso territorial aprobado');
  });
});
