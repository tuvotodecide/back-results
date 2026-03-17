import request from 'supertest';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

describe('Institutional voting integration - multi tenant access', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function login(email: string) {
    const result = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email,
      password: 'secret123',
    });
    return result.body.accessToken as string;
  }

  it('aísla eventos por tenant entre admin global y tenant admin', async () => {
    const ownEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Own Event ${Date.now()}`,
      },
    );

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Other Tenant ${Date.now()}`,
        description: 'Otro tenant',
      });

    const otherEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: `Other Event ${Date.now()}`,
      },
    );

    const tenantList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.tenantAdminToken, { type: 'bearer' });
    expect(tenantList.status).toBe(200);
    expect(tenantList.body.data.map((item: any) => item.id)).toContain(ownEvent.body.id);
    expect(tenantList.body.data.map((item: any) => item.id)).not.toContain(otherEvent.body.id);

    const adminList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.map((item: any) => item.id)).toContain(ownEvent.body.id);
    expect(adminList.body.data.map((item: any) => item.id)).toContain(otherEvent.body.id);
  });

  it('bloquea detalle y mutación de evento ajeno para tenant admin', async () => {
    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Forbidden Tenant ${Date.now()}`,
        description: 'Tenant ajeno',
      });

    const otherEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      institutionalVotingFixtures.event,
    );

    const detailForbidden = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${otherEvent.body.id}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' });
    expect(detailForbidden.status).toBe(403);

    const patchForbidden = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${otherEvent.body.id}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send({ name: 'Intento no autorizado' });
    expect(patchForbidden.status).toBe(403);
  });

  it('bloquea endpoints administrativos sin autenticación y con usuario sin asignación activa', async () => {
    const unauthorized = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .send({
        ...institutionalVotingFixtures.event,
        tenantId: ctx.createdTenantId,
      });
    expect(unauthorized.status).toBe(401);

    const mayorToken = await login('mcbba@example.com');
    const noAssignment = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(mayorToken, { type: 'bearer' });
    expect(noAssignment.status).toBe(200);
    expect(noAssignment.body.data).toEqual([]);

    const forbiddenCreate = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .auth(mayorToken, { type: 'bearer' })
      .send({
        ...institutionalVotingFixtures.event,
        tenantId: ctx.createdTenantId,
      });
    expect(forbiddenCreate.status).toBe(403);
  });

  it('mantiene públicos los endpoints públicos sin bearer token', async () => {
    const event = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );

    const landing = await request(ctx.httpServer).get('/api/v1/voting/events/public/landing');
    expect(landing.status).toBe(200);

    const status = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${event.body.id}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(status.status).toBe(200);
  });
});
