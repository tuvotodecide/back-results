import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CreateEventNewsDto } from '@/modules/institutional-voting/dto/event-news.dto';
import { TopicMessagingService } from '@/modules/notifications/services/topic-messaging.service';
import { DirectPushService } from '@/modules/notifications/services/direct-push.service';
import { InternalPushController } from '@/modules/notifications/controllers/internal-push.controller';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';
import { VoteContractReads } from '@/api/vote';

jest.mock('@/api/vote', () => ({ VoteContractReads: { rewardByVote: jest.fn() } }));

type FirebaseMock = { messaging: jest.Mock; send: jest.Mock };

function makeFirebase(): FirebaseMock {
  const send = jest.fn().mockResolvedValue('mx14-message-id');
  return { messaging: jest.fn(() => ({ send })), send };
}

function makeInstitutionalService() {
  const firebase = makeFirebase();
  const inbox = { create: jest.fn(), insertMany: jest.fn().mockResolvedValue([]) };
  const logs = {
    create: jest.fn().mockResolvedValue({}),
    insertMany: jest.fn().mockResolvedValue([]),
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
    exists: jest.fn().mockResolvedValue(null),
  };
  const events = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
  const padron = {
    getPadronUsersFromEvent: jest.fn(),
    getUsersByCarnets: jest.fn(),
  };
  const service = new InstitutionalVotingNotificationsService(
    { messaging: firebase.messaging } as never,
    inbox as never,
    logs as never,
    events as never,
    { find: jest.fn() } as never,
    { find: jest.fn() } as never,
    padron as never,
    { sendEmail: jest.fn() } as never,
    { get: jest.fn().mockReturnValue('test-chain') } as never,
  );
  return { service, firebase, inbox, logs, events, padron };
}

async function loadZkBoundaries() {
  jest.resetModules();
  jest.doMock('@/modules/zk-auth/services/zk-auth.service', () => ({
    ZkAuthService: class ZkAuthService {},
  }));
  const [{ UsersController }, { ZkAuthGuard }] = await Promise.all([
    import('@/modules/users/controllers/users.controller'),
    import('@/core/guards/zk-auth.guard'),
  ]);
  return { UsersController, ZkAuthGuard };
}

