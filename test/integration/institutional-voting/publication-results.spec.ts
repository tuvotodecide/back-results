import request from 'supertest';
import { Types } from 'mongoose';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  confirmInstitutionalOfficialPublication,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../../utils/institutional-voting.helpers';

describe('Institutional voting integration - publication and results', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function updateEventDatesInDb(
    eventId: string,
    payload: {
      votingStart?: Date;
      votingEnd?: Date;
      resultsPublishAt?: Date;
      publishDeadline?: Date;
    },
  ) {
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: payload },
    );
  }

  async function preparePublishedEvent(overrides: Record<string, unknown> = {}) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
    );

    const eventId = created.body.id as string;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);

    return eventId;
  }

  it('crea el deadline oficial exactamente 6 horas antes del inicio de votación', async () => {
    // Set dynamic dates based on now
    const now = Date.now();
    const votingStartDate = new Date(now + 48 * 60 * 60 * 1000); // 48h from now
    const votingEndDate = new Date(now + 50 * 60 * 60 * 1000); // 50h from now
    const resultsPublishAtDate = new Date(now + 51 * 60 * 60 * 1000); // 51h from now

    const votingStart = votingStartDate.toISOString();
    const votingEnd = votingEndDate.toISOString();
    const resultsPublishAt = resultsPublishAtDate.toISOString();

    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart,
        votingEnd,
        resultsPublishAt,
      },
    );

    // Calculate expected publishDeadline: 6 hours before votingStart
    const expectedPublishDeadline = new Date(votingStartDate.getTime() - 6 * 60 * 60 * 1000).toISOString();

    expect(created.status).toBe(201);
    expect(new Date(created.body.publishDeadline).toISOString()).toBe(expectedPublishDeadline);
  });

  it('abre revisión y luego confirma publicación oficial para usuarios vinculados', async () => {
    const linkedUsers = [
      {
        dni: '123456',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        dni: 'ABC789',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    for (const user of linkedUsers) {
      await ctx.conn.collection('users').updateOne(
        { dni: user.dni },
        { $set: user },
        { upsert: true },
      );
    }

    const eventId = await preparePublishedEvent();

    const published = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );

    expect(published.status).toBe(201);

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
        'data.eventId': eventId,
      })
      .toArray();

    expect(notifications).toHaveLength(2);
    expect(notifications[0].data).toHaveProperty('state', 'READY_FOR_REVIEW');

    const officialNotifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_OFFICIAL_PUBLICATION_CONFIRMED',
        'data.eventId': eventId,
      })
      .toArray();

    expect(officialNotifications).toHaveLength(2);
    expect(officialNotifications[0].title).toBe(
      'La elección fue publicada oficialmente',
    );
    expect(officialNotifications[0].body).toContain(
      'La elección Eleccion Directiva 2026 iniciará el',
    );
    expect(officialNotifications[0].body).not.toMatch(/blockchain|contrato|tx|backend/i);

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('OFFICIALLY_PUBLISHED');
    expect(eventInDb?.convocationNotifiedAt).toBeTruthy();
    expect(eventInDb?.officialPublishedAt).toBeTruthy();
  });

  it('expone readiness completo antes de confirmar publicación oficial', async () => {
    const eventId = await preparePublishedEvent();

    const readiness = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/review-readiness`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(readiness.status).toBe(200);
    expect(readiness.body).toEqual(
      expect.objectContaining({
        id: eventId,
        state: 'READY_FOR_REVIEW',
        isReady: true,
        pending: [],
      }),
    );
    expect(readiness.body.publicationWindow).toEqual(
      expect.objectContaining({
        canConfirmOfficialPublication: true,
        expired: false,
      }),
    );
  });

  it('persiste metadata tx oficial y documenta error de doble publicación', async () => {
    const eventId = await preparePublishedEvent();

    const first = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      {
        txHash: '0xofficialtx',
        wallet: '0xAdminWallet',
        chainId: '11155111',
      },
    );

    expect(first.status).toBe(201);
    expect(first.body).toEqual(
      expect.objectContaining({
        state: 'OFFICIALLY_PUBLISHED',
        publicationConfirmed: true,
        officialPublicationTxHash: '0xofficialtx',
        officialPublicationWallet: '0xAdminWallet',
        officialPublicationChainId: '11155111',
      }),
    );

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb).toEqual(
      expect.objectContaining({
        state: 'OFFICIALLY_PUBLISHED',
        publicationConfirmed: true,
        officialPublicationTxHash: '0xofficialtx',
        officialPublicationWallet: '0xAdminWallet',
        officialPublicationChainId: '11155111',
      }),
    );

    const second = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { txHash: '0xsecond' },
    );
    expect(second.status).toBe(400);
    expect(String(second.body.message)).toContain('READY_FOR_REVIEW');
  });

  it('envía recordatorio automático de inicio 1h a votantes habilitados y no duplica', async () => {
    const linkedUsers = [
      {
        dni: '123456',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        dni: 'ABC789',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    for (const user of linkedUsers) {
      await ctx.conn.collection('users').updateOne(
        { dni: user.dni },
        { $set: user },
        { upsert: true },
      );
    }

    const eventId = await preparePublishedEvent();
    const official = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { txHash: '0xreminder' },
    );
    expect(official.status).toBe(201);

    const now = new Date('2026-07-10T13:00:30.000Z');
    await updateEventDatesInDb(eventId, {
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processVotingReminderNotifications(now);
    await lifecycle.processVotingReminderNotifications(now);

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.eventId': eventId,
        'data.type': 'INSTITUTIONAL_VOTING_STARTS_IN_1H',
      })
      .toArray();
    const logs = await ctx.conn
      .collection('notification_logs')
      .find({
        'data.eventId': eventId,
        'data.type': 'INSTITUTIONAL_VOTING_STARTS_IN_1H',
        status: 'SENT',
      })
      .toArray();

    expect(notifications).toHaveLength(2);
    expect(logs).toHaveLength(2);
    expect(notifications[0]).toEqual(
      expect.objectContaining({
        title: 'La votación inicia en 1 hora',
        body: expect.stringContaining('comienza a las 10:00'),
      }),
    );
    expect(notifications[0].data).toEqual(
      expect.objectContaining({
        eventId,
        eventName: expect.any(String),
        phase: 'START',
        offsetMinutes: '60',
        scheduledFor: '2026-07-10T14:00:00.000Z',
        votingStart: '2026-07-10T14:00:00.000Z',
        votingEnd: '2026-07-10T18:00:00.000Z',
        severity: 'info',
        publicPath: `/votacion/elecciones/${eventId}/publica`,
      }),
    );
  });

  it('no genera notificaciones de revisión cuando no existan usuarios previamente vinculados', async () => {
    await ctx.conn.collection('users').deleteMany({
      dni: { $in: ['123456', 'ABC789'] },
    });

    const eventId = await preparePublishedEvent();

    const published = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );

    expect(published.status).toBe(201);

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({ 'data.eventId': eventId, 'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN' })
      .toArray();
    expect(notifications).toHaveLength(0);
  });

  it('bloquea resultados antes de la fecha permitida y luego los expone con snapshot', async () => {
    const createdBlocked = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    const blockedEventId = createdBlocked.body.id as string;
    await updateEventDatesInDb(blockedEventId, {
      votingStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() - 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const blocked = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${blockedEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('RESULTS_NOT_AVAILABLE');

    const visibleEventId = await preparePublishedEvent();
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, visibleEventId);
    await updateEventDatesInDb(visibleEventId, {
      votingStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() - 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${visibleEventId}/results/snapshot`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.resultsSnapshot);

    const visible = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${visibleEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(visible.status).toBe(200);
    expect(visible.body.source).toBe('BLOCKCHAIN');
    expect(visible.body.txHash).toBe(institutionalVotingFixtures.resultsSnapshot.txHash);
    expect(visible.body.roles).toHaveLength(1);
  });

  it('bloquea snapshot antes de publicación oficial con error controlado', async () => {
    const eventId = await preparePublishedEvent();

    const snapshot = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/results/snapshot`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.resultsSnapshot);

    expect(snapshot.status).toBe(403);
    expect(snapshot.body.error).toBe('RESULTS_SNAPSHOT_NOT_ALLOWED');
    expect(await ctx.conn.collection('event_results_snapshots').countDocuments({
      eventId: new Types.ObjectId(eventId),
    })).toBe(0);
  });

  it('actualiza snapshot único para un evento publicado sin duplicarlo', async () => {
    const eventId = await preparePublishedEvent();
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const first = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/results/snapshot`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.resultsSnapshot);
    expect(first.status).toBe(201);
    expect(first.body.txHash).toBe(institutionalVotingFixtures.resultsSnapshot.txHash);

    const updatedSnapshot = {
      ...institutionalVotingFixtures.resultsSnapshot,
      txHash: '0xupdatedsnapshot',
      blockNumber: '654321',
      roles: [
        {
          roleName: 'Presidente',
          total: 12,
          ranking: [
            { optionName: 'Frente Verde', votes: 7, percentage: 58.33 },
            { optionName: 'Frente Azul', votes: 5, percentage: 41.67 },
          ],
          winners: [{ optionName: 'Frente Verde', votes: 7, percentage: 58.33 }],
        },
      ],
    };

    const second = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/results/snapshot`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(updatedSnapshot);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(
      expect.objectContaining({
        eventId,
        source: 'BLOCKCHAIN',
        txHash: '0xupdatedsnapshot',
        blockNumber: '654321',
      }),
    );
    expect(second.body.roles[0]).toEqual(
      expect.objectContaining({
        roleName: 'Presidente',
        total: 12,
      }),
    );

    const snapshots = await ctx.conn
      .collection('event_results_snapshots')
      .find({ eventId: new Types.ObjectId(eventId) })
      .toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toEqual(
      expect.objectContaining({
        source: 'BLOCKCHAIN',
        txHash: '0xupdatedsnapshot',
        blockNumber: '654321',
      }),
    );
  });

  it('lee resultados publicados sin snapshot usando el shape vacío actual', async () => {
    const eventId = await preparePublishedEvent();
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 2 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() - 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });
    await ctx.conn.collection('event_results_snapshots').deleteMany({
      eventId: new Types.ObjectId(eventId),
    });

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        eventId,
        source: 'BLOCKCHAIN',
        txHash: null,
        blockNumber: null,
        roles: [],
      }),
    );
  });

  it('envía recordatorio 30 minutos antes del límite si aún no hubo publicación oficial', async () => {
    const eventId = await preparePublishedEvent();
    await updateEventDatesInDb(eventId, {
      publishDeadline: new Date(Date.now() + 25 * 60 * 1000),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    const notificationsService = ctx.app.get(InstitutionalVotingNotificationsService);
    const reminderSpy = jest
      .spyOn(notificationsService, 'sendOfficialPublicationReminder')
      .mockImplementation(async (event: any) => {
        event.officialPublicationReminderSentAt = new Date();
        await event.save();
        return { sent: 1 };
      });

    await lifecycle.processLifecycle();

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(reminderSpy).toHaveBeenCalled();
    expect(eventInDb?.officialPublicationReminderSentAt).toBeTruthy();

    reminderSpy.mockRestore();
  });

  it('cierra y publica resultados al ejecutar el ciclo de vida con notificación exitosa', async () => {
    await ctx.conn.collection('users').updateOne(
      { dni: 'ABC789' },
      {
        $set: {
          dni: 'ABC789',
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );

    const eventId = await preparePublishedEvent({
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 3 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() - 2 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const updatedEvent = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(updatedEvent?.state).toBe('RESULTS_PUBLISHED');
    expect(updatedEvent?.resultsNotifiedAt).toBeTruthy();

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({ 'data.type': 'INSTITUTIONAL_RESULTS_AVAILABLE', 'data.eventId': eventId })
      .toArray();
    expect(notifications.length).toBeGreaterThan(0);
  });

  it('publica resultados oficialmente aunque falle la notificación final y reintenta después', async () => {
    const eventId = await preparePublishedEvent({
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 3 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() - 2 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });

    const notificationsService = ctx.app.get(InstitutionalVotingNotificationsService);
    const notifySpy = jest
      .spyOn(notificationsService, 'notifyResultsAvailableIfEligible')
      .mockRejectedValue(new Error('results notification failed'));

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const failedEvent = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(failedEvent?.state).toBe('RESULTS_PUBLISHED');
    expect(failedEvent?.resultsNotifiedAt).toBeFalsy();
    expect(failedEvent?.resultsNotificationFailedAt).toBeTruthy();
    expect(failedEvent?.resultsNotificationError).toBe('results notification failed');
    notifySpy.mockRestore();

    await lifecycle.processLifecycle();

    const retriedEvent = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(retriedEvent?.state).toBe('RESULTS_PUBLISHED');
    expect(retriedEvent?.resultsNotifiedAt).toBeTruthy();
  });
});
