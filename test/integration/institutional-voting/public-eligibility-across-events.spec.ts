import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../../utils/institutional-voting.helpers';

describe('Institutional voting integration - public eligibility across events', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createTenant(name: string) {
    const res = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name,
        description: `Tenant ${name}`,
      });

    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function createBaseEvent(tenantId: string, name: string) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      tenantId,
      {
        ...institutionalVotingFixtures.event,
        name,
        votingStart: new Date(Date.now() - 60_000).toISOString(),
        votingEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    );

    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  async function addBallotSetup(eventId: string) {
    const role = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    expect(role.status).toBe(201);

    const option = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);
    expect(option.status).toBe(201);
  }

  async function markComparisonOk(eventId: string) {
    const res = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    expect(res.status).toBe(201);
  }

  async function setPublicEligibility(eventId: string, enabled: boolean) {
    const res = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/public-eligibility`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled });

    expect(res.status).toBe(200);
  }

  async function forceVisibleEvent(
    eventId: string,
    patch: Record<string, unknown> = {},
  ) {
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          state: 'PUBLISHED',
          publicEligibilityEnabled: true,
          ...patch,
        },
      },
    );
  }

  it('devuelve vacío cuando no existen eventos visibles aplicables', async () => {
    const empty = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      carnet: 'ABC789',
      events: [],
    });
  });

  it('combina estados públicos reales entre múltiples eventos visibles', async () => {
    const tenantId = await createTenant(`Tenant Public Eligibility ${Date.now()}`);
    const eligibleName = `Alpha Eligible ${Date.now()}`;
    const disabledName = `Beta Disabled ${Date.now()}`;
    const pendingName = `Gamma Pending ${Date.now()}`;
    const noPadronName = `Omega No Padron ${Date.now()}`;
    const privateName = `Sigma Private ${Date.now()}`;

    const eligibleEventId = await createBaseEvent(tenantId, eligibleName);
    await addBallotSetup(eligibleEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eligibleEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await markComparisonOk(eligibleEventId);
    const eligiblePublished = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eligibleEventId,
      institutionalVotingFixtures.nullifiersForPadron,
    );
    expect(eligiblePublished.status).toBe(201);

    const disabledEventId = await createBaseEvent(tenantId, disabledName);
    await addBallotSetup(disabledEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      disabledEventId,
      'carnet,habilitado\nABC-789,no\n',
    );
    await markComparisonOk(disabledEventId);
    const disabledPublished = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      disabledEventId,
      ['nullifier-ABC-789'],
    );
    expect(disabledPublished.status).toBe(201);

    const pendingEventId = await createBaseEvent(tenantId, pendingName);
    await addBallotSetup(pendingEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      pendingEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await setPublicEligibility(pendingEventId, true);
    await forceVisibleEvent(pendingEventId);

    const noPadronEventId = await createBaseEvent(tenantId, noPadronName);
    await setPublicEligibility(noPadronEventId, true);
    await forceVisibleEvent(noPadronEventId);

    const privateEventId = await createBaseEvent(tenantId, privateName);
    await addBallotSetup(privateEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      privateEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await markComparisonOk(privateEventId);
    const privatePublished = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      privateEventId,
      institutionalVotingFixtures.nullifiersForPadron,
    );
    expect(privatePublished.status).toBe(201);
    await setPublicEligibility(privateEventId, false);

    const response = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId,
      });

    expect(response.status).toBe(200);
    expect(response.body.carnet).toBe('ABC789');
    expect(response.body.events).toHaveLength(5);

    const byName = new Map(
      response.body.events.map((event: any) => [event.name, event]),
    );

    const eligibleEvent = byName.get(eligibleName);
    const disabledEvent = byName.get(disabledName);
    const pendingEvent = byName.get(pendingName);
    const noPadronEvent = byName.get(noPadronName);
    const privateEvent = byName.get(privateName);

    expect(eligibleEvent).toEqual(
      expect.objectContaining({
        eventId: eligibleEventId,
        tenantId,
        status: 'ELIGIBLE',
        eligible: true,
      }),
    );
    expect(disabledEvent).toEqual(
      expect.objectContaining({
        eventId: disabledEventId,
        tenantId,
        status: 'DISABLED',
        eligible: false,
      }),
    );
    expect(pendingEvent).toEqual(
      expect.objectContaining({
        eventId: pendingEventId,
        tenantId,
        status: 'ROLL_IN_VALIDATION',
        eligible: false,
      }),
    );
    expect(pendingEvent.referenceVersion).toBeTruthy();
    expect(noPadronEvent).toEqual(
      expect.objectContaining({
        eventId: noPadronEventId,
        tenantId,
        status: 'ROLL_IN_VALIDATION',
        eligible: false,
        referenceVersion: null,
      }),
    );
    expect(privateEvent).toEqual(
      expect.objectContaining({
        eventId: privateEventId,
        tenantId,
        status: 'PUBLIC_CHECK_DISABLED',
        eligible: false,
      }),
    );
  });

  it('filtra por institución válida y rechaza un tenant inválido', async () => {
    const ownTenantId = await createTenant(`Tenant Filter Own ${Date.now()}`);
    const otherTenantId = await createTenant(`Tenant Filter Other ${Date.now()}`);

    const ownEventId = await createBaseEvent(ownTenantId, `Own Visible ${Date.now()}`);
    await addBallotSetup(ownEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      ownEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await markComparisonOk(ownEventId);
    const ownPublished = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ownEventId,
      institutionalVotingFixtures.nullifiersForPadron,
    );
    expect(ownPublished.status).toBe(201);

    const otherEventId = await createBaseEvent(otherTenantId, `Other Visible ${Date.now()}`);
    await addBallotSetup(otherEventId);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      otherEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await markComparisonOk(otherEventId);
    const otherPublished = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherEventId,
      institutionalVotingFixtures.nullifiersForPadron,
    );
    expect(otherPublished.status).toBe(201);

    const filtered = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId: ownTenantId,
      });

    expect(filtered.status).toBe(200);
    expect(filtered.body.events).toHaveLength(1);
    expect(filtered.body.events[0]).toEqual(
      expect.objectContaining({
        eventId: ownEventId,
        tenantId: ownTenantId,
        status: 'ELIGIBLE',
      }),
    );

    const invalidTenant = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId: 'tenant-invalido',
      });

    expect(invalidTenant.status).toBe(400);
    expect(invalidTenant.body.message).toBe('tenantId invalido');
  });
});
