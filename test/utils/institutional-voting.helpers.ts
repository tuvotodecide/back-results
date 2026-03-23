import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { ElectionsModule } from '@/modules/elections/elections.module';
import { GeographicModule } from '@/modules/geographic/geographic.module';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalVotingModule } from '@/modules/institutional-voting/institutional-voting.module';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import { seedLocations } from './seeds/locationsSeed';
import { seedAdmin, seedUsers } from './seeds/usersSeed';
import { TestLoggerModule } from './module-helpers';

// Evitar cargar ZK real (dependencias ESM/circuitos) en el entorno de test.
jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

export type InstitutionalVotingContext = {
  app: INestApplication;
  moduleRef: TestingModule;
  conn: Connection;
  mongod: MongoMemoryServer;
  httpServer: any;
  adminToken: string;
  tenantAdminToken: string;
  createdTenantId: string;
};

export async function bootstrapInstitutionalVotingContext(): Promise<InstitutionalVotingContext> {
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();

  const firebaseAdminMock = {
    messaging: jest.fn(() => ({
      send: jest.fn().mockResolvedValue('mock-message-id'),
    })),
  };

  const issuerServiceMock = {
    issueCredential: jest.fn(async (dnis: string[]) => {
      return Object.fromEntries(
        dnis.map((dni) => [dni, { credentialData: `mock-credential-${dni}` }]),
      );
    }),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
      MongooseModule.forRoot(mongoUri),
      CacheModule.register({ isGlobal: true }),
      JwtModule.registerAsync({
        global: true,
        useFactory: (configService: ConfigService) => ({
          secret: configService.get('app.jwt.secret'),
          signOptions: {
            expiresIn: configService.get('app.jwt.expirationTime'),
          },
        }),
        inject: [ConfigService],
      }),
      TestLoggerModule,
      AuthModule,
      ElectionsModule,
      GeographicModule,
      InstitutionalTenantsModule,
      InstitutionalAdminApplicationsModule,
      InstitutionalVotingModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
  })
    .overrideProvider('FIREBASE_ADMIN')
    .useValue(firebaseAdminMock)
    .overrideProvider(IssuerService)
    .useValue(issuerServiceMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const conn = moduleRef.get<Connection>(getConnectionToken());
  const httpServer = app.getHttpServer();

  await seedLocations(conn);
  const users = await seedUsers(conn);
  const admin = await seedAdmin(conn);
  if (!admin) {
    throw new Error('Admin user not seeded properly');
  }

  const loginRes = await request(httpServer).post('/api/v1/auth/login').send({
    email: admin.email,
    password: 'secret123',
  });

  const adminToken = loginRes.body?.accessToken as string;

  const tenantRes = await request(httpServer)
    .post('/api/v1/institutional-tenants')
    .auth(adminToken, { type: 'bearer' })
    .send({
      name: `Tenant E2E ${Date.now()}`,
      description: 'Tenant para pruebas institucionales',
    });

  const governorUserId = users.get('governorLaPaz')._id.toString() as string;
  const governorEmail = users.get('governorLaPaz').email as string;

  await request(httpServer)
    .post(`/api/v1/institutional-tenants/${tenantRes.body?.id}/admins`)
    .auth(adminToken, { type: 'bearer' })
    .send({
      userId: governorUserId,
      active: true,
    });

  const tenantAdminLoginRes = await request(httpServer).post('/api/v1/auth/login').send({
    email: governorEmail,
    password: 'secret123',
  });

  return {
    app,
    moduleRef,
    conn,
    mongod,
    httpServer,
    adminToken,
    tenantAdminToken: tenantAdminLoginRes.body?.accessToken as string,
    createdTenantId: tenantRes.body?.id,
  };
}

export async function teardownInstitutionalVotingContext(
  ctx: InstitutionalVotingContext,
): Promise<void> {
  await ctx.app?.close();
  await ctx.conn?.close();
  await ctx.mongod?.stop();
}

export async function createInstitutionalEvent(
  httpServer: any,
  token: string,
  tenantId: string,
  payload: Record<string, unknown>,
) {
  return request(httpServer)
    .post('/api/v1/voting/events')
    .auth(token, { type: 'bearer' })
    .send({ ...payload, tenantId });
}

export async function publishInstitutionalEvent(
  httpServer: any,
  token: string,
  eventId: string,
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/publish`)
    .auth(token, { type: 'bearer' })
    .send({});
}

export async function uploadPadronCsv(
  httpServer: any,
  token: string,
  eventId: string,
  csvContent: string,
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/padron/import`)
    .auth(token, { type: 'bearer' })
    .attach('file', Buffer.from(csvContent, 'utf-8'), 'padron.csv');
}
