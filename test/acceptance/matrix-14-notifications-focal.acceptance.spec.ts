import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { InstitutionalVotingNewsController } from '@/modules/institutional-voting/controllers/institutional-voting-news.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { AnnouncementsController } from '@/modules/notifications/controllers/announcements.controller';
import { InternalPushController } from '@/modules/notifications/controllers/internal-push.controller';
import { UsersController } from '@/modules/users/controllers/users.controller';
import { UsersService } from '@/modules/users/services/users.service';
import { TopicMessagingService } from '@/modules/notifications/services/topic-messaging.service';
import { DirectPushService } from '@/modules/notifications/services/direct-push.service';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import { User } from '@/modules/users/schemas/user.schema';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthServiceMock {},
}));

jest.mock('@/modules/institutional-voting/services/participation/emit-vote.service', () => ({
  EmitVoteService: class EmitVoteServiceMock {},
}));

type ApiKeyState = { valid: boolean };
type ListRow = Record<string, unknown>;

function pagedQuery(rows: ListRow[]) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
}

function configProvider() {
  return {
    provide: ConfigService,
    useValue: {
      get: jest.fn((key: string) => (key === 'app.apiKey.header' ? 'x-api-key' : undefined)),
    },
  };
}

async function createApp(moduleRef: TestingModule) {
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

async function createNewsApp() {
  const voting = { publishNews: jest.fn().mockResolvedValue({ eventId: 'event-1', sent: 2, skipped: null }) };
  const moduleRef = await Test.createTestingModule({
    controllers: [InstitutionalVotingNewsController],
    providers: [{ provide: InstitutionalVotingService, useValue: voting }],
  }).compile();
  return { app: await createApp(moduleRef), voting };
}

async function createAnnouncementsApp() {
  const locationId = new Types.ObjectId();
  const topics = { announceCountToLocation: jest.fn().mockResolvedValue('accepted-id') };
  const moduleRef = await Test.createTestingModule({
    controllers: [AnnouncementsController],
    providers: [
      { provide: TopicMessagingService, useValue: topics },
      { provide: ElectoralLocationService, useValue: { resolveByIdOrCode: jest.fn().mockResolvedValue({ _id: locationId, name: 'Central', address: 'Av. Uno' }) } },
      { provide: ElectoralTableService, useValue: { resolveByIdOrCode: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), electoralLocationId: locationId, tableCode: 'M-1', tableNumber: 1 }) } },
    ],
  }).compile();
  return { app: await createApp(moduleRef), locationId, topics };
}

async function createInternalPushApp() {
  const direct = { sendToTokens: jest.fn().mockResolvedValue(undefined) };
  const logModel = { create: jest.fn().mockResolvedValue({}) };
  const userModel = { findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })) };
  const moduleRef = await Test.createTestingModule({
    controllers: [InternalPushController],
    providers: [
      { provide: DirectPushService, useValue: direct },
      { provide: getModelToken(NotificationLog.name), useValue: logModel },
      { provide: getModelToken(User.name), useValue: userModel },
    ],
  }).compile();
  return { app: await createApp(moduleRef), direct, logModel, userModel };
}

async function createUsersApp() {
  const auth: ApiKeyState = { valid: true };
  const userId = new Types.ObjectId();
  const locationId = new Types.ObjectId();
  const users = { findOrCreateByDni: jest.fn(async (dni: string) => ({ _id: userId, dni, votingLocationId: locationId })) };
  const logModel = { find: jest.fn(() => pagedQuery([])), countDocuments: jest.fn().mockResolvedValue(0) };
  const notificationModel = { find: jest.fn(() => pagedQuery([])), countDocuments: jest.fn().mockResolvedValue(0) };
  const moduleRef = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [
      { provide: UsersService, useValue: users },
      configProvider(),
      { provide: ZkAuthService, useValue: { isApiKeyValid: jest.fn(() => auth.valid) } },
      ZkAuthGuard,
      { provide: getModelToken(NotificationLog.name), useValue: logModel },
      { provide: getModelToken(UserNotification.name), useValue: notificationModel },
    ],
  }).compile();
  return { app: await createApp(moduleRef), auth, users, logModel, notificationModel };
}

