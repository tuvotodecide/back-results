import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { ElectionsModule } from '@/modules/elections/elections.module';
import { GeographicModule } from '@/modules/geographic/geographic.module';
import { InstitutionalTenantsModule } from '@/modules/institutional-tenants/institutional-tenants.module';
import { InstitutionalAdminApplicationsModule } from '@/modules/institutional-admin-applications/institutional-admin-applications.module';
import { InstitutionalVotingModule } from '@/modules/institutional-voting/institutional-voting.module';
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
import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { VotingOptionDocument } from '@/modules/institutional-voting/schemas/voting-option.schema';
import { PadronResolvedUser } from '@/modules/institutional-voting/services/core/padron-users.service';
import { VotingEventDocument } from '@/modules/institutional-voting/schemas/voting-event.schema';

// Evitar cargar ZK real (dependencias ESM/circuitos) en el entorno de test.
jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: jest.fn().mockImplementation(() => ({
    generateRequest: jest.fn().mockReturnValue({ apiKey: 'mock-api-key', request: {} }),
    zkAuthCallback: jest.fn().mockResolvedValue({}),
    saveApiKey: jest.fn().mockResolvedValue(undefined),
    isApiKeyValid: jest.fn().mockResolvedValue(true),
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
  let mongod: MongoMemoryServer | null = null;

  const firebaseAdminMock = {
    messaging: jest.fn(() => ({
      send: jest.fn().mockResolvedValue('mock-message-id'),
    })),
  };

  const voteReaderServiceMock = {
    getResults: jest.fn(async (voteEventId: string) => {
      return [
        { option: 'Option A', votes: '100' },
        { option: 'Option B', votes: '50' },
      ];
    }),
  };

  const voteWritterServiceMock = {
    createVote: jest.fn(async (event: VotingEventDocument, voters: PadronResolvedUser[], options: VotingOptionDocument[]) => {
      const voteNullifiers = voters.filter(v => v.active).map(() => {
        const uint32 = new Uint32Array(1);
        crypto.getRandomValues(uint32);
        return uint32[0].toString();
      });
      return voteNullifiers;
    }),
    updateVoteSchedule: jest.fn(),
  };

  /*
  const issuerServiceMock = {
    issueCredential: jest.fn(async (dnis: string[]) => {
      return Object.fromEntries(
        dnis.map((dni) => [dni, { credentialData: `mock-credential-${dni}` }]),
      );
    }),
  };*/

  try {
    mongod = await MongoMemoryServer.create({
      instance: {
        launchTimeout: 120000,
      },
    });
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
        InstitutionalTenantsModule,
        InstitutionalAdminApplicationsModule,
        InstitutionalVotingModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    })
      .overrideProvider('FIREBASE_ADMIN')
      .useValue(firebaseAdminMock)
      .overrideProvider(VoteReaderService)
      .useValue(voteReaderServiceMock)
      .overrideProvider(VoteWritterService)
      .useValue(voteWritterServiceMock)
      //.overrideProvider(IssuerService)
      //.useValue(issuerServiceMock)
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
  } catch (error) {
    await mongod?.stop();
    throw error;
  }
}

export async function teardownInstitutionalVotingContext(
  ctx?: Partial<InstitutionalVotingContext> | null,
): Promise<void> {
  await ctx?.app?.close();
  await ctx?.conn?.close();
  await ctx?.mongod?.stop();
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
  payload: Record<string, unknown> = {},
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/publish`)
    .auth(token, { type: 'bearer' })
    .send(payload);
}

export async function validateInstitutionalEventReadiness(
  httpServer: any,
  token: string,
  eventId: string,
) {
  return request(httpServer)
    .get(`/api/v1/voting/events/${eventId}/review-readiness`)
    .auth(token, { type: 'bearer' });
}

export async function markInstitutionalEventReadyForReview(
  httpServer: any,
  token: string,
  eventId: string,
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/ready-for-review`)
    .auth(token, { type: 'bearer' })
    .send({});
}

