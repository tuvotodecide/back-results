jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {
    createAuthorizationRequest: jest.fn(() => ({ id: 'institutional-auth-request' })),
    Verifier: {
      newVerifier: jest.fn(async () => ({
        fullVerify: jest.fn(async () => ({ from: 'did:iden3:test' })),
      })),
    },
  },
  resolver: {
    EthStateResolver: jest.fn(),
  },
}));

import appConfig from '@/config/app.config';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { InstitutionalAccessRecoveryRequestsModule } from '@/modules/institutional-access-recovery-requests/institutional-access-recovery-requests.module';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalApplicationReviewGuard } from '@/modules/institutional-admin-applications/guards/institutional-application-review.guard';
import { InstitutionalAuditModule } from '@/modules/institutional-audit/institutional-audit.module';
import { InstitutionalTenantAdminGuard } from '@/modules/institutional-tenants/guards/institutional-tenant-admin.guard';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { MailService } from '@/modules/mail/mail.service';
import { HttpService } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';

describe('Institutional audit (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let currentUser: any;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;

  const httpService = {
    axiosRef: {
      get: jest.fn(),
      post: jest.fn(),
    },
  };
  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
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
        CacheModule.register({ isGlobal: true }),
        JwtModule.register({ global: true, secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TestLoggerModule,
        InstitutionalAuditModule,
        InstitutionalAdminApplicationsModule,
        InstitutionalTenantsModule,
        InstitutionalAccessRecoveryRequestsModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(MailService)
      .useValue(mailService)
      .overrideGuard(AdminOnlyGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(AccessApproverGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(InstitutionalApplicationReviewGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(InstitutionalTenantAdminGuard)
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
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.get.mockResolvedValue({ data: { ok: true } });
    httpService.axiosRef.post.mockResolvedValue({
      data: { registered: true, accountAddress: walletPrimary },
    });
    mailService.sendEmail.mockResolvedValue(undefined);
    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await conn.collection('institutional_audit_events').deleteMany({});
    await conn.collection('institutional_admin_applications').deleteMany({});
    await conn.collection('institutional_access_recovery_requests').deleteMany({});
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
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

  const walletPrimary = '0x1111111111111111111111111111111111111111';
  const walletSecondary = '0x2222222222222222222222222222222222222222';
  const walletLegacy = '0x3333333333333333333333333333333333333333';

  function postApplication(suffix: string, institutionName = 'Audit Tenant') {
    return request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        dni: `dni-${suffix}`,
        email: `admin-${suffix}@example.test`,
        password: 'Secret1234',
        name: `Admin ${suffix}`,
        institutionName,
        accountAddress: walletPrimary,
      });
  }

  async function createAndApprovePrimary() {
    await conn.collection('institutional_tenants').updateOne(
      { nameNorm: 'audit tenant' },
      {
        $setOnInsert: {
          _id: new Types.ObjectId(),
          name: 'Audit Tenant',
          nameNorm: 'audit tenant',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    const created = await postApplication('primary').expect(201);
    const storedApplication = await conn
      .collection('institutional_admin_applications')
      .findOne({ _id: new Types.ObjectId(created.body.id) });
    currentUser = { sub: String(new Types.ObjectId()), role: 'ACCESS_APPROVER', active: true };
    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token: storedApplication?.verificationToken })
      .expect(201);
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${created.body.id}/approve`)
      .send({})
      .expect(201);
    return approved.body;
  }

  async function seedSecondary(tenantId: string, suffix: string, accountAddress = walletSecondary) {
    const userId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: userId,
      dni: `sec-${suffix}`,
      email: `secondary-${suffix}@example.test`,
      name: `Secondary ${suffix}`,
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: assignmentId,
      tenantId: new Types.ObjectId(tenantId),
      userId,
      status: 'APPROVED',
      active: true,
      accountAddress,
      institutionalRole: 'SECONDARY',
      approvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { userId, assignmentId };
  }

  async function audit(tenantId: string, user = currentUser, query = '') {
    currentUser = user;
    return request(app.getHttpServer())
      .get(`/api/v1/institutional-tenants/${tenantId}/audit${query}`)
      .expect(200);
  }

  it('registro, verificacion y aprobacion producen auditoria segura y consultable por ADMIN', async () => {
    const primary = await createAndApprovePrimary();
    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };

    const response = await audit(primary.tenantId);
    const actions = response.body.data.map((event: any) => event.action);
    expect(actions).toEqual(expect.arrayContaining([
      'INSTITUTIONAL_APPLICATION_CREATED',
      'INSTITUTIONAL_EMAIL_VERIFIED',
      'TENANT_ADMIN_ASSIGNMENT_CREATED',
      'INSTITUTIONAL_APPLICATION_APPROVED',
    ]));
    expect(JSON.stringify(response.body)).not.toContain('Secret1234');
    expect(JSON.stringify(response.body)).not.toContain('verificationToken');
    expect(JSON.stringify(response.body)).not.toContain('identity-test-key');
    expect(JSON.stringify(response.body)).not.toContain('dni-primary');
  });

  it('rechazo, reapertura y revocacion producen eventos sin mezclar tenants', async () => {
    const primary = await createAndApprovePrimary();
    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/revoke`)
      .send({ reason: 'revocar' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/reopen`)
      .send({ reason: 'reabrir' })
      .expect(201);

    const rejected = await postApplication('reject', 'Other Audit Tenant').expect(201);
    const storedApplication = await conn
      .collection('institutional_admin_applications')
      .findOne({ _id: new Types.ObjectId(rejected.body.id) });
    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications/verify-email')
      .send({ token: storedApplication?.verificationToken })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${rejected.body.id}/reject`)
      .send({ reason: 'rechazo' })
      .expect(201);

    const response = await audit(primary.tenantId);
    expect(response.body.data.map((event: any) => event.action)).toEqual(
      expect.arrayContaining([
        'INSTITUTIONAL_APPLICATION_REVOKED',
        'INSTITUTIONAL_APPLICATION_REOPENED',
      ]),
    );
    expect(response.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ applicationId: rejected.body.id }),
      ]),
    );
  });

  it('deshabilitacion, rehabilitacion y solicitud de transferencia auditan cambios administrativos', async () => {
    const tenantObjectId = new Types.ObjectId();
    const primaryUserId = new Types.ObjectId();
    const primaryAssignmentId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantObjectId,
      name: 'Audit Tenant Transfer',
      nameNorm: 'audit tenant transfer',
      stableInstitutionId: String(tenantObjectId),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('roled_users').insertOne({
      _id: primaryUserId,
      dni: 'primary-transfer',
      email: 'primary-transfer@example.test',
      name: 'Primary Transfer',
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: primaryAssignmentId,
      tenantId: tenantObjectId,
      userId: primaryUserId,
      accountAddress: walletPrimary,
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const primary = {
      tenantId: String(tenantObjectId),
      userId: String(primaryUserId),
      assignmentId: String(primaryAssignmentId),
    };
    const secondary = await seedSecondary(primary.tenantId, 'audit-1');
    currentUser = { sub: primary.userId, role: 'USER', active: true };

    await request(app.getHttpServer())
      .patch(`/api/v1/institutional-tenants/${primary.tenantId}/admins/${secondary.assignmentId}/status`)
      .send({ active: false, reason: 'pausa' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/institutional-tenants/${primary.tenantId}/admins/${secondary.assignmentId}/status`)
      .send({ active: true, reason: 'vuelve' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${primary.tenantId}/primary/transfer`)
      .send({ assignmentId: String(secondary.assignmentId), reason: 'transferir' })
      .expect(201);

    const assignments = await conn
      .collection('tenant_admin_assignments')
      .find({ tenantId: new Types.ObjectId(primary.tenantId), active: true })
      .toArray();
    expect(assignments.filter((assignment) => assignment.institutionalRole === 'PRIMARY')).toHaveLength(1);
    expect(assignments.find((assignment) => String(assignment._id) === String(secondary.assignmentId))).toMatchObject({
      institutionalRole: 'SECONDARY',
    });
    await expect(conn.collection('institutional_admin_applications').countDocuments({
      tenantId: new Types.ObjectId(primary.tenantId),
      targetAssignmentId: new Types.ObjectId(secondary.assignmentId),
      mobileAuthorizationAction: 'CHANGE_INSTITUTION_ADMIN',
      status: 'PENDING_MOBILE_AUTHORIZATION',
    })).resolves.toBe(1);

    const response = await audit(primary.tenantId, { sub: String(primary.userId), role: 'USER', active: true });
    expect(response.body.data.map((event: any) => event.action)).toEqual(
      expect.arrayContaining([
        'TENANT_ADMIN_SECONDARY_DISABLED',
        'TENANT_ADMIN_SECONDARY_REHABILITATED',
        'TENANT_PRIMARY_TRANSFER_REQUESTED',
      ]),
    );
  });

  it('fallo de transferencia no deja evento de exito', async () => {
    const primary = await createAndApprovePrimary();
    const before = await conn
      .collection('institutional_audit_events')
      .countDocuments({ action: 'TENANT_PRIMARY_TRANSFERRED' });
    currentUser = { sub: primary.userId, role: 'USER', active: true };

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${primary.tenantId}/primary/transfer`)
      .send({ assignmentId: String(new Types.ObjectId()) })
      .expect(404);

    await expect(
      conn.collection('institutional_audit_events').countDocuments({ action: 'TENANT_PRIMARY_TRANSFERRED' }),
    ).resolves.toBe(before);
  });

  it('recuperacion aprobada y rechazada audita sin exponer token ni cambiar assignment', async () => {
    const primary = await createAndApprovePrimary();
    const secondary = await seedSecondary(primary.tenantId, 'recovery');
    currentUser = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };

    const created = await request(app.getHttpServer())
      .post('/api/v1/institutional-access-recovery-requests')
      .send({
        institutionId: primary.tenantId,
        fullName: 'Secondary recovery',
        phoneNumber: '70000000',
        newEmail: 'recovered@example.test',
        supervisorPhoneNumber: '71111111',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(secondary.userId),
        targetAssignmentId: String(secondary.assignmentId),
        reason: 'ok',
      })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post('/api/v1/institutional-access-recovery-requests')
      .send({
        institutionId: primary.tenantId,
        fullName: 'No Candidate',
        phoneNumber: '72222222',
        newEmail: 'rejected-recovery@example.test',
        supervisorPhoneNumber: '73333333',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${rejected.body.requestId}/reject`)
      .send({ reason: 'manual' })
      .expect(201);

    const response = await audit(primary.tenantId);
    expect(response.body.data.map((event: any) => event.action)).toEqual(
      expect.arrayContaining([
        'INSTITUTIONAL_RECOVERY_REQUEST_CREATED',
        'INSTITUTIONAL_RECOVERY_APPROVED',
        'INSTITUTIONAL_RECOVERY_REJECTED',
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('passwordResetToken');
    expect(JSON.stringify(response.body)).not.toContain('70000000');
  });

  it('regularizacion de wallet audita solo cuando Identity confirma', async () => {
    const primary = await createAndApprovePrimary();
    const legacyUserId = new Types.ObjectId();
    const legacyAssignmentId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: legacyUserId,
      dni: 'legacy-wallet',
      email: 'legacy-wallet@example.test',
      name: 'Legacy Wallet',
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: legacyAssignmentId,
      tenantId: new Types.ObjectId(primary.tenantId),
      userId: legacyUserId,
      status: 'APPROVED',
      active: true,
      accountAddress: null,
      institutionalRole: 'SECONDARY',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    currentUser = { sub: String(legacyUserId), role: 'USER', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${primary.tenantId}/admins/me/wallet-regularization`)
      .send({ accountAddress: walletLegacy })
      .expect(201);

    const falseUserId = new Types.ObjectId();
    const falseAssignmentId = new Types.ObjectId();
    await conn.collection('roled_users').insertOne({
      _id: falseUserId,
      dni: 'legacy-false',
      email: 'legacy-false@example.test',
      name: 'Legacy False',
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: falseAssignmentId,
      tenantId: new Types.ObjectId(primary.tenantId),
      userId: falseUserId,
      status: 'APPROVED',
      active: true,
      accountAddress: null,
      institutionalRole: 'SECONDARY',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: false } });
    currentUser = { sub: String(falseUserId), role: 'USER', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-tenants/${primary.tenantId}/admins/me/wallet-regularization`)
      .send({ accountAddress: '0x4444444444444444444444444444444444444444' })
      .expect(400);

    const events = await conn
      .collection('institutional_audit_events')
      .find({ action: 'INSTITUTIONAL_WALLET_REGULARIZED' })
      .toArray();
    expect(events).toHaveLength(1);
    expect(String(events[0].assignmentId)).toBe(String(legacyAssignmentId));
  });

  it('ADMIN consulta, PRIMARY solo su tenant, SECONDARY y ACCESS_APPROVER quedan bloqueados con paginacion estable', async () => {
    const primary = await createAndApprovePrimary();
    const secondary = await seedSecondary(primary.tenantId, 'read');
    const otherTenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: otherTenantId,
      name: 'Other Tenant',
      nameNorm: 'other tenant',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await conn.collection('institutional_audit_events').insertOne({
      tenantId: otherTenantId,
      action: 'INSTITUTIONAL_APPLICATION_CREATED',
      targetType: 'InstitutionalAdminApplication',
      createdAt: new Date(),
    });

    const adminResponse = await audit(primary.tenantId, { sub: String(new Types.ObjectId()), role: 'ADMIN' }, '?limit=2&page=1');
    expect(adminResponse.body.limit).toBe(2);
    expect(adminResponse.body.data.every((event: any) => event.tenantId === primary.tenantId)).toBe(true);

    await audit(primary.tenantId, { sub: primary.userId, role: 'USER', active: true }, '?action=INSTITUTIONAL_APPLICATION_APPROVED');

    currentUser = { sub: String(secondary.userId), role: 'USER', active: true };
    await request(app.getHttpServer())
      .get(`/api/v1/institutional-tenants/${primary.tenantId}/audit`)
      .expect(403);

    currentUser = { sub: String(new Types.ObjectId()), role: 'ACCESS_APPROVER', active: true };
    await request(app.getHttpServer())
      .get(`/api/v1/institutional-tenants/${primary.tenantId}/audit`)
      .expect(403);
  });
});
