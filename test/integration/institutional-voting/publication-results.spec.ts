import request from 'supertest';
import { Types } from 'mongoose';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
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

  async function preparePublishedEvent(overrides: Record<string, unknown> = {}) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 60_000).toISOString(),
        votingEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
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

    return eventId;
  }

  it('publica el evento y emite credenciales/notificaciones para usuarios vinculados', async () => {
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
    const issuerMock = ctx.app.get(IssuerService) as { issueCredential: jest.Mock };

    const published = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );

    expect(published.status).toBe(201);
    expect(issuerMock.issueCredential).toHaveBeenCalledWith(
      ['123456', 'ABC789'],
      expect.objectContaining({ name: institutionalVotingFixtures.event.name }),
    );

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_EVENT_PUBLISHED',
        'data.eventId': eventId,
      })
      .toArray();

    expect(notifications).toHaveLength(2);
    expect(notifications[0].data).toHaveProperty('credentialData');

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('PUBLISHED');
    expect(eventInDb?.convocationNotifiedAt).toBeTruthy();
  });

  it('no genera notificaciones de convocatoria cuando no existen usuarios vinculados', async () => {
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
      .find({ 'data.eventId': eventId, 'data.type': 'INSTITUTIONAL_EVENT_PUBLISHED' })
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
        votingStart: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    );
    const blockedEventId = createdBlocked.body.id as string;

    const blocked = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${blockedEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('RESULTS_NOT_AVAILABLE');

    const createdVisible = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    const visibleEventId = createdVisible.body.id as string;

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
      votingStart: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

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

  it('no publica resultados automáticamente si falla la notificación final', async () => {
    const eventId = await preparePublishedEvent({
      votingStart: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const notificationsService = ctx.app.get(InstitutionalVotingNotificationsService);
    const notifySpy = jest
      .spyOn(notificationsService, 'notifyResultsAvailableIfEligible')
      .mockRejectedValue(new Error('results notification failed'));

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const updatedEvent = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(updatedEvent?.state).not.toBe('RESULTS_PUBLISHED');
    notifySpy.mockRestore();
  });
});
