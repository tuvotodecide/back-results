import appConfig from '@/config/app.config';

jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {
    createAuthorizationRequest: jest.fn(() => ({ id: 'mx02-zk-request', body: { scope: [] } })),
    Verifier: { newVerifier: jest.fn() },
  },
  resolver: { EthStateResolver: jest.fn() },
}));

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class {
    getAuthRequest() { return { apiKey: 'mx02-zk', request: { body: { scope: [] } } }; }
    getVoteRequest() { return { request: { body: { scope: [] } } }; }
    getRewardRequest() { return { request: { body: { scope: [] } } }; }
    async zkAuthCallback() { return { from: 'did:iden3:mx02' }; }
    async zkRequestCallback() { return { from: 'did:iden3:mx02' }; }
    async isApiKeyValid() { return true; }
  },
}));

jest.mock('@/modules/zk-auth/zk-auth.module', () => {
  const { Module } = jest.requireActual('@nestjs/common');
  const { ZkAuthService } = require('@/modules/zk-auth/services/zk-auth.service');
  class ZkAuthModule {}
  Module({ providers: [ZkAuthService], exports: [ZkAuthService] })(ZkAuthModule);
  return { ZkAuthModule };
});

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service', () => ({
  OfficialPublicationMobileZkAuthService: class {
    async createAuthorizationRequest() { return { requestId: 'mx02-publication-zk', request: { body: { scope: [] } } }; }
    async verifyAuthorizationResponse() { return { sub: 'mx02-publication-zk' }; }
  },
}));

jest.mock('@/modules/institutional-voting/services/core/vote-writter.service', () => ({
  VoteWritterService: class {},
}));

jest.mock('@/api/vote', () => ({
  VoteContractReads: {
    getInstitutionAdmin: jest.fn().mockResolvedValue('0x0000000000000000000000000000000000000000'),
    isAuthorizedAddress: jest.fn().mockResolvedValue(false),
  },
}));

