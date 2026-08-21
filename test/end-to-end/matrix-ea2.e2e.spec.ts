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
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { TestLoggerModule } from '../utils/module-helpers';

jest.setTimeout(240000);

// Topic configurado en app.notifications.broadcastTopic (NOTIFICATIONS_BROADCAST_TOPIC). Una
// votación abierta no tiene padrón, así que sus notificaciones salen a este topic único en vez
// de ir por destinatario. Se resuelve desde el ConfigService real para no depender del entorno.
let BROADCAST_TOPIC = '';

let currentUser: any;

const firebaseSend = jest.fn().mockResolvedValue('mock-message-id');

function mockCanActivate(context: ExecutionContext): boolean {
  if (!currentUser) {
    throw new ForbiddenException();
  }
  context.switchToHttp().getRequest().user = currentUser;
  return true;
}

@Injectable()
class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return mockCanActivate(context);
  }
}

describe('MX-EA2 | Votaciones abiertas (sin padrón) E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let httpServer: any;
  let tenantId: string;
  let adminUserId: string;

  const voteWritterMock = {
    createVote: jest.fn(),
    prepareCreateVote: jest.fn(),
    executePreparedCreateVote: jest.fn(),
    updateVoteSchedule: jest.fn(),
    castVote: jest.fn(),
    addNewVoters: jest.fn(),
  };
  const tvdBlockchainMock = {
    validateVotePublicationPreflight: jest.fn(),
  };

  const preflightResult = {
    chainId: 84532,
    proxyAddress: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
    implementationAddress: '0x24638b4A7fcbF4fC1B971F17Fcd2bae77777D3eF',
    creditsContractAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
    tokenAddress: '0x0156D96BAbC74139a5cdb2cf2C90FDA1F6B53562',
    spenderAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
    tvdPerCredit: '1000000000000000000',
    requiredCredits: '300',
    requiredTvd: '300000000000000000000',
    simulated: true,
  };

  beforeAll(async () => {
    const firebaseAdminMock = {
      messaging: jest.fn(() => ({ send: firebaseSend })),
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
      .useValue({
        getResults: jest.fn().mockResolvedValue([]),
        getElectionStatus: jest.fn().mockResolvedValue({ creditBalance: '100' }),
        isDniInMerkleTree: jest.fn().mockResolvedValue(false),
      })
      .overrideProvider(VoteWritterService)
      .useValue(voteWritterMock)
      .overrideProvider(TvdBlockchainService)
      .useValue(tvdBlockchainMock)
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
    BROADCAST_TOPIC = moduleRef
      .get(ConfigService)
      .get<string>('app.notifications.broadcastTopic')!;
    expect(BROADCAST_TOPIC).toBeTruthy();
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    firebaseSend.mockResolvedValue('mock-message-id');
    voteWritterMock.prepareCreateVote.mockImplementation(async () => ({
      secrets: [],
      ciMerkleTree: { root: 0n, layers: [] },
      optionsWithBlank: ['Lista Unica', 'BLANK'],
      // Dirección válida: el paquete de ejecución de la publicación oficial la valida con viem.
      callData: {
        to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
        value: 0n,
        data: '0xdeadbeef',
      },
      createVoteArgs: [],
      onChainElectionId: 1n,
    }));
    voteWritterMock.executePreparedCreateVote.mockResolvedValue([]);
    tvdBlockchainMock.validateVotePublicationPreflight.mockResolvedValue(preflightResult);

    await Promise.all([
      conn.collection('users').deleteMany({}),
      conn.collection('user_notifications').deleteMany({}),
      conn.collection('notification_logs').deleteMany({}),
      conn.collection('participations').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('institutional_admin_applications').deleteMany({}),
    ]);

    adminUserId = new Types.ObjectId().toString();
    currentUser = { sub: adminUserId, role: 'ADMIN', active: true };

    const tenant = await conn.collection('institutional_tenants').insertOne({
      name: `Tenant EA2 ${Date.now()}-${Math.random()}`,
      nameNorm: `tenant ea2 ${Date.now()}-${Math.random()}`,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    tenantId = tenant.insertedId.toString();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function eventPayload(extra: Record<string, unknown> = {}) {
    return {
      tenantId,
      name: `Evento Abierto ${Date.now()}`,
      objective: 'Objetivo de prueba para votacion abierta sin padron',
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString(),
      ...extra,
    };
  }

  async function createEvent(extra: Record<string, unknown> = {}) {
    return request(httpServer).post('/api/v1/voting/events').send(eventPayload(extra));
  }

  async function createUser(dni: string, active = true) {
    await conn.collection('users').insertOne({
      dni,
      active,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Deja el evento con cargos, opciones y candidatos: todo lo que review-readiness exige
   * aparte del padrón. Así el único factor que queda en juego es isOpenVoting.
   */
  async function seedBallot(eventId: string) {
    const role = await request(httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .send({ name: 'Presidencia', maxWinners: 1 });
    expect(role.status).toBe(201);

    const option = await request(httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .send({
        name: 'Lista Unica',
        color: '#112233',
        candidates: [{ name: 'Candidata Uno', roleName: 'Presidencia' }],
      });
    expect(option.status).toBe(201);
  }

  /** Relación institucional aprobada + wallet: requisito de la publicación oficial. */
  async function seedInstitutionalWallet() {
    const applicationId = new Types.ObjectId();
    const accountAddress = '0x1111111111111111111111111111111111111111';

    await conn.collection('institutional_admin_applications').insertOne({
      _id: applicationId,
      tenantId: new Types.ObjectId(tenantId),
      userId: new Types.ObjectId(adminUserId),
      status: 'APPROVED',
      accountAddress,
      stableInstitutionId: 'institution-ea2-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await conn.collection('tenant_admin_assignments').insertOne({
      tenantId: new Types.ObjectId(tenantId),
      userId: new Types.ObjectId(adminUserId),
      applicationId,
      accountAddress,
      active: true,
      status: 'APPROVED',
      institutionalRole: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { applicationId: applicationId.toString(), accountAddress };
  }

  async function createOpenEventReadyToReview(maxOpenVoters = 300) {
    const created = await createEvent({ isOpenVoting: true, maxOpenVoters });
    expect(created.status).toBe(201);
    const eventId = created.body.id as string;
    await seedBallot(eventId);
    return eventId;
  }

  function broadcastCalls() {
    return firebaseSend.mock.calls.filter(([message]) => message?.topic === BROADCAST_TOPIC);
  }

  // ---------------------------------------------------------------------------
  // EA2-01 | Activar la opción de votación abierta y establecer límite de tokens
  // ---------------------------------------------------------------------------

  describe('EA2-01 | Borrador de votación abierta con límite de votantes', () => {
    it('EA2-01-001 registra el borrador con la etiqueta de abierta y el límite de votantes', async () => {
      const created = await createEvent({ isOpenVoting: true, maxOpenVoters: 500 });

      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        isOpenVoting: true,
        maxOpenVoters: 500,
        state: 'DRAFT',
      });

      const stored = await conn
        .collection('voting_events')
        .findOne({ _id: new Types.ObjectId(created.body.id) });
      expect(stored?.isOpenVoting).toBe(true);
      expect(stored?.maxOpenVoters).toBe(500);
    });

    it('EA2-01-002 rechaza la votación abierta sin límite de votantes', async () => {
      const created = await createEvent({ isOpenVoting: true });

      expect(created.status).toBe(400);
      expect(String(created.body.message)).toContain('maxOpenVoters');
    });

    it('EA2-01-003 rechaza un límite de votantes menor a 1', async () => {
      const created = await createEvent({ isOpenVoting: true, maxOpenVoters: 0 });

      expect(created.status).toBe(400);
      expect(String(created.body.message)).toContain('maxOpenVoters');
    });

    it('EA2-01-004 rechaza un límite de votantes no entero', async () => {
      const created = await createEvent({ isOpenVoting: true, maxOpenVoters: 12.5 });

      expect(created.status).toBe(400);
      expect(String(created.body.message)).toContain('maxOpenVoters');
    });

    it('EA2-01-005 ignora el límite de votantes cuando la votación no es abierta', async () => {
      const created = await createEvent({ isOpenVoting: false, maxOpenVoters: 700 });

      expect(created.status).toBe(201);
      expect(created.body.isOpenVoting).toBe(false);
      // El límite enviado se descarta y queda el default del schema (0 = sin cupo abierto).
      expect(created.body.maxOpenVoters).toBe(0);

      const stored = await conn
        .collection('voting_events')
        .findOne({ _id: new Types.ObjectId(created.body.id) });
      expect(stored?.maxOpenVoters).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-02 | Desaparecer ventana de padrón en votación abierta
  // ---------------------------------------------------------------------------

  describe('EA2-02 | Listo para publicar sin padrón', () => {
    it('EA2-02-001 review-readiness de una votación abierta no exige padrón', async () => {
      const eventId = await createOpenEventReadyToReview();

      const readiness = await request(httpServer).get(
        `/api/v1/voting/events/${eventId}/review-readiness`,
      );

      expect(readiness.status).toBe(200);
      expect(readiness.body.isReady).toBe(true);
      expect(readiness.body.pending).toEqual([]);
    });

    it('EA2-02-002 review-readiness de una votación cerrada sigue exigiendo padrón', async () => {
      const created = await createEvent({ isOpenVoting: false });
      expect(created.status).toBe(201);
      await seedBallot(created.body.id);

      const readiness = await request(httpServer).get(
        `/api/v1/voting/events/${created.body.id}/review-readiness`,
      );

      expect(readiness.status).toBe(200);
      expect(readiness.body.isReady).toBe(false);
      expect(readiness.body.pending).toContain('padron');
    });

    it('EA2-02-003 permite pasar a READY_FOR_REVIEW sin ningún padrón cargado', async () => {
      const eventId = await createOpenEventReadyToReview();

      const ready = await request(httpServer).post(
        `/api/v1/voting/events/${eventId}/ready-for-review`,
      );

      expect(ready.status).toBe(201);
      expect(ready.body.state).toBe('READY_FOR_REVIEW');

      const padronVersions = await conn
        .collection('padron_versions')
        .countDocuments({ eventId: new Types.ObjectId(eventId) });
      expect(padronVersions).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-04 | Notificar a los votantes
  // ---------------------------------------------------------------------------

  describe('EA2-04 | Convocatoria notificada a todos', () => {
    it('EA2-04-001 envía la convocatoria por broadcast al topic general y no por destinatario', async () => {
      await createUser('10001');
      await createUser('20002');
      const eventId = await createOpenEventReadyToReview();

      const ready = await request(httpServer).post(
        `/api/v1/voting/events/${eventId}/ready-for-review`,
      );
      expect(ready.status).toBe(201);

      // Un único envío al topic global sustituye a los envíos por token de cada empadronado.
      expect(firebaseSend).toHaveBeenCalledTimes(1);
      expect(broadcastCalls()).toHaveLength(1);
      expect(broadcastCalls()[0][0]).toMatchObject({
        topic: BROADCAST_TOPIC,
        data: expect.objectContaining({ eventId }),
      });
      expect(ready.body.convocationNotification).toMatchObject({
        status: 'success',
        newlyNotified: 1,
        failed: 0,
      });
    });

    it('EA2-04-002 registra la notificación broadcast en la bandeja sin userId ni dni', async () => {
      const eventId = await createOpenEventReadyToReview();

      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);

      const inbox = await conn.collection('user_notifications').find({}).toArray();
      expect(inbox).toHaveLength(1);
      expect(inbox[0]).toMatchObject({ topic: BROADCAST_TOPIC, status: 'NEW' });
      expect(inbox[0].userId).toBeUndefined();
      expect(inbox[0].dni).toBeUndefined();

      const logs = await conn.collection('notification_logs').find({}).toArray();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        topic: BROADCAST_TOPIC,
        status: 'SENT',
        messageId: 'mock-message-id',
      });
    });

    it('EA2-04-003 marca la convocatoria como enviada y no la reenvía', async () => {
      const eventId = await createOpenEventReadyToReview();

      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);
      const stored = await conn
        .collection('voting_events')
        .findOne({ _id: new Types.ObjectId(eventId) });
      expect(stored?.convocationNotifiedAt).toBeInstanceOf(Date);

      firebaseSend.mockClear();
      const second = await request(httpServer).post(
        `/api/v1/voting/events/${eventId}/ready-for-review`,
      );

      expect(second.status).toBe(201);
      expect(second.body.convocationNotification).toMatchObject({
        status: 'no_pending_voters',
        newlyNotified: 0,
      });
      expect(firebaseSend).not.toHaveBeenCalled();
    });

    it('EA2-04-004 reporta el fallo del broadcast sin marcar la convocatoria como enviada', async () => {
      const eventId = await createOpenEventReadyToReview();
      firebaseSend.mockRejectedValueOnce(new Error('fcm down'));

      const ready = await request(httpServer).post(
        `/api/v1/voting/events/${eventId}/ready-for-review`,
      );

      expect(ready.status).toBe(201);
      expect(ready.body.convocationNotification).toMatchObject({
        status: 'failed',
        newlyNotified: 0,
        failed: 1,
      });

      const stored = await conn
        .collection('voting_events')
        .findOne({ _id: new Types.ObjectId(eventId) });
      expect(stored?.convocationNotifiedAt ?? null).toBeNull();

      const logs = await conn.collection('notification_logs').find({}).toArray();
      expect(logs[0]).toMatchObject({ status: 'FAILED', error: 'fcm down' });
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-05 | Publicar votación abierta
  // ---------------------------------------------------------------------------

  describe('EA2-05 | Publicación oficial sin padrón ni merkle tree', () => {
    async function publishOpenEvent(maxOpenVoters = 300) {
      const eventId = await createOpenEventReadyToReview(maxOpenVoters);
      await seedInstitutionalWallet();
      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);

      const confirm = await request(httpServer)
        .post(`/api/v1/voting/events/${eventId}/official-publication/confirm`)
        .send({});

      return { eventId, confirm };
    }

    it('EA2-05-001 confirma la publicación oficial sin padrón y deja el evento OFFICIALLY_PUBLISHED', async () => {
      const { eventId, confirm } = await publishOpenEvent();

      expect(confirm.status).toBe(201);

      const stored = await conn
        .collection('voting_events')
        .findOne({ _id: new Types.ObjectId(eventId) });
      expect(stored?.state).toBe('OFFICIALLY_PUBLISHED');
      expect(stored?.publicationConfirmed).toBe(true);

      // Sin padrón: la publicación no materializó ninguna versión ni entrada de padrón.
      expect(
        await conn
          .collection('padron_versions')
          .countDocuments({ eventId: new Types.ObjectId(eventId) }),
      ).toBe(0);
    });

    it('EA2-05-002 prepara el voto on-chain sin votantes de padrón', async () => {
      await createUser('30003');
      const { eventId } = await publishOpenEvent(300);

      expect(voteWritterMock.prepareCreateVote).toHaveBeenCalledTimes(1);
      const [event, , voters, options] = voteWritterMock.prepareCreateVote.mock.calls[0];
      expect(String(event._id)).toBe(eventId);
      expect(event.isOpenVoting).toBe(true);
      expect(event.maxOpenVoters).toBe(300);
      // La lista de votantes va vacía: el contrato recibe maxOpenVoters como cupo (ver EA2-05-004).
      expect(voters).toEqual([]);
      expect(options).toEqual(['Lista Unica']);
    });

    it('EA2-05-003 no emite credenciales por votante al publicar una votación abierta', async () => {
      const { eventId } = await publishOpenEvent();

      const sessions = await conn
        .collection('enabled_sessions')
        .countDocuments({ eventId: new Types.ObjectId(eventId) });
      expect(sessions).toBe(0);
    });

    it('EA2-05-012 persiste la solicitud de publicación como abierta y sin padrón', async () => {
      const eventId = await createOpenEventReadyToReview(300);
      await seedInstitutionalWallet();
      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);

      const created = await request(httpServer).post(
        `/api/v1/voting/events/${eventId}/official-publication/requests`,
      );

      expect(created.status).toBe(201);
      expect(created.body.created).toBe(true);
      expect(created.body.request).toMatchObject({
        votersCount: '300',
        requiredCredits: '300',
      });

      // El schema dejó padronVersionId opcional justamente para este caso: la solicitud se
      // guarda sin versión de padrón y con el cupo abierto como conteo de habilitados.
      const stored = await conn
        .collection('official_publication_requests')
        .findOne({ eventId: new Types.ObjectId(eventId) });
      expect(stored).toBeTruthy();
      expect(stored?.isOpenVoting).toBe(true);
      expect(stored?.enabledVotersCount).toBe(300);
      expect(stored?.padronVersionId ?? null).toBeNull();
      expect(stored?.creditsRequired).toBe('300');
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-06 | Notificaciones del estado de votación y noticias
  // ---------------------------------------------------------------------------

  describe('EA2-06 | Noticias y cambios de estado notificados a todos', () => {
    it('EA2-06-001 publica una noticia por broadcast en vez de por padrón', async () => {
      await createUser('40004');
      const eventId = await createOpenEventReadyToReview();

      const news = await request(httpServer)
        .post(`/api/v1/voting/events/${eventId}/news`)
        .send({ title: 'Recordatorio', body: 'La votación abre mañana' });

      expect(news.status).toBe(201);
      expect(broadcastCalls()).toHaveLength(1);
      expect(broadcastCalls()[0][0]).toMatchObject({
        topic: BROADCAST_TOPIC,
        notification: { title: 'Recordatorio', body: 'La votación abre mañana' },
        data: expect.objectContaining({ type: 'INSTITUTIONAL_NEWS', eventId }),
      });
    });

    it('EA2-06-002 notifica por broadcast el cambio de horario tras la convocatoria', async () => {
      const eventId = await createOpenEventReadyToReview();
      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);
      firebaseSend.mockClear();

      const schedule = await request(httpServer)
        .patch(`/api/v1/voting/events/${eventId}/schedule`)
        .send({
          votingStart: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          votingEnd: new Date(Date.now() + 74 * 60 * 60 * 1000).toISOString(),
          resultsPublishAt: new Date(Date.now() + 76 * 60 * 60 * 1000).toISOString(),
        });

      expect(schedule.status).toBe(200);
      expect(broadcastCalls()).toHaveLength(1);
      expect(broadcastCalls()[0][0]).toMatchObject({
        topic: BROADCAST_TOPIC,
        data: expect.objectContaining({ type: 'INSTITUTIONAL_SCHEDULE_UPDATED', eventId }),
      });
    });

    it('EA2-06-003 una votación cerrada sin padrón no usa el topic de broadcast', async () => {
      const created = await createEvent({ isOpenVoting: false });
      expect(created.status).toBe(201);

      const news = await request(httpServer)
        .post(`/api/v1/voting/events/${created.body.id}/news`)
        .send({ title: 'Sin padron', body: 'No debe salir por broadcast' });

      expect(news.status).toBe(201);
      expect(broadcastCalls()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-07 | Pantalla de información de votación pública y de admin
  // ---------------------------------------------------------------------------

  describe('EA2-07 | Información pública y de administración sin padrón', () => {
    it('EA2-07-001 la lista de participación muestra a todos los usuarios registrados activos', async () => {
      await createUser('50005');
      await createUser('60006');
      await createUser('70007', false); // inactivo: no es "registrado" del sistema
      const eventId = await createOpenEventReadyToReview();

      const list = await request(httpServer).get(
        `/api/v1/voting/events/${eventId}/participation-list`,
      );

      expect(list.status).toBe(200);
      expect(list.body.total).toBe(2);
      expect(list.body.padronVersionId).toBeNull();
      expect(list.body.data.map((row: any) => row.carnetNorm).sort()).toEqual(['50005', '60006']);
      expect(list.body.data.every((row: any) => row.status === 'PENDING')).toBe(true);
    });

    it('EA2-07-002 la lista de participación marca PARTICIPATED a quien ya votó', async () => {
      await createUser('80008');
      await createUser('90009');
      const eventId = await createOpenEventReadyToReview();
      await conn.collection('participations').insertOne({
        eventId: new Types.ObjectId(eventId),
        carnetNorm: '80008',
        participatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const list = await request(httpServer).get(
        `/api/v1/voting/events/${eventId}/participation-list`,
      );

      expect(list.status).toBe(200);
      const byCarnet = Object.fromEntries(
        list.body.data.map((row: any) => [row.carnetNorm, row.status]),
      );
      expect(byCarnet).toEqual({ '80008': 'PARTICIPATED', '90009': 'PENDING' });
    });

    it('EA2-07-003 la lista de participación pagina sobre los usuarios registrados', async () => {
      await createUser('11111');
      await createUser('22222');
      await createUser('33333');
      const eventId = await createOpenEventReadyToReview();

      const page = await request(httpServer)
        .get(`/api/v1/voting/events/${eventId}/participation-list`)
        .query({ page: 2, limit: 2 });

      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
      expect(page.body.data).toHaveLength(1);
      expect(page.body.data[0].carnetNorm).toBe('33333');
    });

    it('EA2-07-004 la consulta pública de padrón responde habilitado sin revisar padrón', async () => {
      await createUser('44444');
      const eventId = await createOpenEventReadyToReview();
      await request(httpServer).post(`/api/v1/voting/events/${eventId}/ready-for-review`);

      // Un carné que no existe en ningún padrón sigue siendo elegible: en votación abierta
      // la consulta de estado de padrón deja de tener sentido.
      const eligibility = await request(httpServer)
        .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
        .query({ carnet: '99999999' });

      expect(eligibility.status).toBe(200);
      expect(eligibility.body).toMatchObject({
        status: 'ELIGIBLE',
        referenceVersion: null,
      });
    });

    it('EA2-07-005 las analíticas de participación se calculan sin padrón vigente', async () => {
      await createUser('55555');
      await createUser('66666');
      const eventId = await createOpenEventReadyToReview();
      await conn.collection('participations').insertOne({
        eventId: new Types.ObjectId(eventId),
        carnetNorm: '55555',
        participatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const analytics = await request(httpServer).get(
        `/api/v1/voting/events/${eventId}/participation-analytics`,
      );

      expect(analytics.status).toBe(200);
      expect(analytics.body).toMatchObject({
        votingId: eventId,
        totalEnabled: 2,
        totalParticipated: 1,
        totalPending: 1,
        participationPercentage: 50,
      });
    });
  });
});
