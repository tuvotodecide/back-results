import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

jest.setTimeout(180000);

describe('Institutional voting integration - cancelled voting API contract', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let adminId: Types.ObjectId;

  const associatedCollections = [
    'event_roles',
    'voting_options',
    'padron_versions',
    'padron_entries',
    'participations',
    'presential_qr_sessions',
    'comparison_reports',
    'event_results_snapshots',
  ];

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    const admin = await ctx.conn
      .collection('roled_users')
      .findOne({ email: 'admin@example.com' });
    adminId = admin?._id as Types.ObjectId;
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  function objectId(id: string) {
    return new Types.ObjectId(id);
  }

  function futureEventPayload(name: string) {
    const votingStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const votingEnd = new Date(Date.now() + 50 * 60 * 60 * 1000);
    const resultsPublishAt = new Date(Date.now() + 52 * 60 * 60 * 1000);

    return {
      ...institutionalVotingFixtures.event,
      name,
      votingStart: votingStart.toISOString(),
      votingEnd: votingEnd.toISOString(),
      resultsPublishAt: resultsPublishAt.toISOString(),
    };
  }

  async function createEventInState(
    state: string,
    overrides: Record<string, unknown> = {},
  ) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...futureEventPayload(`Cancel API ${state} ${Date.now()} ${Math.random()}`),
        ...overrides,
      },
    );
    expect(created.status).toBe(201);

    const eventId = created.body.id as string;
    const statePatch: Record<string, unknown> = {
      state,
      ...(state === 'OFFICIALLY_PUBLISHED' || state === 'PUBLISHED'
        ? { publicationConfirmed: true, officialPublishedAt: new Date() }
        : {}),
      ...(state === 'PUBLICATION_EXPIRED'
        ? { publicationExpiredAt: new Date(), publicationConfirmed: false }
        : {}),
      ...(state === 'DISABLED'
        ? { disabledAt: new Date(), publicationConfirmed: true }
        : {}),
      ...(state === 'CANCELLED'
        ? { cancelledAt: new Date(), cancelledBy: String(adminId) }
        : {}),
    };

    await ctx.conn
      .collection('voting_events')
      .updateOne(
        { _id: objectId(eventId) },
        { $set: { ...statePatch, ...overrides } },
      );

    return eventId;
  }

  async function seedAssociatedResources(
    eventId: string,
    options: { dni?: string; includeUser?: boolean } = {},
  ) {
    const eventObjectId = objectId(eventId);
    const tenantId = objectId(ctx.createdTenantId);
    const suffix = `${eventId}-${Date.now()}-${Math.random()}`;
    const dni = options.dni || `900${String(Date.now()).slice(-6)}`;
    const padronVersionId = new Types.ObjectId();

    if (options.includeUser !== false) {
      await ctx.conn.collection('users').updateOne(
        { dni },
        {
          $set: {
            dni,
            active: true,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true },
      );
    }

    await ctx.conn.collection('event_roles').insertOne({
      eventId: eventObjectId,
      name: `Rol ${suffix}`,
      normalizedName: `rol ${suffix}`,
      maxWinners: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('voting_options').insertOne({
      eventId: eventObjectId,
      tenantId,
      name: `Opcion ${suffix}`,
      normalizedName: `opcion ${suffix}`,
      color: '#0057FF',
      colors: ['#0057FF'],
      candidates: [{ name: 'Candidato Uno', roleName: `Rol ${suffix}` }],
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('padron_versions').insertOne({
      _id: padronVersionId,
      eventId: eventObjectId,
      tenantId,
      createdBy: adminId,
      fileDigest: `digest-${suffix}`,
      sourceType: 'CSV_LEGACY',
      totals: { validCount: 1, duplicateCount: 0, invalidCount: 0 },
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('padron_entries').insertOne({
      padronVersionId,
      eventId: eventObjectId,
      carnetNorm: dni,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('comparison_reports').insertOne({
      eventId: eventObjectId,
      padronVersionId,
      status: 'OK',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('participations').insertOne({
      eventId: eventObjectId,
      carnetNorm: `${dni}-participated`,
      idempotencyKey: `idem-${suffix}`,
      participatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('presential_qr_sessions').insertOne({
      eventId: eventObjectId,
      stationId: `station-${suffix}`,
      tokenId: `token-${suffix}`,
      tokenHash: `hash-${suffix}`,
      status: 'READY',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      createdBy: adminId,
      rotationNumber: 1,
      claimTtlSeconds: 300,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('event_results_snapshots').insertOne({
      eventId: eventObjectId,
      source: 'TEST',
      txHash: `0x${String(Date.now())}`,
      blockNumber: '1',
      roles: [
        {
          roleName: `Rol ${suffix}`,
          total: 1,
          ranking: [{ optionName: `Opcion ${suffix}`, votes: 1, percentage: 100 }],
          winners: [{ optionName: `Opcion ${suffix}`, votes: 1, percentage: 100 }],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { dni, padronVersionId };
  }

  async function countAssociatedResources(eventId: string) {
    const eventObjectId = objectId(eventId);
    const out: Record<string, number> = {};
    for (const collectionName of associatedCollections) {
      out[collectionName] = await ctx.conn
        .collection(collectionName)
        .countDocuments({ eventId: eventObjectId });
    }
    return out;
  }

  async function countCancellationNotifications(eventId: string) {
    const userNotifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.eventId': eventId,
        'data.type': 'INSTITUTIONAL_VOTING_CANCELLED',
      })
      .toArray();
    const logs = await ctx.conn
      .collection('notification_logs')
      .find({
        'data.eventId': eventId,
        'data.type': 'INSTITUTIONAL_VOTING_CANCELLED',
      })
      .toArray();

    return { userNotifications, logs };
  }

  it.each(['DRAFT', 'READY_FOR_REVIEW', 'PUBLICATION_EXPIRED'])(
    'DELETE cancela lógicamente un evento %s y conserva recursos asociados',
    async (state) => {
      const eventId = await createEventInState(state);
      await seedAssociatedResources(eventId);
      const beforeCounts = await countAssociatedResources(eventId);

      const response = await request(ctx.httpServer)
        .delete(`/api/v1/voting/events/${eventId}`)
        .auth(ctx.adminToken, { type: 'bearer' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: eventId,
          deleted: true,
          state: 'CANCELLED',
          cancellationNotification: null,
        }),
      );

      const eventInDb = await ctx.conn
        .collection('voting_events')
        .findOne({ _id: objectId(eventId) });
      expect(eventInDb).toEqual(
        expect.objectContaining({
          state: 'CANCELLED',
          publicationConfirmed: false,
          cancelledBy: String(adminId),
        }),
      );
      expect(eventInDb?.cancelledAt).toBeInstanceOf(Date);

      expect(await countAssociatedResources(eventId)).toEqual(beforeCounts);
      const activeSessions = await ctx.conn
        .collection('presential_qr_sessions')
        .find({ eventId: objectId(eventId) })
        .toArray();
      expect(activeSessions).toHaveLength(beforeCounts.presential_qr_sessions);
      expect(activeSessions[0].status).toBe('CANCELLED');

      const cancellationNotifications = await countCancellationNotifications(eventId);
      expect(cancellationNotifications.userNotifications).toHaveLength(0);
      expect(cancellationNotifications.logs).toHaveLength(0);
    },
  );

  it.each([
    'OFFICIALLY_PUBLISHED',
    'PUBLISHED',
    'CLOSED',
    'RESULTS_PUBLISHED',
    'DISABLED',
  ])(
    'DELETE rechaza estado no cancelable %s sin cambiar estado, borrar recursos ni notificar',
    async (state) => {
      const eventId = await createEventInState(state, {
        convocationNotifiedAt: new Date(),
      });
      await seedAssociatedResources(eventId);
      const beforeCounts = await countAssociatedResources(eventId);

      const response = await request(ctx.httpServer)
        .delete(`/api/v1/voting/events/${eventId}`)
        .auth(ctx.adminToken, { type: 'bearer' });

      expect(response.status).toBe(400);
      const eventInDb = await ctx.conn
        .collection('voting_events')
        .findOne({ _id: objectId(eventId) });
      expect(eventInDb?.state).toBe(state);
      expect(await countAssociatedResources(eventId)).toEqual(beforeCounts);

      const cancellationNotifications = await countCancellationNotifications(eventId);
      expect(cancellationNotifications.userNotifications).toHaveLength(0);
      expect(cancellationNotifications.logs).toHaveLength(0);
    },
  );

  it('DELETE de evento inexistente devuelve error sin generar notificación', async () => {
    const missingId = String(new Types.ObjectId());

    const response = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${missingId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(404);
    const cancellationNotifications = await countCancellationNotifications(missingId);
    expect(cancellationNotifications.userNotifications).toHaveLength(0);
    expect(cancellationNotifications.logs).toHaveLength(0);
  });

  it('DELETE de evento ya CANCELLED no es idempotente y no duplica notificación', async () => {
    const eventId = await createEventInState('CANCELLED', {
      convocationNotifiedAt: new Date(),
    });
    await seedAssociatedResources(eventId);

    const response = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(400);
    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: objectId(eventId) });
    expect(eventInDb?.state).toBe('CANCELLED');

    const cancellationNotifications = await countCancellationNotifications(eventId);
    expect(cancellationNotifications.userNotifications).toHaveLength(0);
    expect(cancellationNotifications.logs).toHaveLength(0);
  });

  it('DELETE sin convocationNotifiedAt no crea UserNotification ni NotificationLog de cancelación', async () => {
    const eventId = await createEventInState('READY_FOR_REVIEW', {
      convocationNotifiedAt: null,
    });
    await seedAssociatedResources(eventId);

    const response = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    const cancellationNotifications = await countCancellationNotifications(eventId);
    expect(cancellationNotifications.userNotifications).toHaveLength(0);
    expect(cancellationNotifications.logs).toHaveLength(0);
  });

  it('DELETE con convocationNotifiedAt notifica INSTITUTIONAL_VOTING_CANCELLED al padrón actual', async () => {
    const eventId = await createEventInState('READY_FOR_REVIEW', {
      convocationNotifiedAt: new Date(),
      name: `Cancel notified ${Date.now()}`,
    });
    const { dni } = await seedAssociatedResources(eventId);

    const response = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body.cancellationNotification).toEqual({ sent: 1, failed: 0 });

    const { userNotifications, logs } = await countCancellationNotifications(eventId);
    expect(userNotifications).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(userNotifications[0]).toEqual(
      expect.objectContaining({
        dni,
        title: 'Votación eliminada',
        body: 'La votación ya no está disponible porque fue eliminada por el administrador.',
        status: 'NEW',
      }),
    );
    expect(userNotifications[0].data).toEqual(
      expect.objectContaining({
        type: 'INSTITUTIONAL_VOTING_CANCELLED',
        eventId,
        electionId: eventId,
        state: 'CANCELLED',
        status: 'cancelled',
        severity: 'error',
        bannerTitle: 'Esta votación fue eliminada',
        bannerSubtitle: 'No es necesario realizar ninguna acción.',
        eligible: 'true',
        dni,
      }),
    );
    expect(userNotifications[0].data.eventName).toContain('Cancel notified');
    expect(logs[0]).toEqual(
      expect.objectContaining({
        type: 'generic',
        title: 'Votación eliminada',
        status: 'SENT',
        messageId: 'mock-message-id',
      }),
    );
    expect(logs[0].data).toEqual(
      expect.objectContaining({
        type: 'INSTITUTIONAL_VOTING_CANCELLED',
        eventId,
        state: 'CANCELLED',
        status: 'cancelled',
        severity: 'error',
      }),
    );
  });

  it('DELETE con convocationNotifiedAt pero sin destinatarios no rompe ni crea registros', async () => {
    const eventId = await createEventInState('READY_FOR_REVIEW', {
      convocationNotifiedAt: new Date(),
    });

    const response = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body.cancellationNotification).toEqual({
      sent: 0,
      skipped: 'no_linked_users',
    });
    const cancellationNotifications = await countCancellationNotifications(eventId);
    expect(cancellationNotifications.userNotifications).toHaveLength(0);
    expect(cancellationNotifications.logs).toHaveLength(0);
  });

  it('GET admin list oculta CANCELLED y conserva eventos normales visibles para el tenant', async () => {
    const visibleId = await createEventInState('DRAFT');
    const cancelledId = await createEventInState('CANCELLED');

    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    const ids = response.body.data.map((item: any) => item.id);
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(cancelledId);
  });

  it('GET public landing oculta CANCELLED sin afectar estados visibles', async () => {
    const visibleId = await createEventInState('READY_FOR_REVIEW');
    const cancelledId = await createEventInState('CANCELLED');

    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/landing')
      .query({ tenantId: ctx.createdTenantId, limit: 50 });

    expect(response.status).toBe(200);
    const ids = [
      ...response.body.upcoming,
      ...response.body.active,
      ...response.body.results,
    ].map((item: any) => item.id);
    expect(ids).toContain(visibleId);
    expect(ids).not.toContain(cancelledId);
  });

  it('GET public detail de CANCELLED devuelve contrato mínimo seguro para la app', async () => {
    const eventId = await createEventInState('CANCELLED');
    await seedAssociatedResources(eventId);

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/public/detail/${eventId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: eventId,
        state: 'CANCELLED',
        availabilityStatus: 'CANCELLED',
        phase: 'UNAVAILABLE',
        publicEligibilityEnabled: false,
        presentialKioskEnabled: false,
        resultsAvailable: false,
      }),
    );
    expect(response.body.roles).toEqual([]);
    expect(response.body.options).toEqual([]);
    expect(response.body.results).toEqual([]);
    expect(response.body).not.toHaveProperty('actions');
    expect(response.body).not.toHaveProperty('canVote');
  });

  it('GET admin detail de CANCELLED conserva trazabilidad pero bloquea edición', async () => {
    const eventId = await createEventInState('CANCELLED');
    await seedAssociatedResources(eventId);

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: eventId,
        state: 'CANCELLED',
        canEditStructure: false,
        canEditPadronDuringVoting: false,
        canEditPadronInLimitedMode: false,
        padronEditMode: 'READ_ONLY',
      }),
    );
    expect(response.body.editingRules).toEqual(
      expect.objectContaining({
        canEditEverything: false,
        canEditPadronDuringVoting: false,
        canEditPadronInLimitedMode: false,
      }),
    );
    expect(response.body.roles.length).toBeGreaterThan(0);
    expect(response.body.options.length).toBeGreaterThan(0);
  });

  it('bloquea acciones administrativas y públicas principales sobre evento CANCELLED', async () => {
    const eventId = await createEventInState('CANCELLED');

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'No debe editarse' });
    expect(patchEvent.status).toBe(400);

    const ready = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/ready-for-review`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});
    expect(ready.status).toBe(400);

    const officialPublication = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/official-publication/confirm`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});
    expect(officialPublication.status).toBe(400);

    const publish = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/publish`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});
    expect(publish.status).toBe(400);

    const padronStaging = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ ci: '777777' });
    expect(padronStaging.status).toBe(400);

    const presential = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/presential-sessions`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ stationId: 'principal' });
    expect(presential.status).toBe(400);

    const participation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: '777777' });
    expect(participation.status).toBe(403);
    expect(participation.body.message?.error || participation.body.error).toBe(
      'EVENT_NOT_PUBLISHED',
    );
  });
});
