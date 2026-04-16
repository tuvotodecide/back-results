import {
  RoledUser,
  RoledUserSchema,
} from '@/modules/auth/schemas/roledUser.schema';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { AuthModule } from '@/modules/auth/auth.module';
import { MailService } from '@/modules/mail/mail.service';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AnyObject, Connection, InsertManyResult } from 'mongoose';
import request from 'supertest';
import { seedAdmin, seedContracts, seedUsers } from '../utils/seeds/usersSeed';
import {
  testActiveContract,
  testDelegateObject,
  testDelegatesCsv2String,
  testUser,
} from '../utils/testing-data';
import { seedLocations } from '../utils/seeds/locationsSeed';
import appConfig from '@/config/app.config';
import { mongoLocationFeatures } from '../utils/mongo';
import { RoledUserResponseDto } from '@/modules/auth/dto/register-roled-user.dto';
import { ContractsModule } from '@/modules/contracts/contracts.module';
import { TestLoggerModule } from '../utils/module-helpers';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import Papa from 'papaparse';
import { seedElectionConfigWith } from '../utils/seeds/electionsSeed';
import path from 'path';

// Avoid loading the real zk-auth module (pulls ESM deps) during tests
jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

const MailMockService = {
  sendEmail: jest.fn(),
  createEmail: jest.fn(),
  getTemplate: jest.fn(),
};

jest.setTimeout(180000);

