import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  seedActivePublishedPresentialEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../utils/institutional-voting.helpers';
import { PresentialSessionsService } from '@/modules/institutional-voting/services/presential/presential-sessions.service';

describe('MX-09 kiosk QR focal integration coverage', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let sessions: PresentialSessionsService;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    sessions = ctx.moduleRef.get(PresentialSessionsService);
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function activeEvent(padron = institutionalVotingFixtures.padronCsv) {
    const created = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, {
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60_000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60_000).toISOString(),
    });
    const eventId = String(created.body.id);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.rolePresident);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.optionBlue);
    await uploadPadronCsv(ctx.httpServer, ctx.adminToken, eventId, padron);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/comparison-report/status`).auth(ctx.adminToken, { type: 'bearer' }).send({ status: 'OK' });
    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await seedActivePublishedPresentialEvent(ctx, eventId);
    return eventId;
  }

  async function createSession(eventId: string, stationId = 'kiosco-principal') {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/presential-sessions`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ stationId, regenerateKioskAccessToken: true });
    expect(response.status).toBe(201);
    return response.body;
  }

  it('[MX-09][KIO-HAB-P0-001][INTEGRACION] persiste desactivación autorizada, conserva sesiones terminales y controla la sincronización cancelada', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId);
    await ctx.conn.collection('presential_qr_sessions').insertMany([
      { _id: new Types.ObjectId(), eventId: new Types.ObjectId(eventId), stationId: 'terminal-completed', status: 'COMPLETED', tokenId: 'a', tokenHash: 'a', rotationNumber: 1, expiresAt: new Date(), completedAt: new Date() },
      { _id: new Types.ObjectId(), eventId: new Types.ObjectId(eventId), stationId: 'terminal-expired', status: 'EXPIRED', tokenId: 'b', tokenHash: 'b', rotationNumber: 1, expiresAt: new Date() },
    ]);
    await ctx.conn.collection('voting_events').updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { presentialKioskEnabled: false } });
    const scan = await request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token: created.currentSession.qrToken, carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(scan.status).toBe(403);
    const terminal = await ctx.conn.collection('presential_qr_sessions').find({ eventId: new Types.ObjectId(eventId), stationId: { $in: ['terminal-completed', 'terminal-expired'] } }).toArray();
    expect(terminal.map((entry) => entry.status).sort()).toEqual(['COMPLETED', 'EXPIRED']);
  });

  it('[MX-09][KIO-QR-P0-001][INTEGRACION] persiste una sola sesión activa por estación y devuelve campos completos de READY', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId, 'station-one');
    const stored = await ctx.conn.collection('presential_qr_sessions').findOne({ _id: new Types.ObjectId(created.currentSession.id) });
    expect(stored?.status).toBe('READY');
    expect(stored?.tokenHash).toBeTruthy();
    expect(created.currentSession).toEqual(expect.objectContaining({ stationId: 'station-one', rotationNumber: 1, qrValue: expect.stringMatching(/^pqs\./), expiresAt: expect.any(String) }));
    const active = await ctx.conn.collection('presential_qr_sessions').countDocuments({ eventId: new Types.ObjectId(eventId), stationId: 'station-one', status: { $in: ['READY', 'CLAIMED'] } });
    expect(active).toBe(1);
  });

  it('[MX-09][KIO-QR-P1-004][INTEGRACION] publica estados SSE permitidos y reconcilia el estado actual sin session.cancelled', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId, 'stream');
    const stream = await sessions.createAuthorizedStream(eventId, 'stream', created.kioskAccessToken);
    const types: string[] = [];
    const subscription = stream.subscribe((message) => types.push(String(message.type)));
    const claim = await sessions.scanAndClaim({ token: created.currentSession.qrToken, carnet: institutionalVotingFixtures.carnet.empadronado });
    await sessions.completeSessionForParticipation(eventId, claim.body.presentialSessionId, institutionalVotingFixtures.carnet.empadronado);
    await ctx.conn.collection('presential_qr_sessions').updateOne({ _id: new Types.ObjectId(created.currentSession.id) }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    await sessions.expireTimedOutSessions();
    subscription.unsubscribe();
    expect(types).toEqual(expect.arrayContaining(['session.ready', 'session.claimed', 'session.completed', 'session.rotated']));
    expect(types).not.toContain('session.cancelled');
    const current = await sessions.getCurrentSessionState(eventId, 'stream', created.kioskAccessToken);
    expect(current.session?.status).toBe('READY');
  });

  it('[MX-09][KIO-QR-P0-005][INTEGRACION] conserva READY cancelada y crea la rotación siguiente', async () => {
    const eventId = await activeEvent();
    const first = await createSession(eventId, 'rotate');
    const second = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/presential-sessions`).auth(ctx.adminToken, { type: 'bearer' }).send({ stationId: 'rotate' });
    expect(second.status).toBe(201);
    const previous = await ctx.conn.collection('presential_qr_sessions').findOne({ _id: new Types.ObjectId(first.currentSession.id) });
    expect(previous?.status).toBe('CANCELLED');
    expect(second.body.currentSession.rotationNumber).toBe(first.currentSession.rotationNumber + 1);
  });

  it('[MX-09][KIO-VAL-P0-003][INTEGRACION] consulta padrón y participación registrada antes de reclamar', async () => {
    const eventId = await activeEvent('carnet,habilitado\nABC-789,si\nXYZ-123,no\n');
    const created = await createSession(eventId);
    const disabled = await request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token: created.currentSession.qrToken, carnet: 'XYZ-123' });
    expect(disabled.status).toBe(403);
    const valid = await request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token: created.currentSession.qrToken, carnet: 'ABC-789' });
    expect(valid.status).toBe(201);
  });

  it('[MX-09][KIO-CNS-P0-001][INTEGRACION] completa una vez después de participación y libera la estación con READY nueva', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId);
    const claim = await sessions.scanAndClaim({ token: created.currentSession.qrToken, carnet: institutionalVotingFixtures.carnet.empadronado });
    const completed = await sessions.completeSessionForParticipation(eventId, claim.body.presentialSessionId, institutionalVotingFixtures.carnet.empadronado);
    const retry = await sessions.completeSessionForParticipation(eventId, claim.body.presentialSessionId, institutionalVotingFixtures.carnet.empadronado);
    expect(completed.status).toBe('COMPLETED');
    expect(retry.status).toBe('COMPLETED');
    const active = await ctx.conn.collection('presential_qr_sessions').findOne({ eventId: new Types.ObjectId(eventId), stationId: 'kiosco-principal', status: 'READY' });
    expect(String(active?._id)).not.toBe(claim.body.presentialSessionId);
  });

  it('[MX-09][KIO-CNS-P1-003][INTEGRACION] mantiene estable la repetición de la misma participación presencial', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId);
    const claim = await request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token: created.currentSession.qrToken, carnet: institutionalVotingFixtures.carnet.empadronado });
    const payload = { carnet: institutionalVotingFixtures.carnet.empadronado, presentialSessionId: claim.body.presentialSessionId };
    const first = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/participations`).set('Idempotency-Key', `mx09-${eventId}`).send(payload);
    const retry = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/participations`).set('Idempotency-Key', `mx09-${eventId}`).send(payload);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await ctx.conn.collection('participations').countDocuments({
      eventId: new Types.ObjectId(eventId),
      carnetNorm: 'ABC789',
    })).toBe(1);
    expect(await ctx.conn.collection('presential_qr_sessions').countDocuments({ _id: new Types.ObjectId(claim.body.presentialSessionId), status: 'COMPLETED' })).toBe(1);
    expect(await ctx.conn.collection('presential_qr_sessions').countDocuments({
      eventId: new Types.ObjectId(eventId),
      stationId: 'kiosco-principal',
      status: 'READY',
    })).toBe(1);
  });

  it('[MX-09][KIO-CON-P0-001][INTEGRACION] aplica el índice parcial de sesión activa en la persistencia', async () => {
    const eventId = await activeEvent();
    await createSession(eventId, 'unique');
    const duplicate = await ctx.conn.collection('presential_qr_sessions').insertOne({
      eventId: new Types.ObjectId(eventId), stationId: 'unique', tokenId: 'duplicate', tokenHash: 'duplicate', status: 'READY', expiresAt: new Date(Date.now() + 60_000), rotationNumber: 99, claimTtlSeconds: 300,
    }).catch((error: { code?: number }) => error);
    expect(duplicate).toMatchObject({ code: 11000 });
  });

  it('[MX-09][KIO-CON-P0-002][INTEGRACION] expira una sesión reclamada y rechaza su cierre ordinario sin reemitir voto', async () => {
    const eventId = await activeEvent();
    const created = await createSession(eventId);
    const claim = await sessions.scanAndClaim({ token: created.currentSession.qrToken, carnet: institutionalVotingFixtures.carnet.empadronado });
    await ctx.conn.collection('presential_qr_sessions').updateOne({ _id: new Types.ObjectId(claim.body.presentialSessionId) }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    await sessions.expireTimedOutSessions();
    await expect(sessions.completeSessionForParticipation(eventId, claim.body.presentialSessionId, institutionalVotingFixtures.carnet.empadronado)).rejects.toMatchObject({ status: 409 });
    expect(await ctx.conn.collection('presential_qr_sessions').findOne({ _id: new Types.ObjectId(claim.body.presentialSessionId) })).toMatchObject({ status: 'EXPIRED' });
  });
});
