import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalTenantAdminGuard } from '@/modules/institutional-tenants/guards/institutional-tenant-admin.guard';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';

describe('Institutional tenant admin management (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let accessService: InstitutionalVotingAccessService;
  let currentUser: any;

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
        TestLoggerModule,
        InstitutionalTenantsModule,
      ],
    })
      .overrideGuard(AdminOnlyGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          req.user = currentUser;
          return currentUser?.role === 'ADMIN';
        }),
      })
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
    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedTenantWithAdmins(suffix = 'base') {
    const tenantId = new Types.ObjectId();
    const primaryUserId = new Types.ObjectId();
    const secondaryUserId = new Types.ObjectId();
    const secondSecondaryUserId = new Types.ObjectId();
    const primaryAssignmentId = new Types.ObjectId();
    const secondaryAssignmentId = new Types.ObjectId();
    const secondSecondaryAssignmentId = new Types.ObjectId();
    const now = new Date();

    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: `Tenant ${suffix}`,
      nameNorm: `tenant ${suffix}`,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await conn.collection('roled_users').insertMany([
      {
        _id: primaryUserId,
        dni: `p-${suffix}`,
        email: `primary-${suffix}@example.com`,
        name: `Primary ${suffix}`,
        password: 'hash',
        role: 'USER',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: secondaryUserId,
        dni: `s1-${suffix}`,
        email: `secondary-${suffix}@example.com`,
        name: `Secondary ${suffix}`,
        password: 'hash',
        role: 'USER',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: secondSecondaryUserId,
        dni: `s2-${suffix}`,
        email: `secondary-two-${suffix}@example.com`,
        name: `Secondary Two ${suffix}`,
        password: 'hash',
        role: 'USER',
        active: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await conn.collection('tenant_admin_assignments').insertMany([
      {
        _id: primaryAssignmentId,
        tenantId,
        userId: primaryUserId,
        accountAddress: '0x0000000000000000000000000000000000000101',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        requestedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: secondaryAssignmentId,
        tenantId,
        userId: secondaryUserId,
        accountAddress: '0x0000000000000000000000000000000000000102',
        institutionalRole: 'SECONDARY',
        status: 'APPROVED',
        active: true,
        requestedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: secondSecondaryAssignmentId,
        tenantId,
        userId: secondSecondaryUserId,
        accountAddress: '0x0000000000000000000000000000000000000103',
        institutionalRole: 'SECONDARY',
        status: 'APPROVED',
        active: true,
        requestedAt: now,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    return {
      tenantId,
      primaryUserId,
      secondaryUserId,
      secondSecondaryUserId,
      primaryAssignmentId,
      secondaryAssignmentId,
      secondSecondaryAssignmentId,
    };
  }

  it('catalogo publico lista solo instituciones activas con busqueda, paginacion y sin datos internos', async () => {
    const activeOne = await seedTenantWithAdmins('catalog-one');
    const activeTwo = await seedTenantWithAdmins('catalog-two');
    await conn.collection('institutional_tenants').insertOne({
      _id: new Types.ObjectId(),
      name: 'Tenant Inactivo Catalog',
      nameNorm: 'tenant inactivo catalog',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/institutional-tenants/public')
      .query({ search: 'Catalog', page: 1, limit: 1 })
      .expect(200);

    expect(response.body.total).toBe(2);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        institutionId: expect.any(String),
        institutionName: expect.stringMatching(/catalog/i),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('accountAddress');
    expect(JSON.stringify(response.body)).not.toContain('admin');
    expect(JSON.stringify(response.body)).not.toContain('dni');
    expect(JSON.stringify(response.body)).not.toContain(String(activeOne.primaryUserId));
    expect(JSON.stringify(response.body)).not.toContain(String(activeTwo.secondaryAssignmentId));

    const sanitized = await request(app.getHttpServer())
      .get('/api/v1/institutional-tenants/public')
      .query({ search: 'Catalog{$ne:null}', page: 1, limit: 10 })
      .expect(200);
    expect(sanitized.body.items).toEqual([]);

    await request(app.getHttpServer())
      .get('/api/v1/institutional-tenants/public')
      .query({ page: 0, limit: 101 })
      .expect(400);
  });

  it('ADMIN lista instituciones con multiples wallets y bloquea roles no globales', async () => {
    const seeded = await seedTenantWithAdmins('global-list');
    const emptyTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: emptyTenantId,
      name: 'Tenant Sin Admins',
      nameNorm: 'tenant sin admins',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.secondSecondaryAssignmentId },
      { $set: { accountAddress: null } },
    );

    currentUser = { role: 'ADMIN', sub: String(new Types.ObjectId()), active: true };
    const response = await request(app.getHttpServer())
      .get('/api/v1/institutional-tenants')
      .query({ search: 'Tenant', page: 1, limit: 10 })
      .expect(200);

    const tenant = response.body.items.find(
      (item: any) => item.tenantId === String(seeded.tenantId),
    );
    expect(tenant).toMatchObject({
      tenantId: String(seeded.tenantId),
      institutionName: 'Tenant global-list',
      active: true,
      hasPrimary: true,
      adminCount: 3,
      walletCount: 2,
    });
    expect(tenant.admins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: String(seeded.primaryAssignmentId),
          institutionalRole: 'PRIMARY',
          accountAddress: '0x0000000000000000000000000000000000000101',
          hasWallet: true,
          walletStatus: 'VERIFIED',
        }),
        expect.objectContaining({
          assignmentId: String(seeded.secondSecondaryAssignmentId),
          institutionalRole: 'SECONDARY',
          accountAddress: null,
          hasWallet: false,
          walletStatus: 'MISSING',
        }),
      ]),
    );
    const empty = response.body.items.find((item: any) => item.tenantId === String(emptyTenantId));
    expect(empty).toMatchObject({
      tenantId: String(emptyTenantId),
      adminCount: 0,
      walletCount: 0,
      admins: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('accountAddressNormalized');
    expect(JSON.stringify(response.body)).not.toContain('dni');
    expect(JSON.stringify(response.body)).not.toContain('hash');

    currentUser = undefined;
    await request(app.getHttpServer())
      .get('/api/v1/institutional-tenants')
      .expect(403);

    for (const role of ['ACCESS_APPROVER', 'USER', 'MAYOR', 'GOVERNOR']) {
      currentUser = { role, sub: String(new Types.ObjectId()), active: true };
      await request(app.getHttpServer())
        .get('/api/v1/institutional-tenants')
        .expect(403);
    }
  });

  it('lista administradores del tenant con roles, wallets y sin secretos ni mezcla cross-tenant', async () => {
    const seeded = await seedTenantWithAdmins('list');
    const otherTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: otherTenantId,
      name: 'Other',
      nameNorm: 'other',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId: otherTenantId,
      userId: new Types.ObjectId(),
      accountAddress: '0x0000000000000000000000000000000000000199',
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };
    const response = await request(app.getHttpServer())
      .get(`/api/v1/institutional-tenants/${seeded.tenantId}/admins`)
      .expect(200);

    expect(response.body.total).toBe(3);
    expect(response.body.data.map((row: any) => row.assignmentId)).toEqual(
      expect.arrayContaining([
        String(seeded.primaryAssignmentId),
        String(seeded.secondaryAssignmentId),
        String(seeded.secondSecondaryAssignmentId),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('hash');
    expect(JSON.stringify(response.body)).not.toContain('dni');
    expect(JSON.stringify(response.body)).not.toContain(String(otherTenantId));
  });

  it('PRIMARY deshabilita y rehabilita SECONDARY, bloqueando acceso operativo mientras esta inactivo', async () => {
    const seeded = await seedTenantWithAdmins('status');
    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };

    await request(app.getHttpServer())
      .patch(
        `/api/v1/institutional-tenants/${seeded.tenantId}/admins/${seeded.secondaryAssignmentId}/status`,
      )
      .send({ active: false, reason: 'Pausa operativa' })
      .expect(200);

    const disabled = await conn.collection('tenant_admin_assignments').findOne({
      _id: seeded.secondaryAssignmentId,
    });
    expect(disabled).toEqual(
      expect.objectContaining({
        institutionalRole: 'SECONDARY',
        status: 'REVOKED',
        active: false,
        accountAddress: '0x0000000000000000000000000000000000000102',
      }),
    );
    await expect(
      accessService.resolveAdminWalletForTenant(
        String(seeded.secondaryUserId),
        String(seeded.tenantId),
      ),
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .patch(
        `/api/v1/institutional-tenants/${seeded.tenantId}/admins/${seeded.secondaryAssignmentId}/status`,
      )
      .send({ active: true })
      .expect(200);

    await expect(
      accessService.resolveAdminWalletForTenant(
        String(seeded.secondaryUserId),
        String(seeded.tenantId),
      ),
    ).resolves.toMatchObject({
      accountAddress: '0x0000000000000000000000000000000000000102',
      institutionalRole: 'SECONDARY',
    });
  });

  it('SECONDARY no administra y PRIMARY de tenant A no administra tenant B', async () => {
    const tenantA = await seedTenantWithAdmins('a');
    const tenantB = await seedTenantWithAdmins('b');

    currentUser = { sub: String(tenantA.secondaryUserId), role: 'USER', active: true };
    await request(app.getHttpServer())
      .patch(
        `/api/v1/institutional-tenants/${tenantA.tenantId}/admins/${tenantA.secondSecondaryAssignmentId}/status`,
      )
      .send({ active: false })
      .expect(403);

    currentUser = { sub: String(tenantA.primaryUserId), role: 'USER', active: true };
    await request(app.getHttpServer())
      .patch(
        `/api/v1/institutional-tenants/${tenantB.tenantId}/admins/${tenantB.secondaryAssignmentId}/status`,
      )
      .send({ active: false })
      .expect(403);
  });

  it('transfiere PRIMARY a un SECONDARY del mismo tenant y conserva wallets', async () => {
    const seeded = await seedTenantWithAdmins('transfer');
    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId), reason: 'Rotacion' })
      .expect(201);

    const assignments = await conn.collection('tenant_admin_assignments')
      .find({ tenantId: seeded.tenantId, active: true, status: 'APPROVED' })
      .toArray();
    expect(assignments.filter((row) => row.institutionalRole === 'PRIMARY')).toHaveLength(1);
    expect(assignments.find((row) => row._id.equals(seeded.secondaryAssignmentId))).toMatchObject({
      institutionalRole: 'PRIMARY',
      accountAddress: '0x0000000000000000000000000000000000000102',
    });
    expect(assignments.find((row) => row._id.equals(seeded.primaryAssignmentId))).toMatchObject({
      institutionalRole: 'SECONDARY',
      accountAddress: '0x0000000000000000000000000000000000000101',
    });
  });

  it('transferencias concurrentes producen un unico PRIMARY y un unico ganador', async () => {
    const seeded = await seedTenantWithAdmins('race');
    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
        .send({ assignmentId: String(seeded.secondaryAssignmentId) }),
      request(app.getHttpServer())
        .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
        .send({ assignmentId: String(seeded.secondSecondaryAssignmentId) }),
    ]);

    const statuses = results.map((result: any) => result.value?.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.some((status) => [403, 409].includes(status))).toBe(true);
    const primaryCount = await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: seeded.tenantId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    });
    expect(primaryCount).toBe(1);
  });

  it('ADMIN designa PRIMARY cuando el tenant no tiene principal y ACCESS_APPROVER no administra', async () => {
    const seeded = await seedTenantWithAdmins('designate');
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.primaryAssignmentId },
      { $set: { institutionalRole: 'SECONDARY' } },
    );

    currentUser = { sub: String(new Types.ObjectId()), role: 'ACCESS_APPROVER', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId) })
      .expect(403);

    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId) })
      .expect(201);

    expect(
      await conn.collection('tenant_admin_assignments').countDocuments({
        tenantId: seeded.tenantId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }),
    ).toBe(1);
  });
});
