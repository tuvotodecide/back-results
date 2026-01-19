import { AuthController } from "@/modules/auth/controllers/auth.controller";
import { RoledUser, RoledUserSchema } from "@/modules/auth/schemas/roledUser.schema";
import { AuthService } from "@/modules/auth/services/auth.service";
import { Department, DepartmentSchema } from "@/modules/geographic/schemas/department.schema";
import { Municipality, MunicipalitySchema } from "@/modules/geographic/schemas/municipality.schema";
import { MailService } from "@/modules/mail/mail.service";
import { CacheModule } from "@nestjs/cache-manager";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { getConnectionToken, MongooseModule } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Connection } from "mongoose";
import request from 'supertest';
import { seedUsers } from '../utils/seeds/usersSeed';
import { ContractsModule } from "@/modules/contracts/contracts.module";
import { testUser } from "../utils/testing-data";
import { GeographicModule } from "@/modules/geographic/geographic.module";
import { LoggerService } from "@/core/services/logger.service";

const MailMockService = {
  sendEmail: jest.fn(),
  createEmail: jest.fn(),
  getTemplate: jest.fn(),
}

describe('Auth E2E testing + contracts and delegates', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let conn: Connection;

  let users: Map<string, any>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: RoledUser.name, schema: RoledUserSchema },
          { name: Department.name, schema: DepartmentSchema  },
          { name: Municipality.name, schema: MunicipalitySchema },
        ]),
        JwtModule.registerAsync({
          global: true,
          useFactory: (configService: ConfigService) => ({
            secret: configService.get('app.jwt.secret'),
            signOptions: { expiresIn: configService.get('app.jwt.expirationTime') },
          }),
          inject: [ConfigService],
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: MailService,
          useValue: MailMockService,
        },
      ],
    }).compile();

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
    users = await seedUsers(conn);
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  it('should deny no email verificated user login', async () => {
    const notEmailVerifiedUser = users.get('notVerifiedEmail');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: notEmailVerifiedUser.email,
        password: 'secret123',
      })
      .expect(401);
    
    expect(res.body.message).toBe('El correo electrónico no ha sido verificado');
  });

  it('should deny no active user login', async () => {
    const notActiveUser = users.get('notActive');

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: notActiveUser.email,
        password: 'secret123',
      })
      .expect(401);
    
    expect(res.body.message).toBe('El usuario no está activo');
  });

  it('should return BadRequest for register without dni', async () => {
    const { dni, ...req } = testUser;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('dni must be a string');
  });

  it('should return BadRequest for register with empty dni', async () => {
    const req = { ...testUser, dni: '' };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('dni should not be empty');
  });

  it('should return BadRequest for register without email', async () => {
    const { email, ...req } = testUser;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('email must be an email');
  });

  it('should return BadRequest for register with empty email', async () => {
    const req = { ...testUser, email: '' };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('email must be an email');
  });

  it('should return BadRequest for register with invalid email', async () => {
    const req = { ...testUser, email: 'invalid-email' };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('email must be an email');
  });

  it('should return BadRequest for register without password', async () => {
    const { password, ...req } = testUser;

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('password must be a string');
  });

  it('should return BadRequest for register with less than 8 characters password', async () => {
    const req = { ...testUser, password: 'short' };

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(req)
      .expect(400);

    expect(res.body.message).toContain('password must be longer than or equal to 8 characters');
  });
})