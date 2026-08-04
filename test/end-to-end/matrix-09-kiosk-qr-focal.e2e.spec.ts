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

describe('MX-09 kiosk QR focal E2E backend coverage', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => { ctx = await bootstrapInstitutionalVotingContext(); });
  afterAll(async () => { await teardownInstitutionalVotingContext(ctx); });

  async function readyEvent(padron = institutionalVotingFixtures.padronCsv) {
    const response = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, {
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60_000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60_000).toISOString(),
    });
    const eventId = String(response.body.id);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.rolePresident);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.optionBlue);
    await uploadPadronCsv(ctx.httpServer, ctx.adminToken, eventId, padron);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/comparison-report/status`).auth(ctx.adminToken, { type: 'bearer' }).send({ status: 'OK' });
    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await seedActivePublishedPresentialEvent(ctx, eventId);
    const kiosk = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/presential-sessions`).auth(ctx.adminToken, { type: 'bearer' }).send({ regenerateKioskAccessToken: true });
    expect(kiosk.status).toBe(201);
    return { eventId, kiosk: kiosk.body };
  }

  const scan = (token: string, carnet: string) => request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token, carnet });

  it('[MX-09][KIO-VAL-P0-004][E2E] recorre HTTP, controles, controlador, servicio y persistencia al reclamar un QR una sola vez', async () => {
    const { kiosk } = await readyEvent('carnet,habilitado\nABC-789,si\nXYZ-123,si\n');
    const first = await scan(kiosk.currentSession.qrToken, 'ABC-789');
    const samePerson = await scan(kiosk.currentSession.qrToken, 'ABC-789');
    const otherPerson = await scan(kiosk.currentSession.qrToken, 'XYZ-123');
    expect(first.status).toBe(201);
    expect(samePerson.status).toBe(200);
    expect(otherPerson.status).toBe(409);
    expect(first.body).toEqual(expect.objectContaining({ presentialSessionId: kiosk.currentSession.id, status: 'CLAIMED' }));
  });

  it('[MX-09][KIO-VAL-P0-005][E2E] rechaza QR vencido, reutilizado y cancelado sin abrir otra autorización', async () => {
    const { eventId, kiosk } = await readyEvent('carnet,habilitado\nABC-789,si\nXYZ-123,si\n');
    await ctx.conn.collection('presential_qr_sessions').updateOne({ _id: new Types.ObjectId(kiosk.currentSession.id) }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await scan(kiosk.currentSession.qrToken, 'ABC-789')).status).toBe(409);
    const rotated = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/presential-sessions`).auth(ctx.adminToken, { type: 'bearer' }).send({});
    expect(rotated.status).toBe(201);
    expect((await scan(kiosk.currentSession.qrToken, 'XYZ-123')).status).toBe(409);
    await ctx.conn.collection('presential_qr_sessions').updateOne({ _id: new Types.ObjectId(rotated.body.currentSession.id) }, { $set: { status: 'CANCELLED' } });
    expect((await scan(rotated.body.currentSession.qrToken, 'ABC-789')).status).toBe(409);
  });

  it('[MX-09][KIO-CNS-P0-001][E2E] reclama, registra la participación posterior y rota a READY nueva', async () => {
    const { eventId, kiosk } = await readyEvent();
    const claim = await scan(kiosk.currentSession.qrToken, institutionalVotingFixtures.carnet.empadronado);
    const participation = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/participations`).set('Idempotency-Key', `mx09-e2e-${eventId}`).send({ carnet: institutionalVotingFixtures.carnet.empadronado, presentialSessionId: claim.body.presentialSessionId });
    const state = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', kiosk.kioskAccessToken);
    expect(claim.status).toBe(201);
    expect(participation.status).toBe(201);
    expect(state.body.session).toEqual(expect.objectContaining({ status: 'READY' }));
    expect(state.body.session.id).not.toBe(claim.body.presentialSessionId);
  });

  it('[MX-09][KIO-CON-P0-004][E2E] procesa dos escaneos simultáneos y conserva una única sesión CLAIMED', async () => {
    const { eventId, kiosk } = await readyEvent('carnet,habilitado\nABC-789,si\nXYZ-123,si\n');
    const [first, second] = await Promise.all([
      scan(kiosk.currentSession.qrToken, 'ABC-789'),
      scan(kiosk.currentSession.qrToken, 'XYZ-123'),
    ]);
    expect([first.status, second.status].sort((left, right) => left - right)).toEqual([201, 409]);
    expect(await ctx.conn.collection('presential_qr_sessions').countDocuments({ eventId: new Types.ObjectId(eventId), stationId: 'kiosco-principal', status: 'CLAIMED' })).toBe(1);
  });
});
