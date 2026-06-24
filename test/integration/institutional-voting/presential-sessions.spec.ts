import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../../utils/institutional-voting.helpers';
import { PresentialSessionsService } from '@/modules/institutional-voting/services/presential/presential-sessions.service';

describe('Institutional voting integration - presential QR sessions', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let presentialSessionsService: PresentialSessionsService;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    presentialSessionsService = ctx.moduleRef.get(PresentialSessionsService);
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createConfiguredEvent(padronCsv = institutionalVotingFixtures.padronCsv) {
    const created = await createInstitutionalEvent(
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
    const eventId = created.body.id as string;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    await uploadPadronCsv(ctx.httpServer, ctx.adminToken, eventId, padronCsv);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60 * 60 * 1000),
          resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      },
    );

    return eventId;
  }

  async function createKioskSession(eventId: string, body: Record<string, unknown> = {}) {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/presential-sessions`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);

    expect(response.status).toBe(201);
    expect(response.body.kioskEnabled).toBe(true);
    return response;
  }

  async function getCurrent(
    eventId: string,
    kioskToken: string,
    stationId = 'kiosco-principal',
  ) {
    return request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/presential-sessions/current`)
      .set('x-kiosk-token', kioskToken)
      .query({ stationId });
  }

  const waitForCondition = async (
    predicate: () => boolean,
    timeoutMs = 3000,
    intervalMs = 50,
  ) => {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) {
        throw new Error('Timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };

  it('crea la sesión QR actual del kiosco y expone el contrato limitado de acceso', async () => {
    const eventId = await createConfiguredEvent();

    const created = await createKioskSession(eventId, {
      stationId: 'main-kiosk',
      regenerateKioskAccessToken: true,
    });

    expect(created.body.kioskAccessToken).toMatch(/^pkc_/);
    expect(created.body.kioskBootstrap.authHeader).toBe('x-kiosk-token');
    expect(created.body.currentSession.status).toBe('READY');
    expect(created.body.currentSession.qrToken).toMatch(/^pqs\./);

    const current = await getCurrent(eventId, created.body.kioskAccessToken, 'main-kiosk');
    expect(current.status).toBe(200);
    expect(current.body.eventName).toBe(institutionalVotingFixtures.event.name);
    expect(current.body.session.status).toBe('READY');
    expect(current.body.session.qrToken).toBe(created.body.currentSession.qrToken);
  });

  it('rechaza consulta current sin x-kiosk-token o con token inválido', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId, {
      regenerateKioskAccessToken: true,
    });

    const missingToken = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/presential-sessions/current`)
      .query({ stationId: 'kiosco-principal' });
    expect(missingToken.status).toBe(401);

    const invalidToken = await getCurrent(eventId, 'pkc_invalid-token');
    expect(invalidToken.status).toBe(401);

    const validToken = await getCurrent(eventId, created.body.kioskAccessToken);
    expect(validToken.status).toBe(200);
  });

  it('permite claim válido del QR y deja el kiosco en estado CLAIMED', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    expect(created.body.stationId).toBe('kiosco-principal');
    expect(created.body.kioskBootstrap.currentPath).toContain('stationId=kiosco-principal');
    expect(created.body.kioskBootstrap.streamPath).toContain('stationId=kiosco-principal');

    const scan = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(scan.status).toBe(201);
    expect(scan.body.status).toBe('CLAIMED');
    expect(scan.body.presentialSessionId).toBe(created.body.currentSession.id);

    const current = await getCurrent(eventId, created.body.kioskAccessToken);
    expect(current.status).toBe(200);
    expect(current.body.session.status).toBe('CLAIMED');
    expect(current.body.session.qrToken).toBeNull();
  });

  it('usa READY TTL por defecto de 300 segundos y al reclamar pasa a TTL de CLAIM', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId, {
      readyTtlSeconds: 30,
      claimTtlSeconds: 300,
    });
    const readyExpiresAt = new Date(created.body.currentSession.expiresAt).getTime();

    expect(created.body.readyTtlSeconds).toBe(30);

    const scan = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(scan.status).toBe(201);
    const claimed = await ctx.conn.collection('presential_qr_sessions').findOne({
      _id: new Types.ObjectId(scan.body.presentialSessionId),
    });

    expect(claimed?.status).toBe('CLAIMED');
    expect(claimed?.expiresAt.getTime()).toBeGreaterThan(readyExpiresAt + 240_000);
  });

  it('mantiene READY TTL por defecto en 300 segundos cuando no se envía override', async () => {
    const eventId = await createConfiguredEvent();
    const createdAt = Date.now();
    const created = await createKioskSession(eventId);
    const expiresAt = new Date(created.body.currentSession.expiresAt).getTime();

    expect(created.body.readyTtlSeconds).toBe(300);
    expect(expiresAt - createdAt).toBeGreaterThan(295_000);
    expect(expiresAt - createdAt).toBeLessThanOrEqual(305_000);
  });

  it('mantiene compatibilidad con kioscos legados que usan stationId=default de forma explícita', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId, {
      stationId: 'default',
    });

    expect(created.body.stationId).toBe('default');
    expect(created.body.kioskBootstrap.currentPath).toContain('stationId=default');

    const current = await getCurrent(eventId, created.body.kioskAccessToken, 'default');
    expect(current.status).toBe(200);
    expect(current.body.stationId).toBe('default');
    expect(current.body.session.status).toBe('READY');
  });

  it('bloquea el claim concurrente duplicado del mismo QR', async () => {
    const eventId = await createConfiguredEvent(
      'carnet,habilitado\nABC-789,si\nXYZ-123,si\n',
    );
    const created = await createKioskSession(eventId);
    const token = created.body.currentSession.qrToken;

    const [first, second] = await Promise.all([
      request(ctx.httpServer)
        .post('/api/v1/voting/presential-sessions/scan')
        .send({ token, carnet: 'ABC-789' }),
      request(ctx.httpServer)
        .post('/api/v1/voting/presential-sessions/scan')
        .send({ token, carnet: 'XYZ-123' }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const current = await getCurrent(eventId, created.body.kioskAccessToken);
    expect(current.status).toBe(200);
    expect(current.body.session.status).toBe('CLAIMED');
  });

  it('rechaza token inválido y QR READY expirado', async () => {
    const invalid = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: 'pqs.token-invalido',
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(invalid.status).toBe(400);

    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);
    await ctx.conn.collection('presential_qr_sessions').updateOne(
      { _id: new Types.ObjectId(created.body.currentSession.id) },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const expired = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(expired.status).toBe(409);
    expect(expired.body.error).toBe('QR_EXPIRED');
  });

  it('no permite rotar QR mientras hay una sesión CLAIMED vigente', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    const scan = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(scan.status).toBe(201);

    const rotate = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/presential-sessions`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ stationId: 'kiosco-principal' });

    expect(rotate.status).toBe(409);
  });

  it('bloquea scan y participación con sesión vieja cuando el kiosco queda apagado', async () => {
    const eventId = await createConfiguredEvent(
      'carnet,habilitado\nABC-789,si\nXYZ-123,si\n',
    );
    const createdForScan = await createKioskSession(eventId, {
      stationId: 'scan-off',
    });

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: { presentialKioskEnabled: false } },
    );

    const scanOff = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: createdForScan.body.currentSession.qrToken,
        carnet: 'ABC-789',
      });

    expect(scanOff.status).toBe(403);
    expect(scanOff.body.error).toBe('KIOSK_DISABLED');

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: { presentialKioskEnabled: true } },
    );
    const createdForParticipation = await createKioskSession(eventId, {
      stationId: 'participation-off',
    });
    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: createdForParticipation.body.currentSession.qrToken,
        carnet: 'XYZ-123',
      });
    expect(claim.status).toBe(201);

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: { presentialKioskEnabled: false } },
    );

    const blockedParticipation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-disabled-old-session')
      .send({
        carnet: 'XYZ-123',
        presentialSessionId: claim.body.presentialSessionId,
      });

    expect(blockedParticipation.status).toBe(403);
    expect(blockedParticipation.body.error).toBe('KIOSK_DISABLED');

    const normalParticipation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-disabled-normal-flow')
      .send({ carnet: 'XYZ-123' });

    expect(normalParticipation.status).toBe(201);
    expect(normalParticipation.body.participated).toBe(true);
  });

  it('expira una sesión reclamada por abandono y deja una nueva sesión READY', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);
    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(claim.status).toBe(201);

    await ctx.conn.collection('presential_qr_sessions').updateOne(
      { _id: new Types.ObjectId(claim.body.presentialSessionId) },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const current = await getCurrent(eventId, created.body.kioskAccessToken);
    expect(current.status).toBe(200);
    expect(current.body.session.status).toBe('READY');
    expect(current.body.session.id).not.toBe(claim.body.presentialSessionId);

    const expired = await ctx.conn.collection('presential_qr_sessions').findOne({
      _id: new Types.ObjectId(claim.body.presentialSessionId),
    });
    expect(expired?.status).toBe('EXPIRED');
  });

  it('cierra correctamente la sesión presencial al registrar la participación final', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(claim.status).toBe(201);

    const participation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-finalization-idem')
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        presentialSessionId: claim.body.presentialSessionId,
      });

    expect(participation.status).toBe(201);
    expect(participation.body.participated).toBe(true);

    const completed = await ctx.conn.collection('presential_qr_sessions').findOne({
      _id: new Types.ObjectId(claim.body.presentialSessionId),
    });
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.completedAt).toBeTruthy();

    const current = await getCurrent(eventId, created.body.kioskAccessToken);
    expect(current.status).toBe(200);
    expect(current.body.session.status).toBe('READY');
    expect(current.body.session.id).not.toBe(claim.body.presentialSessionId);
  });

  it('rechaza participación con presentialSessionId READY no reclamado', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-not-claimed-idem')
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        presentialSessionId: created.body.currentSession.id,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('PRESENTIAL_SESSION_NOT_CLAIMED');
  });

  it('rechaza participación cuando la sesión presencial pertenece a otro carnet', async () => {
    const eventId = await createConfiguredEvent(
      'carnet,habilitado\nABC-789,si\nXYZ-123,si\n',
    );
    const created = await createKioskSession(eventId);

    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: 'ABC-789',
      });
    expect(claim.status).toBe(201);

    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-not-owned-idem')
      .send({
        carnet: 'XYZ-123',
        presentialSessionId: claim.body.presentialSessionId,
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('PRESENTIAL_SESSION_NOT_OWNED');
  });

  it('rechaza participación cuando la sesión presencial reclamada expiró', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });
    expect(claim.status).toBe(201);

    await ctx.conn.collection('presential_qr_sessions').updateOne(
      { _id: new Types.ObjectId(claim.body.presentialSessionId) },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-expired-idem')
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        presentialSessionId: claim.body.presentialSessionId,
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('PRESENTIAL_SESSION_NOT_CLAIMED');
  });

  it('evita doble voto en el flujo presencial después de registrar la participación', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId);

    const claim = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: created.body.currentSession.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(claim.status).toBe(201);

    const firstParticipation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'presential-double-vote-idem')
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        presentialSessionId: claim.body.presentialSessionId,
      });

    expect(firstParticipation.status).toBe(201);

    const current = await getCurrent(eventId, created.body.kioskAccessToken);
    const secondScan = await request(ctx.httpServer)
      .post('/api/v1/voting/presential-sessions/scan')
      .send({
        token: current.body.session.qrToken,
        carnet: institutionalVotingFixtures.carnet.empadronado,
      });

    expect(secondScan.status).toBe(409);
  });

  it('emite eventos estilo SSE cuando la sesión cambia de estado', async () => {
    const eventId = await createConfiguredEvent();
    const created = await createKioskSession(eventId, {
      stationId: 'stream-kiosk',
      regenerateKioskAccessToken: true,
    });

    const messages: Array<{ type?: string; data?: any }> = [];
    const stream = await presentialSessionsService.createAuthorizedStream(
      eventId,
      'stream-kiosk',
      created.body.kioskAccessToken,
    );
    const subscription = stream.subscribe((message) => {
      messages.push({ type: message.type, data: message.data });
    });

    try {
      await waitForCondition(() =>
        messages.some((message) => message.type === 'session.ready'),
      );
      expect(
        messages.find((message) => message.type === 'session.ready')?.data?.eventName,
      ).toBe(institutionalVotingFixtures.event.name);

      const claim = await request(ctx.httpServer)
        .post('/api/v1/voting/presential-sessions/scan')
        .send({
          token: created.body.currentSession.qrToken,
          carnet: institutionalVotingFixtures.carnet.empadronado,
        });

      expect(claim.status).toBe(201);

      await waitForCondition(() =>
        messages.some((message) => message.type === 'session.claimed'),
      );
      expect(
        messages.find((message) => message.type === 'session.claimed')?.data?.eventName,
      ).toBe(institutionalVotingFixtures.event.name);

      const participation = await request(ctx.httpServer)
        .post(`/api/v1/voting/events/${eventId}/participations`)
        .set('Idempotency-Key', 'presential-stream-idem')
        .send({
          carnet: institutionalVotingFixtures.carnet.empadronado,
          presentialSessionId: claim.body.presentialSessionId,
        });

      expect(participation.status).toBe(201);

      await waitForCondition(() =>
        messages.some((message) => message.type === 'session.completed'),
      );
      expect(
        messages.find((message) => message.type === 'session.completed')?.data?.eventName,
      ).toBe(institutionalVotingFixtures.event.name);
      await waitForCondition(() =>
        messages.filter((message) => message.type === 'session.ready').length >= 2,
      );
      expect(
        messages.find((message) => message.type === 'session.rotated')?.data?.eventName,
      ).toBe(institutionalVotingFixtures.event.name);
    } finally {
      subscription.unsubscribe();
    }
  });
});
