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

describe('Institutional voting integration - padron editing rules', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createBaseEvent() {
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

  it('mantiene un draft editable después de confirmar el padrón mientras falten más de 24 horas', async () => {
    const eventId = await createBaseEvent();
    const importJobId = new Types.ObjectId();

    await ctx.conn.collection('padron_import_jobs').insertOne({
      _id: importJobId,
      eventId: new Types.ObjectId(eventId),
      tenantId: new Types.ObjectId(ctx.createdTenantId),
      createdBy: new Types.ObjectId(),
      sourceType: 'PDF',
      status: 'PARSED',
      isActiveDraft: true,
      originalFileName: 'padron.pdf',
      originalFileMimeType: 'application/pdf',
      originalFileSize: 128,
      originalFileSha256: 'draft-sha',
      parserProvider: 'test',
      parserModel: null,
      parserUsedFallback: true,
      summary: {
        parsedCount: 2,
        validCount: 2,
        duplicateCount: 0,
        invalidCount: 0,
        stagingCount: 2,
        enabledCount: 1,
        disabledCount: 1,
      },
      errors: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.conn.collection('padron_staging_entries').insertMany([
      {
        importJobId,
        eventId: new Types.ObjectId(eventId),
        tenantId: new Types.ObjectId(ctx.createdTenantId),
        ciNorm: 'AAA111',
        enabled: true,
        sourceKind: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        importJobId,
        eventId: new Types.ObjectId(eventId),
        tenantId: new Types.ObjectId(ctx.createdTenantId),
        ciNorm: 'BBB222',
        enabled: false,
        sourceKind: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const confirmed = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/confirm`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({});

    expect(confirmed.status).toBe(201);

    const summary = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/summary`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toBeTruthy();
    expect(summary.body.activeDraft).toBeTruthy();
    expect(summary.body.activeDraft.importJobId).not.toBe(confirmed.body.importJobId);
    expect(summary.body.editingRules.mode).toBe('FULL');
    expect(summary.body.editingRules.canEditEverything).toBe(true);
  });

  it('después de publicar oficialmente bloquea la edición total y deja solo padrón limitado aunque falten más de 24 horas', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(detail.status).toBe(200);
    expect(detail.body.canEditStructure).toBe(false);
    expect(detail.body.canEditPadronDuringVoting).toBe(true);
    expect(detail.body.canEditPadronInLimitedMode).toBe(true);
    expect(detail.body.padronEditMode).toBe('VOTING_LIMITED');

    const patchEvent = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ name: 'Nuevo nombre bloqueado' });

    expect(patchEvent.status).toBe(400);

    const addStagingEntry = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ ci: 'NEW-111', enabled: true });

    expect(addStagingEntry.status).toBe(400);

    const added = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: 'NEW-999', enabled: true });

    expect(added.status).toBe(201);
    expect(added.body.enabled).toBe(true);
    expect(added.body.mode).toBe('VOTING_LIMITED');
  });

  it('durante votación solo permite agregar habilitados y habilitar deshabilitados del padrón vigente', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await publishInstitutionalEvent(ctx.httpServer, ctx.adminToken, eventId);

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

    const votersBefore = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(votersBefore.status).toBe(200);
    expect(votersBefore.body.editingRules.mode).toBe('VOTING_LIMITED');
    const disabledVoter = votersBefore.body.data.find((row: any) => row.carnetNorm === 'ABC123');
    expect(disabledVoter?.enabled).toBe(false);

    const added = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: 'NEW-999', enabled: true });

    expect(added.status).toBe(201);
    expect(added.body.enabled).toBe(true);

    const enabled = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters/${disabledVoter.id}/enable`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);

    const summary = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters/summary`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(summary.status).toBe(200);
    expect(summary.body.total).toBe(2);
    expect(summary.body.enabledToVote).toBe(2);
    expect(summary.body.disabledToVote).toBe(0);

    const notifications = await ctx.conn
      .collection('user_notifications')
      .find({
        'data.type': 'INSTITUTIONAL_VOTING_ENABLED',
        'data.eventId': eventId,
      })
      .toArray();

    expect(notifications).toHaveLength(2);
    expect(notifications.map((row) => row.data.reason).sort()).toEqual([
      'ADDED_ENABLED',
      'ENABLED_DURING_VOTING',
    ]);
  });
});
