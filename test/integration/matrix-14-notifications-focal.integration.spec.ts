import { Types } from 'mongoose';
import { TopicMessagingService } from '@/modules/notifications/services/topic-messaging.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VoteContractReads } from '@/api/vote';

jest.mock('@/api/vote', () => ({ VoteContractReads: { rewardByVote: jest.fn() } }));

type Row = Record<string, unknown>;

function makeFirebase() {
  const send = jest.fn().mockResolvedValue('mx14-delivery-id');
  return { messaging: jest.fn(() => ({ send })), send };
}

function makeNotificationFlow() {
  const firebase = makeFirebase();
  const inboxRows: Row[] = [];
  const logRows: Row[] = [];
  const inbox = {
    create: jest.fn(async (row: Row) => { inboxRows.push(row); return row; }),
    insertMany: jest.fn(async (rows: Row[]) => { inboxRows.push(...rows); return rows; }),
  };
  const logs = {
    create: jest.fn(async (row: Row) => { logRows.push(row); return row; }),
    insertMany: jest.fn(async (rows: Row[]) => { logRows.push(...rows); return rows; }),
    find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
    exists: jest.fn().mockResolvedValue(null),
  };
  const padron = { getPadronUsersFromEvent: jest.fn(), getUsersByCarnets: jest.fn() };
  const service = new InstitutionalVotingNotificationsService(
    { messaging: firebase.messaging } as never, inbox as never, logs as never,
    { updateOne: jest.fn().mockResolvedValue({}) } as never, { find: jest.fn() } as never,
    { find: jest.fn() } as never, padron as never, { sendEmail: jest.fn() } as never,
    { get: jest.fn().mockReturnValue('test-chain') } as never,
  );
  return { firebase, inboxRows, logRows, inbox, logs, padron, service };
}

