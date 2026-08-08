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

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard', () => ({
  OfficialPublicationMobileZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service', () => ({
  OfficialPublicationMobileZkAuthService: jest.fn().mockImplementation(() => ({
    createAuthRequest: jest.fn().mockResolvedValue({
      apiKey: 'mock-official-publication-mobile-api-key',
      request: {},
      expiresAt: '2026-07-28T00:00:00.000Z',
    }),
    callback: jest.fn().mockResolvedValue({}),
    getContextByApiKey: jest.fn().mockResolvedValue(null),
    hashApiKey: jest.fn((apiKey: string) => `mock-hash-${apiKey}`),
  })),
}));

import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { JwtOrApiKeyGuard } from '@/core/guards/jwt-or-api-key.guard';
import { InstitutionalVotingModule } from '@/modules/institutional-voting/institutional-voting.module';
import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { CacheModule } from '@nestjs/cache-manager';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';

jest.setTimeout(240000);

let currentUser: any;

// Shared by the mock guards below: rejects with 403 when there's no authenticated user, so
// tests can flip `currentUser` to null/undefined to simulate a rejected token and assert the
// endpoint is actually guarded.
function mockCanActivate(context: ExecutionContext): boolean {
  if (!currentUser) {
    throw new ForbiddenException();
  }
  context.switchToHttp().getRequest().user = currentUser;
  return true;
}

// Dependency-free stand-in for JwtAuthGuard: NestJS hashes `{ provide: APP_GUARD, useClass: JwtAuthGuard }`
// under a random per-compile token, so overriding APP_GUARD/JwtAuthGuard after the fact never matches it.
// Registering this stub directly avoids ever constructing the real guard (and its JwtService/Connection deps).
@Injectable()
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return mockCanActivate(context);
  }
}

