import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../utils/institutional-voting.helpers';

describe('Institutional participation HTTP contract', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let eventId: string;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    eventId = await createActivePublishedEvent();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createActivePublishedEvent() {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Contrato Participacion ${Date.now()}`,
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
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(id) },
      {
        $set: {
          state: 'OFFICIALLY_PUBLISHED',
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 3_600_000),
          resultsPublishAt: new Date(Date.now() + 7_200_000),
        },
      },
    );

    return id as string;
  }

  it('PAR-REG-P0-003 GET /api/v1/voting/events/:eventId/participations/status antes de votar retorna CAN_VOTE', async () => {
    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'CAN_VOTE',
        canVote: true,
        alreadyVoted: false,
      }),
    );
  });

  it('PAR-REG-P0-003 GET /api/v1/voting/events/:eventId/participations/status rechaza carnet inválido', async () => {
    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: '###' })
      .expect(400);

    expect(String(response.body.message)).toContain('carnet inválido');
  });

  it('PAR-REG-P0-001 / PAR-REG-P0-004 POST /api/v1/voting/events/:eventId/participations registra participación con shape estable y segura', async () => {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'contract-participation-key')
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        participated: true,
        participatedAt: expect.any(String),
      }),
    );
    expect(response.body).not.toHaveProperty('carnet');
    expect(response.body).not.toHaveProperty('carnetNorm');
    expect(response.body).not.toHaveProperty('option');
    expect(response.body).not.toHaveProperty('candidate');
    expect(response.body).not.toHaveProperty('proof');
    expect(response.body).not.toHaveProperty('nullifier');
    expect(response.body).not.toHaveProperty('credential');
    expect(response.body).not.toHaveProperty('privateKey');
  });

  it('PAR-SYN-P0-001 POST /api/v1/voting/events/:eventId/participations idempotente retorna 200 sin cambiar shape', async () => {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'contract-participation-key')
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        participated: true,
        participatedAt: expect.any(String),
      }),
    );
  });

  it('PAR-YAV-P0-001 GET /api/v1/voting/events/:eventId/participations/status después de votar retorna ALREADY_VOTED', async () => {
    const response = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ALREADY_VOTED',
        canVote: false,
        alreadyVoted: true,
        participatedAt: expect.any(String),
      }),
    );
  });

  it('PAR-REG-P0-003 POST /api/v1/voting/events/:eventId/participations bloquea carnet no habilitado con error controlado', async () => {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.notEmpadronado })
      .expect(403);

    expect(response.body).toEqual({ error: 'NOT_IN_ROLL' });
  });
});
