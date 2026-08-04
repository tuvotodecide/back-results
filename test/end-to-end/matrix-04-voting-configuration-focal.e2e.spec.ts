import request from 'supertest';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  teardownInstitutionalVotingContext,
} from '../utils/institutional-voting.helpers';

jest.setTimeout(240000);

describe('MX-04 Backend Results — E2E focal de configuración', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => { ctx = await bootstrapInstitutionalVotingContext(); });
  afterAll(async () => { await teardownInstitutionalVotingContext(ctx); });

  const eventPayload = (name: string, extra: Record<string, unknown> = {}) => ({
    ...institutionalVotingFixtures.event,
    name,
    votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    votingEnd: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    resultsPublishAt: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString(),
    ...extra,
  });
  async function create(name: string, extra: Record<string, unknown> = {}) {
    const result = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, eventPayload(name, extra));
    expect(result.status).toBe(201);
    return result.body.id as string;
  }
  async function role(eventId: string, name = 'Presidencia') {
    return request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send({ name, maxWinners: 1 });
  }
  async function option(eventId: string, name = 'Lista Azul') {
    return request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send({ name, colors: ['#0057FF', '#FFFFFF'], logoUrl: 'data:image/png;base64,bG9nbw==', candidates: [{ name: 'Ana Pérez', roleName: 'Presidencia', photoUrl: 'data:image/jpeg;base64,cGhvdG8=' }] });
  }

  it('[MX-04][ELE-LST-P0-001][E2E] lista solamente eventos visibles del tenant autorizado en orden descendente', async () => {
    const first = await create(`MX04 listado antiguo ${Date.now()}`);
    const second = await create(`MX04 listado reciente ${Date.now()}`);
    const response = await request(ctx.httpServer).get('/api/v1/voting/events').auth(ctx.tenantAdminToken, { type: 'bearer' }).expect(200);
    const ids = response.body.data.map((item: { id: string }) => item.id);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
  });

  it('[MX-04][ELE-NEW-P0-006][E2E] crea votación DRAFT con tenant, fechas y deadline de publicación', async () => {
    const eventId = await create(`MX04 creación ${Date.now()}`);
    const detail = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    expect(detail.body).toMatchObject({ id: eventId, tenantId: ctx.createdTenantId, state: 'DRAFT', isReferendum: false });
    expect(detail.body.publishDeadline).toEqual(expect.any(String));
  });

  it('[MX-04][ELE-ROL-P0-001][E2E] crea cargo normalizado con maxWinners por defecto', async () => {
    const eventId = await create(`MX04 cargo ${Date.now()}`);
    const created = await role(eventId, ' Presidencia ');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ eventId, name: 'Presidencia', maxWinners: 1 });
  });

  it('[MX-04][ELE-ROL-P1-002][E2E] renombra un cargo y propaga el nombre a candidatos asociados', async () => {
    const eventId = await create(`MX04 renombre ${Date.now()}`);
    const createdRole = await role(eventId);
    const createdOption = await option(eventId);
    expect(createdOption.status).toBe(201);
    const updated = await request(ctx.httpServer).patch(`/api/v1/voting/events/${eventId}/roles/${createdRole.body.id}`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'Presidencia General' });
    expect(updated.status).toBe(200);
    const detail = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    expect(detail.body.options[0].candidates).toEqual(expect.arrayContaining([expect.objectContaining({ roleName: 'Presidencia General' })]));
  });

  it('[MX-04][ELE-ROL-P0-003][E2E] rechaza un cargo duplicado por nombre normalizado', async () => {
    const eventId = await create(`MX04 duplicado ${Date.now()}`);
    expect((await role(eventId, 'Presidencia')).status).toBe(201);
    const duplicate = await role(eventId, ' presidencia ');
    expect(duplicate.status).toBe(409);
  });

  it('[MX-04][ELE-ROL-P0-004][E2E] elimina cargo no usado y rechaza eliminar cargo usado por candidatos', async () => {
    const eventId = await create(`MX04 eliminar cargo ${Date.now()}`);
    const removable = await role(eventId, 'Secretaría');
    const used = await role(eventId, 'Presidencia');
    expect((await option(eventId)).status).toBe(201);
    const removed = await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}/roles/${removable.body.id}`).auth(ctx.adminToken, { type: 'bearer' });
    const blocked = await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}/roles/${used.body.id}`).auth(ctx.adminToken, { type: 'bearer' });
    expect(removed.body).toEqual({ id: removable.body.id, deleted: true });
    expect(blocked.status).toBe(409);
  });

  it('[MX-04][ELE-OPT-P0-001][E2E] crea opción activa con paleta, color principal y logo', async () => {
    const eventId = await create(`MX04 opción ${Date.now()}`);
    expect((await role(eventId)).status).toBe(201);
    const created = await option(eventId);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ eventId, active: true, color: '#0057FF', colors: ['#0057FF', '#FFFFFF'], logoUrl: 'data:image/png;base64,bG9nbw==' });
  });

  it('[MX-04][ELE-OPT-P1-004][E2E] elimina la opción editable y deja de mostrarla en el detalle', async () => {
    const eventId = await create(`MX04 eliminar opción ${Date.now()}`);
    expect((await role(eventId)).status).toBe(201);
    const created = await option(eventId);
    const deleted = await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}/options/${created.body.id}`).auth(ctx.adminToken, { type: 'bearer' });
    const detail = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' });
    expect(deleted.body).toEqual({ id: created.body.id, deleted: true });
    expect(detail.body.options.map((item: { id: string }) => item.id)).not.toContain(created.body.id);
  });

  it('[MX-04][ELE-RDY-P0-002][E2E] conserva el evento normal en DRAFT y expone faltantes antes de la precondición externa simulada', async () => {
    const eventId = await create(`MX04 readiness ${Date.now()}`);
    const readiness = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/review-readiness`).auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    expect(readiness.body).toMatchObject({ id: eventId, state: 'DRAFT', isReady: false });
    expect(readiness.body.pending).toEqual(expect.arrayContaining(['cargos', 'opciones', 'padron']));
  });

  it('[MX-04][ELE-HTTP-P0-001][E2E] rechaza payload inválido sin persistir una votación auxiliar', async () => {
    const before = await request(ctx.httpServer).get('/api/v1/voting/events').auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    const invalid = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, { name: '', objective: 'corta', votingStart: 'invalid' });
    const after = await request(ctx.httpServer).get('/api/v1/voting/events').auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    expect(invalid.status).toBe(400);
    expect(after.body.data).toHaveLength(before.body.data.length);
  });
});