describe('Auth E2E testing + contracts and delegates', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let conn: Connection;

  let users: Map<string, any>;
  let contracts: InsertManyResult<AnyObject>;
  let laPazToken: string;
  let adminToken: string;

  //Flow data
  let registeredUser: RoledUserResponseDto;
  let emailVerificationToken: string;
  let passwordResetToken: string;
  let activeElectionId: string;
  let createdContractId: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: RoledUser.name, schema: RoledUserSchema },
          ...mongoLocationFeatures,
        ]),
        TestLoggerModule,
        AuthModule,
        ContractsModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    })
      .overrideProvider(MailService)
      .useValue(MailMockService)
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
    await seedLocations(conn);
    users = await seedUsers(conn);
    const election = await seedElectionConfigWith(conn, 'activeElection');
    activeElectionId = election.insertedId.toString();
    contracts = await seedContracts(conn, users, 'activeElection');

    const governorLaPaz = users.get('governorLaPaz');
    let res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: governorLaPaz.email,
        password: 'secret123',
      })
      .expect(200);

    laPazToken = res.body!.accessToken;

    const admin = await seedAdmin(conn);
    if (!admin) throw new Error('Admin user not seeded properly');

    res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: admin.email,
        password: 'secret123',
      })
      .expect(200);

    adminToken = res.body!.accessToken;
  });

  async function registerAndVerifyPendingTerritorialUser(overrides: Partial<typeof testUser> = {}) {
    MailMockService.sendEmail.mockClear();

    const laPaz = await conn
      .collection('departments')
      .findOne({ name: 'La Paz' });

    const requestBody = {
      ...testUser,
      dni: String(Date.now()),
      email: `territorial-${Date.now()}@example.com`,
      votingDepartmentId: laPaz?._id.toString(),
      ...overrides,
    };

    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(requestBody)
      .expect(201);

    const verificationLink: string =
      MailMockService.sendEmail.mock.calls[0][3].verificationLink;
    const url = new URL(verificationLink);
    const verificationToken = url.searchParams.get('token');

    expect(verificationToken).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: verificationToken })
      .expect(200);

    return {
      registeredUser: registered.body as RoledUserResponseDto,
      requestBody,
    };
  }

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  it('R1-A: should register as Governor by sending department id', async () => {
    const lapaz = await conn
      .collection('departments')
      .findOne({ name: 'La Paz' });
    const req = { ...testUser, votingDepartmentId: lapaz?._id.toString() };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(201);

    expect(res.body).toHaveProperty('_id');
    expect(res.body).toHaveProperty('email', req.email);
    expect(res.body).toHaveProperty('role', 'GOVERNOR');

    const user = await conn
      .collection<RoledUser>('roled_users')
      .findOne({ email: res.body.email });
    expect(user).not.toBeNull();
    expect(user!.role).toBe('GOVERNOR');
    expect(user!.votingDepartmentId!.toString()).toBe(req.votingDepartmentId);
  });

  it('R1-B: should register as Mayor by sending municipality id', async () => {
    const cochabamba = await conn
      .collection<Municipality>('municipalities')
      .findOne({ name: 'Cochabamba' });
    const req = {
      ...testUser,
      dni: '6287342',
      email: 'user2@example.com',
      votingDepartmentId: undefined,
      votingMunicipalityId: cochabamba?._id.toString(),
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(201);

    expect(res.body).toHaveProperty('_id');
    expect(res.body).toHaveProperty('email', req.email);
    expect(res.body).toHaveProperty('role', 'MAYOR');

    const user = await conn
      .collection<RoledUser>('roled_users')
      .findOne({ email: res.body.email });
    expect(user).not.toBeNull();
    expect(user!.role).toBe('MAYOR');
    expect(user!.votingMunicipalityId!.toString()).toBe(
      req.votingMunicipalityId,
    );
  });

  it('R2: should send email verification on registration', async () => {
    MailMockService.sendEmail.mockClear();

    const cochabamba = await conn
      .collection<Department>('departments')
      .findOne({ name: 'Cochabamba' });
    const req = {
      ...testUser,
      dni: '6435645',
      email: 'user3@example.com',
      votingDepartmentId: cochabamba?._id.toString(),
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(201);

    expect(MailMockService.sendEmail).toHaveBeenCalled();
    expect(MailMockService.sendEmail.mock.calls[0][0]).toBe(req.email);
    expect(MailMockService.sendEmail.mock.calls[0][1]).toBe(
      'Verificación de correo electrónico',
    );
    expect(MailMockService.sendEmail.mock.calls[0][2]).toBe('verify-email');
    expect(MailMockService.sendEmail.mock.calls[0][3]).toHaveProperty(
      'name',
      req.name.split(' ')[0],
    );
    expect(
      MailMockService.sendEmail.mock.calls[0][3].verificationLink,
    ).toContain('?token=');

    // Extract data for further tests
    registeredUser = res.body;
    const verificationLink: string =
      MailMockService.sendEmail.mock.calls[0][3].verificationLink;
    const url = new URL(verificationLink);
    emailVerificationToken = url.searchParams.get('token')!;
  });

  it('R3-A: should return BadRequest when registering with existing email', async () => {
    const existingUser = users.get('governorLaPaz');

    const req = {
      ...testUser,
      dni: '3425394',
      email: existingUser.email,
      votingDepartmentId: existingUser.votingDepartmentId.toString(),
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(409);

    expect(res.body.message).toBe(
      'El email y el DNI ya están asociados a usuarios distintos; no se puede unificar automáticamente',
    );
  });

  it('R3-B: should return BadRequest when registering with existing dni', async () => {
    const existingUser = users.get('governorLaPaz');

    const req = {
      ...testUser,
      dni: existingUser.dni,
      email: 'user4@example.com',
      votingDepartmentId: existingUser.votingDepartmentId.toString(),
    };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(409);

    expect(res.body.message).toBe(
      'El email y el DNI ya están asociados a usuarios distintos; no se puede unificar automáticamente',
    );
  });

  it('R4-A: should return BadRequest for verify email without token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .expect(400);

    expect(res.body.message).toContain('token must be a string');
  });

  it('R4-B: should return BadRequest for verify email with empty token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: '' })
      .expect(400);

    expect(res.body.message).toContain('token should not be empty');
  });

  it('R4-C: should return BadRequest for verify email with invalid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: 'invalidtoken123' })
      .expect(400);

    expect(res.body.message).toBe('Token de verificación inválido');
  });

  it('R5: should return not verfied email on login attempt before email verification', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: testUser.password,
      })
      .expect(401);

    expect(res.body.message).toBe(
      'El correo electrónico no ha sido verificado',
    );
  });

  it('R6: should verify email with valid token', async () => {
    let res = await request(app.getHttpServer())
      .get('/api/v1/auth/verify-email')
      .query({ token: emailVerificationToken })
      .expect(200);

    expect(res.body).toHaveProperty('email', registeredUser.email);

    res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: testUser.password,
      })
      .expect(401);

    expect(res.body.message).toBe(
      'La solicitud territorial está pendiente de aprobación',
    );
  });

  it('R7-A: should return Unauthorized on approve user without auth token', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${registeredUser._id}/approve`)
      .expect(401);

    expect(res.body.message).toBe('Unauthorized');
  });

  it('R7-B: should return Forbidden on approve user without admin role', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${registeredUser._id}/approve`)
      .auth(laPazToken, { type: 'bearer' })
      .expect(403);

    expect(res.body.message).toBe('Access approver role required');
  });

  it('R8: should approve user as admin', async () => {
    let res = await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${registeredUser._id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        approve: true,
        reason: 'All good',
      })
      .expect(201);

    expect(res.body).toHaveProperty('message', 'Usuario aprobado exitosamente');
    expect(res.body.user).toHaveProperty('id', registeredUser._id);

    // Now login should work
    res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: registeredUser.email,
        password: testUser.password,
      })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
  });

  it('R9: should reject user as admin', async () => {
    const { registeredUser: pendingUser, requestBody } =
      await registerAndVerifyPendingTerritorialUser({
        dni: `${Date.now()}9`,
        email: `rejected-${Date.now()}@example.com`,
      });

    let res = await request(app.getHttpServer())
      .post(`/api/v1/contracts/users/${pendingUser._id}/approve`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        approve: false,
        reason: 'Incomplete documents',
      })
      .expect(201);

    expect(res.body).toHaveProperty('message', 'Usuario rechazado');
    expect(res.body.user).toHaveProperty('id', pendingUser._id);
    expect(res.body.user).toHaveProperty('reason', 'Incomplete documents');

    // Now login shouln't work
    res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: requestBody.email,
        password: testUser.password,
      })
      .expect(401);

    expect(res.body.message).toBe('La solicitud territorial fue rechazada');
  });

  it('R12: should return Unauthorized on reset password without email verified', async () => {
    const notVerifiedEmailUser = users.get('notVerifiedEmail');
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: notVerifiedEmailUser.email })
      .expect(401);

    expect(res.body.message).toBe(
      'El correo electrónico no ha sido verificado',
    );
  });

  it('R13: should return Unauthorized on reset password for inactive user', async () => {
    const inactiveUser = users.get('notActive');
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: inactiveUser.email })
      .expect(401);

    expect(res.body.message).toBe('El usuario no está activo');
  });

  it('R14: should send email on reset password request', async () => {
    MailMockService.sendEmail.mockClear();
    const activeUser = users.get('mayorCbba');

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: activeUser.email, context: 'votacion' })
      .expect(200);

    expect(MailMockService.sendEmail).toHaveBeenCalled();
    expect(MailMockService.sendEmail.mock.calls[0][3].resetLink).toContain(
      '/votacion/restablecer',
    );

    MailMockService.sendEmail.mockClear();

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: activeUser.email, context: 'resultados' })
      .expect(200);

    expect(MailMockService.sendEmail).toHaveBeenCalled();
    expect(MailMockService.sendEmail.mock.calls[0][0]).toBe(activeUser.email);
    expect(MailMockService.sendEmail.mock.calls[0][1]).toBe(
      'Restablecer contraseña',
    );
    expect(MailMockService.sendEmail.mock.calls[0][2]).toBe('reset-password');
    expect(MailMockService.sendEmail.mock.calls[0][3]).toHaveProperty(
      'name',
      activeUser.name.split(' ')[0],
    );
    expect(MailMockService.sendEmail.mock.calls[0][3].resetLink).toContain(
      '?token=',
    );

    // Extract data for further tests
    const resetLink: string =
      MailMockService.sendEmail.mock.calls[0][3].resetLink;
    expect(resetLink).toContain('/resultados/restablecer');
    const url = new URL(resetLink);
    passwordResetToken = url.searchParams.get('token')!;
  });

  it('R14-B: should reject unsupported password reset context', async () => {
    const activeUser = users.get('mayorCbba');

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: activeUser.email, context: 'admin' })
      .expect(400);
  });

  it('R15-A: should return BadRequest on reset password without token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ password: 'newSecret123' })
      .expect(400);

    expect(res.body.message).toContain('token must be a string');
  });

  it('R15-B: should return BadRequest on reset password with empty token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: '', password: 'newSecret123' })
      .expect(400);

    expect(res.body.message).toContain('token should not be empty');
  });

  it('R15-C: should return BadRequest on reset password with invalid token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'invalidtoken123', password: 'newSecret123' })
      .expect(400);

    expect(res.body.message).toBe('Token de restablecimiento inválido');
  });

  it('R16: should reset password with valid token', async () => {
    const userToReset = users.get('mayorCbba');

    let res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: passwordResetToken, password: 'newSecret123' })
      .expect(200);

    // Now login with new password should work
    res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: userToReset.email,
        password: 'newSecret123',
      })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');

    // And not with old password
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: userToReset.email,
        password: 'secret123',
      })
      .expect(403);
  });

  // it('R17-A: should return Unauthorized on delegate import without auth token', async () => {
  //   await request(app.getHttpServer())
  //     .post('/api/v1/delegates/upload-csv')
  //     .attach('file', path.join(__dirname, '../assets/testDelegates.csv'))
  //     .field('contractId', contracts.insertedIds[0].toString())
  //     .expect(401);
  // });

  // it('R17-B: should return Unauthorized on delegate import without admin role', async () => {
  //   await request(app.getHttpServer())
  //     .post('/api/v1/delegates/upload-csv')
  //     .auth(laPazToken, { type: 'bearer' })
  //     .attach('file', path.join(__dirname, '../assets/testDelegates.csv'))
  //     .field('contractId', contracts.insertedIds[0].toString())
  //     .expect(401);
  // });

  it('R18-A: should return Unauthorized on creating single delegate without auth token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/delegates')
      .send({
        ...testDelegateObject,
        contractId: contracts.insertedIds[0].toString(),
      })
      .expect(401);
  });

  it('R18-B: should return Forbidden on creating single delegate without admin role', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/delegates')
      .auth(laPazToken, { type: 'bearer' })
      .send({
        ...testDelegateObject,
        contractId: contracts.insertedIds[0].toString(),
      })
      .expect(403);
  });

  it('R19-A: should upload delegate with admin role', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/delegates/upload-csv')
      .auth(adminToken, { type: 'bearer' })
      .attach('file', path.join(__dirname, '../assets/testDelegates2.csv'))
      .field('contractId', contracts.insertedIds[0].toString())
      .expect(201);

    const { data } = Papa.parse(testDelegatesCsv2String, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (h) => h.trim().toLowerCase(),
    });

    const savedDelegatesCount = await conn
      .collection('delegates')
      .countDocuments({ dni: { $in: data.map((d: any) => d.dni) } });
    expect(savedDelegatesCount).toBe(data.length);

    for (const row of data as any[]) {
      const authRes = await request(app.getHttpServer())
        .get('/api/v1/delegates/check-authorization')
        .auth(adminToken, { type: 'bearer' })
        .query({
          dni: row.dni,
          contractId: contracts.insertedIds[0].toString(),
        })
        .expect(200);

      expect(authRes.body).toHaveProperty('isAuthorized', true);
    }
  });

  it('R19-B: should create single delegate with admin role', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/delegates')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...testDelegateObject,
        dni: '99988833',
        contractId: contracts.insertedIds[0].toString(),
      })
      .expect(201);

    const savedDelegate = await conn
      .collection('delegates')
      .findOne({ dni: '99988833' });
    expect(savedDelegate).not.toBeNull();
    expect(savedDelegate!.name).toBe(testDelegateObject.name);

    const authRes = await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization')
      .auth(adminToken, { type: 'bearer' })
      .query({
        dni: '99988833',
        contractId: contracts.insertedIds[0].toString(),
      })
      .expect(200);

    expect(authRes.body).toHaveProperty('isAuthorized', true);
  });

  it('R20-A: should return Unauthorized on get delegates info without auth token', async () => {
    const contractId = contracts.insertedIds[0].toString();

    await request(app.getHttpServer())
      .get('/api/v1/delegates/contract/' + contractId)
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization')
      .query({
        dni: '1',
        contractId,
      })
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/delegates/authorized-contracts/1')
      .expect(401);
  });

  it('R21-A: should return Unauthorized on delete delegate without auth token', async () => {
    const contractId = contracts.insertedIds[0].toString();

    await request(app.getHttpServer())
      .delete('/api/v1/delegates')
      .send({
        dni: '1',
        contractId,
      })
      .expect(401);
  });

  it('R21-B: should return Forbidden on delete delegate without admin role', async () => {
    const contractId = contracts.insertedIds[0].toString();

    await request(app.getHttpServer())
      .delete('/api/v1/delegates')
      .auth(laPazToken, { type: 'bearer' })
      .send({
        dni: '1',
        contractId,
      })
      .expect(403);
  });

  it('R22: should delete a delegate with admin role', async () => {
    const contractId = contracts.insertedIds[0].toString();

    await request(app.getHttpServer())
      .delete('/api/v1/delegates')
      .auth(adminToken, { type: 'bearer' })
      .send({
        dni: '99988833', //Using previously created delegate
        contractId,
      })
      .expect(200);

    const authRes = await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization')
      .auth(adminToken, { type: 'bearer' })
      .query({
        dni: '99988833',
        contractId: contracts.insertedIds[0].toString(),
      })
      .expect(200);

    expect(authRes.body).toHaveProperty('isAuthorized', false);
  });

  it('R23: should only delete delegates for specified contract', async () => {
    const contractIdDeleted = contracts.insertedIds[0].toString();
    const remainingContractId = contracts.insertedIds[1].toString();
    const newDelegateDni = '77766655';

    await request(app.getHttpServer())
      .post('/api/v1/delegates')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...testDelegateObject,
        dni: newDelegateDni,
        contractId: contractIdDeleted,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/delegates')
      .auth(adminToken, { type: 'bearer' })
      .send({
        ...testDelegateObject,
        dni: newDelegateDni,
        contractId: remainingContractId,
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete('/api/v1/delegates')
      .auth(adminToken, { type: 'bearer' })
      .send({
        dni: newDelegateDni,
        contractId: contractIdDeleted,
      })
      .expect(200);

    const authRes = await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization')
      .auth(adminToken, { type: 'bearer' })
      .query({
        dni: newDelegateDni,
        contractId: contractIdDeleted,
      })
      .expect(200);

    expect(authRes.body).toHaveProperty('isAuthorized', false);

    const authRes2 = await request(app.getHttpServer())
      .get('/api/v1/delegates/check-authorization')
      .auth(adminToken, { type: 'bearer' })
      .query({
        dni: newDelegateDni,
        contractId: remainingContractId,
      })
      .expect(200);

    expect(authRes2.body).toHaveProperty('isAuthorized', true);
  });

  it('R24-A: should return Unauthorized on creating a contract without auth token', async () => {
    const contract = {
      ...testActiveContract,
      clientId: users.get('governorLaPaz')._id.toString(),
      electionId: activeElectionId,
      departmentId: (await conn
        .collection('departments')
        .findOne({ name: 'La Paz' }))!._id.toString(),
    };

    await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .send(contract)
      .expect(401);
  });

  it('R24-B: should return Forbidden on creating a contract without admin role', async () => {
    const contract = {
      ...testActiveContract,
      clientId: users.get('governorLaPaz')._id.toString(),
      electionId: activeElectionId,
      departmentId: (await conn
        .collection('departments')
        .findOne({ name: 'Pando' }))!._id.toString(),
    };

    await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .auth(laPazToken, { type: 'bearer' })
      .send(contract)
      .expect(403);
  });

  it('R25: should create a contract with admin user', async () => {
    const contract = {
      ...testActiveContract,
      clientId: users.get('withoutContract')._id.toString(),
      electionId: activeElectionId,
      departmentId: (await conn
        .collection('departments')
        .findOne({ name: 'La Paz' }))!._id.toString(),
    };

    const contractRes = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .auth(adminToken, { type: 'bearer' })
      .send(contract)
      .expect(201);

    expect(contractRes.body).toHaveProperty('id');
    createdContractId = contractRes.body.id;

    const res = await request(app.getHttpServer())
      .get('/api/v1/contracts')
      .auth(adminToken, { type: 'bearer' })
      .query({
        clientId: contract.clientId,
        electionId: contract.electionId,
        departmentId: contract.departmentId,
      })
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0]).toHaveProperty('id', createdContractId);
    expect(res.body.data[0]).toHaveProperty('active', true);
  });

  it('R26: should return Unauthorized on deactivate contract without auth token', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/contracts/507f1f77bcf86cd799439013/deactivate`) //no existing id
      .expect(401);
  });

  it('R27: should return Forbidden on deactivate contract without admin role', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/contracts/507f1f77bcf86cd799439013/deactivate`) //no existing id
      .auth(laPazToken, { type: 'bearer' })
      .expect(403);
  });

  it('R28: should deactivate contract with admin role', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/contracts/${createdContractId}/deactivate`)
      .auth(adminToken, { type: 'bearer' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/v1/contracts')
      .auth(adminToken, { type: 'bearer' })
      .query({
        clientId: users.get('withoutContract')._id.toString(),
        electionId: activeElectionId,
        departmentId: (await conn
          .collection('departments')
          .findOne({ name: 'La Paz' }))!._id.toString(),
      })
      .expect(200);

    expect(res.body.data.length).toBe(0);
  });
});
