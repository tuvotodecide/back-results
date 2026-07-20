import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalTenantAdminGuard } from '@/modules/institutional-tenants/guards/institutional-tenant-admin.guard';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';

describe('Institutional wallet regularization (integration)', () => {
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
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.get.mockResolvedValue({ data: { ok: true } });
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
      dni: overrides.dni === undefined ? `dni-${String(userId).slice(-6)}` : overrides.dni,
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
    return { tenantId, userId, assignmentId };
  }

  function regularize(tenantId: Types.ObjectId, accountAddress: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${tenantId}/admins/me/wallet-regularization`)
      .send({ accountAddress });
  }

  it('persiste wallet validada y el resolver pasa de bloquear a devolverla sin cambiar rol ni estado', async () => {
    const seeded = await seedLegacyAssignment({ role: 'PRIMARY' });
    currentUser = { sub: String(seeded.userId), role: 'USER', active: true };

    await expect(
      accessService.resolveAdminWalletForTenant(String(seeded.userId), String(seeded.tenantId)),
    ).rejects.toThrow('wallet operativa');

    const response = await regularize(seeded.tenantId, walletA).expect(201);
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

    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: walletA, dnis: expect.any(String) },
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );

    const resolved = await accessService.resolveAdminWalletForTenant(
      String(seeded.userId),
      String(seeded.tenantId),
    );
    expect(resolved.accountAddress).toBe(walletA);
    expect(resolved.institutionalRole).toBe('PRIMARY');

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
  });

  it('no persiste cuando Identity rechaza o no responde', async () => {
    const rejected = await seedLegacyAssignment();
    currentUser = { sub: String(rejected.userId), role: 'USER', active: true };
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: false } });

    await regularize(rejected.tenantId, walletA).expect(400);
    let stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: rejected.assignmentId });
    expect(stored?.accountAddress).toBeNull();

    const timeout = await seedLegacyAssignment();
    currentUser = { sub: String(timeout.userId), role: 'USER', active: true };
    httpService.axiosRef.get.mockRejectedValueOnce(new Error('timeout'));

    await regularize(timeout.tenantId, walletB).expect(503);
    stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: timeout.assignmentId });
    expect(stored?.accountAddress).toBeNull();
  });

  it('completa metadata cuando la misma wallet ya existe sin verificacion persistida', async () => {
    const seeded = await seedLegacyAssignment({
      accountAddress: walletA,
      walletVerified: false,
    });
    currentUser = { sub: String(seeded.userId), role: 'USER', active: true };

    const response = await regularize(seeded.tenantId, walletA).expect(201);
    expect(response.body).toMatchObject({
      assignmentId: String(seeded.assignmentId),
      accountAddress: walletA,
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
      walletVerificationSource: 'LEGACY_REGULARIZATION',
      updated: true,
    });
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: walletA, dnis: expect.any(String) },
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
  });

  it('bloquea wallet de otro usuario, tenant ajeno, cuenta revocada y reemplazo de wallet', async () => {
    const owner = await seedLegacyAssignment({
      accountAddress: walletA.toUpperCase().replace('0X', '0x'),
    });
    const target = await seedLegacyAssignment();
    currentUser = { sub: String(target.userId), role: 'USER', active: true };

    await regularize(target.tenantId, walletA).expect(409);
    let stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: target.assignmentId });
    expect(stored?.accountAddress).toBeNull();

    currentUser = { sub: String(owner.userId), role: 'USER', active: true };
    await regularize(target.tenantId, walletB).expect(409);
    stored = await conn
      .collection('tenant_admin_assignments')
      .findOne({ _id: target.assignmentId });
    expect(stored?.accountAddress).toBeNull();

    const revoked = await seedLegacyAssignment({ status: 'REVOKED', active: false });
    currentUser = { sub: String(revoked.userId), role: 'USER', active: true };
    await regularize(revoked.tenantId, walletB).expect(403);

    const withWallet = await seedLegacyAssignment({ accountAddress: walletB });
    currentUser = { sub: String(withWallet.userId), role: 'USER', active: true };
    await regularize(withWallet.tenantId, walletA).expect(409);

    httpService.axiosRef.get.mockClear();
    const sameWallet = await regularize(withWallet.tenantId, walletB).expect(201);
    expect(sameWallet.body.updated).toBe(false);
    expect(sameWallet.body).toMatchObject({
      hasWallet: true,
      requiresWalletUpdate: false,
      walletStatus: 'VERIFIED',
    });
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
  });

  it('bloquea formato invalido, relacion inexistente y usuario sin DNI interno', async () => {
    const invalidWallet = await seedLegacyAssignment();
    currentUser = { sub: String(invalidWallet.userId), role: 'USER', active: true };
    await regularize(invalidWallet.tenantId, 'not-a-wallet').expect(400);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    const missingRelation = await seedLegacyAssignment();
    await conn
      .collection('tenant_admin_assignments')
      .deleteOne({ _id: missingRelation.assignmentId });
    currentUser = { sub: String(missingRelation.userId), role: 'USER', active: true };
    await regularize(missingRelation.tenantId, walletA).expect(409);

    const noDni = await seedLegacyAssignment({ dni: null });
    currentUser = { sub: String(noDni.userId), role: 'USER', active: true };
    await regularize(noDni.tenantId, walletB).expect(409);
  });
});
