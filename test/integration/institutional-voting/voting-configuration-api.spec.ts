import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

jest.setTimeout(180000);

describe('MX-04 | Creación y configuración de votaciones | Backend API', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  const futureEventPayload = (name: string) => ({
    ...institutionalVotingFixtures.event,
    name,
    votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    votingEnd: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    resultsPublishAt: new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString(),
  });

  it('ELE-NEW-P0-001 / ELE-NEW-P0-002 / ELE-NEW-P1-007 / ELE-HTTP-P0-001 crea eventos y rechaza payload inválido sin persistirlo', async () => {
    const create = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      futureEventPayload(`MX04 Create ${Date.now()}`),
    );

    expect(create.status).toBe(201);
    expect(create.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        state: 'DRAFT',
        isReferendum: false,
      }),
    );

    const invalid = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        tenantId: ctx.createdTenantId,
        name: '',
        objective: 'corta',
        votingStart: new Date(Date.now() + 60_000).toISOString(),
      });

    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
      }),
    );

    const list = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(list.status).toBe(200);
    expect(list.body.data.map((event: any) => event.name)).not.toContain('');
  });

  it('ELE-LST-P0-001 / ELE-LST-P1-005 lista eventos del tenant sin exponer tenant ajeno al admin institucional', async () => {
    const ownName = `MX04 Own ${Date.now()}`;
    await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      futureEventPayload(ownName),
    );

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `MX04 Other Tenant ${Date.now()}`,
        description: 'Tenant ajeno para listado MX-04',
      });
    expect(otherTenant.status).toBe(201);

    const otherName = `MX04 Other ${Date.now()}`;
    await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      futureEventPayload(otherName),
    );

    const tenantList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.tenantAdminToken, { type: 'bearer' });

    expect(tenantList.status).toBe(200);
    const names = tenantList.body.data.map((event: any) => event.name);
    expect(names).toContain(ownName);
    expect(names).not.toContain(otherName);
  });

  it('ELE-ROL-P0-001 / ELE-ROL-P0-003 / ELE-OPT-P0-001 / ELE-OPT-P0-003 / ELE-CAN-P0-001 / ELE-CAN-P0-002 configura cargos, opciones y candidatos con errores HTTP específicos', async () => {
    await ctx.conn.collection('event_roles').createIndex(
      { eventId: 1, normalizedName: 1 },
      { unique: true, name: 'eventId_1_normalizedName_1' },
    );

    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      futureEventPayload(`MX04 Config ${Date.now()}`),
    );
    expect(created.status).toBe(201);
    const eventId = created.body.id as string;

    const role = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Presidencia', maxWinners: 1 });
    expect(role.status).toBe(201);

    const duplicateRole = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Presidencia', maxWinners: 1 });
    expect(duplicateRole.status).toBe(409);

    const persistedRoles = await ctx.conn
      .collection('event_roles')
      .find({ eventId: new Types.ObjectId(eventId), normalizedName: 'presidencia' })
      .toArray();
    expect(persistedRoles).toHaveLength(1);

    const invalidOption = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Lista inválida', colors: ['azul'] });
    expect(invalidOption.status).toBe(400);

    const option = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: 'Lista Verde',
        colors: ['#2E7D32', '#93C5FD'],
        logoUrl: 'data:image/png;base64,logo-verde',
        candidates: [{ name: 'Ana Rectora', roleName: 'Presidencia' }],
      });
    expect(option.status).toBe(201);
    expect(option.body).toEqual(
      expect.objectContaining({
        name: 'Lista Verde',
        color: '#2E7D32',
        colors: ['#2E7D32', '#93C5FD'],
      }),
    );
    const optionId = option.body.id as string;

    const invalidCandidates = await request(ctx.httpServer)
      .put(`/api/v1/voting/events/${eventId}/options/${optionId}/candidates`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        candidates: [{ name: 'Ana Rectora', roleName: 'Tesoreria' }],
      });
    expect(invalidCandidates.status).toBe(400);

    const candidates = await request(ctx.httpServer)
      .put(`/api/v1/voting/events/${eventId}/options/${optionId}/candidates`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        candidates: [
          {
            name: 'Ana Rectora',
            roleName: 'Presidencia',
            photoUrl: 'data:image/jpeg;base64,ana',
          },
        ],
      });
    expect(candidates.status).toBe(200);
    expect(candidates.body.candidates).toEqual([
      {
        name: 'Ana Rectora',
        roleName: 'Presidencia',
        photoUrl: 'data:image/jpeg;base64,ana',
      },
    ]);
  });
});
