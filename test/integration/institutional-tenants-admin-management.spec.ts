import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplication } from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
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

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Administración de tenants', () => {
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
      conn.model(InstitutionalAdminApplication.name) as any,
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
        accountAddressNormalized: '0x0000000000000000000000000000000000000101',
        walletVerifiedAt: now,
        walletVerificationSource: 'TEST',
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
        accountAddressNormalized: '0x0000000000000000000000000000000000000102',
        walletVerifiedAt: now,
        walletVerificationSource: 'TEST',
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
        accountAddressNormalized: '0x0000000000000000000000000000000000000103',
        walletVerifiedAt: now,
        walletVerificationSource: 'TEST',
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

  it('D-LIST-001 / D-LIST-002 | catalogo publico lista solo instituciones activas con busqueda, paginacion y sin datos internos', async () => {
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

  it('D-LIST-003 / D-PERM-002 | ADMIN lista instituciones con multiples wallets y bloquea roles no globales', async () => {
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

  it('D-LIST-004 / D-LIST-005 | lista administradores del tenant con roles, wallets y sin secretos ni mezcla cross-tenant', async () => {
    const seeded = await seedTenantWithAdmins('list');
    const pendingUserId = new Types.ObjectId();
    const pendingAssignmentId = new Types.ObjectId();
    const revokedUserId = new Types.ObjectId();
    const revokedAssignmentId = new Types.ObjectId();
    const otherTenantId = new Types.ObjectId();
    await conn.collection('roled_users').insertMany([
      {
        _id: pendingUserId,
        dni: 'pending-list',
        email: 'pending-list@example.com',
        name: 'Pendiente List',
        password: 'hash',
        role: 'USER',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: revokedUserId,
        dni: 'revoked-list',
        email: 'revoked-list@example.com',
        name: 'Revoked List',
        password: 'hash',
        role: 'USER',
        active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: pendingAssignmentId,
      tenantId: seeded.tenantId,
      userId: pendingUserId,
      accountAddress: '0x0000000000000000000000000000000000000198',
      institutionalRole: 'SECONDARY',
      status: 'PENDING',
      active: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: revokedAssignmentId,
      tenantId: seeded.tenantId,
      userId: revokedUserId,
      accountAddress: '0x0000000000000000000000000000000000000197',
      institutionalRole: 'SECONDARY',
      status: 'REVOKED',
      active: false,
      revokedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.secondSecondaryAssignmentId },
      { $set: { status: 'SUSPENDED', active: false, suspendedAt: new Date() } },
    );
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

    expect(response.body.total).toBe(5);
    expect(response.body.data.map((row: any) => row.assignmentId)).toEqual(
      expect.arrayContaining([
        String(seeded.primaryAssignmentId),
        String(seeded.secondaryAssignmentId),
        String(seeded.secondSecondaryAssignmentId),
        String(pendingAssignmentId),
        String(revokedAssignmentId),
      ]),
    );
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignmentId: String(seeded.primaryAssignmentId),
          institutionalRole: 'PRIMARY',
          status: 'APPROVED',
          active: true,
          functionalStatus: 'ACCESS_ENABLED',
          functionalStatusLabel: 'Acceso habilitado',
        }),
        expect.objectContaining({
          assignmentId: String(seeded.secondSecondaryAssignmentId),
          institutionalRole: 'SECONDARY',
          status: 'SUSPENDED',
          active: false,
          accountAddress: '0x0000000000000000000000000000000000000103',
          functionalStatus: 'ACCESS_SUSPENDED',
          functionalStatusLabel: 'Acceso suspendido',
        }),
        expect.objectContaining({
          assignmentId: String(pendingAssignmentId),
          institutionalRole: 'SECONDARY',
          status: 'PENDING',
          active: false,
          functionalStatus: 'PENDING_REVIEW',
          functionalStatusLabel: 'Pendiente de revisión',
        }),
        expect.objectContaining({
          assignmentId: String(revokedAssignmentId),
          institutionalRole: 'SECONDARY',
          status: 'REVOKED',
          active: false,
          functionalStatus: 'ACCESS_REMOVED',
          functionalStatusLabel: 'Acceso eliminado',
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('hash');
    expect(JSON.stringify(response.body)).not.toContain('dni');
    expect(JSON.stringify(response.body)).not.toContain(String(otherTenantId));
  });

  it('D-DIS-001 / D-DIS-002 / D-DIS-003 / D-DIS-004 / D-DIS-005 / D-DIS-006 PRIMARY suspende y reactiva SECONDARY sin tocar wallet ni otras instituciones', async () => {
    const seeded = await seedTenantWithAdmins('status');
    const other = await seedTenantWithAdmins('status-other');
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: other.primaryAssignmentId },
      {
        $set: {
          accountAddress: '0x0000000000000000000000000000000000000201',
          accountAddressNormalized: '0x0000000000000000000000000000000000000201',
        },
      },
    );
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: other.secondaryAssignmentId },
      {
        $set: {
          accountAddress: '0x0000000000000000000000000000000000000204',
          accountAddressNormalized: '0x0000000000000000000000000000000000000204',
        },
      },
    );
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: other.secondSecondaryAssignmentId },
      {
        $set: {
          accountAddress: '0x0000000000000000000000000000000000000203',
          accountAddressNormalized: '0x0000000000000000000000000000000000000203',
        },
      },
    );
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: new Types.ObjectId(),
      tenantId: other.tenantId,
      userId: seeded.secondaryUserId,
      accountAddress: '0x0000000000000000000000000000000000000202',
      accountAddressNormalized: '0x0000000000000000000000000000000000000202',
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      requestedAt: new Date(),
      approvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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
        status: 'SUSPENDED',
        active: false,
        accountAddress: '0x0000000000000000000000000000000000000102',
        revokedAt: null,
      }),
    );
    expect(disabled?.suspendedAt).toBeInstanceOf(Date);
    expect(
      await conn.collection('institutional_admin_applications').countDocuments({
        tenantId: seeded.tenantId,
      }),
    ).toBe(0);
    await expect(
      accessService.resolveAdminWalletForTenant(
        String(seeded.secondaryUserId),
        String(seeded.tenantId),
      ),
    ).rejects.toThrow();
    await expect(
      accessService.resolveAdminWalletForTenant(
        String(seeded.secondaryUserId),
        String(other.tenantId),
      ),
    ).resolves.toMatchObject({
      accountAddress: '0x0000000000000000000000000000000000000202',
      institutionalRole: 'SECONDARY',
    });

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

  it('D-PERM-003 / D-MULTI-008 | SECONDARY no administra y PRIMARY de tenant A no administra tenant B', async () => {
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

  it('D-TRF-001 / D-TRF-005 / D-TRF-006 | inicia transferencia PRIMARY con autorizacion movil y conserva roles hasta confirmar red', async () => {
    const seeded = await seedTenantWithAdmins('transfer');
    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };

    const response = await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId), reason: 'Rotacion' })
      .expect(201);
    expect(response.body).toMatchObject({
      tenantId: String(seeded.tenantId),
      targetAssignmentId: String(seeded.secondaryAssignmentId),
      status: 'PENDING_MOBILE_AUTHORIZATION',
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
    });

    const assignments = await conn.collection('tenant_admin_assignments')
      .find({ tenantId: seeded.tenantId, active: true, status: 'APPROVED' })
      .toArray();
    expect(assignments.filter((row) => row.institutionalRole === 'PRIMARY')).toHaveLength(1);
    expect(assignments.find((row) => row._id.equals(seeded.secondaryAssignmentId))).toMatchObject({
      institutionalRole: 'SECONDARY',
      accountAddress: '0x0000000000000000000000000000000000000102',
    });
    expect(assignments.find((row) => row._id.equals(seeded.primaryAssignmentId))).toMatchObject({
      institutionalRole: 'PRIMARY',
      accountAddress: '0x0000000000000000000000000000000000000101',
    });
    await expect(conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
      targetAssignmentId: seeded.secondaryAssignmentId,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      status: 'PENDING_MOBILE_AUTHORIZATION',
    })).resolves.toBe(1);
    await expect(conn.collection('institutional_admin_applications').findOne({
      tenantId: seeded.tenantId,
      targetAssignmentId: seeded.secondaryAssignmentId,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
    })).resolves.toMatchObject({
      approvedBy: seeded.primaryUserId,
      initiatedByAssignmentId: seeded.primaryAssignmentId,
      initiatedByWallet: '0x0000000000000000000000000000000000000101',
    });
    await expect(conn.collection('notification_logs').countDocuments({
      'data.action': 'CHANGE_INSTITUTION_ADMIN',
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
    })).resolves.toBe(1);
  });

  it('D-TRF-007 / D-TRF-011 | transferencias concurrentes dejan una sola solicitud pendiente y roles intactos', async () => {
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
    await expect(conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
    })).resolves.toBe(1);
    const primaryCount = await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: seeded.tenantId,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    });
    expect(primaryCount).toBe(1);
  });

  it('D-TRF-003 / D-TRF-004 | bloquea destino pendiente, suspendido o eliminado sin solicitud movil', async () => {
    const seeded = await seedTenantWithAdmins('blocked-targets');
    currentUser = { sub: String(seeded.primaryUserId), role: 'USER', active: true };

    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.secondaryAssignmentId },
      { $set: { status: 'PENDING', active: false } },
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId) })
      .expect(409);
    await expect(conn.collection('institutional_admin_applications').countDocuments({
      tenantId: seeded.tenantId,
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
    })).resolves.toBe(0);

    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.secondaryAssignmentId },
      { $set: { status: 'SUSPENDED', active: false } },
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId) })
      .expect(409);

    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.secondaryAssignmentId },
      { $set: { status: 'REVOKED', active: false } },
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${seeded.tenantId}/primary/transfer`)
      .send({ assignmentId: String(seeded.secondaryAssignmentId) })
      .expect(409);
    await expect(conn.collection('notification_logs').countDocuments({
      'data.action': 'CHANGE_INSTITUTION_ADMIN',
      'data.tenantId': String(seeded.tenantId),
    })).resolves.toBe(0);
    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: seeded.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    })).resolves.toBe(1);
  });

  it('D-TRF-002 / D-PERM-003 | bloquea transferencia si no existe principal vigente de la institucion', async () => {
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
      .expect(403);

    expect(
      await conn.collection('tenant_admin_assignments').countDocuments({
        tenantId: seeded.tenantId,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }),
    ).toBe(0);
  });
});