describe('MX-EA | Votaciones abiertas E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let httpServer: any;
  let tenantId: string;

  beforeAll(async () => {
    const firebaseAdminMock = {
      messaging: jest.fn(() => ({
        send: jest.fn().mockResolvedValue('mock-message-id'),
      })),
    };

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        CacheModule.register({ isGlobal: true }),
        TestLoggerModule,
        InstitutionalVotingModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: MockJwtAuthGuard }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: mockCanActivate })
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: mockCanActivate })
      .overrideProvider('FIREBASE_ADMIN')
      .useValue(firebaseAdminMock)
      .overrideProvider(VoteReaderService)
      .useValue({ getResults: jest.fn().mockResolvedValue([]) })
      .overrideProvider(VoteWritterService)
      .useValue({
        createVote: jest.fn(),
        prepareCreateVote: jest.fn(),
        executePreparedCreateVote: jest.fn(),
        updateVoteSchedule: jest.fn(),
        castVote: jest.fn(),
        addNewVoters: jest.fn(),
      })
      .overrideProvider(TvdBlockchainService)
      .useValue({ validateVotePublicationPreflight: jest.fn() })
      .overrideProvider(IssuerService)
      .useValue({ issueCredential: jest.fn(), getDidsByDnis: jest.fn().mockResolvedValue([]) })
      .overrideProvider(EmitVoteService)
      .useValue({ getVoteVc: jest.fn(), emitVote: jest.fn() })
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
    httpServer = app.getHttpServer();
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    currentUser = { sub: new Types.ObjectId().toString(), role: 'ADMIN', active: true };

    const tenant = await conn.collection('institutional_tenants').insertOne({
      name: `Tenant Open Voting ${Date.now()}-${Math.random()}`,
      nameNorm: `tenant open voting ${Date.now()}-${Math.random()}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tenantId = tenant.insertedId.toString();
  });

  function eventPayload(extra: Record<string, unknown> = {}) {
    return {
      tenantId,
      name: `Evento Open Voting ${Date.now()}`,
      objective: 'Objetivo de prueba para votacion abierta',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString(),
      ...extra,
    };
  }

  async function createEvent(extra: Record<string, unknown> = {}) {
    return request(httpServer)
      .post('/api/v1/voting/events')
      .send(eventPayload(extra));
  }

  async function getEventDetail(eventId: string) {
    return request(httpServer).get(`/api/v1/voting/events/${eventId}`);
  }

  it('EA-P0-02-001 crea el evento con isOpenVoting=true y lo refleja en el detalle', async () => {
    const created = await createEvent({ isOpenVoting: true });
    expect(created.status).toBe(201);

    const detail = await getEventDetail(created.body.id);
    expect(detail.status).toBe(200);
    expect(detail.body.isOpenVoting).toBe(true);

    const stored = await conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(created.body.id) });
    expect(stored?.isOpenVoting).toBe(true);
  });

  it('EA-P0-02-002 crea el evento con isOpenVoting=false explícito y lo refleja en el detalle', async () => {
    const created = await createEvent({ isOpenVoting: false });
    expect(created.status).toBe(201);

    const detail = await getEventDetail(created.body.id);
    expect(detail.status).toBe(200);
    expect(detail.body.isOpenVoting).toBe(false);

    const stored = await conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(created.body.id) });
    expect(stored?.isOpenVoting).toBe(false);
  });

  it('EA-P0-02-003 por defecto crea el evento con isOpenVoting=false cuando la propiedad se omite', async () => {
    const created = await createEvent();
    expect(created.status).toBe(201);

    const detail = await getEventDetail(created.body.id);
    expect(detail.status).toBe(200);
    expect(detail.body.isOpenVoting).toBe(false);

    const stored = await conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(created.body.id) });
    expect(stored?.isOpenVoting).toBe(false);
  });

  describe('POST /:eventId/padron/imports/users', () => {
    beforeEach(async () => {
      await conn.collection('users').deleteMany({});
    });

    async function createUser(dni: string, active = true) {
      await conn.collection('users').insertOne({
        dni,
        active,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    async function createDraftEventId() {
      const created = await createEvent();
      expect(created.status).toBe(201);
      return created.body.id as string;
    }

    async function setAllUsersToPadron(eventId: string) {
      return request(httpServer)
        .post(`/api/v1/voting/events/${eventId}/padron/imports/users`)
        .send({});
    }

    async function getPadronImportJob(eventId: string, importJobId: string) {
      return request(httpServer).get(
        `/api/v1/voting/events/${eventId}/padron/imports/${importJobId}`,
      );
    }

    it('EA-P0-03-001 carga como padrón a todos los usuarios activos del sistema', async () => {
      await createUser('10001');
      await createUser('20002');
      const eventId = await createDraftEventId();

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        eventId,
        sourceType: 'SYSTEM',
        status: 'PARSED',
        isActiveDraft: true,
        originalFile: {
          fileName: 'usuarios-activos.json',
          mimeType: 'application/json',
          size: 2,
        },
        parser: { provider: 'system-users', model: null, usedFallback: false },
        summary: {
          parsedCount: 2,
          validCount: 2,
          duplicateCount: 0,
          invalidCount: 0,
          stagingCount: 2,
          enabledCount: 2,
          disabledCount: 0,
          missingIdentityCount: 0,
        },
        errors: [],
      });
      expect(res.body.importJobId).toEqual(expect.any(String));

      const stagingEntries = await conn
        .collection('padron_staging_entries')
        .find({ importJobId: new Types.ObjectId(res.body.importJobId) })
        .toArray();
      expect(stagingEntries).toHaveLength(2);
      expect(stagingEntries.every((entry) => entry.enabled === true)).toBe(true);
      expect(stagingEntries.map((entry) => entry.ciNorm).sort()).toEqual(['10001', '20002']);

      const detail = await getPadronImportJob(eventId, res.body.importJobId);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe('PARSED');
      expect(detail.body.summary.stagingCount).toBe(2);
    });

    it('EA-P0-03-002 ignora usuarios inactivos del sistema', async () => {
      await createUser('30003', true);
      await createUser('40004', false);
      const eventId = await createDraftEventId();

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PARSED');
      expect(res.body.summary).toMatchObject({ parsedCount: 1, stagingCount: 1, enabledCount: 1 });

      const staging = await conn
        .collection('padron_staging_entries')
        .find({ importJobId: new Types.ObjectId(res.body.importJobId) })
        .toArray();
      expect(staging).toHaveLength(1);
      expect(staging[0].ciNorm).toBe('30003');
    });

    it('EA-P0-03-003 marca CI inválido y continúa en estado PARSED_WITH_ERRORS', async () => {
      await createUser('50005');
      await createUser('12'); // demasiado corto tras normalizar -> INVALID_CI
      const eventId = await createDraftEventId();

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PARSED_WITH_ERRORS');
      // Nota: parsedCount refleja el conteo final de la etapa de staging (refreshImportJobSummary
      // lo recalcula como stagingCount), no el total original de usuarios activos procesados.
      expect(res.body.summary).toMatchObject({
        parsedCount: 1,
        validCount: 1,
        stagingCount: 1,
        enabledCount: 1,
      });
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'INVALID_CI', rawValue: '12' }),
        ]),
      );
    });

    it('EA-P0-03-004 marca CI duplicado entre usuarios activos y continúa en estado PARSED_WITH_ERRORS', async () => {
      await createUser('60006');
      await createUser('600-06'); // normaliza al mismo CI que el anterior -> DUPLICATE_CI
      const eventId = await createDraftEventId();

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PARSED_WITH_ERRORS');
      expect(res.body.summary).toMatchObject({
        parsedCount: 1,
        validCount: 1,
        stagingCount: 1,
        enabledCount: 1,
      });
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_CI' })]),
      );

      const staging = await conn
        .collection('padron_staging_entries')
        .find({ importJobId: new Types.ObjectId(res.body.importJobId) })
        .toArray();
      expect(staging).toHaveLength(1);
      expect(staging[0].ciNorm).toBe('60006');
    });

    it('EA-P0-03-005 retorna FAILED cuando no hay usuarios activos en el sistema', async () => {
      const eventId = await createDraftEventId();

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.summary).toMatchObject({
        parsedCount: 0,
        validCount: 0,
        stagingCount: 0,
        enabledCount: 0,
      });
      expect(res.body.errors).toEqual([]);
    });

    it('EA-P0-05-001 rechaza una segunda carga y retorna 400 cuando ya existe un padrón PARSED', async () => {
      await createUser('70007');
      const eventId = await createDraftEventId();

      const first = await setAllUsersToPadron(eventId);
      expect(first.status).toBe(201);
      expect(first.body.status).toBe('PARSED');

      const second = await setAllUsersToPadron(eventId);
      expect(second.status).toBe(400);
      expect(second.body.message).toBe('El padrón ya está cargado');
    });

    it('EA-P0-05-002 rechaza la carga cuando el evento ya no está en una etapa editable', async () => {
      await createUser('80008');
      const eventId = await createDraftEventId();
      await conn
        .collection('voting_events')
        .updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { state: 'CLOSED' } });

      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Solo se permite importar el padrón');
    });

    it('EA-P0-05-003 rechaza un eventId inválido', async () => {
      const res = await setAllUsersToPadron('not-an-object-id');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('eventId inválido');
    });

    it('EA-P0-05-004 retorna 404 cuando el evento no existe', async () => {
      const res = await setAllUsersToPadron(new Types.ObjectId().toString());
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Evento no encontrado');
    });

    it('EA-P0-04-001 retorna 403 cuando el guard JWT no autentica al usuario', async () => {
      await createUser('90009');
      const eventId = await createDraftEventId();

      currentUser = null; // simula ausencia/invalidez de token: el guard JWT debe rechazar la request
      const res = await setAllUsersToPadron(eventId);
      expect(res.status).toBe(403);

      // El evento no debe haber recibido ningún padrón, confirmando que la ruta nunca
      // llegó al controller/servicio cuando el guard rechaza.
      const importJobs = await conn
        .collection('padron_import_jobs')
        .find({ eventId: new Types.ObjectId(eventId) })
        .toArray();
      expect(importJobs).toHaveLength(0);
    });
  });
});