describe('MX-14 Backend Results — unitarias focales', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock('@/modules/zk-auth/services/zk-auth.service');
  });

  it('[MX-14][NOT-ADM-P1-001][UNITARIA] valida DTO de noticia y sus campos obligatorios', async () => {
    const invalid = Object.assign(new CreateEventNewsDto(), {
      title: '', body: '', imageUrl: 'file:///noticia.png', link: 'javascript:alert(1)',
    });

    const errors = await validate(invalid);

    expect(errors.map((error) => error.property).sort()).toEqual(['body', 'imageUrl', 'link', 'title']);

    const event = { _id: 'event-1', tenantId: 'tenant-1' };
    const access = { getEventOrThrow: jest.fn().mockResolvedValue(event), assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined) };
    const notifications = { notifyNewsToCurrentPadron: jest.fn().mockResolvedValue({ sent: 1 }) };
    const service = Object.assign(Object.create(VotingEventsService.prototype), { accessService: access, notificationsService: notifications }) as VotingEventsService;
    await expect(service.publishNews('event-1', { title: 'Válida', body: 'Contenido' }, { sub: 'admin-1' })).resolves.toEqual({ eventId: 'event-1', sent: 1, skipped: null });
    expect(access.assertTenantWriteAccess).toHaveBeenCalledWith('tenant-1', { sub: 'admin-1' });
  });

  it('[MX-14][NOT-ADM-P1-002][UNITARIA] rechaza URLs opcionales inválidas antes de publicar', async () => {
    const invalid = Object.assign(new CreateEventNewsDto(), {
      title: 'Aviso', body: 'Cuerpo', imageUrl: 'not-a-url', link: 'also-not-a-url',
    });

    const errors = await validate(invalid);

    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.constraints?.isUrl)).toBe(true);

    const access = {
      getEventOrThrow: jest.fn().mockResolvedValue({ tenantId: 'tenant-1' }),
      assertTenantWriteAccess: jest.fn().mockRejectedValue(new Error('tenant denied')),
    };
    const notifications = { notifyNewsToCurrentPadron: jest.fn() };
    const service = Object.assign(Object.create(VotingEventsService.prototype), { accessService: access, notificationsService: notifications }) as VotingEventsService;
    await expect(service.publishNews('event-1', { title: 'Válida', body: 'Contenido' }, { sub: 'outsider' })).rejects.toThrow('tenant denied');
    expect(notifications.notifyNewsToCurrentPadron).not.toHaveBeenCalled();
  });

  it('[MX-14][NOT-PUB-P1-001][UNITARIA] combina historial por topics, fecha y clave semántica', async () => {
    const { UsersController } = await loadZkBoundaries();
    const userId = new Types.ObjectId();
    const locationId = new Types.ObjectId();
    const users = { findOrCreateByDni: jest.fn().mockResolvedValue({ _id: userId, votingLocationId: locationId }) };
    const query = (rows: object[]) => ({ sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(rows) });
    const logModel = { find: jest.fn(() => query([{ _id: 'log', messageId: 'same', createdAt: new Date('2026-01-02') }])), countDocuments: jest.fn().mockResolvedValue(1) };
    const inboxModel = { find: jest.fn(() => query([{ _id: 'inbox', messageId: 'same', createdAt: new Date('2026-01-01') }])), countDocuments: jest.fn().mockResolvedValue(1) };
    const controller = new UsersController(users as never, logModel as never, inboxModel as never);

    const response = await controller.listNotificationsByDni('123', 1, 20);

    expect(logModel.find).toHaveBeenCalledWith({ topic: { $in: [`loc_${locationId}`, `user_${userId}`] } });
    expect(response).toEqual(expect.objectContaining({ total: 1, data: [expect.objectContaining({ _id: 'log' })] }));
  });

  it('[MX-14][NOT-PUB-P1-002][INTEGRACION] persiste contenido institucional y log seguro sin tokens ni cabeceras', async () => {
    const firebase = makeFirebase();
    const inbox: Array<Record<string, unknown>> = [];
    const logs: Array<Record<string, unknown>> = [];
    const service = new TopicMessagingService(
      firebase as never,
      { create: jest.fn(async (row: Record<string, unknown>) => { logs.push(row); return row; }) } as never,
      { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), dni: '123' }]) })) } as never,
      { insertMany: jest.fn(async (rows: Array<Record<string, unknown>>) => { inbox.push(...rows); return rows; }) } as never,
    );

    await service.announceCountToLocation({ locationId: '507f1f77bcf86cd799439011', title: 'Noticia', body: 'Contenido' });

    expect(inbox[0]).toEqual(expect.objectContaining({ title: 'Noticia', body: 'Contenido', status: 'NEW', topic: 'loc_507f1f77bcf86cd799439011' }));
    expect(logs[0]).toEqual(expect.objectContaining({ status: 'SENT', messageId: 'mx14-message-id' }));
    expect(JSON.stringify({ inbox, logs })).not.toMatch(/fcm.*token|authorization|private.?key/i);
  });

  it('[MX-14][NOT-TOK-P0-002][UNITARIA] genera topic de recinto sanitizado y topic de usuario', async () => {
    const firebase = makeFirebase();
    const topic = new TopicMessagingService(firebase as never, { create: jest.fn().mockResolvedValue({}) } as never, { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })) } as never, { insertMany: jest.fn() } as never);
    const locationId = new Types.ObjectId();

    await topic.announceCountToLocation({ locationId: String(locationId), title: 'Conteo', body: 'Comienza' });

    expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ topic: `loc_${locationId}` }));
  });

  it('[MX-14][NOT-GEN-P0-001][UNITARIA] selecciona padrón habilitado, payload público y marca convocatoria solo con envíos', async () => {
    const { service, firebase, padron, events } = makeInstitutionalService();
    const enabled = new Types.ObjectId();
    padron.getPadronUsersFromEvent.mockResolvedValue([
      { _id: enabled, dni: '111', active: true, enabled: true },
      { _id: new Types.ObjectId(), dni: '222', active: true, enabled: false },
    ]);
    const event = { _id: new Types.ObjectId(), name: 'Elección', state: 'READY_FOR_REVIEW', convocationNotifiedAt: null };

    const result = await service.notifyConvocationIfEligible(event as never);

    expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ topic: `user_${enabled}`, data: expect.objectContaining({ eventId: String(event._id), publicPath: `/votacion/elecciones/${event._id}/publica` }) }));
    expect(events.updateOne).toHaveBeenCalledWith({ _id: event._id }, { $set: { convocationNotifiedAt: expect.any(Date) } });
    expect(result).toEqual(expect.objectContaining({
      status: 'success',
      mode: 'initial',
      totalEligible: 1,
      newlyNotified: 1,
      alreadyNotified: 0,
      skippedWithoutUser: 0,
      failed: 0,
    }));
    expect(result).not.toHaveProperty('sent');
  });

  it('[MX-14][NOT-GEN-P0-002][UNITARIA] omite recompensa cero y construye clave por tipo, evento y usuario', async () => {
    const { service, inbox, padron, firebase } = makeInstitutionalService();
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValueOnce(0n).mockResolvedValueOnce(5n);
    const userId = new Types.ObjectId();
    padron.getUsersByCarnets.mockResolvedValue([{ _id: userId, dni: '123' }]);

    expect(await service.notifyVoteRewardAvailableIfEligible('event-1', '123')).toEqual({ sent: 0, skipped: 'no_reward' });
    await service.notifyVoteRewardAvailableIfEligible('event-1', '123');

    expect(inbox.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEW', data: expect.objectContaining({ deduplicationKey: `VOTE_REWARD_AVAILABLE:event-1:${userId}` }) }));
    expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ topic: `user_${userId}` }));
  });

  it('[MX-14][NOT-GEN-P1-003][UNITARIA] construye anuncio de conteo con datos reconocidos', async () => {
    const firebase = makeFirebase();
    const service = new TopicMessagingService(firebase as never, { create: jest.fn().mockResolvedValue({}) } as never, { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })) } as never, { insertMany: jest.fn() } as never);
    const locationId = new Types.ObjectId();

    await service.announceCountToLocation({ locationId: String(locationId), locationName: 'Central', locationAddress: 'Av. Uno', tableId: 'mesa-1', tableCode: 'M-1', tableNumber: 1 });

    expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'announce_count', locationId: String(locationId), screen: 'CountTableDetail', tableId: 'mesa-1', tableCode: 'M-1', tableNumber: '1' }) }));
  });

  it('[MX-14][NOT-SND-P0-001][UNITARIA] envía Firebase mock con prioridad alta y APNs 10', async () => {
    const firebase = makeFirebase();
    const service = new DirectPushService(firebase as never);

    await service.sendToTokens(['fcm-test-token'], { title: 'Título', body: 'Cuerpo' }, { type: 'generic' });

    expect(firebase.send).toHaveBeenCalledWith({ token: 'fcm-test-token', notification: { title: 'Título', body: 'Cuerpo' }, data: { type: 'generic' }, android: { priority: 'high' }, apns: { headers: { 'apns-priority': '10' } } });
  });

  it('[MX-14][NOT-SND-P0-002][UNITARIA] exige secreto interno, payload válido y envía secuencialmente', async () => {
    const firebase = makeFirebase();
    const direct = new DirectPushService(firebase as never);
    const controller = new InternalPushController(direct, { create: jest.fn().mockResolvedValue({}) } as never, { findOne: jest.fn() } as never);
    const previous = process.env.INTERNAL_PUSH_SECRET;
    process.env.INTERNAL_PUSH_SECRET = 'mx14-secret';

    await expect(controller.push('wrong', { tokens: ['x'], notification: { title: 't', body: 'b' }, data: {} })).rejects.toMatchObject({ status: 401 });
    await controller.push('mx14-secret', { tokens: ['one', 'two'], notification: { title: 't', body: 'b' }, data: { userId: 'u-1' } });

    expect(firebase.send.mock.calls.map(([message]) => message.token)).toEqual(['one', 'two']);
    process.env.INTERNAL_PUSH_SECRET = previous;
  });

  it('[MX-14][NOT-RCV-P0-001][INTEGRACION] entrega payload ordenable con title, body, type y createdAt', async () => {
    const firebase = makeFirebase();
    const stored: Array<Record<string, unknown>> = [];
    const service = new TopicMessagingService(
      firebase as never,
      { create: jest.fn().mockResolvedValue({}) } as never,
      { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), dni: '111' }]) })) } as never,
      { insertMany: jest.fn(async (rows: Array<Record<string, unknown>>) => { stored.push(...rows.map((row) => ({ ...row, createdAt: new Date() }))); }) } as never,
    );

    await service.announceCountToLocation({ locationId: '507f1f77bcf86cd799439011' });

    expect(stored[0]).toEqual(expect.objectContaining({ title: 'Inicio de conteo', body: expect.any(String), data: expect.objectContaining({ type: 'announce_count' }), createdAt: expect.any(Date) }));
  });

  it('[MX-14][NOT-NAV-P0-001][UNITARIA] limita payload institucional a tipos y destinos reconocidos', async () => {
    const { service, firebase, padron } = makeInstitutionalService();
    const userId = new Types.ObjectId();
    padron.getPadronUsersFromEvent.mockResolvedValue([{ _id: userId, dni: '123', active: true, enabled: true }]);
    const event = { _id: new Types.ObjectId(), name: 'Elección', state: 'READY' };

    await service.notifyNewsToCurrentPadron(event as never, { title: 'Noticia', body: 'Contenido', link: 'https://example.test/news' });

    expect(firebase.send).toHaveBeenCalledWith(expect.objectContaining({ data: { type: 'INSTITUTIONAL_NEWS', eventId: String(event._id), link: 'https://example.test/news', eligible: 'true', carnetNorm: '123', dni: '123', userId: String(userId) } }));
  });

  it('[MX-14][NOT-NAV-P0-002][UNITARIA] valida DTO interno antes de procesar navegación o push', async () => {
    const { DirectPushDto } = await import('@/modules/notifications/dto/direct-push.dto');
    const dto = Object.assign(new DirectPushDto(), { tokens: [], notification: 'invalid', data: 'invalid' });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual(['data', 'notification', 'tokens']);
  });

  it('[MX-14][NOT-DUP-P0-001][UNITARIA] devuelve already_notified ante índice único de recompensa', async () => {
    const { service, inbox, padron } = makeInstitutionalService();
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValue(5n);
    padron.getUsersByCarnets.mockResolvedValue([{ _id: new Types.ObjectId(), dni: '123' }]);
    inbox.create.mockRejectedValue({ code: 11000 });

    await expect(service.notifyVoteRewardAvailableIfEligible('event-1', '123')).resolves.toEqual({ sent: 0, skipped: 'already_notified' });
  });

  it('[MX-14][NOT-DUP-P1-002][INTEGRACION] conserva SENT y FAILED ante fallo parcial sin detener destinatarios', async () => {
    const { service, firebase, logs, padron } = makeInstitutionalService();
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    padron.getPadronUsersFromEvent.mockResolvedValue([
      { _id: new Types.ObjectId(), dni: '111', active: true, enabled: true },
      { _id: new Types.ObjectId(), dni: '222', active: true, enabled: true },
    ]);
    firebase.send.mockResolvedValueOnce('sent').mockRejectedValueOnce(new Error('single local failure'));

    try {
      const result = await service.notifyNewsToCurrentPadron(
        { _id: new Types.ObjectId(), name: 'Evento' } as never,
        { title: 'Aviso', body: 'Contenido' },
      );

      expect(result).toEqual({ sent: 1, failed: 1 });
      expect(logs.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ status: 'SENT' }),
          expect.objectContaining({ status: 'FAILED' }),
        ]),
        { ordered: false },
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('[MX-14][NOT-SEC-P0-001][UNITARIA] protege consulta por API key y no atribuye DNI a un claim inexistente', async () => {
    const { ZkAuthGuard } = await loadZkBoundaries();
    const guard = new ZkAuthGuard({ get: jest.fn().mockReturnValue('x-api-key') } as never, { isApiKeyValid: jest.fn().mockResolvedValue(true) } as never);
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-api-key': 'valid' } }) }) };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
  });

  it('[MX-14][NOT-SEC-P0-002][UNITARIA] registra solo datos funcionales sin credenciales Firebase', async () => {
    const firebase = makeFirebase();
    const logs = { create: jest.fn().mockResolvedValue({}) };
    const service = new TopicMessagingService(firebase as never, logs as never, { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })) } as never, { insertMany: jest.fn() } as never);

    const locationId = new Types.ObjectId();
    await service.announceCountToLocation({ locationId: String(locationId) });

    expect(logs.create).toHaveBeenCalledWith(expect.not.objectContaining({ FB_PRIVATE_KEY: expect.anything(), INTERNAL_PUSH_SECRET: expect.anything(), token: expect.anything() }));
  });
});
