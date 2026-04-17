import request from 'supertest';
import { Types } from 'mongoose';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
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

  it('crea el deadline oficial exactamente 24 horas antes del inicio de votación', async () => {
    const votingStart = '2026-04-25T00:01:00.000Z';
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart,
        votingEnd: '2026-04-25T02:01:00.000Z',
        resultsPublishAt: '2026-04-25T03:01:00.000Z',
      },
    );

    expect(created.status).toBe(201);
    expect(new Date(created.body.publishDeadline).toISOString()).toBe(
      '2026-04-24T00:01:00.000Z',
    );
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

  it('genera notificaciones de revisión aunque no existan usuarios previamente vinculados', async () => {
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
    expect(notifications).toHaveLength(2);
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
