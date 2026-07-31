jest.mock('@/api/account', () => ({
  executeCoinbaseOp: jest.fn().mockResolvedValue({ txHash: '0xabc123' }),
}));

jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {
    createAuthorizationRequest: jest.fn(() => ({ id: 'institutional-auth-request' })),
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
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { TestLoggerModule } from '../utils/module-helpers';
import { executeCoinbaseOp } from '@/api/account';
import { VoteContractCalls, VoteContractReads } from '@/api/vote';

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

  async function confirmPendingMobileAuthorization(targetId: string, deviceId = 'qa-phone-add') {
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${targetId}/claim`)
      .send({ deviceId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${targetId}/submission`)
      .send({ deviceId, userOpHash: `0x${'a'.repeat(64)}` })
      .expect(200);
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    await applicationsService.reconcileMobileAuthorizationOperation(targetId);
  }

it('D-NEW-001 / D-NEW-006 / D-NEW-007 | crea solicitud pendiente solo cuando Identity confirma wallet-DNI', async () => {
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

it('D-NEW-003 / D-NEW-004 | registro acepta institutionId activo, resuelve nombre backend y conserva validacion wallet-DNI', async () => {
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

it('D-NEW-005 | registro rechaza institutionId inexistente o inactivo antes de consultar Identity', async () => {
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
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'INVITATION_CREATED',
      'data.dni': 'inv001',
    })).toBe(1);
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
    httpService.axiosRef.post.mockResolvedValueOnce({
      data: { registered: false, accountAddress: null },
    });
    httpService.axiosRef.get.mockResolvedValueOnce({ data: { records: [] } });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${tenantId}/invitations`)
      .send({ dni: 'noexiste1', name: 'No Existe' })
      .expect(400);

    expect(await conn.collection('institutional_admin_invitations').countDocuments()).toBe(0);
    expect(await conn.collection('notification_logs').countDocuments()).toBe(0);
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
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'INVITATION_CREATED',
      'data.dni': 'dup-inv',
    })).toBe(1);
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
      .expect(201);

    expect(await conn.collection('institutional_admin_invitations').findOne({
      _id: new Types.ObjectId(created.body.id),
    })).toEqual(expect.objectContaining({ status: 'REJECTED', reason: 'No acepta' }));
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

it('D-NEW-013 | rechaza correo duplicado antes de consultar Identity', async () => {
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
    expect(await conn.collection('notification_logs').countDocuments()).toBe(0);
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

it('D-NEW-011 | rechaza wallet manual con formato invalido sin consultar Identity ni persistir', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/institutional-admin-applications')
      .send({ ...validPayload(), accountAddress: '0x123' })
      .expect(400);

    expect(httpService.axiosRef.post).not.toHaveBeenCalled();
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
    expect(await countApplications()).toBe(0);
    expect(await countUsers()).toBe(0);
  });

it('D-NEW-012 | rechaza persona no registrada sin persistencia ni efectos externos', async () => {
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

  it('rechaza persona registrada sin billetera sin guardar billetera vacia', async () => {
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

  it('D-NEW-006 | aprobar una nueva institución deja acceso pendiente de confirmación de red', async () => {
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

  it('D-STATE-001 / D-STATE-002 / D-STATE-003 / D-STATE-004 / D-STATE-005 | expone estados funcionales autoritativos para solicitudes institucionales', async () => {
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

  it('D-NEW-007 | rechazar conserva historial y no crea institución, relación ni operación', async () => {
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

  it('D-NEW-008 | una nueva solicitud tras rechazo obtiene otro ID y no reabre la anterior', async () => {
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

  it('D-NEW-009 | la aprobación usa el ID estable de institución y no el ID de solicitud', async () => {
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

  it('D-NEW-010 | el procesamiento enviado conserva institución y relación inactivas', async () => {
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

  it('D-NEW-011 | un error recuperable conserva la operación y agenda reintento sin activar acceso', async () => {
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

  it('D-NEW-012 | la confirmación de red activa una sola institución y una relación principal', async () => {
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

  it('D-NEW-013 | si la red ya confirmó y el estado local quedó incompleto, reconcilia sin reenviar', async () => {
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

  it('D-NEW-014 | dos aprobaciones y dos workers concurrentes dejan una sola operación efectiva', async () => {
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

  it('D-NEW-015 | el backfill histórico ejecutado dos veces asigna ID estable sin duplicar operaciones', async () => {
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

  it('D-COMPAT-001 / D-COMPAT-002 / D-COMPAT-003 / D-COMPAT-004 / D-COMPAT-005 / D-COMPAT-006 / D-COMPAT-007 / D-COMPAT-008 | el backfill común regulariza históricos sin duplicados ni acceso antes de red', async () => {
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

  it('D-SIGN-001 / D-SIGN-005 / D-SIGN-006 / D-SIGN-007 / D-SIGN-008 / D-SIGN-015 | prepara addAuthorizedAddress con ID estable y registra una sola operación firmada', async () => {
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

  it('D-SIGN-004 | bloquea la firma con billetera distinta sin preparar operación', async () => {
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

  it('D-TRF-005 / D-TRF-006 | prepara changeInstitutionAdmin con ID estable y conserva roles originales', async () => {
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

  it('D-TRF-008 / D-TRF-009 / D-TRF-010 / D-TRF-011 | confirma por getInstitutionAdmin y deja exactamente un principal', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('confirm');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-confirm' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/submission`)
      .send({ deviceId: 'qa-phone-transfer-confirm', userOpHash: `0x${'8'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValueOnce(transfer.primaryWallet);
    const pending = await applicationsService.reconcileMobileAuthorizationOperation(String(transfer.applicationId));
    expect(pending.reconciled).toBe(false);
    await expect(conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      userId: transfer.primaryUserId,
    })).resolves.toBe(1);

    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(transfer.targetWallet);
    const confirmed = await applicationsService.reconcileMobileAuthorizationOperation(String(transfer.applicationId));
    const confirmedAgain = await applicationsService.reconcileMobileAuthorizationOperation(String(transfer.applicationId));
    expect(confirmed.reconciled).toBe(true);
    expect(confirmedAgain.reconciled).toBe(true);
    expect(VoteContractReads.getInstitutionAdmin).toHaveBeenCalledWith(
      expect.any(String),
      transfer.stableInstitutionId,
    );
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').findOne({
      _id: transfer.targetAssignmentId,
    })).toMatchObject({ institutionalRole: 'PRIMARY', accountAddress: transfer.targetWallet });
    expect(await conn.collection('tenant_admin_assignments').findOne({
      _id: transfer.primaryAssignmentId,
    })).toMatchObject({ institutionalRole: 'SECONDARY', accountAddress: transfer.primaryWallet });
    expect(await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    })).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(VoteContractCalls.changeInstitutionAdmin).toHaveBeenCalledTimes(1);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('D-TRF-007 / D-TRF-011 | error recuperable conserva firma y dos workers no duplican transferencia', async () => {
    const transfer = await createPendingPrimaryTransferAuthorization('retry');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-transfer-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${transfer.applicationId}/submission`)
      .send({ deviceId: 'qa-phone-transfer-retry', userOpHash: `0x${'9'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockRejectedValueOnce(new Error('rpc timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId));
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    let stored = await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    });
    expect(stored).toMatchObject({
      status: 'CHAIN_RETRY_PENDING',
      chainStatus: 'RETRY_PENDING',
      mobileAuthorizationUserOpHash: `0x${'9'.repeat(64)}`,
    });

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: transfer.applicationId },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    (VoteContractReads.getInstitutionAdmin as jest.Mock).mockResolvedValue(transfer.targetWallet);
    await Promise.allSettled([
      applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId)),
      applicationsService.processMobileAuthorizationRetry(String(transfer.applicationId)),
    ]);
    stored = await conn.collection('institutional_admin_applications').findOne({
      _id: transfer.applicationId,
    });
    expect(stored).toMatchObject({ status: 'APPROVED', chainStatus: 'CONFIRMED' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: transfer.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
      status: 'APPROVED',
    })).toBe(1);
    expect(VoteContractCalls.changeInstitutionAdmin).toHaveBeenCalledTimes(1);
    expect(executeCoinbaseOp).not.toHaveBeenCalled();
  });

  it('D-SIGN-003 | rechazo móvil cierra la autorización sin firma ni acceso', async () => {
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

  it('D-SIGN-002 / D-SIGN-014 / D-RETRY-004 | autorización vencida no permite firmar y exige una nueva autorización móvil', async () => {
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

  it('D-SIGN-009 / D-SIGN-010 / D-SIGN-011 / D-SIGN-012 / D-SIGN-013 | confirma por isAuthorizedAddress y reconcilia sin reenviar', async () => {
    const { target, primaryApplication, targetApplication, stableInstitutionId, targetWallet } =
      await createPendingMobileAuthorization('sign-confirm');
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-confirm' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-confirm', userOpHash: `0x${'3'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValueOnce(false);
    const pending = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    expect(pending.reconciled).toBe(false);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    })).toBe(0);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    const confirmed = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    const confirmedAgain = await applicationsService.reconcileMobileAuthorizationOperation(target.id);
    expect(confirmed.reconciled).toBe(true);
    expect(confirmedAgain.reconciled).toBe(true);
    expect(VoteContractReads.isAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(VoteContractCalls.addAuthorizedAddress).toHaveBeenCalledTimes(1);
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

  it('D-SIGN-010 / D-RETRY-001 / D-RETRY-002 / D-RETRY-003 / D-RETRY-005 / D-RETRY-007 | reintenta con claim, conserva firma y lee red antes de reenviar', async () => {
    const { target, primaryApplication, targetApplication, targetWallet, stableInstitutionId } =
      await createPendingMobileAuthorization('retry-flow');
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/claim`)
      .send({ deviceId: 'qa-phone-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${target.id}/submission`)
      .send({ deviceId: 'qa-phone-retry', userOpHash: `0x${'4'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockRejectedValueOnce(new Error('rpc timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(target.id);
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    let stored = await conn.collection('institutional_admin_applications').findOne({
      _id: new Types.ObjectId(target.id),
    });
    expect(stored).toMatchObject({
      status: 'CHAIN_RETRY_PENDING',
      chainStatus: 'RETRY_PENDING',
      mobileAuthorizationUserOpHash: `0x${'4'.repeat(64)}`,
    });
    expect(stored?.chainAttempts).toBeGreaterThanOrEqual(2);
    expect(stored?.chainNextRetryAt).toBeInstanceOf(Date);

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(target.id) },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(true);
    const workers = await Promise.allSettled([
      applicationsService.processMobileAuthorizationRetry(target.id),
      applicationsService.processMobileAuthorizationRetry(target.id),
    ]);
    expect(workers).toHaveLength(2);
    expect(VoteContractReads.isAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(VoteContractCalls.addAuthorizedAddress).toHaveBeenCalledTimes(1);
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

  it('D-RETRY-006 | doble notificación conserva una sola autorización móvil activa', async () => {
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

  it('D-REV-001 / D-REV-002 / D-REV-003 / D-REV-004 / D-REV-005 / D-REV-008 / D-REV-009 / D-REV-011 | elimina wallet solo tras confirmación de red', async () => {
    const { target, primaryApplication, targetApplication, stableInstitutionId, targetWallet } =
      await createPendingMobileAuthorization('remove-flow');
    await confirmPendingMobileAuthorization(target.id, 'qa-phone-remove-add');
    (VoteContractCalls.addAuthorizedAddress as jest.Mock).mockClear();
    (VoteContractCalls.removeAuthorizedAddress as jest.Mock).mockClear();
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockClear();

    const targetAssignment = await conn.collection('tenant_admin_assignments').findOne({
      tenantId: primaryApplication?.tenantId,
      userId: targetApplication?.userId,
      active: true,
    });
    expect(targetAssignment).toBeTruthy();

    const created = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Salida de la institución' })
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Doble clic' })
      .expect(201);
    expect(repeated.body.applicationId).toBe(created.body.applicationId);
    expect(created.body).toMatchObject({
      action: 'REMOVE_AUTHORIZED_ADDRESS',
      status: 'PENDING_MOBILE_AUTHORIZATION',
      targetWallet,
      stableInstitutionId,
      canSign: true,
    });
    expect(await conn.collection('notification_logs').countDocuments({
      'data.event': 'MOBILE_AUTHORIZATION_REQUESTED',
      'data.applicationId': created.body.applicationId,
      'data.action': 'REMOVE_AUTHORIZED_ADDRESS',
    })).toBe(1);

    const claim = await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${created.body.applicationId}/claim`)
      .send({ deviceId: 'qa-phone-remove' })
      .expect(200);
    expect(claim.body.execution).toMatchObject({
      action: 'REMOVE_AUTHORIZED_ADDRESS',
      stableInstitutionId,
      targetWallet,
    });
    expect(claim.body.execution.calls).toEqual([
      expect.objectContaining({
        target: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
        value: '0',
        callData: '0x5678',
        purpose: 'REMOVE_AUTHORIZED_ADDRESS',
      }),
    ]);
    expect(VoteContractCalls.removeAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(VoteContractCalls.addAuthorizedAddress).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${created.body.applicationId}/submission`)
      .send({ deviceId: 'qa-phone-remove', userOpHash: `0x${'5'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValueOnce(true);
    const pending = await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);
    expect(pending.reconciled).toBe(false);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: true,
      status: 'APPROVED',
    })).toBe(1);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    const removed = await applicationsService.reconcileMobileAuthorizationOperation(created.body.applicationId);
    expect(removed.reconciled).toBe(true);
    expect(VoteContractReads.isAuthorizedAddress).toHaveBeenCalledWith(
      expect.any(String),
      stableInstitutionId,
      targetWallet,
    );
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: false,
      status: 'REVOKED',
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      tenantId: primaryApplication?.tenantId,
      institutionalRole: 'PRIMARY',
      active: true,
    })).toBe(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      userId: targetApplication?.userId,
      tenantId: { $ne: primaryApplication?.tenantId },
    })).toBe(0);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/tenants/${primaryApplication?.tenantId}/admins/${targetAssignment?._id}/removal-authorizations`)
      .send({ reason: 'Ya eliminado' })
      .expect(409);
  });

  it('D-REV-006 / D-REV-007 | error recuperable de eliminación conserva acceso y reintenta sin duplicar operación', async () => {
    const { target, primaryApplication, targetApplication } =
      await createPendingMobileAuthorization('remove-retry');
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
      .send({ deviceId: 'qa-phone-remove-retry' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-admin-applications/mobile/authorizations/${created.body.applicationId}/submission`)
      .send({ deviceId: 'qa-phone-remove-retry', userOpHash: `0x${'6'.repeat(64)}` })
      .expect(200);

    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockRejectedValueOnce(new Error('rpc timeout'));
    const retry = await applicationsService.processMobileAuthorizationRetry(created.body.applicationId);
    expect(retry).toMatchObject({ processed: true, status: 'RETRY_PENDING' });
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: true,
      status: 'APPROVED',
    })).toBe(1);
    expect(VoteContractCalls.removeAuthorizedAddress).toHaveBeenCalledTimes(1);

    await conn.collection('institutional_admin_applications').updateOne(
      { _id: new Types.ObjectId(created.body.applicationId) },
      { $set: { chainNextRetryAt: new Date(Date.now() - 1000), chainLockedUntil: null } },
    );
    (VoteContractReads.isAuthorizedAddress as jest.Mock).mockResolvedValue(false);
    const confirmed = await applicationsService.processMobileAuthorizationRetry(created.body.applicationId);
    expect(confirmed).toMatchObject({ processed: true, status: 'CONFIRMED', reusedNetworkState: true });
    expect(VoteContractCalls.removeAuthorizedAddress).toHaveBeenCalledTimes(1);
    expect(await conn.collection('tenant_admin_assignments').countDocuments({
      _id: targetAssignment?._id,
      active: false,
      status: 'REVOKED',
    })).toBe(1);
  });

  it('D-REV-010 | bloquea eliminación definitiva del administrador principal', async () => {
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

it('D-REG-009 | rechaza wallet ya usada por otro usuario sin escrituras parciales de aprobacion', async () => {
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

it('D-RETRY-007 | reintento de aprobacion no duplica assignment', async () => {
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
