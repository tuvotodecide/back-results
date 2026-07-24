import appConfig from '@/config/app.config';
import { HttpService } from '@nestjs/axios';
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
import { InstitutionalApplicationReviewGuard } from '@/modules/institutional-admin-applications/guards/institutional-application-review.guard';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { TestLoggerModule } from '../utils/module-helpers';

const validAccountAddress = '0x1234567890abcdef1234567890abcdef12345678';

describe('Institutional admin application wallet validation (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let accessService: InstitutionalVotingAccessService;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;
  let previousInstitutionalApplicationRateLimit: string | undefined;
  let previousInstitutionalVerifyEmailRateLimit: string | undefined;
  let currentReviewer: any;

  const httpService = {
    axiosRef: {
      get: jest.fn(),
    },
  };

  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
    createEmail: jest.fn(),
    getTemplate: jest.fn(),
  };

  beforeAll(async () => {
    previousIdentityBaseUrl = process.env.IDENTITY_BASE_URL;
    previousIdentityApiKey = process.env.IDENTITY_API_KEY;
    previousInstitutionalApplicationRateLimit =
      process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT;
    previousInstitutionalVerifyEmailRateLimit =
      process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT;
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';
    process.env.EMAIL_VERIFICATION_BASE_URL = 'https://front.example.test';
    process.env.INSTITUTIONAL_APPLICATION_RATE_LIMIT = '1000';
    process.env.INSTITUTIONAL_VERIFY_EMAIL_RATE_LIMIT = '1000';

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
        JwtModule.register({ secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TestLoggerModule,
        InstitutionalAdminApplicationsModule,
      ],
    })
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideProvider(MailService)
      .useValue(mailService)
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
    accessService = new InstitutionalVotingAccessService(
      conn.model(VotingEvent.name) as any,
      conn.model(InstitutionalTenant.name) as any,
      conn.model(TenantAdminAssignment.name) as any,
      conn.model(InstitutionalAdminApplication.name) as any,
    );
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.get.mockResolvedValue({ data: { ok: true } });
    currentReviewer = {
      sub: String(new Types.ObjectId('64f000000000000000000001')),
      role: 'ADMIN',
    };
    await conn.collection('institutional_admin_applications').deleteMany({});
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

  it('crea solicitud pendiente solo cuando Identity confirma wallet-DNI', async () => {
    const payload = validPayload();

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

    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: validAccountAddress, dnis: payload.dni },
        headers: { 'x-api-key': 'identity-test-key' },
      }),
    );
  });

  it('registro acepta institutionId activo, resuelve nombre backend y conserva validacion wallet-DNI', async () => {
    const tenantId = new Types.ObjectId();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Institucion Catalogada',
      nameNorm: 'institucion catalogada',
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
    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/has-dni',
      expect.objectContaining({
        params: { account: validAccountAddress, dnis: payload.dni },
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

    const approveRes = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${response.body.id}/approve`)
      .auth('admin-token', { type: 'bearer' })
      .expect(201);
    expect(approveRes.body.tenantId).toBe(String(tenantId));
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
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({
        ...validPayload(),
        email: `inactive-${Date.now()}@example.com`,
        institutionId: String(inactiveTenantId),
      })
      .expect(400);
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
  });

  it('rechaza correo duplicado antes de consultar Identity', async () => {
    const payload = validPayload();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(201);

    httpService.axiosRef.get.mockClear();

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(payload)
      .expect(409);

    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(await countApplications()).toBe(1);
  });

  it('rechaza payload sin wallet o con formato invalido sin persistir', async () => {
    const missingWalletPayload = validPayload();
    delete (missingWalletPayload as any).accountAddress;

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(missingWalletPayload)
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({ ...validPayload(), accountAddress: '0x123' })
      .expect(400);

    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

  it('rechaza wallet no registrada o incompatible sin exponer propietario ni persistir', async () => {
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { ok: false } });

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(400);

    expect(response.body.message).toBe(
      'La wallet no esta registrada o no corresponde al usuario solicitante.',
    );
    expect(JSON.stringify(response.body)).not.toContain('did');
    expect(JSON.stringify(response.body)).not.toContain('discoverableHash');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

  it('rechaza temporalmente cuando Identity no esta disponible sin persistir', async () => {
    httpService.axiosRef.get.mockRejectedValueOnce(
      Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send(validPayload())
      .expect(503);

    expect(response.body.message).toBe('No se pudo verificar la wallet en este momento');
    expect(JSON.stringify(response.body)).not.toContain('identity-test-key');
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

  it('crea solicitud valida y al aprobar persiste relacion usuario-tenant-wallet', async () => {
    const { id, payload } = await createVerifiedApplication();

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

    const application = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: application?.tenantId,
      userId: application?.userId,
    });

    expect(application?.status).toBe('APPROVED');
    expect(assignment).toEqual(
      expect.objectContaining({
        tenantId: application?.tenantId,
        userId: application?.userId,
        accountAddress: payload.accountAddress,
        status: 'APPROVED',
        active: true,
        institutionalRole: 'PRIMARY',
      }),
    );
  });

  it('permite a ACCESS_APPROVER crear el primer PRIMARY actual', async () => {
    currentReviewer = {
      sub: String(new Types.ObjectId('64f0000000000000000000a1')),
      role: 'ACCESS_APPROVER',
    };
    const { id } = await createVerifiedApplication(
      payloadFor('access-approver-primary', 'Tenant Access Approver', validAccountAddress),
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

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
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

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

  it('aprueba primer administrador como PRIMARY y permite a ese PRIMARY aprobar SECONDARY', async () => {
    const first = await createVerifiedApplication(
      payloadFor('primary-flow', 'Tenant Principal', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${first.id}/approve`)
      .expect(201);

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
        status: 'APPROVED',
        active: true,
      }),
    );

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
    ).resolves.toMatchObject({
      accountAddress: secondWallet,
      institutionalRole: 'SECONDARY',
    });
  });

  it('revoca PRIMARY como inactivo sin promover automaticamente a SECONDARY', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('revoke-primary-real', 'Tenant Revocacion Real', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/approve`)
      .expect(201);
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
        status: 'APPROVED',
        active: true,
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
      .expect(409);

    const pending = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(next.id),
    });
    expect(pending?.status).toBe('PENDING_APPROVAL');
  });

  it('rechaza aprobacion por SECONDARY y por PRIMARY de otro tenant', async () => {
    const tenantA = await createVerifiedApplication(
      payloadFor('tenant-a-primary', 'Tenant A', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantA.id}/approve`)
      .expect(201);
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
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${tenantB.id}/approve`)
      .expect(201);

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

  it('permite a SUPERADMIN aprobar un secundario y bloquea autoaprobacion', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('support-primary', 'Tenant Soporte', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/approve`)
      .expect(201);

    const secondary = await createVerifiedApplication(
      payloadFor('support-secondary', 'Tenant Soporte', '0x00000000000000000000000000000000000000c2'),
    );
    currentReviewer = {
      sub: '64f000000000000000000001',
      role: 'ADMIN',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${secondary.id}/approve`)
      .expect(201);
    const secondaryApplication = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(secondary.id),
    });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: secondaryApplication?.tenantId,
      userId: secondaryApplication?.userId,
    });
    expect(assignment?.institutionalRole).toBe('SECONDARY');

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

  it('bloquea aprobaciones con principal revocado y tenants heredados sin rol explicito', async () => {
    const primary = await createVerifiedApplication(
      payloadFor('revoked-primary', 'Tenant Revocado', validAccountAddress),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${primary.id}/approve`)
      .expect(201);
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

  it('rechaza aprobar solicitud heredada sin wallet y no crea relacion', async () => {
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

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(400);

    expect(await conn.collection('tenant_admin_assignments').countDocuments()).toBe(1);
  });

  it('resolveAdminWalletForTenant devuelve wallet correcta y rechaza tenant incorrecto', async () => {
    const { id, payload } = await createVerifiedApplication();
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/${id}/approve`)
      .expect(201);

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

  it('cuenta heredada aprobada sin wallet no recibe wallet ficticia ni queda lista', async () => {
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
