import request from 'supertest';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../utils/institutional-voting.helpers';

describe('Institutional voting E2E (phase 1 + phase 2 + phase 3)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  it('EVT-001: crear evento debe devolver DRAFT', async () => {
    const res = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('state', 'DRAFT');
    expect(res.body).toHaveProperty('id');
  });

  it('SEC-ADM-001: endpoint admin requiere autenticacion', async () => {
    const unauthorized = await request(ctx.httpServer).post('/api/v1/voting/events').send({
      ...institutionalVotingFixtures.event,
      tenantId: ctx.createdTenantId,
    });

    expect(unauthorized.status).toBe(401);
  });

  it('EVT-002: publicar falla si faltan precondiciones y devuelve pending[]', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        name: institutionalVotingFixtures.event.name,
        objective: institutionalVotingFixtures.event.objective,
      },
    );
    const eventId = created.body.id;

    const publish = await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    expect(publish.status).toBe(400);
    expect(publish.body).toHaveProperty('pending');
    expect(publish.body.pending).toEqual(
      expect.arrayContaining(['cargos', 'opciones', 'padron', 'horarios']),
    );
  });

  it('BLT-001/002: crear cargo y rechazar duplicado', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    const firstRole = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    expect(firstRole.status).toBe(201);

    const duplicate = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    expect(duplicate.status).toBe(409);
  });

  it('OPT-001/002: crear opcion y desactivar', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    const createdOption = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);
    expect(createdOption.status).toBe(201);
    expect(createdOption.body.active).toBe(true);

    const deactivated = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/options/${createdOption.body.id}/deactivate`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);
  });

  it('PAD-001/002/003: importar padron (hash+totals), 1 vigente y normalizacion carnet', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    const importV1 = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(importV1.status).toBe(201);
    expect(importV1.body).toHaveProperty('padronVersionId');
    expect(importV1.body).toHaveProperty('fileDigest');
    expect(importV1.body).toHaveProperty('totals.validCount');
    expect(importV1.body).toHaveProperty('totals.duplicateCount');
    expect(importV1.body).toHaveProperty('totals.invalidCount');

    const importV2 = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(importV2.status).toBe(201);

    const versions = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/versions`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(versions.status).toBe(200);
    const current = versions.body.data.filter((v: any) => v.isCurrent === true);
    expect(current).toHaveLength(1);

    const check = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility`)
      .query({ carnet: institutionalVotingFixtures.carnet.normalizedSource });
    expect(check.status).toBe(200);
    expect(check.body.normalizedCarnet).toBe(institutionalVotingFixtures.carnet.normalizedExpected);
    expect(check.body.status).toBe('HABILITADO');
  });

  it('PAR-STATUS: estado de participacion por carnet (canVote / alreadyVoted)', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 60_000).toISOString(),
        votingEnd: new Date(Date.now() + 3_600_000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 7_200_000).toISOString(),
      },
    );
    const eventId = created.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const statusBefore = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(statusBefore.status).toBe(200);
    expect(statusBefore.body.status).toBe('CAN_VOTE');
    expect(statusBefore.body.canVote).toBe(true);

    const first = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(first.status).toBe(201);
    expect(first.body.participated).toBe(true);

    const statusAfter = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.status).toBe('ALREADY_VOTED');
    expect(statusAfter.body.alreadyVoted).toBe(true);
  });

  it('PAR-001/002/003: no empadronado bloqueado, idempotencia, voto unico', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 60_000).toISOString(),
        votingEnd: new Date(Date.now() + 3_600_000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 7_200_000).toISOString(),
      },
    );
    const eventId = created.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.notEmpadronado });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('NOT_IN_PADRON');

    const body = { carnet: institutionalVotingFixtures.carnet.empadronado };
    const first = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.participated).toBe(true);

    const retry = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.participated).toBe(true);

    const secondVote = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'idem-evt-second-vote')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);
    expect(secondVote.status).toBe(409);
  });

  it('WIN-001: fuera de ventana se bloquea participacion', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 3_600_000).toISOString(),
        votingEnd: new Date(Date.now() + 7_200_000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 10_800_000).toISOString(),
      },
    );
    const eventId = created.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const voteOutOfWindow = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(voteOutOfWindow.status).toBe(403);
    expect(voteOutOfWindow.body.error).toBe('OUTSIDE_VOTING_WINDOW');
  });

  it('PUB-001/PUB-002: consulta publica deshabilitada y habilitada por toggle', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    const beforeToggle = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(beforeToggle.status).toBe(200);
    expect(beforeToggle.body.status).toBe('PUBLIC_CHECK_DISABLED');

    await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/public-eligibility`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled: true });

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const afterToggle = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(afterToggle.status).toBe(200);
    expect(afterToggle.body.status).toBe('HABILITADO');
  });

  it('PUB-003: endpoints publicos de padron y estado no requieren bearer token', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const eligibilityPublic = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(eligibilityPublic.status).toBe(200);
    expect(eligibilityPublic.body.status).toBe('HABILITADO');

    const participationStatusPublic = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(participationStatusPublic.status).toBe(200);
    expect(participationStatusPublic.body).toHaveProperty('canVote');
  });

  it('RES-001/RES-002: resultados bloqueados antes de fecha y disponibles con snapshot', async () => {
    const createdBlocked = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 7_200_000).toISOString(),
        votingEnd: new Date(Date.now() - 3_600_000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    );
    const blockedEventId = createdBlocked.body.id;

    const beforePublishAt = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${blockedEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(beforePublishAt.status).toBe(403);
    expect(beforePublishAt.body.error).toBe('RESULTS_NOT_AVAILABLE');

    const createdAvailable = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() - 7_200_000).toISOString(),
        votingEnd: new Date(Date.now() - 3_600_000).toISOString(),
        resultsPublishAt: new Date(Date.now() - 60_000).toISOString(),
      },
    );
    const availableEventId = createdAvailable.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${availableEventId}/results/snapshot`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.resultsSnapshot);

    const available = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${availableEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(available.status).toBe(200);
    expect(available.body.source).toBe('BLOCKCHAIN');
    expect(Array.isArray(available.body.roles)).toBe(true);
    expect(available.body.roles).toHaveLength(1);
    expect(available.body.txHash).toBe(institutionalVotingFixtures.resultsSnapshot.txHash);
  });

  it('NEWS-001: noticia rica segmentada a empadronados queda en historial', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    const linkedDni = '777001';
    await ctx.conn.collection('users').insertOne({
      dni: linkedDni,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      `carnet\n${linkedDni}\n`,
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const publishNews = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/news`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.news);

    expect(publishNews.status).toBe(201);
    expect(publishNews.body.sent).toBeGreaterThan(0);

    const storedNews = await ctx.conn
      .collection('user_notifications')
      .findOne({ dni: linkedDni, title: institutionalVotingFixtures.news.title });
    expect(storedNews).toBeTruthy();
    expect(storedNews?.data?.type).toBe('INSTITUTIONAL_NEWS');
  });

  it('NEWS-002: news no se envia si comparison report no esta OK', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet\n3\n',
    );

    const publishNews = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/news`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.news);

    expect(publishNews.status).toBe(201);
    expect(publishNews.body.sent).toBe(0);
    expect(publishNews.body.skipped).toBe('comparison_not_ok');
  });

  it('NEWS-003: con comparison OK pero sin usuarios vinculados retorna no_linked_users', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet\n999001\n',
    );

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });

    const publishNews = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/news`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.news);

    expect(publishNews.status).toBe(201);
    expect(publishNews.body.sent).toBe(0);
    expect(publishNews.body.skipped).toBe('no_linked_users');
  });
});
