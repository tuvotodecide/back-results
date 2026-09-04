import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  markInstitutionalEventReadyForReview,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
  uploadPadronPdf,
} from '../../utils/institutional-voting.helpers';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | Reglas de edición', () => {
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

  function buildMockPdf(lines: string[]) {
    return Buffer.from(`%PDF-1.4\n${lines.join('\n')}\n`, 'utf-8');
  }

  async function forcePublishedVotingWindow(eventId: string, patch: Record<string, unknown> = {}) {
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          state: 'OFFICIALLY_PUBLISHED',
          publicationConfirmed: true,
          officialPublishedAt: new Date(),
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60 * 60 * 1000),
          resultsPublishAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          ...patch,
        },
      },
    );
  }

  it('PAD-CFM-P0-001 / PAD-STA-P0-001 | mantiene un draft editable después de confirmar el padrón mientras el deadline de publicación siga vigente', async () => {
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

  it('PAD-STA-P0-001 / PAD-RPL-P1-001 | permite revisión pre-publicación desde el active draft autosalvado sin reabrir validación artificialmente', async () => {
    const eventId = await createBaseEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['ABC123 si', 'XYZ999 no', 'DEF456 si']),
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');

    const staging = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/staging`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(staging.status).toBe(200);
    expect(staging.body.total).toBe(3);

    const edited = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/padron/staging/${staging.body.data[0].id}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ enabled: false });

    expect(edited.status).toBe(200);

    const readinessBefore = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/review-readiness`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(readinessBefore.status).toBe(200);
    expect(readinessBefore.body.pending).not.toContain('padron_validation');

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    const readinessAfter = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/review-readiness`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(readinessAfter.status).toBe(200);
    expect(readinessAfter.body.pending).not.toContain('padron_validation');
  });

  it('PAD-STA-P1-002 / PAD-PER-P0-001 | después de publicar oficialmente bloquea edición total y solo permite habilitar existentes', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n123456,si\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await forcePublishedVotingWindow(eventId);

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

    expect(added.status).toBe(400);
    expect(String(added.body.message || '')).toMatch(/no se permite agregar nuevos votantes/i);

    const voters = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' });
    const disabledVoter = voters.body.data.find((row: any) => row.carnetNorm === 'ABC123');

    const enabled = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters/${disabledVoter.id}/enable`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    expect(enabled.body.mode).toBe('VOTING_LIMITED');
  });

  it('PAD-STA-P1-002 | durante votación solo permite habilitar deshabilitados del padrón vigente', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n123456,si\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await forcePublishedVotingWindow(eventId);

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

    expect(added.status).toBe(400);
    expect(String(added.body.message || '')).toMatch(/no se permite agregar nuevos votantes/i);

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

    expect(notifications).toHaveLength(1);
    expect(notifications.map((row) => row.data.reason)).toEqual([
      'ENABLED_DURING_VOTING',
    ]);
  });

  it('PAD-STA-P1-002 / PAD-CON-P1-001 | en modo limitado no crea una nueva versión estructural ni altera publicación vigente', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n123456,si\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);
    await forcePublishedVotingWindow(eventId);

    const beforeVersions = await ctx.conn
      .collection('padron_versions')
      .find({ eventId: new Types.ObjectId(eventId), isCurrent: true })
      .toArray();

    expect(beforeVersions).toHaveLength(1);
    const currentVersionId = String(beforeVersions[0]?._id);

    const votersBefore = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' });
    const disabledVoter = votersBefore.body.data.find((row: any) => row.carnetNorm === 'ABC123');

    const added = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ carnet: 'NEW-777', enabled: true });
    expect(added.status).toBe(400);

    const enabled = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters/${disabledVoter.id}/enable`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(enabled.status).toBe(200);

    const afterVersions = await ctx.conn
      .collection('padron_versions')
      .find({ eventId: new Types.ObjectId(eventId), isCurrent: true })
      .toArray();

    expect(afterVersions).toHaveLength(1);
    expect(String(afterVersions[0]?._id)).toBe(currentVersionId);

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(detail.status).toBe(200);
    expect(detail.body.state).toBe('OFFICIALLY_PUBLISHED');
  });

  it('PAD-STA-P1-002 / PAD-PER-P0-001 | bloquea incluso la habilitación desde tabla cuando la bandera post-publicación está desactivada', async () => {
    const eventId = await createBaseEvent();

    await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      'carnet,habilitado\nABC-123,no\n123456,si\n',
    );

    await markInstitutionalEventReadyForReview(ctx.httpServer, ctx.adminToken, eventId);

    const toggled = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ allowPostPublicationPadronEnable: false });

    expect(toggled.status).toBe(200);
    expect(toggled.body.allowPostPublicationPadronEnable).toBe(false);

    await forcePublishedVotingWindow(eventId, { allowPostPublicationPadronEnable: false });

    const voters = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/voters`)
      .auth(ctx.adminToken, { type: 'bearer' });
    const disabledVoter = voters.body.data.find((row: any) => row.carnetNorm === 'ABC123');

    const enabled = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/voters/${disabledVoter.id}/enable`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(enabled.status).toBe(400);
    expect(String(enabled.body.message || '')).toMatch(/habilitación manual desde la tabla está desactivada/i);

    const detail = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}`)
      .auth(ctx.adminToken, { type: 'bearer' });

    expect(detail.status).toBe(200);
    expect(detail.body.canEditPadronDuringVoting).toBe(true);
    expect(detail.body.canEditPadronInLimitedMode).toBe(false);
  });
});
