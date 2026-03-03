import request from 'supertest';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
} from '../utils/institutional-voting.helpers';

describe('Institutional voting E2E (contract-first, red suite)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  it('EVT-001: crear evento debe devolver BORRADOR', async () => {
    const res = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('state', 'BORRADOR');
    expect(res.body).toHaveProperty('id');
  });

  it('EVT-002: publicar debe fallar si faltan cargos/opciones/padron/horarios y devolver pendientes', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );

    const eventId = created.body?.id || 'missing-event-id';
    const publish = await publishInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );

    expect(publish.status).toBe(400);
    expect(publish.body).toHaveProperty('pending');
    expect(Array.isArray(publish.body.pending)).toBe(true);
    expect(publish.body.pending).toEqual(
      expect.arrayContaining(['cargos', 'opciones', 'padron', 'horarios']),
    );
  });

  it('BLT-001: cargos debe permitir crear y BLT-002 rechazar duplicados', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );

    const eventId = created.body?.id || 'missing-event-id';

    const firstRole = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    expect(firstRole.status).toBe(201);

    const duplicatedRole = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);

    expect(duplicatedRole.status).toBe(409);
  });

  it('OPT-001: opciones/listas debe permitir crear y OPT-002 desactivar', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );

    const eventId = created.body?.id || 'missing-event-id';

    const createdOption = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);

    expect(createdOption.status).toBe(201);
    expect(createdOption.body).toHaveProperty('active', true);

    const optionId = createdOption.body?.id || 'missing-option-id';
    const deactivated = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/options/${optionId}/deactivate`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});

    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toHaveProperty('active', false);
  });

  it('PAD-001: importar padron debe devolver version + conteos + hash y PAD-002 solo 1 vigente', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );

    const eventId = created.body?.id || 'missing-event-id';

    const importV1 = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    expect(importV1.status).toBe(201);
    expect(importV1.body).toHaveProperty('padronVersionId');
    expect(importV1.body).toHaveProperty('fileDigest');
    expect(importV1.body).toHaveProperty('totals.validos');
    expect(importV1.body).toHaveProperty('totals.duplicados');
    expect(importV1.body).toHaveProperty('totals.invalidos');

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
    expect(Array.isArray(versions.body?.data)).toBe(true);

    const current = versions.body.data.filter((v: any) => v.isCurrent === true);
    expect(current).toHaveLength(1);
  });

  it('PAD-003: normalizacion carnet (puntos/guiones/espacios)', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdContractId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body?.id || 'missing-event-id';

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );

    const check = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility`)
      .query({ carnet: institutionalVotingFixtures.carnet.normalizedSource });

    expect(check.status).toBe(200);
    expect(check.body).toHaveProperty('normalizedCarnet', institutionalVotingFixtures.carnet.normalizedExpected);
    expect(check.body).toHaveProperty('status', 'HABILITADO');
  });

  it('HAB-001/HAB-002: no empadronado no participa y empadronado si participa', async () => {
    const eventId = 'evt-eligibility-01';

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        carnet: institutionalVotingFixtures.carnet.notEmpadronado,
        selections: institutionalVotingFixtures.participation.selections,
      });

    expect(denied.status).toBe(403);

    const allowed = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        selections: institutionalVotingFixtures.participation.selections,
      });

    expect(allowed.status).toBe(201);
  });

  it('WIN-001/WIN-002: bloquear voto fuera de horario y resultados antes de resultsPublishAt', async () => {
    const eventId = 'evt-window-01';

    const voteOutOfWindow = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        selections: institutionalVotingFixtures.participation.selections,
      });

    expect(voteOutOfWindow.status).toBe(403);
    expect(voteOutOfWindow.body).toHaveProperty('error', 'OUTSIDE_VOTING_WINDOW');

    const resultsBeforePublish = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(resultsBeforePublish.status).toBe(403);
    expect(resultsBeforePublish.body).toHaveProperty('error', 'RESULTS_NOT_AVAILABLE');
  });

  it('PAR-001/PAR-002: participacion unica + idempotencia + comprobante', async () => {
    const eventId = 'evt-participation-01';
    const body = {
      carnet: institutionalVotingFixtures.carnet.empadronado,
      selections: institutionalVotingFixtures.participation.selections,
    };

    const first = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body).toHaveProperty('receipt');

    const retry = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', institutionalVotingFixtures.participation.idempotencyKey)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);

    expect(retry.status).toBe(200);
    expect(retry.body).toHaveProperty('receipt');

    const secondVote = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .set('Idempotency-Key', 'idem-evt-01-user-01-second-vote')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(body);

    expect(secondVote.status).toBe(409);
  });

  it('ZK-001: cualquier no-GET del dominio sin x-api-key ZK debe bloquearse', async () => {
    const res = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ ...institutionalVotingFixtures.event, contractId: ctx.createdContractId });

    expect(res.status).toBe(403);
  });

  it('ZK-002: cualquier no-GET con x-api-key ZK debe permitirse (cuando exista implementacion)', async () => {
    const res = await request(ctx.httpServer)
      .post('/api/v1/voting/events')
      .set('x-api-key', 'zk-api-key-from-zk-auth-request')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ ...institutionalVotingFixtures.event, contractId: ctx.createdContractId });

    expect(res.status).toBe(201);
  });

  it.todo('PUB-001: consulta publica de habilitacion debe responder PADRON_EN_VALIDACION sin ComparisonReport OK');
  it.todo('PUB-002: consulta publica no debe exponer datos personales (solo estado y referenciaVersion)');
});
