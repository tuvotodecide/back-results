import request from 'supertest';
import { Types } from 'mongoose';

import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../../utils/institutional-voting.helpers';
import { normalizeCarnet } from '@/modules/institutional-voting/utils/carnet-normalizer';

describe('Institutional voting integration - participation concurrency regression', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createActiveVotingEvent() {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    expect(created.status).toBe(201);
    const eventId = created.body.id as string;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident)
      .expect(201);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue)
      .expect(201);

    const padronUpload = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(padronUpload.status).toBe(201);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' })
      .expect((response) => {
        expect([200, 201]).toContain(response.status);
      });

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);

    const published = await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    expect(published.status).toBe(201);

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60 * 60 * 1000),
          resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      },
    );

    return eventId;
  }

  async function countParticipations(eventId: string, carnet: string) {
    return ctx.conn.collection('participations').countDocuments({
      eventId: new Types.ObjectId(eventId),
      carnetNorm: normalizeCarnet(carnet),
    });
  }

  function unwrapSettledResponses<T>(results: PromiseSettledResult<T>[]) {
    return results.map((result) => {
      expect(result.status).toBe('fulfilled');
      if (result.status === 'rejected') {
        throw result.reason;
      }
      return result.value;
    });
  }

  it('dos solicitudes concurrentes para el mismo evento y carnet dejan una sola participación persistida', async () => {
    const eventId = await createActiveVotingEvent();
    const carnet = institutionalVotingFixtures.carnet.empadronado;

    const beforeCount = await countParticipations(eventId, carnet);
    expect(beforeCount).toBe(0);

    const attempts = await Promise.allSettled([
      request(ctx.httpServer)
        .post(`/api/v1/voting/events/${eventId}/participations`)
        .set('Idempotency-Key', 'concurrent-real-attempt-a')
        .send({ carnet }),
      request(ctx.httpServer)
        .post(`/api/v1/voting/events/${eventId}/participations`)
        .set('Idempotency-Key', 'concurrent-real-attempt-b')
        .send({ carnet }),
    ]);

    const responses = unwrapSettledResponses(attempts);
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);

    expect(statuses).toEqual([201, 409]);
    expect(
      responses.filter((response) => response.body?.participated === true),
    ).toHaveLength(1);

    const afterCount = await countParticipations(eventId, carnet);
    expect(afterCount).toBe(1);
  });

  it('dos solicitudes concurrentes con la misma Idempotency-Key no duplican participación', async () => {
    const eventId = await createActiveVotingEvent();
    const carnet = institutionalVotingFixtures.carnet.empadronado;
    const idempotencyKey = 'concurrent-same-idempotency-key';

    const beforeCount = await countParticipations(eventId, carnet);
    expect(beforeCount).toBe(0);

    const attempts = await Promise.allSettled([
      request(ctx.httpServer)
        .post(`/api/v1/voting/events/${eventId}/participations`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ carnet }),
      request(ctx.httpServer)
        .post(`/api/v1/voting/events/${eventId}/participations`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ carnet }),
    ]);

    const responses = unwrapSettledResponses(attempts);
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    const participationIds = new Set(
      responses.map((response) => response.body?.id).filter(Boolean),
    );

    expect(statuses).toEqual([200, 201]);
    expect(
      responses.every((response) => response.body?.participated === true),
    ).toBe(true);
    expect(participationIds.size).toBe(1);

    const afterCount = await countParticipations(eventId, carnet);
    expect(afterCount).toBe(1);
  });

  it('misma Idempotency-Key con carnet distinto documenta el contrato actual por carnet', async () => {
    const eventId = await createActiveVotingEvent();
    const idempotencyKey = 'same-key-different-carnet';

    const first = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ carnet: 'ABC-789' });
    expect(first.status).toBe(201);

    const second = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ carnet: '123456' });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);

    expect(await countParticipations(eventId, 'ABC-789')).toBe(1);
    expect(await countParticipations(eventId, '123456')).toBe(1);
  });
});
