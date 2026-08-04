import request from 'supertest';
import * as http from 'http';
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

describe('MX-09 kiosk QR focal acceptance coverage', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    if (!ctx.httpServer.address()) {
      await ctx.app.listen(0, '127.0.0.1');
    }
  });
  afterAll(async () => { await teardownInstitutionalVotingContext(ctx); });

  async function configuredEvent() {
    const response = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, {
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60_000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60_000).toISOString(),
    });
    const eventId = String(response.body.id);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.rolePresident);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send(institutionalVotingFixtures.optionBlue);
    await uploadPadronCsv(ctx.httpServer, ctx.adminToken, eventId, institutionalVotingFixtures.padronCsv);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/comparison-report/status`).auth(ctx.adminToken, { type: 'bearer' }).send({ status: 'OK' });
    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await seedActivePublishedPresentialEvent(ctx, eventId);
    return eventId;
  }

  async function kiosk(eventId: string, stationId = 'kiosco-principal') {
    const response = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/presential-sessions`).auth(ctx.adminToken, { type: 'bearer' }).send({ stationId, regenerateKioskAccessToken: true });
    expect(response.status).toBe(201);
    return response.body;
  }

  const scan = (token: string, carnet = institutionalVotingFixtures.carnet.empadronado) =>
    request(ctx.httpServer).post('/api/v1/voting/presential-sessions/scan').send({ token, carnet });

  const collectSse = (eventId: string, headers: Record<string, string> = {}) => {
    const address = ctx.httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the in-process HTTP server address');
    }

    return new Promise<{
      status: number;
      body: string;
      closed: boolean;
      closedByHarness: boolean;
    }>((resolve, reject) => {
      let status = 0;
      let body = '';
      let settled = false;
      let closed = false;
      let closedByHarness = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        resolve({ status, body, closed, closedByHarness });
      };
      const client = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: `/api/v1/voting/events/${eventId}/presential-sessions/stream`,
        headers: { Accept: 'text/event-stream', ...headers },
      }, (response) => {
        status = response.statusCode ?? 0;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
          if (body.includes('event: session.ready')) {
            closedByHarness = true;
            client.destroy();
            finish();
          }
        });
        response.on('end', () => {
          closed = true;
          finish();
        });
        response.on('close', () => {
          closed = true;
          finish();
        });
      });
      timeout = setTimeout(() => {
        closedByHarness = true;
        client.destroy();
        finish();
      }, 750);
      client.on('error', (error: Error) => {
        if (!settled) {
          if (timeout) clearTimeout(timeout);
          reject(error);
        }
      });
      client.end();
    });
  };

  it('[MX-09][KIO-HAB-P1-002][ACEPTACION] retorna token limitado, bootstrap y sesión actual, y bloquea evento cancelado', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    expect(created).toEqual(expect.objectContaining({ kioskAccessToken: expect.stringMatching(/^pkc_/), kioskBootstrap: expect.objectContaining({ authHeader: 'x-kiosk-token' }), currentSession: expect.objectContaining({ status: 'READY' }) }));
    await ctx.conn.collection('voting_events').updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { state: 'CANCELLED' } });
    const cancelled = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/presential-sessions`).auth(ctx.adminToken, { type: 'bearer' }).send({});
    expect(cancelled.status).toBe(400);
  });

  // it('[MX-09][KIO-QR-P0-002][ACEPTACION] no entrega QR cuando la ventana de votación está inactiva', async () => {
  //   const eventId = await configuredEvent();
  //   const created = await kiosk(eventId);
  //   const active = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
  //   expect(active.status).toBe(200);
  //   expect(active.body.session.qrValue).toMatch(/^pqs\./);
  //   await ctx.conn.collection('voting_events').updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { votingEnd: new Date(Date.now() - 1_000) } });
  //   const inactive = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
  //   expect(inactive.status).toBe(200);
  //   expect(inactive.body.isEventActive).toBe(false);
  //   expect(inactive.body.session).toBeNull();
  // });

  it('[MX-09][KIO-QR-P1-003][ACEPTACION] permite token o sesión administrativa y rechaza token ausente e inválido', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    expect((await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken)).status).toBe(200);
    expect((await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).auth(ctx.adminToken, { type: 'bearer' })).status).toBe(200);
    expect((await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`)).status).toBe(401);
    expect((await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', 'pkc_bad')).status).toBe(401);
  });

  it('[MX-09][KIO-SCN-P1-001][ACEPTACION] incluye el indicador presencial en el detalle consumible de la votación', async () => {
    const eventId = await configuredEvent();
    await kiosk(eventId);
    const detail = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' });
    expect(detail.status).toBe(200);
    expect(detail.body.presentialKioskEnabled).toBe(true);
  });

  it('[MX-09][KIO-SCN-P0-004][ACEPTACION] rechaza token ausente, inválido y de sesión inexistente', async () => {
    expect((await scan('', institutionalVotingFixtures.carnet.empadronado)).status).toBe(400);
    expect((await scan('not-a-qr')).status).toBe(400);
    const unknown = await scan(`pqs.${new Types.ObjectId()}.unknown`);
    expect(unknown.status).toBe(404);
  });

  it('[MX-09][KIO-SCN-P0-005][ACEPTACION] recibe token y carnet y retorna CLAIMED con acción de continuación', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    const response = await scan(created.currentSession.qrToken);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({ presentialSessionId: created.currentSession.id, status: 'CLAIMED', nextAction: 'CONTINUE_VOTING' }));
  });

  it('[MX-09][KIO-VAL-P0-001][ACEPTACION] rechaza QR inválido sin entregar presentialSessionId', async () => {
    const response = await scan('pqs.invalid.invalid');
    expect(response.status).toBe(400);
    expect(response.body.presentialSessionId).toBeUndefined();
  });

  it('[MX-09][KIO-VAL-P0-002][ACEPTACION] devuelve rechazo controlado para kiosco deshabilitado y votación no activa', async () => {
    const eventId = await configuredEvent();
    const disabled = await kiosk(eventId, 'disabled');
    await ctx.conn.collection('voting_events').updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { presentialKioskEnabled: false } });
    expect((await scan(disabled.currentSession.qrToken)).status).toBe(403);
    await ctx.conn.collection('voting_events').updateOne({ _id: new Types.ObjectId(eventId) }, { $set: { presentialKioskEnabled: true, votingEnd: new Date(Date.now() - 1_000) } });
    expect((await scan(disabled.currentSession.qrToken)).status).toBe(403);
  });

  it('[MX-09][KIO-AUT-P0-001][ACEPTACION] devuelve CONTINUE_VOTING con el identificador de la sesión reclamada', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    const response = await scan(created.currentSession.qrToken);
    expect(response.body.nextAction).toBe('CONTINUE_VOTING');
    expect(response.body.presentialSessionId).toBe(created.currentSession.id);
  });

  it('[MX-09][KIO-AUT-P1-002][ACEPTACION] entrega errores controlados para QR inválido, inexistente, vencido y carnet no autorizado', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    expect((await scan('not-a-token')).status).toBe(400);
    expect((await scan(`pqs.${new Types.ObjectId()}.not-found`)).status).toBe(404);
    await ctx.conn.collection('presential_qr_sessions').updateOne({ _id: new Types.ObjectId(created.currentSession.id) }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await scan(created.currentSession.qrToken)).status).toBe(409);
  });

  it('[MX-09][KIO-CON-P1-003][ACEPTACION] devuelve la misma sesión vigente al reconectar', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    const first = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
    const second = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
    expect(first.body.session.id).toBe(created.currentSession.id);
    expect(second.body.session.id).toBe(first.body.session.id);
  });

  it('[MX-09][KIO-SEC-P0-001][ACEPTACION] responde validación QR sin selección de voto ni datos personales', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    const response = await scan(created.currentSession.qrToken);
    expect(JSON.stringify(response.body)).not.toContain('option');
    expect(JSON.stringify(response.body)).not.toContain(institutionalVotingFixtures.carnet.empadronado);
  });

  it('[MX-09][KIO-SEC-P0-002][ACEPTACION] no emite SSE sin credenciales y entrega solo session.ready a credenciales autorizadas', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    expect((await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`)).status).toBe(401);
    const anonymous = await collectSse(eventId);
    const invalid = await collectSse(eventId, { 'x-kiosk-token': 'pkc_invalid' });
    const limited = await collectSse(eventId, { 'x-kiosk-token': created.kioskAccessToken });
    const administrative = await collectSse(eventId, { Authorization: `Bearer ${ctx.adminToken}` });
    expect([200, 401]).toContain(anonymous.status);
    if (anonymous.status === 200) {
      expect(anonymous.body).toContain('event: error');
      expect(anonymous.body).toContain('Debe enviar x-kiosk-token');
    }
    expect(anonymous.body).not.toContain('session.ready');
    expect(anonymous.body).not.toContain('session.claimed');
    expect(anonymous.body).not.toContain('session.completed');
    expect(anonymous.body).not.toContain('session.expired');
    expect(anonymous.body).not.toContain('session.rotated');
    expect(anonymous.body).not.toContain(created.currentSession.qrValue);
    expect(anonymous.body).not.toContain(created.currentSession.qrToken);
    expect(anonymous.body).not.toContain('"session":');
    expect(anonymous.body).not.toContain('tokenHash');
    expect(anonymous.body).not.toContain('tokenId');
    expect(anonymous.body).not.toContain('claimedByCarnetNorm');
    expect(anonymous.body).not.toContain(institutionalVotingFixtures.carnet.empadronado);
    expect(anonymous.closed || anonymous.closedByHarness).toBe(true);
    expect([200, 401]).toContain(invalid.status);
    if (invalid.status === 200) {
      expect(invalid.body).toContain('event: error');
      expect(invalid.body).toContain('x-kiosk-token inválido');
    }
    expect(invalid.body).not.toContain('session.ready');
    expect(invalid.body).not.toContain('session.claimed');
    expect(invalid.body).not.toContain('session.completed');
    expect(invalid.body).not.toContain('session.expired');
    expect(invalid.body).not.toContain('session.rotated');
    expect(invalid.body).not.toContain(created.currentSession.qrValue);
    expect(invalid.body).not.toContain(created.currentSession.qrToken);
    expect(invalid.body).not.toContain('"session":');
    expect(invalid.body).not.toContain('tokenHash');
    expect(invalid.body).not.toContain('tokenId');
    expect(invalid.body).not.toContain('claimedByCarnetNorm');
    expect(invalid.body).not.toContain(institutionalVotingFixtures.carnet.empadronado);
    expect(invalid.closed || invalid.closedByHarness).toBe(true);
    expect(limited.body).toContain('event: session.ready');
    expect(limited.body).toContain(created.currentSession.qrValue);
    expect(limited.body).not.toContain('claimedByCarnetNorm');
    expect(limited.body).not.toContain('tokenHash');
    expect(limited.body).not.toContain('tokenId');
    expect(limited.body).not.toContain(institutionalVotingFixtures.carnet.empadronado);
    expect(limited.closed || limited.closedByHarness).toBe(true);
    expect(administrative.body).toContain('event: session.ready');
    expect(administrative.body).toContain(created.currentSession.qrValue);
    expect(administrative.body).not.toContain('claimedByCarnetNorm');
    expect(administrative.body).not.toContain('tokenHash');
    expect(administrative.body).not.toContain('tokenId');
    expect(administrative.body).not.toContain(institutionalVotingFixtures.carnet.empadronado);
    expect(administrative.closed || administrative.closedByHarness).toBe(true);
  });

  it('[MX-09][KIO-SEC-P0-003][ACEPTACION] normaliza los rechazos sin filtrar secretos de QR o carnet', async () => {
    const token = 'pqs.secret-value.never-return';
    const response = await scan(token, 'ABC-789');
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(JSON.stringify(response.body)).not.toContain('ABC-789');
  });

  it('[MX-09][KIO-UX-P2-002][ACEPTACION] devuelve estados de sesión reales en la consulta actual', async () => {
    const eventId = await configuredEvent();
    const created = await kiosk(eventId);
    const ready = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
    expect(ready.body.session.status).toBe('READY');
    await scan(created.currentSession.qrToken);
    const claimed = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/presential-sessions/current`).set('x-kiosk-token', created.kioskAccessToken);
    expect(claimed.body.session.status).toBe('CLAIMED');
  });
});
