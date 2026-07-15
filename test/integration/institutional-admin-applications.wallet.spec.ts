import appConfig from '@/config/app.config';
import { HttpService } from '@nestjs/axios';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { MailService } from '@/modules/mail/mail.service';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { TestLoggerModule } from '../utils/module-helpers';

const validAccountAddress = '0x1234567890abcdef1234567890abcdef12345678';

describe('Institutional admin application wallet validation (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryServer;
  let conn: Connection;
  let previousIdentityBaseUrl: string | undefined;
  let previousIdentityApiKey: string | undefined;

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
    process.env.IDENTITY_BASE_URL = 'https://identity.example.test';
    process.env.IDENTITY_API_KEY = 'identity-test-key';
    process.env.EMAIL_VERIFICATION_BASE_URL = 'https://front.example.test';

    mongod = await MongoMemoryServer.create({
      instance: {
        launchTimeout: 120000,
      },
    });

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
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    httpService.axiosRef.get.mockResolvedValue({ data: { ok: true } });
    await conn.collection('institutional_admin_applications').deleteMany({});
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
});