describe('MX-14 Backend Results — integraciones focales', () => {
  afterEach(() => jest.restoreAllMocks());

  it('[MX-14][NOT-PUB-P1-002][INTEGRACION] persiste contenido institucional y log sin tokens ni cabeceras', async () => {
    const firebase = makeFirebase();
    const inbox: Row[] = [];
    const logs: Row[] = [];
    const service = new TopicMessagingService(
      firebase as never,
      { create: jest.fn(async (row: Row) => { logs.push(row); return row; }) } as never,
      { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), dni: '123', votingLocationId: new Types.ObjectId('507f1f77bcf86cd799439011') }]) })) } as never,
      { insertMany: jest.fn(async (rows: Row[]) => { inbox.push(...rows); return rows; }) } as never,
    );

    await service.announceCountToLocation({ locationId: '507f1f77bcf86cd799439011', title: 'Noticia', body: 'Contenido' });

    expect(inbox[0]).toEqual(expect.objectContaining({ title: 'Noticia', body: 'Contenido', status: 'NEW', topic: 'loc_507f1f77bcf86cd799439011' }));
    expect(logs[0]).toEqual(expect.objectContaining({ status: 'SENT', messageId: 'mx14-delivery-id' }));
    expect(JSON.stringify({ inbox, logs })).not.toMatch(/fcm.*token|authorization|private.?key/i);
  });

  it('[MX-14][NOT-GEN-P0-001][INTEGRACION] persiste bandeja y logs y continúa tras fallo parcial', async () => {
    const { service, firebase, inboxRows, logRows, padron } = makeNotificationFlow();
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();
    padron.getPadronUsersFromEvent.mockResolvedValue([{ _id: first, dni: '111', active: true, enabled: true }, { _id: second, dni: '222', active: true, enabled: true }]);
    firebase.send.mockResolvedValueOnce('sent-1').mockRejectedValueOnce(new Error('simulated provider failure'));
    const event = { _id: new Types.ObjectId(), name: 'Elección', state: 'READY_FOR_REVIEW', convocationNotifiedAt: null };

    const result = await service.notifyConvocationIfEligible(event as never);

    expect(inboxRows).toHaveLength(2);
    expect(logRows.map((row) => row.status).sort()).toEqual(['FAILED', 'SENT']);
    expect(result).toEqual(expect.objectContaining({ status: 'partial_success', newlyNotified: 1, failed: 1 }));
  });

  it('[MX-14][NOT-GEN-P0-002][INTEGRACION] inserta NEW antes del push y evita duplicar recompensa', async () => {
    const { service, inboxRows, logRows, padron } = makeNotificationFlow();
    const userId = new Types.ObjectId();
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValue(5n);
    padron.getUsersByCarnets.mockResolvedValue([{ _id: userId, dni: '123' }]);

    await service.notifyVoteRewardAvailableIfEligible('event-1', '123');

    expect(inboxRows).toEqual([expect.objectContaining({ status: 'NEW', topic: `user_${userId}` })]);
    expect(logRows).toEqual([expect.objectContaining({ status: 'SENT', messageId: 'mx14-delivery-id' })]);
  });

  it('[MX-14][NOT-SND-P0-001][INTEGRACION] conserva éxitos y FAILED sanitizado al fallar un destinatario', async () => {
    const { service, firebase, logRows, padron } = makeNotificationFlow();
    padron.getPadronUsersFromEvent.mockResolvedValue([{ _id: new Types.ObjectId(), dni: '111', active: true, enabled: true }, { _id: new Types.ObjectId(), dni: '222', active: true, enabled: true }]);
    firebase.send.mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('provider failure without credentials'));

    await service.notifyNewsToCurrentPadron({ _id: new Types.ObjectId(), name: 'Evento' } as never, { title: 'Aviso', body: 'Mensaje' });

    expect(logRows.map((row) => row.status).sort()).toEqual(['FAILED', 'SENT']);
    expect(String(logRows.find((row) => row.status === 'FAILED')?.error)).not.toMatch(/FB_PRIVATE_KEY|INTERNAL_PUSH_SECRET/);
  });

  it('[MX-14][NOT-RCV-P0-001][INTEGRACION] entrega payload ordenable con title, body, type y createdAt', async () => {
    const firebase = makeFirebase();
    const stored: Row[] = [];
    const service = new TopicMessagingService(firebase as never, { create: jest.fn().mockResolvedValue({}) } as never, { find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId(), dni: '111' }]) })) } as never, { insertMany: jest.fn(async (rows: Row[]) => { stored.push(...rows.map((row) => ({ ...row, createdAt: new Date() }))); }) } as never);

    await service.announceCountToLocation({ locationId: '507f1f77bcf86cd799439011' });

    expect(stored[0]).toEqual(expect.objectContaining({ title: 'Inicio de conteo', body: expect.any(String), data: expect.objectContaining({ type: 'announce_count' }), createdAt: expect.any(Date) }));
  });

  it('[MX-14][NOT-DUP-P0-001][INTEGRACION] repite resultados o recordatorios sin segundo envío cuando ya existen marcas', async () => {
    const { service, firebase, padron } = makeNotificationFlow();
    const event = { _id: new Types.ObjectId(), name: 'Evento', resultsNotifiedAt: new Date() };
    padron.getPadronUsersFromEvent.mockResolvedValue([{ _id: new Types.ObjectId(), dni: '111', active: true, enabled: true }]);

    await expect(service.notifyResultsAvailableIfEligible(event as never)).resolves.toEqual({ sent: 0, skipped: 'already_notified' });
    expect(firebase.send).not.toHaveBeenCalled();
  });

  it('[MX-14][NOT-DUP-P1-002][INTEGRACION] registra conteos SENT/FAILED y no detiene el flujo por un fallo', async () => {
    const { service, firebase, logRows, padron } = makeNotificationFlow();
    padron.getPadronUsersFromEvent.mockResolvedValue([{ _id: new Types.ObjectId(), dni: '111', active: true, enabled: true }, { _id: new Types.ObjectId(), dni: '222', active: true, enabled: true }]);
    firebase.send.mockResolvedValueOnce('ok').mockRejectedValueOnce(new Error('single failure'));

    const result = await service.notifyNewsToCurrentPadron({ _id: new Types.ObjectId(), name: 'Evento' } as never, { title: 'A', body: 'B' });

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(logRows).toHaveLength(2);
  });
});
