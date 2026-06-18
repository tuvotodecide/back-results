import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../utils/institutional-voting.helpers';

describe('Institutional public HTTP contract', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let eventId: string;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    eventId = await createPublishedEvent();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createPublishedEvent() {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Contrato Publico ${Date.now()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    const id = created.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${id}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident)
      .expect(201);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${id}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue)
      .expect(201);

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      id,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${id}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' })
      .expect((response) => {
        expect([200, 201]).toContain(response.status);
      });

    const ready = await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, id);
    expect([200, 201]).toContain(ready.status);
    const published = await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, id);
    expect([200, 201]).toContain(published.status);
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 3_600_000),
          resultsPublishAt: new Date(Date.now() + 7_200_000),
          publicEligibilityEnabled: true,
        },
      },
    );

    return id as string;
  }

  it('GET /api/v1/voting/events/public/landing retorna agrupación pública estable', async () => {
    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/landing')
      .query({ tenantId: ctx.createdTenantId })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        upcoming: expect.any(Array),
        active: expect.any(Array),
        results: expect.any(Array),
      }),
    );

    const event = response.body.active.find((item: any) => item.id === eventId);
    expect(event).toEqual(
      expect.objectContaining({
        id: eventId,
        tenantId: ctx.createdTenantId,
        name: expect.any(String),
        state: expect.any(String),
        votingStart: expect.any(String),
        votingEnd: expect.any(String),
        resultsPublishAt: expect.any(String),
      }),
    );
  });

  it('GET /api/v1/voting/events/public/detail/:eventId retorna detalle público mínimo', async () => {
    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/public/detail/${eventId}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: eventId,
        tenantId: ctx.createdTenantId,
        name: expect.any(String),
        state: expect.any(String),
        phase: expect.any(String),
        votingStart: expect.any(String),
        votingEnd: expect.any(String),
        resultsPublishAt: expect.any(String),
        roles: expect.any(Array),
        options: expect.any(Array),
      }),
    );
    expect(response.body.options[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
      }),
    );
  });

  it('GET /api/v1/voting/events/public/eligibility-by-carnet retorna elegibilidad pública estable', async () => {
    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId: ctx.createdTenantId,
      })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        carnet: expect.any(String),
        events: expect.any(Array),
      }),
    );

    const event = response.body.events.find((item: any) => item.eventId === eventId);
    expect(event).toEqual(
      expect.objectContaining({
        eventId,
        tenantId: ctx.createdTenantId,
        name: expect.any(String),
        state: expect.any(String),
        phase: expect.any(String),
        status: 'ELIGIBLE',
        eligible: true,
        referenceVersion: expect.any(String),
      }),
    );
  });

  it('GET /api/v1/voting/events/public/eligibility-by-carnet retorna no elegible con shape estable', async () => {
    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.notEmpadronado,
        tenantId: ctx.createdTenantId,
      })
      .expect(200);

    const event = response.body.events.find((item: any) => item.eventId === eventId);
    expect(event).toEqual(
      expect.objectContaining({
        eventId,
        status: 'NOT_ELIGIBLE',
        eligible: false,
      }),
    );
  });

  it('GET /api/v1/voting/events/public/detail/:eventId inválido retorna error controlado', async () => {
    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/detail/not-a-valid-id')
      .expect(400);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 400,
        message: expect.any(String),
      }),
    );
  });
});
