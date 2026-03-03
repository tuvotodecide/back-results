import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { ContractsModule } from '@/modules/contracts/contracts.module';
import { ElectionsModule } from '@/modules/elections/elections.module';
import { GeographicModule } from '@/modules/geographic/geographic.module';
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
import { seedElectionConfigWith } from './seeds/electionsSeed';
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
  activeElectionId: string;
  governorUserId: string;
  createdContractId: string;
};

export async function bootstrapInstitutionalVotingContext(): Promise<InstitutionalVotingContext> {
  const mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri();

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
      ContractsModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
  }).compile();

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

  const election = await seedElectionConfigWith(conn, 'activeElection');
  const activeElectionId = election.insertedId.toString();

  const loginRes = await request(httpServer).post('/api/v1/auth/login').send({
    email: admin.email,
    password: 'secret123',
  });

  const adminToken = loginRes.body?.accessToken as string;
  const governorUserId = users.get('governorLaPaz')._id.toString() as string;

  const contractRes = await request(httpServer)
    .post('/api/v1/contracts')
    .auth(adminToken, { type: 'bearer' })
    .send({
      clientId: governorUserId,
      electionId: activeElectionId,
      departmentId: users.get('governorLaPaz').votingDepartmentId.toString(),
      startDate: new Date(Date.now() - 60_000).toISOString(),
      endDate: new Date(Date.now() + 86_400_000).toISOString(),
    });

  return {
    app,
    moduleRef,
    conn,
    mongod,
    httpServer,
    adminToken,
    activeElectionId,
    governorUserId,
    createdContractId: contractRes.body?.id,
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
  contractId: string,
  payload: Record<string, unknown>,
) {
  return request(httpServer)
    .post('/api/v1/voting/events')
    .auth(token, { type: 'bearer' })
    .send({ ...payload, contractId });
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
