import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import { bootstrapInstitutionalVotingContext, createInstitutionalEvent, teardownInstitutionalVotingContext } from '../utils/institutional-voting.helpers';

jest.setTimeout(240000);

describe('MX-04 Backend Results — integración focal de configuración', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  beforeAll(async () => { ctx = await bootstrapInstitutionalVotingContext(); });
  afterAll(async () => { await teardownInstitutionalVotingContext(ctx); });
  const payload = (name: string) => ({ ...institutionalVotingFixtures.event, name, votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), votingEnd: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(), resultsPublishAt: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString() });
  async function create(name: string) { const result = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, payload(name)); expect(result.status).toBe(201); return result.body.id as string; }

  it('[MX-04][ELE-LST-P1-003][INTEGRACION] devuelve error controlado para un filtro de tenant que el administrador institucional no puede leer', async () => {
    const other = await request(ctx.httpServer).post('/api/v1/institutional-tenants').auth(ctx.adminToken, { type: 'bearer' }).send({ name: `MX04 prohibido ${Date.now()}`, description: 'Tenant ajeno de prueba' }).expect(201);
    await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: other.body.id }).auth(ctx.tenantAdminToken, { type: 'bearer' }).expect(403);
  });
  it('[MX-04][ELE-LST-P1-004][INTEGRACION] devuelve una lista vacía para un tenant permitido sin votaciones visibles', async () => {
    const tenant = await request(ctx.httpServer).post('/api/v1/institutional-tenants').auth(ctx.adminToken, { type: 'bearer' }).send({ name: `MX04 vacío ${Date.now()}`, description: 'Tenant sin eventos' }).expect(201);
    const response = await request(ctx.httpServer).get('/api/v1/voting/events').query({ tenantId: tenant.body.id }).auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    expect(response.body.data).toEqual([]);
  });
  it('[MX-04][ELE-CAN-P0-001][INTEGRACION] reemplaza candidatos con nombre, foto y cargo persistidos', async () => {
    const eventId = await create(`MX04 candidatos ${Date.now()}`);
    const role = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'Presidencia' }).expect(201);
    const option = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'Lista Azul', color: '#0057FF' }).expect(201);
    const replaced = await request(ctx.httpServer).put(`/api/v1/voting/events/${eventId}/options/${option.body.id}/candidates`).auth(ctx.adminToken, { type: 'bearer' }).send({ candidates: [{ name: 'Ana Pérez', roleName: role.body.name, photoUrl: 'data:image/jpeg;base64,cGhvdG8=' }] }).expect(200);
    expect(replaced.body.candidates).toEqual([expect.objectContaining({ name: 'Ana Pérez', roleName: 'Presidencia', photoUrl: 'data:image/jpeg;base64,cGhvdG8=' })]);
  });
  it('[MX-04][ELE-IMG-P1-001][INTEGRACION] conserva logo y foto como datos de configuración sin procesar archivos externos', async () => {
    const eventId = await create(`MX04 imágenes ${Date.now()}`);
    await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/roles`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'Presidencia' }).expect(201);
    const option = await request(ctx.httpServer).post(`/api/v1/voting/events/${eventId}/options`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'Lista Imagen', color: '#0057FF', logoUrl: 'data:image/png;base64,bG9nbw==', candidates: [{ name: 'Ana', roleName: 'Presidencia', photoUrl: 'data:image/jpeg;base64,cGhvdG8=' }] }).expect(201);
    expect(option.body).toMatchObject({ logoUrl: 'data:image/png;base64,bG9nbw==', candidates: [expect.objectContaining({ photoUrl: 'data:image/jpeg;base64,cGhvdG8=' })] });
  });
  it('[MX-04][ELE-EDT-P1-003][INTEGRACION] diferencia identificador mal formado de evento inexistente sin crear recursos', async () => {
    await request(ctx.httpServer).get('/api/v1/voting/events/no-es-object-id').auth(ctx.adminToken, { type: 'bearer' }).expect(400);
    await request(ctx.httpServer).get('/api/v1/voting/events/64f000000000000000000099').auth(ctx.adminToken, { type: 'bearer' }).expect(404);
  });
  it('[MX-04][ELE-CANCL-P1-002][INTEGRACION] rechaza repetir la cancelación y conserva el estado CANCELLED', async () => {
    const eventId = await create(`MX04 cancelar ${Date.now()}`);
    await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' }).expect(200);
    await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}`).auth(ctx.adminToken, { type: 'bearer' }).expect(400);
    const persisted = await ctx.conn.collection('voting_events').findOne({ _id: new Types.ObjectId(eventId) });
    expect(persisted?.state).toBe('CANCELLED');
  });
  it('[MX-04][ELE-PER-P0-001][INTEGRACION] bloquea detalle y mutación de una votación perteneciente a otro tenant', async () => {
    const eventId = await create(`MX04 propio ${Date.now()}`);
    const otherTenant = await request(ctx.httpServer).post('/api/v1/institutional-tenants').auth(ctx.adminToken, { type: 'bearer' }).send({ name: `MX04 otro ${Date.now()}`, description: 'Tenant ajeno' }).expect(201);
    const createdElsewhere = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, otherTenant.body.id, payload(`MX04 ajeno ${Date.now()}`));
    expect(createdElsewhere.status).toBe(201); expect(eventId).toEqual(expect.any(String));
    await request(ctx.httpServer).get(`/api/v1/voting/events/${createdElsewhere.body.id}`).auth(ctx.tenantAdminToken, { type: 'bearer' }).expect(403);
    await request(ctx.httpServer).patch(`/api/v1/voting/events/${createdElsewhere.body.id}`).auth(ctx.tenantAdminToken, { type: 'bearer' }).send({ name: 'No autorizado' }).expect(403);
  });
  it('[MX-04][ELE-PER-P0-002][INTEGRACION] rechaza consulta administrativa sin una sesión válida', async () => {
    await request(ctx.httpServer).get('/api/v1/voting/events').expect(401);
  });
  it('[MX-04][ELE-HTTP-P1-003][INTEGRACION] responde no encontrado para cargo u opción inexistentes sin recursos auxiliares', async () => {
    const eventId = await create(`MX04 inexistente ${Date.now()}`);
    const missing = '64f000000000000000000099';
    await request(ctx.httpServer).patch(`/api/v1/voting/events/${eventId}/options/${missing}`).auth(ctx.adminToken, { type: 'bearer' }).send({ name: 'No existe' }).expect(404);
    await request(ctx.httpServer).delete(`/api/v1/voting/events/${eventId}/roles/${missing}`).auth(ctx.adminToken, { type: 'bearer' }).expect(404);
  });
});
