import request from 'supertest';
import { Types } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

const SENSITIVE_FIELDS = [
  'candidateId',
  'selectedCandidateId',
  'candidateSelected',
  'optionId',
  'nullifier',
  'proof',
  'vote',
  'votes',
  'ranking',
  'winners',
  'txHash',
  'sessionToken',
  'receipt',
];

describe('Institutional voting integration - participation analytics', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createEvent(overrides: Record<string, unknown> = {}) {
    const response = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Analytics ${Date.now()} ${Math.random()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
    );
    expect(response.status).toBe(201);
    return response.body;
  }

  async function seedCurrentPadron(
    eventId: string,
    tenantId: string,
    entries: Array<{ carnetNorm: string; enabled?: boolean }>,
  ) {
    const versionId = new Types.ObjectId();
    await ctx.conn.collection('padron_versions').insertOne({
      _id: versionId,
      eventId: new Types.ObjectId(eventId),
      tenantId: new Types.ObjectId(tenantId),
      createdBy: new Types.ObjectId(),
      fileDigest: `digest-${versionId.toString()}`,
      sourceType: 'CSV_LEGACY',
      totals: {
        validCount: entries.length,
        duplicateCount: 0,
        invalidCount: 0,
      },
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (entries.length) {
      await ctx.conn.collection('padron_entries').insertMany(
        entries.map((entry) => ({
          _id: new Types.ObjectId(),
          padronVersionId: versionId,
          eventId: new Types.ObjectId(eventId),
          carnetNorm: entry.carnetNorm,
          enabled: entry.enabled !== false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }

    return versionId;
  }

  async function insertParticipations(eventId: string, carnets: string[]) {
    if (!carnets.length) return;
    await ctx.conn.collection('participations').insertMany(
      carnets.map((carnetNorm, index) => ({
        _id: new Types.ObjectId(),
        eventId: new Types.ObjectId(eventId),
        carnetNorm,
        idempotencyKey: `analytics-${eventId}-${index}-${carnetNorm}`,
        participatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      { ordered: false },
    );
  }

  function analyticsRequest(eventId: string, token?: string) {
    const req = request(ctx.httpServer).get(
      `/api/v1/voting/events/${eventId}/participation-analytics`,
    );
    return token ? req.auth(token, { type: 'bearer' }) : req;
  }

  function expectNoSensitiveFields(payload: unknown) {
    const serialized = JSON.stringify(payload);
    SENSITIVE_FIELDS.forEach((field) => {
      expect(serialized).not.toContain(field);
    });
  }

  it('usuario autorizado recibe 200 con conteos actuales y sin listas ni campos sensibles', async () => {
    const event = await createEvent();
    await seedCurrentPadron(event.id, event.tenantId, [
      { carnetNorm: 'A1' },
      { carnetNorm: 'A2' },
      { carnetNorm: 'A3' },
      { carnetNorm: 'A4', enabled: false },
    ]);
    await insertParticipations(event.id, ['A1', 'A2', 'A4', 'NO_ROLL']);

    const response = await analyticsRequest(event.id, ctx.tenantAdminToken);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        votingId: event.id,
        votingName: event.name,
        institutionName: expect.any(String),
        status: expect.any(String),
        publishedAt: null,
        totalEnabled: 3,
        totalParticipated: 2,
        totalPending: 1,
        participationPercentage: 66.7,
      }),
    );
    expect(response.body).not.toHaveProperty('participants');
    expect(response.body).not.toHaveProperty('pending');
    expectNoSensitiveFields(response.body);
  });

  it('sin token recibe 401 y usuario sin permiso recibe 403', async () => {
    const event = await createEvent();

    const noToken = await analyticsRequest(event.id);
    expect(noToken.status).toBe(401);

    const insertedUser = await ctx.conn.collection('roled_users').insertOne({
      dni: `user-${Date.now()}`,
      active: true,
      email: `plain-user-${Date.now()}@example.com`,
      name: 'Plain User',
      password: '$2b$10$YR43oUJ.897w6HOUH4nMkeJkWfg0FHxthUT.oygCzejA4BTTJZdlu',
      role: 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const jwtService = ctx.moduleRef.get(JwtService);
    const userToken = jwtService.sign({
      sub: insertedUser.insertedId.toString(),
      role: 'USER',
      active: true,
    });

    const forbidden = await analyticsRequest(event.id, userToken);
    expect(forbidden.status).toBe(403);
  });

  it('admin tenant propio recibe 200, admin tenant ajeno recibe 403 y ADMIN global recibe 200', async () => {
    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Tenant analytics ajeno ${Date.now()}`,
        description: 'Tenant ajeno',
      });
    expect(otherTenant.status).toBe(201);

    const ownEvent = await createEvent();
    const otherEventResponse = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: `Analytics ajeno ${Date.now()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    expect(otherEventResponse.status).toBe(201);

    expect((await analyticsRequest(ownEvent.id, ctx.tenantAdminToken)).status).toBe(200);
    expect((await analyticsRequest(otherEventResponse.body.id, ctx.tenantAdminToken)).status).toBe(403);
    expect((await analyticsRequest(otherEventResponse.body.id, ctx.adminToken)).status).toBe(200);
  });

  it('votación inexistente devuelve 404', async () => {
    const response = await analyticsRequest(new Types.ObjectId().toString(), ctx.adminToken);

    expect(response.status).toBe(404);
  });

  it('votación en proceso, finalizada y con resultados publicados devuelven estado y publishedAt correctos', async () => {
    const active = await createEvent();
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(active.id) },
      {
        $set: {
          state: 'PUBLISHED',
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
      },
    );
    expect((await analyticsRequest(active.id, ctx.adminToken)).body.status).toBe('IN_PROGRESS');

    const finished = await createEvent();
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(finished.id) },
      {
        $set: {
          state: 'CLOSED',
          votingStart: new Date(Date.now() - 180_000),
          votingEnd: new Date(Date.now() - 120_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
      },
    );
    const finishedResponse = await analyticsRequest(finished.id, ctx.adminToken);
    expect(finishedResponse.body.status).toBe('FINISHED');
    expect(finishedResponse.body.publishedAt).toBeNull();

    const publishedAt = new Date(Date.now() - 60_000);
    const published = await createEvent();
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(published.id) },
      {
        $set: {
          state: 'RESULTS_PUBLISHED',
          votingStart: new Date(Date.now() - 180_000),
          votingEnd: new Date(Date.now() - 120_000),
          resultsPublishAt: publishedAt,
        },
      },
    );
    const publishedResponse = await analyticsRequest(published.id, ctx.adminToken);
    expect(publishedResponse.body.status).toBe('RESULTS_PUBLISHED');
    expect(publishedResponse.body.publishedAt).toBe(publishedAt.toISOString());
  });

  it('padrón vacío o inexistente responde sin 500', async () => {
    const noPadron = await createEvent();
    const noPadronResponse = await analyticsRequest(noPadron.id, ctx.adminToken);

    expect(noPadronResponse.status).toBe(200);
    expect(noPadronResponse.body.totalEnabled).toBe(0);
    expect(noPadronResponse.body.participationPercentage).toBe(0);

    const emptyPadron = await createEvent();
    await seedCurrentPadron(emptyPadron.id, emptyPadron.tenantId, []);
    const emptyResponse = await analyticsRequest(emptyPadron.id, ctx.adminToken);

    expect(emptyResponse.status).toBe(200);
    expect(emptyResponse.body.totalEnabled).toBe(0);
    expect(emptyResponse.body.totalParticipated).toBe(0);
  });
});
