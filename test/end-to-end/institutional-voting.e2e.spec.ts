import request from 'supertest';
import { Types } from 'mongoose';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  confirmInstitutionalOfficialPublication,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  publishInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
  validateInstitutionalEventReadiness,
} from '../utils/institutional-voting.helpers';

describe('Institutional voting E2E (phase 1 + phase 2 + phase 3)', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createConfiguredEvent(
    payload: Record<string, unknown> = institutionalVotingFixtures.event,
    optionPayload: Record<string, unknown> = institutionalVotingFixtures.optionBlue,
  ) {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      payload,
    );
    const eventId = created.body.id;

    const role = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    expect(role.status).toBe(201);

    const option = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(optionPayload);
    expect(option.status).toBe(201);

    return eventId as string;
  }

  async function createPublishReadyEvent(
    csvContent = institutionalVotingFixtures.padronCsv,
    payloadOverrides: Record<string, unknown> = {},
  ) {
    const eventId = await createConfiguredEvent({
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      ...payloadOverrides,
    });

    const upload = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      csvContent,
    );
    expect(upload.status).toBe(201);

    const comparison = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });
    expect([200, 201]).toContain(comparison.status);

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    return eventId;
  }

  async function approveComparisonReport(
    eventId: string,
    token: string,
    status: 'PENDING' | 'OK' | 'FAILED' = 'OK',
  ) {
    return request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(token, { type: 'bearer' })
      .send({ status });
  }

  async function seedLinkedUsers(dnis: string[]) {
    for (const dni of dnis) {
      await ctx.conn.collection('users').updateOne(
        { dni },
        {
          $set: {
            dni,
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
    }
  }

  async function updateEventDatesInDb(
    eventId: string,
    payload: {
      votingStart?: Date;
      votingEnd?: Date;
      resultsPublishAt?: Date;
      publishDeadline?: Date;
    },
  ) {
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      { $set: payload },
    );
  }

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

  it('EVT-LIST-001: lista eventos segun sesion (tenant admin solo sus tenants)', async () => {
    const ownEventName = `Tenant Event ${Date.now()}`;
    await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: ownEventName,
      },
    );

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Tenant Other ${Date.now()}`,
        description: 'Otro tenant',
      });

    const otherEventName = `Other Event ${Date.now()}`;
    await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: otherEventName,
      },
    );

    const tenantAdminList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.tenantAdminToken, { type: 'bearer' });

    expect(tenantAdminList.status).toBe(200);
    const tenantAdminNames = tenantAdminList.body.data.map((e: any) => e.name);
    expect(tenantAdminNames).toContain(ownEventName);
    expect(tenantAdminNames).not.toContain(otherEventName);

    const superAdminList = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(superAdminList.status).toBe(200);
    const superAdminNames = superAdminList.body.data.map((e: any) => e.name);
    expect(superAdminNames).toContain(ownEventName);
    expect(superAdminNames).toContain(otherEventName);
  });

  it('EVT-LIST-002: tenant admin no puede listar tenant ajeno por tenantId', async () => {
    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Tenant Forbidden ${Date.now()}`,
        description: 'Tenant sin asignacion',
      });

    const forbidden = await request(ctx.httpServer)
      .get('/api/v1/voting/events')
      .query({ tenantId: otherTenant.body.id })
      .auth(ctx.tenantAdminToken, { type: 'bearer' });

    expect(forbidden.status).toBe(403);
  });

  it('EVT-CRUD-001: detalle de evento + CRUD roles/opciones/evento', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      institutionalVotingFixtures.event,
    );
    const eventId = created.body.id;

    const roleRes = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Secretario', maxWinners: 1 });
    expect(roleRes.status).toBe(201);
    const roleId = roleRes.body.id;

    const optionRes = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: 'Lista Naranja',
        colors: ['#F97316', '#FED7AA'],
        candidates: [{ name: 'Maria Nina', roleName: 'Secretario' }],
      });
    expect(optionRes.status).toBe(201);
    expect(optionRes.body.color).toBe('#F97316');
    expect(optionRes.body.colors).toEqual(['#F97316', '#FED7AA']);
    const optionId = optionRes.body.id;

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(detail.status).toBe(200);
    expect(detail.body.roles.length).toBeGreaterThan(0);
    expect(detail.body.options.length).toBeGreaterThan(0);
    expect(detail.body.options[0].color).toBe('#F97316');
    expect(detail.body.options[0].colors).toEqual(['#F97316', '#FED7AA']);

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Evento Editado', objective: 'Objetivo Editado' });
    expect(patchEvent.status).toBe(200);
    expect(patchEvent.body.name).toBe('Evento Editado');

    const patchRole = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/roles/${roleId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Secretario General', maxWinners: 2 });
    expect(patchRole.status).toBe(200);
    expect(patchRole.body.maxWinners).toBe(2);

    const putCandidates = await request(ctx.httpServer)
      .put(`/api/v1/voting/events/${eventId}/options/${optionId}/candidates`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        candidates: [
          {
            name: 'Maria Nina',
            photoUrl: 'https://cdn.example.com/candidates/maria.png',
            roleName: 'Secretario General',
          },
        ],
      });
    expect(putCandidates.status).toBe(200);

    const patchOption = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/options/${optionId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Lista Naranja 2', color: '#EA580C' });
    expect(patchOption.status).toBe(200);
    expect(patchOption.body.name).toBe('Lista Naranja 2');
    expect(patchOption.body.color).toBe('#EA580C');
    expect(patchOption.body.colors).toEqual(['#EA580C']);

    const listRoles = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(listRoles.status).toBe(200);
    expect(Array.isArray(listRoles.body.data)).toBe(true);

    const listOptions = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(listOptions.status).toBe(200);
    expect(Array.isArray(listOptions.body.data)).toBe(true);
    expect(listOptions.body.data[0].colors).toEqual(['#EA580C']);

    const deleteOption = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}/options/${optionId}`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(deleteOption.status).toBe(200);
    expect(deleteOption.body.deleted).toBe(true);

    const deleteRole = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}/roles/${roleId}`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(deleteRole.status).toBe(200);
    expect(deleteRole.body.deleted).toBe(true);

    const deleteEvent = await request(ctx.httpServer)
      .delete(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(deleteEvent.status).toBe(200);
    expect(deleteEvent.body.deleted).toBe(true);
  });

  it('SEC-ADM-001: endpoint admin requiere autenticacion', async () => {
    const unauthorized = await request(ctx.httpServer).post('/api/v1/voting/events').send({
      ...institutionalVotingFixtures.event,
      tenantId: ctx.createdTenantId,
    });

    expect(unauthorized.status).toBe(401);
  });

  it('PAD-APPROVAL-001: tenant admin configura el evento pero solo admin global aprueba el padrón', async () => {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.tenantAdminToken,
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

    const role = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    expect(role.status).toBe(201);

    const option = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/options`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);
    expect(option.status).toBe(201);

    const upload = await uploadPadronCsv(
      ctx.httpServer,
      ctx.tenantAdminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(upload.status).toBe(201);

    const readyBeforeApproval = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.tenantAdminToken,
      eventId,
    );
    expect(readyBeforeApproval.status).toBe(400);
    expect(readyBeforeApproval.body.pending).toEqual(
      expect.arrayContaining(['padron_validation']),
    );

    const forbiddenApproval = await approveComparisonReport(
      eventId,
      ctx.tenantAdminToken,
      'OK',
    );
    expect(forbiddenApproval.status).toBe(403);

    const approved = await approveComparisonReport(eventId, ctx.adminToken, 'OK');
    expect([200, 201]).toContain(approved.status);

    const readyAfterApproval = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.tenantAdminToken,
      eventId,
    );
    expect(readyAfterApproval.status).toBe(201);
    expect(readyAfterApproval.body.state).toBe('READY_FOR_REVIEW');
  });

  it('EVT-002: pasar a READY_FOR_REVIEW falla si faltan precondiciones y devuelve pending[]', async () => {
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

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect(ready.status).toBe(400);
    expect(ready.body).toHaveProperty('pending');
    expect(ready.body.pending).toEqual(
      expect.arrayContaining(['cargos', 'opciones', 'padron', 'horarios']),
    );
  });

  it('EVT-003: confirmar publicación oficial deja el evento en OFFICIALLY_PUBLISHED y mantiene la revisión ya notificada', async () => {
    await seedLinkedUsers(['123456', 'ABC789']);
    const eventId = await createPublishReadyEvent();

    const publish = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { txHash: '0xabc123', wallet: '0xAdmin', chainId: '1' },
    );
    expect(publish.status).toBe(201);
    expect(publish.body.state).toBe('OFFICIALLY_PUBLISHED');

    const publicEligibility = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(publicEligibility.status).toBe(200);
    expect(publicEligibility.body.status).toBe('ELIGIBLE');

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
        'data.eventId': eventId,
      })
      .toArray();
    expect(notifications).toHaveLength(2);

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('OFFICIALLY_PUBLISHED');
    expect(eventInDb?.convocationNotifiedAt).toBeTruthy();
    expect(eventInDb?.officialPublishedAt).toBeTruthy();
    expect(eventInDb?.publicEligibilityEnabled).toBe(true);
  });

  it('EVT-004: READY_FOR_REVIEW notifica y sigue editable sin volver a DRAFT', async () => {
    await seedLinkedUsers(['123456', 'ABC789']);
    const eventId = await createPublishReadyEvent();

    const notificationsAfterReady = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
        'data.eventId': eventId,
      })
      .toArray();
    expect(notificationsAfterReady).toHaveLength(2);

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ objective: 'Objetivo ajustado en revisión' });
    expect(patchEvent.status).toBe(200);
    expect(patchEvent.body.state).toBe('READY_FOR_REVIEW');

    const detailAfterPatch = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(detailAfterPatch.status).toBe(200);
    expect(detailAfterPatch.body.state).toBe('READY_FOR_REVIEW');

    const publish = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { txHash: '0xpublish2' },
    );
    expect(publish.status).toBe(201);
    expect(publish.body.state).toBe('OFFICIALLY_PUBLISHED');

    const notificationsAfterPublish = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
        'data.eventId': eventId,
      })
      .toArray();
    expect(notificationsAfterPublish).toHaveLength(2);
  });

  it('EVT-005: validar readiness expone faltantes y READY_FOR_REVIEW habilita revisión de padrón', async () => {
    await seedLinkedUsers(['123456', 'ABC789']);
    const eventId = await createConfiguredEvent({
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });

    const readinessBefore = await validateInstitutionalEventReadiness(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect(readinessBefore.status).toBe(200);
    expect(readinessBefore.body.isReady).toBe(false);
    expect(readinessBefore.body.pending).toEqual(
      expect.arrayContaining(['padron']),
    );

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    await approveComparisonReport(eventId, ctx.adminToken, 'OK');

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect(ready.status).toBe(201);
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({ 'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN', 'data.eventId': eventId })
      .toArray();
    expect(notifications).toHaveLength(2);

    const publicEligibility = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(publicEligibility.status).toBe(200);
    expect(publicEligibility.body.status).toBe('ELIGIBLE');
  });

  it('EVT-006: intento de publicación oficial fuera de plazo expira el evento', async () => {
    const eventId = await createPublishReadyEvent();
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() + 23 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 25 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 26 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() - 60_000),
    });

    const publish = await confirmInstitutionalOfficialPublication(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { txHash: '0xlate' },
    );
    expect(publish.status).toBe(400);
    expect(publish.body.message).toContain('venció el plazo');

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('PUBLICATION_EXPIRED');
    expect(eventInDb?.publicationExpiredAt).toBeTruthy();
  });

  it('EVT-007: lifecycle marca PUBLICATION_EXPIRED automáticamente al vencer el deadline', async () => {
    const eventId = await createPublishReadyEvent();
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() + 23 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() - 60_000),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('PUBLICATION_EXPIRED');
  });

  it('EVT-008: bloquea edición estructural en OFFICIALLY_PUBLISHED', async () => {
    const eventId = await createPublishReadyEvent();
    await confirmInstitutionalOfficialPublication(ctx.httpServer, ctx.adminToken, eventId, {
      txHash: '0xblocked',
    });

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'No debe editarse' });
    expect(patchEvent.status).toBe(400);

    const createRole = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Nuevo Cargo' });
    expect(createRole.status).toBe(400);
  });

  it('EVT-009: bloquea edición estructural en PUBLICATION_EXPIRED', async () => {
    const eventId = await createPublishReadyEvent();
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() + 23 * 60 * 60 * 1000),
      votingEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resultsPublishAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
      publishDeadline: new Date(Date.now() - 60_000),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'No debe editarse' });
    expect(patchEvent.status).toBe(400);

    const upload = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(upload.status).toBe(400);
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
    expect(check.body.status).toBe('ELIGIBLE');
  });

  it('PAD-004: listar votantes del padron vigente paginado', async () => {
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

    const voters = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters`)
      .query({ page: 1, limit: 2 })
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(voters.status).toBe(200);
    expect(voters.body).toHaveProperty('padronVersionId');
    expect(Array.isArray(voters.body.data)).toBe(true);
    expect(voters.body.data.length).toBeLessThanOrEqual(2);
    expect(voters.body.total).toBeGreaterThan(0);
  });

  it('PAD-005: elegibilidad privada negativa devuelve NOT_ELIGIBLE y DISABLED', async () => {
    const eventId = await createConfiguredEvent(institutionalVotingFixtures.event);

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-789,no\n',
    );

    const disabled = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(disabled.status).toBe(200);
    expect(disabled.body.status).toBe('DISABLED');

    const notEligible = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility`)
      .query({ carnet: institutionalVotingFixtures.carnet.notEmpadronado });
    expect(notEligible.status).toBe(200);
    expect(notEligible.body.status).toBe('NOT_ELIGIBLE');
  });

  it('PAD-006: elegibilidad pública negativa devuelve NOT_ELIGIBLE y DISABLED', async () => {
    const eventId = await createConfiguredEvent({
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-789,no\n999001,si\n',
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
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    const disabled = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(disabled.status).toBe(200);
    expect(disabled.body.status).toBe('DISABLED');

    const notEligible = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.notEmpadronado });
    expect(notEligible.status).toBe(200);
    expect(notEligible.body.status).toBe('NOT_ELIGIBLE');
  });

  it('PAR-STATUS: estado de participacion por carnet (canVote / alreadyVoted)', async () => {
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

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 3_600_000),
      resultsPublishAt: new Date(Date.now() + 7_200_000),
    });

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
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
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

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 3_600_000),
      resultsPublishAt: new Date(Date.now() + 7_200_000),
    });

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.notEmpadronado });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('NOT_IN_ROLL');

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

  it('PAR-004: votante inhabilitado no puede participar', async () => {
    const eventId = await createPublishReadyEvent('carnet,habilitado\nABC-789,no\n');
    const published = await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    expect(published.status).toBe(201);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 3_600_000),
      resultsPublishAt: new Date(Date.now() + 7_200_000),
    });

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('VOTER_DISABLED');
  });

  it('PAR-005: no se puede participar cuando el evento sigue en DRAFT', async () => {
    const eventId = await createConfiguredEvent({
      ...institutionalVotingFixtures.event,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });

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

    const denied = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participations`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('EVENT_NOT_PUBLISHED');
  });

  it('WIN-001: fuera de ventana se bloquea participacion', async () => {
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
    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
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
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    const eventId = created.body.id;

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

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    const afterToggle = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/eligibility/public`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(afterToggle.status).toBe(200);
    expect(afterToggle.body.status).toBe('ELIGIBLE');
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
    expect(eligibilityPublic.body.status).toBe('ELIGIBLE');

    const participationStatusPublic = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/participations/status`)
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });
    expect(participationStatusPublic.status).toBe(200);
    expect(participationStatusPublic.body).toHaveProperty('canVote');
  });

  it('PUB-004/PUB-005: consulta pública transversal entre múltiples eventos y filtro institucional', async () => {
    const ownEligibleName = `Own Eligible ${Date.now()}`;
    const ownDisabledName = `Own Disabled ${Date.now()}`;
    const ownPrivateName = `Own Private ${Date.now()}`;
    const otherTenantName = `Other Tenant ${Date.now()}`;
    const otherEligibleName = `Other Eligible ${Date.now()}`;

    const ownEligibleEventId = await createPublishReadyEvent(
      institutionalVotingFixtures.padronCsv,
      { name: ownEligibleName },
    );
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, ownEligibleEventId);

    const ownDisabledEventId = await createPublishReadyEvent(
      'carnet,habilitado\nABC-789,no\n',
      { name: ownDisabledName },
    );
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, ownDisabledEventId);

    const ownPrivateEventId = await createPublishReadyEvent(
      institutionalVotingFixtures.padronCsv,
      { name: ownPrivateName },
    );
    const ownPrivateToggle = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${ownPrivateEventId}/public-eligibility`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled: false });
    expect(ownPrivateToggle.status).toBe(200);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, ownPrivateEventId);

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: otherTenantName,
        description: 'Tenant para filtro público',
      });
    expect(otherTenant.status).toBe(201);

    const otherCreated = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: otherEligibleName,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    const otherEligibleEventId = otherCreated.body.id;

    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${otherEligibleEventId}/roles`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.rolePresident);
    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${otherEligibleEventId}/options`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.optionBlue);
    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      otherEligibleEventId,
      institutionalVotingFixtures.padronCsv,
    );
    await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${otherEligibleEventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK' });
    await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      otherEligibleEventId,
    );
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, otherEligibleEventId);

    const allVisible = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({ carnet: institutionalVotingFixtures.carnet.empadronado });

    expect(allVisible.status).toBe(200);
    const allByName = new Map(allVisible.body.events.map((event: any) => [event.name, event]));
    expect(allByName.get(ownEligibleName)).toEqual(
      expect.objectContaining({ status: 'ELIGIBLE', tenantId: ctx.createdTenantId }),
    );
    expect(allByName.get(ownDisabledName)).toEqual(
      expect.objectContaining({ status: 'DISABLED', tenantId: ctx.createdTenantId }),
    );
    expect(allByName.get(ownPrivateName)).toEqual(
      expect.objectContaining({
        status: 'PUBLIC_CHECK_DISABLED',
        tenantId: ctx.createdTenantId,
      }),
    );
    expect(allByName.get(otherEligibleName)).toEqual(
      expect.objectContaining({ status: 'ELIGIBLE', tenantId: otherTenant.body.id }),
    );

    const filtered = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId: ctx.createdTenantId,
      });

    expect(filtered.status).toBe(200);
    expect(filtered.body.events.every((event: any) => event.tenantId === ctx.createdTenantId)).toBe(
      true,
    );
    expect(filtered.body.events.map((event: any) => event.name)).not.toContain(otherEligibleName);

    const invalidTenant = await request(ctx.httpServer)
      .get('/api/v1/voting/events/public/eligibility-by-carnet')
      .query({
        carnet: institutionalVotingFixtures.carnet.empadronado,
        tenantId: 'tenant-invalido',
      });

    expect(invalidTenant.status).toBe(400);
    expect(invalidTenant.body.message).toBe('tenantId invalido');
  });

  it('RES-001/RES-002: resultados bloqueados antes de fecha y disponibles con snapshot', async () => {
    const createdBlocked = await createInstitutionalEvent(
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
    const blockedEventId = createdBlocked.body.id;
    await updateEventDatesInDb(blockedEventId, {
      votingStart: new Date(Date.now() - 7_200_000),
      votingEnd: new Date(Date.now() - 3_600_000),
      resultsPublishAt: new Date(Date.now() + 3_600_000),
    });

    const beforePublishAt = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${blockedEventId}/results`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(beforePublishAt.status).toBe(403);
    expect(beforePublishAt.body.error).toBe('RESULTS_NOT_AVAILABLE');

    const availableEventId = await createPublishReadyEvent();
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, availableEventId);
    await updateEventDatesInDb(availableEventId, {
      votingStart: new Date(Date.now() - 7_200_000),
      votingEnd: new Date(Date.now() - 3_600_000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });

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

  it('RES-003: el ciclo institucional cierra la votación y publica resultados finales', async () => {
    await seedLinkedUsers(['ABC789']);
    const eventId = await createPublishReadyEvent();

    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);
    await updateEventDatesInDb(eventId, {
      votingStart: new Date(Date.now() - 7_200_000),
      votingEnd: new Date(Date.now() - 3_600_000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const updatedEvent = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(updatedEvent?.state).toBe('RESULTS_PUBLISHED');
    expect(updatedEvent?.resultsNotifiedAt).toBeTruthy();

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_RESULTS_AVAILABLE',
        'data.eventId': eventId,
      })
      .toArray();
    expect(notifications.length).toBeGreaterThan(0);
  });

  it('SEC-ADM-002: tenant admin no puede ver ni mutar un evento ajeno', async () => {
    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Tenant Foreign ${Date.now()}`,
        description: 'Tenant ajeno para validación E2E',
      });
    expect(otherTenant.status).toBe(201);

    const foreignEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      institutionalVotingFixtures.event,
    );
    const foreignEventId = foreignEvent.body.id;

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${foreignEventId}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' });
    expect(detail.status).toBe(403);

    const patch = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${foreignEventId}`)
      .auth(ctx.tenantAdminToken, { type: 'bearer' })
      .send({ name: 'Intento no autorizado' });
    expect(patch.status).toBe(403);
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

  it('NEWS-002: sin comparison report OK la publicacion retorna no_linked_users', async () => {
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
      'carnet,habilitado\n3,maybe\n',
    );

    const publishNews = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/news`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send(institutionalVotingFixtures.news);

    expect(publishNews.status).toBe(201);
    expect(publishNews.body.sent).toBe(0);
    expect(publishNews.body.skipped).toBe('no_linked_users');
  });

  it('NEWS-003: con comparison OK crea usuario desde padron y envia noticia', async () => {
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
    expect(publishNews.body.sent).toBe(1);
    expect(publishNews.body.skipped).toBeNull();

    const storedNews = await ctx.conn
      .collection('user_notifications')
      .findOne({ dni: '999001', title: institutionalVotingFixtures.news.title });
    expect(storedNews).toBeTruthy();
  });
});