import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalTenantAdminGuard } from '@/modules/institutional-tenants/guards/institutional-tenant-admin.guard';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplication } from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';
import { VoteContractReads } from '@/api/vote';

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Regularización de wallet', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let accessService: InstitutionalVotingAccessService;
  let currentUser: any;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;

  const httpService = {
    axiosRef: {
      post: jest.fn(),
      get: jest.fn(),
    },
  };

  beforeAll(async () => {
    previousIdentityBaseUrl = process.env.IDENTITY_BASE_URL;
    previousIdentityApiKey = process.env.IDENTITY_API_KEY;
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';

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
        TestLoggerModule,
        InstitutionalTenantsModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(InstitutionalTenantAdminGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = currentUser;
          return true;
        }),
      })
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

    accessService = new InstitutionalVotingAccessService(
      {} as any,
      conn.model(InstitutionalTenant.name) as any,
      conn.model(TenantAdminAssignment.name) as any,
      conn.model(InstitutionalAdminApplication.name) as any,
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.post.mockReset();
    httpService.axiosRef.get.mockReset();
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockReset();
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockReset();
    httpService.axiosRef.post.mockResolvedValue({
      data: { registered: true, accountAddress: walletA },
    });
    httpService.axiosRef.get.mockResolvedValue({ data: { records: [] } });
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(
      '0x0000000000000000000000000000000000000000',
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
    currentUser = { sub: String(new Types.ObjectId()), role: 'USER', active: true };
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
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  const walletA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const walletB = '0x2222222222222222222222222222222222222222';

  async function seedLegacyAssignment(overrides: {
    tenantId?: Types.ObjectId;
    userId?: Types.ObjectId;
    role?: string | null;
    status?: string;
    active?: boolean;
    accountAddress?: string | null;
    walletVerified?: boolean;
    userActive?: boolean;
    dni?: string | null;
  } = {}) {
    const tenantId = overrides.tenantId ?? new Types.ObjectId();
    const userId = overrides.userId ?? new Types.ObjectId();
    const dni = overrides.dni === undefined ? `dni-${String(userId).slice(-6)}` : overrides.dni;
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: `Tenant ${String(tenantId).slice(-6)}`,
      nameNorm: `tenant-${String(tenantId).slice(-6)}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertOne({
      _id: userId,
      dni,
      active: overrides.userActive ?? true,
      email: `${String(userId)}@example.test`,
      name: `User ${String(userId).slice(-6)}`,
      password: 'hashed',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const assignmentId = new Types.ObjectId();
    const accountAddress = overrides.accountAddress ?? null;
    const walletVerified = overrides.walletVerified ?? Boolean(accountAddress);
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: assignmentId,
      tenantId,
      userId,
      status: overrides.status ?? 'APPROVED',
      active: overrides.active ?? true,
      accountAddress,
      accountAddressNormalized: accountAddress ? accountAddress.toLowerCase() : null,
      walletVerifiedAt: walletVerified ? new Date() : null,
      walletVerificationSource: walletVerified ? 'TEST' : null,
      institutionalRole: overrides.role === undefined ? 'SECONDARY' : overrides.role,
      approvedAt: new Date(),
      requestedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { tenantId, userId, assignmentId, dni };
  }

  function regularize(
    tenantId: Types.ObjectId,
    body: { dni: string; accountAddress?: string },
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${tenantId}/admins/me/wallet-regularization`)
      .send(body);
  }

  it('[MX-02][D-REG-001][INTEGRACION] / [MX-02][D-REG-002][INTEGRACION] / [MX-02][D-REG-006][INTEGRACION] resuelve wallet por Identity y crea una sola operación si la institución no existe en la red', async () => {
    const seeded = await seedLegacyAssignment({ role: 'PRIMARY' });
    currentUser = { sub: String(seeded.userId), role: 'USER', active: true };

    await expect(
      accessService.resolveAdminWalletForTenant(String(seeded.userId), String(seeded.tenantId)),
    ).rejects.toThrow('wallet operativa');

    const response = await regularize(seeded.tenantId, { dni: seeded.dni! }).expect(201);
    expect(response.body).toMatchObject({
      tenantId: String(seeded.tenantId),
      assignmentId: String(seeded.assignmentId),
      userId: String(seeded.userId),
      accountAddress: walletA,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      walletVerificationSource: 'LEGACY_REGULARIZATION',
      updated: true,
    });
    expect(response.body.dni).toBeUndefined();
    expect(response.body.password).toBeUndefined();
    expect(response.body.accountAddressNormalized).toBeUndefined();

    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://identity.example.test/registry/resolve-account-by-dni',
      { dni: seeded.dni },
      expect.objectContaining({
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );

    await expect(
      accessService.resolveAdminWalletForTenant(String(seeded.userId), String(seeded.tenantId)),
    ).rejects.toThrow('pendiente de confirmacion de la red');

    const stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: seeded.assignmentId });
    expect(stored).toMatchObject({
      accountAddress: walletA,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    });
    const tenant = await conn.collection('institutional_tenants').findOne({ _id: seeded.tenantId });
    expect(tenant?.stableInstitutionId).toBe(String(seeded.tenantId));
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
      stableInstitutionId: String(seeded.tenantId),
      chainStatus: 'PENDING_SEND',
    })).toBe(1);
    expect(VoteContractReads.getInstitutionAdmin).toHaveBeenCalledWith(
      expect.any(String),
      String(seeded.tenantId),
    );
  });

  it('[MX-02][D-REG-003][INTEGRACION] no persiste cuando Identity no encuentra una persona registrada', async () => {
    const rejected = await seedLegacyAssignment();
    currentUser = { sub: String(rejected.userId), role: 'USER', active: true };
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { records: [] } });

    await regularize(rejected.tenantId, { dni: rejected.dni! }).expect(400);
    let stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: rejected.assignmentId });
    expect(stored?.accountAddress).toBeNull();
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: rejected.tenantId,
    })).toBe(0);
  });

  it('[MX-02][D-REG-004][INTEGRACION] no persiste cuando Identity no responde', async () => {
    const timeout = await seedLegacyAssignment();
    currentUser = { sub: String(timeout.userId), role: 'USER', active: true };
    httpService.axiosRef.post.mockRejectedValueOnce(new Error('timeout'));

    await regularize(timeout.tenantId, { dni: timeout.dni! }).expect(503);
    const stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: timeout.assignmentId });
    expect(stored?.accountAddress).toBeNull();
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: timeout.tenantId,
    })).toBe(0);
  });

  it('[MX-02][D-REG-005][INTEGRACION] si la institución ya existe en la red completa metadata sin crear operación nueva', async () => {
    const seeded = await seedLegacyAssignment({
      accountAddress: walletA,
      walletVerified: false,
    });
    currentUser = { sub: String(seeded.userId), role: 'USER', active: true };
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(walletA);

    const response = await regularize(seeded.tenantId, { dni: seeded.dni! }).expect(201);
    expect(response.body).toMatchObject({
      assignmentId: String(seeded.assignmentId),
      accountAddress: walletA,
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      walletVerificationSource: 'LEGACY_REGULARIZATION',
      updated: true,
    });
    expect(httpService.axiosRef.post).toHaveBeenCalledWith(
      'https://identity.example.test/registry/resolve-account-by-dni',
      { dni: seeded.dni },
      expect.objectContaining({
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );

    const stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: seeded.assignmentId });
    expect(stored).toMatchObject({
      accountAddress: walletA,
      accountAddressNormalized: walletA.toLowerCase(),
      walletVerifiedAt: expect.any(Date),
      walletVerificationSource: 'LEGACY_REGULARIZATION',
    });
    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
    })).toBe(0);
  });

  it('[MX-02][D-REG-009][INTEGRACION] / [MX-02][D-REG-010][INTEGRACION] bloquea persona sin permiso, wallet manipulada, cuenta revocada y reemplazo de wallet', async () => {
    const owner = await seedLegacyAssignment({
      accountAddress: walletA.toUpperCase().replace('0X', '0x'),
    });
    const target = await seedLegacyAssignment();
    currentUser = { sub: String(target.userId), role: 'USER', active: true };

    await regularize(target.tenantId, { dni: target.dni! }).expect(409);
    let stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: target.assignmentId });
    expect(stored?.accountAddress).toBeNull();

    currentUser = { sub: String(owner.userId), role: 'USER', active: true };
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: true, accountAddress: walletB },
    });
    await regularize(target.tenantId, { dni: owner.dni! }).expect(403);
    stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: target.assignmentId });
    expect(stored?.accountAddress).toBeNull();

    const revoked = await seedLegacyAssignment({ status: 'REVOKED', active: false });
    currentUser = { sub: String(revoked.userId), role: 'USER', active: true };
    await regularize(revoked.tenantId, { dni: revoked.dni! }).expect(403);

    const withWallet = await seedLegacyAssignment({ accountAddress: walletB });
    currentUser = { sub: String(withWallet.userId), role: 'USER', active: true };
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: true, accountAddress: walletB },
    });
    await regularize(withWallet.tenantId, {
      dni: withWallet.dni!,
      accountAddress: walletA,
    }).expect(400);

    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: true, accountAddress: walletB },
    });
    const sameWallet = await regularize(withWallet.tenantId, { dni: withWallet.dni! }).expect(201);
    expect(sameWallet.body.updated).toBe(false);
    expect(sameWallet.body).toMatchObject({
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
    });
    expect(httpService.axiosRef.post).toHaveBeenCalled();
  });

  it('bloquea formato invalido, relacion inexistente y usuario sin DNI interno', async () => {
    const invalidWallet = await seedLegacyAssignment();
    currentUser = { sub: String(invalidWallet.userId), role: 'USER', active: true };
    await regularize(invalidWallet.tenantId, {
      dni: invalidWallet.dni!,
      accountAddress: 'not-a-wallet',
    }).expect(400);
    expect(httpService.axiosRef.post).not.toHaveBeenCalled();

    const missingRelation = await seedLegacyAssignment();
    await conn
      .collection('tenant_admin_assignments')
      .deleteOne({ _id: missingRelation.assignmentId });
    currentUser = { sub: String(missingRelation.userId), role: 'USER', active: true };
    await regularize(missingRelation.tenantId, { dni: missingRelation.dni! }).expect(403);

    const noDni = await seedLegacyAssignment({ dni: null });
    currentUser = { sub: String(noDni.userId), role: 'USER', active: true };
    await regularize(noDni.tenantId, { dni: '12345678' }).expect(409);
  });

  it('[MX-02][D-REG-007][INTEGRACION] / [MX-02][D-REG-008][INTEGRACION] repetir regularización conserva ID estable y no duplica operación pendiente', async () => {
    const seeded = await seedLegacyAssignment({ role: 'PRIMARY' });
    currentUser = { sub: String(seeded.userId), role: 'USER', active: true };

    await regularize(seeded.tenantId, { dni: seeded.dni! }).expect(201);
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: true, accountAddress: walletA },
    });
    await regularize(seeded.tenantId, { dni: seeded.dni! }).expect(201);

    expect(await conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
      stableInstitutionId: String(seeded.tenantId),
      chainStatus: 'PENDING_SEND',
    })).toBe(1);
    const tenant = await conn.collection('institutional_tenants').findOne({ _id: seeded.tenantId });
    expect(tenant?.stableInstitutionId).toBe(String(seeded.tenantId));
  });
});
