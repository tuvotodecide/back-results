import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

const FORBIDDEN_PUBLIC_FIELDS = [
  'carnet',
  'normalizedCarnet',
  'eligible',
  'status',
  'name',
  'user',
  'dni',
  'did',
  'tenant',
  'participatedAt',
  'vote',
  'option',
  'candidate',
  'plancha',
  'ballot',
  'proof',
  'hash',
  'receipt',
  'selectedOption',
  'credential',
  'privateKey',
  'seed',
  'authToken',
  'deviceToken',
];

describe('Institutional voting integration - public participation check', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createEvent(overrides: Record<string, unknown> = {}) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Participacion Publica ${Date.now()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
    );

    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  async function insertParticipation(eventId: string, carnetNorm: string) {
    await ctx.conn.collection('participations').insertOne({
      eventId: new Types.ObjectId(eventId),
      carnetNorm,
      participatedAt: new Date('2026-01-01T12:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  function expectMinimalPublicResponse(body: Record<string, unknown>) {
    expect(Object.keys(body).sort()).toEqual(['eventId', 'participated']);
    FORBIDDEN_PUBLIC_FIELDS.forEach((field) => {
      expect(body).not.toHaveProperty(field);
    });
  }

  it('PAR-YAV-P1-003 / PAR-SEC-P0-001 responde true para un CI con participación registrada y solo expone campos mínimos', async () => {
    const eventId = await createEvent();
    await insertParticipation(eventId, '123456');

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participation/check-public`)
      .query({ carnet: '123456' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eventId,
      participated: true,
    });
    expectMinimalPublicResponse(response.body);
  });

  it('PAR-REG-P0-003 normaliza el carnet y encuentra participación con espacios y guiones', async () => {
    const eventId = await createEvent();
    await insertParticipation(eventId, 'ABC789');

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participation/check-public`)
      .query({ carnet: ' abc-789 ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eventId,
      participated: true,
    });
    expectMinimalPublicResponse(response.body);
  });

  it('PAR-YAV-P1-003 responde false para un CI sin participación sin revelar padrón ni habilitación', async () => {
    const eventId = await createEvent();

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participation/check-public`)
      .query({ carnet: 'NO-999' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eventId,
      participated: false,
    });
    expectMinimalPublicResponse(response.body);
  });

  it('PAR-YAV-P1-003 funciona con evento cerrado o en resultados sin depender de ventana de votación', async () => {
    const eventId = await createEvent({
      name: `Resultados Publicos ${Date.now()}`,
    });

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          state: 'RESULTS_PUBLISHED',
          votingStart: new Date(Date.now() - 4 * 60 * 60 * 1000),
          votingEnd: new Date(Date.now() - 3 * 60 * 60 * 1000),
          resultsPublishAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      },
    );
    await insertParticipation(eventId, '123456');

    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participation/check-public`)
      .query({ carnet: '123456' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eventId,
      participated: true,
    });
    expectMinimalPublicResponse(response.body);
  });

  it('devuelve 404 para evento inexistente y 400 para carnet vacío', async () => {
    const missingEventId = new Types.ObjectId().toString();

    const missing = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${missingEventId}/participation/check-public`)
      .query({ carnet: '123456' });

    expect(missing.status).toBe(404);

    const eventId = await createEvent();
    const invalid = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participation/check-public`)
      .query({ carnet: '' });

    expect(invalid.status).toBe(400);
  });
});
