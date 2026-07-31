import request from 'supertest';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../../utils/institutional-voting.helpers';
import { Types } from 'mongoose';

describe('Institutional voting integration - participation flow', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createPublishableEvent(overrides: Record<string, unknown> = {}) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
    );

    const eventId = created.body.id as string;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    return eventId;
  }

  async function updateEventDatesInDb(
    eventId: string,
    payload: {
      votingStart?: Date;
      votingEnd?: Date;
      resultsPublishAt?: Date;
      publishDeadline?: Date;
      state?: string;
    },
  ) {
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: payload },
    );
  }

  it('PAR-REG-P0-001 / PAR-SYN-P0-001 / PAR-YAV-P0-001 integra elegibilidad, aprobación de padrón, publicación y participación idempotente', async () => {
    const eventId = await createPublishableEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    const beforeApproval = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(beforeApproval.status).toBe(200);
    expect(beforeApproval.body.status).toBe('PUBLIC_CHECK_DISABLED');

    await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/public-eligibility`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled: true });

    const stillPending = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(stillPending.status).toBe(200);
    expect(stillPending.body.status).toBe('PUBLIC_CHECK_DISABLED');

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);

    const eligible = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(eligible.status).toBe(200);
    expect(eligible.body.status).toBe('ELIGIBLE');

    await updateEventDatesInDb(eventId, {
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const canVote = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(canVote.status).toBe(200);
    expect(canVote.body.status).toBe('CAN_VOTE');

    const firstParticipation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(firstParticipation.status).toBe(201);
    expect(firstParticipation.body.participated).toBe(true);
    expect(firstParticipation.body).not.toHaveProperty('option');
    expect(firstParticipation.body).not.toHaveProperty('candidate');
    expect(firstParticipation.body).not.toHaveProperty('proof');
    expect(firstParticipation.body).not.toHaveProperty('nullifier');

    const retryParticipation = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(retryParticipation.status).toBe(200);
    expect(retryParticipation.body.id).toBe(firstParticipation.body.id);

    const secondRealAttempt = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'idem-real-second-attempt')
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(secondRealAttempt.status).toBe(409);

    const alreadyVoted = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(alreadyVoted.status).toBe(200);
    expect(alreadyVoted.body.status).toBe('ALREADY_VOTED');
  });

  it('PAR-REG-P0-003 bloquea la participación cuando el padrón aún no fue aprobado operativamente', async () => {
    const eventId = await createPublishableEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    const published = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect(published.status).toBe(400);
    expect(published.body.message).toBe(
      'Solo se puede confirmar la publicación oficial desde READY_FOR_REVIEW',
    );

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('EVENT_NOT_PUBLISHED');
  });

  it('PAR-REG-P0-003 bloquea la participación publicada cuando no existe padrón vigente', async () => {
    const eventId = await createPublishableEvent();

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          state: 'OFFICIALLY_PUBLISHED',
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60 * 60 * 1000),
          resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      },
    );

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('PADRON_NOT_AVAILABLE');
  });

  it('PAR-REG-P0-003 bloquea la participación para no empadronado e inhabilitado', async () => {
    const eventId = await createPublishableEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-789,no\n123456,si\n',
    );

    await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/public-eligibility`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled: true });

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);

    await updateEventDatesInDb(eventId, {
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const disabled = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(disabled.status).toBe(403);
    expect(disabled.body.error).toBe('VOTER_DISABLED');

    const notInRoll = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.notEmpadronado });
    expect(notInRoll.status).toBe(403);
    expect(notInRoll.body.error).toBe('NOT_IN_ROLL');
  });

  it('PAR-REG-P0-003 bloquea la participación cuando el evento no está publicado o está fuera de ventana', async () => {
    const draftEventId = await createPublishableEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      draftEventId,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${draftEventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const draftDenied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${draftEventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(draftDenied.status).toBe(403);
    expect(draftDenied.body.error).toBe('EVENT_NOT_PUBLISHED');

    const futureEventId = await createPublishableEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      futureEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${futureEventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });
    const futureReady = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      futureEventId,
    );
    expect([200, 201]).toContain(futureReady.status);
    await updateEventDatesInDb(futureEventId, {
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date(Date.now() + 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 2 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });

    const outOfWindow = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${futureEventId}/participations`)
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(outOfWindow.status).toBe(403);
    expect(outOfWindow.body.error).toBe('OUTSIDE_VOTING_WINDOW');
  });
});