describe('MX-14 Backend Results — aceptación focal', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    jest.clearAllMocks();
  });

  it('[MX-14][NOT-ADM-P1-001][ACEPTACION] POST de noticia válida devuelve eventId, sent y skipped', async () => {
    const harness = await createNewsApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).post('/api/v1/voting/events/event-1/news').send({ title: 'Aviso', body: 'Mensaje', link: 'https://example.test/news' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ eventId: 'event-1', sent: 2, skipped: null });
    expect(harness.voting.publishNews).toHaveBeenCalledWith('event-1', expect.objectContaining({ title: 'Aviso', body: 'Mensaje' }), undefined);
  });

  it('[MX-14][NOT-ADM-P1-002][ACEPTACION] DTO inválido no alcanza el servicio de noticias', async () => {
    const harness = await createNewsApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).post('/api/v1/voting/events/event-1/news').send({ title: '', body: '', imageUrl: 'unsafe' });

    expect(response.status).toBe(400);
    expect(harness.voting.publishNews).not.toHaveBeenCalled();
  });

  it('[MX-14][NOT-PUB-P1-001][ACEPTACION] GET protegido responde forma paginada sin afirmar vínculo DNI-claim', async () => {
    const harness = await createUsersApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).get('/api/v1/users/123/notifications?page=1&limit=10').set('x-api-key', 'valid');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
  });

  it('[MX-14][NOT-GEN-P1-003][ACEPTACION] POST de conteo acepta recinto válido y conserva payload permitido', async () => {
    const harness = await createAnnouncementsApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).post('/api/v1/announcements/count').send({ locationId: String(harness.locationId), tableCode: 'M-1', title: 'Conteo', body: 'Iniciado' });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ success: true, result: 'accepted-id' });
    expect(harness.topics.announceCountToLocation).toHaveBeenCalledWith(expect.objectContaining({ locationId: String(harness.locationId), tableCode: 'M-1' }));
  });

  it('[MX-14][NOT-SND-P0-002][ACEPTACION] POST interno válido devuelve 202 y no expone secreto', async () => {
    const harness = await createInternalPushApp();
    app = harness.app;
    const previous = process.env.INTERNAL_PUSH_SECRET;
    process.env.INTERNAL_PUSH_SECRET = 'mx14-internal';
    const response = await request(harness.app.getHttpServer()).post('/internal/push').set('x-internal-secret', 'mx14-internal').send({ tokens: ['fcm-test'], notification: { title: 'A', body: 'B' }, data: { userId: 'u-1' } });
    process.env.INTERNAL_PUSH_SECRET = previous;

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ success: true });
    expect(JSON.stringify(response.body)).not.toMatch(/mx14-internal|fcm-test/i);
    expect(harness.direct.sendToTokens).toHaveBeenCalledTimes(1);
  });

  it('[MX-14][NOT-NAV-P0-001][ACEPTACION] productores persisten o devuelven tipos reconocidos por la app', async () => {
    const harness = await createUsersApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).get('/api/v1/users/123/notifications').set('x-api-key', 'valid');

    expect(response.status).toBe(200);
    expect(harness.logModel.find).toHaveBeenCalledWith(expect.objectContaining({ topic: { $in: expect.arrayContaining([expect.stringMatching(/^loc_/), expect.stringMatching(/^user_/)]) } }));
  });

  it('[MX-14][NOT-NAV-P0-002][ACEPTACION] rechaza push interno incompleto de forma controlada', async () => {
    const harness = await createInternalPushApp();
    app = harness.app;

    const response = await request(harness.app.getHttpServer()).post('/internal/push').set('x-internal-secret', 'any').send({ tokens: [], notification: {}, data: 'invalid' });

    expect(response.status).toBe(400);
    expect(harness.direct.sendToTokens).not.toHaveBeenCalled();
  });

  it('[MX-14][NOT-SEC-P0-001][ACEPTACION] API key inválida rechaza historial sin datos', async () => {
    const harness = await createUsersApp();
    app = harness.app;
    harness.auth.valid = false;

    const response = await request(harness.app.getHttpServer()).get('/api/v1/users/999/notifications');

    expect(response.status).toBe(403);
    expect(response.body.data).toBeUndefined();
  });

  it('[MX-14][NOT-SEC-P0-002][ACEPTACION] respuestas focales no filtran credenciales, tokens ni cabeceras', async () => {
    const harness = await createUsersApp();
    app = harness.app;

    const history = await request(harness.app.getHttpServer()).get('/api/v1/users/123/notifications').set('x-api-key', 'valid');

    expect(JSON.stringify(history.body)).not.toMatch(/FB_PRIVATE_KEY|INTERNAL_PUSH_SECRET|authorization|fcm-test/i);
  });
});