export async function confirmInstitutionalOfficialPublication(
  httpServer: any,
  token: string,
  eventId: string,
  payload: Record<string, unknown> = {},
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/official-publication/confirm`)
    .auth(token, { type: 'bearer' })
    .send(payload);
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

export async function uploadPadronSource(
  httpServer: any,
  token: string,
  eventId: string,
  content: Buffer | string,
  fileName = 'padron.pdf',
  contentType = 'application/pdf',
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/padron/imports`)
    .auth(token, { type: 'bearer' })
    .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'), {
      filename: fileName,
      contentType,
    });
}

export async function uploadPadronPdf(
  httpServer: any,
  token: string,
  eventId: string,
  pdfContent: Buffer | string,
  fileName = 'padron.pdf',
) {
  return uploadPadronSource(httpServer, token, eventId, pdfContent, fileName, 'application/pdf');
}

export async function uploadPadronImage(
  httpServer: any,
  token: string,
  eventId: string,
  imageContent: Buffer | string,
  fileName = 'padron.png',
  contentType = 'image/png',
) {
  return uploadPadronSource(httpServer, token, eventId, imageContent, fileName, contentType);
}

export async function getPadronImport(
  httpServer: any,
  token: string,
  eventId: string,
  importJobId: string,
) {
  return request(httpServer)
    .get(`/api/v1/voting/events/${eventId}/padron/imports/${importJobId}`)
    .auth(token, { type: 'bearer' });
}

export async function listPadronStaging(
  httpServer: any,
  token: string,
  eventId: string,
  query: { page?: number; limit?: number } = {},
) {
  return request(httpServer)
    .get(`/api/v1/voting/events/${eventId}/padron/staging`)
    .auth(token, { type: 'bearer' })
    .query(query);
}

export async function addPadronStagingEntry(
  httpServer: any,
  token: string,
  eventId: string,
  payload: { ci: string; enabled?: boolean },
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/padron/staging`)
    .auth(token, { type: 'bearer' })
    .send(payload);
}

export async function updatePadronStagingEntry(
  httpServer: any,
  token: string,
  eventId: string,
  entryId: string,
  payload: { ci?: string; enabled?: boolean },
) {
  return request(httpServer)
    .patch(`/api/v1/voting/events/${eventId}/padron/staging/${entryId}`)
    .auth(token, { type: 'bearer' })
    .send(payload);
}

export async function deletePadronStagingEntry(
  httpServer: any,
  token: string,
  eventId: string,
  entryId: string,
) {
  return request(httpServer)
    .delete(`/api/v1/voting/events/${eventId}/padron/staging/${entryId}`)
    .auth(token, { type: 'bearer' });
}

export async function confirmPadronStaging(
  httpServer: any,
  token: string,
  eventId: string,
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/padron/staging/confirm`)
    .auth(token, { type: 'bearer' })
    .send({});
}

export async function getPadronSummary(
  httpServer: any,
  token: string,
  eventId: string,
) {
  return request(httpServer)
    .get(`/api/v1/voting/events/${eventId}/padron/summary`)
    .auth(token, { type: 'bearer' });
}

export async function getPadronCertificateMetadata(
  httpServer: any,
  token: string,
  eventId: string,
  padronVersionId?: string,
) {
  return request(httpServer)
    .get(`/api/v1/voting/events/${eventId}/padron/certificate`)
    .auth(token, { type: 'bearer' })
    .query(padronVersionId ? { padronVersionId } : {});
}

export async function materializePadronCertificate(
  httpServer: any,
  token: string,
  eventId: string,
  payload: { padronVersionId?: string; forceRegenerate?: boolean } = {},
) {
  return request(httpServer)
    .post(`/api/v1/voting/events/${eventId}/padron/certificate/materialize`)
    .auth(token, { type: 'bearer' })
    .send(payload);
}
