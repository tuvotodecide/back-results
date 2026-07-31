import request from 'supertest';
import { Types } from 'mongoose';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  addPadronStagingEntry,
  bootstrapInstitutionalVotingContext,
  confirmPadronStaging,
  createInstitutionalEvent,
  deletePadronStagingEntry,
  getPadronImport,
  getPadronSummary,
  listPadronStaging,
  markInstitutionalEventReadyForReview,
  teardownInstitutionalVotingContext,
  updatePadronStagingEntry,
  uploadPadronCsv,
  uploadPadronImage,
  uploadPadronPdf,
} from '../utils/institutional-voting.helpers';

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | E2E staging', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  function buildMockPdf(lines: string[]) {
    return Buffer.from(`%PDF-1.4\n${lines.join('\n')}\n`, 'utf-8');
  }

  function buildEmptyMockPdf() {
    return Buffer.from(
      '%PDF-1.4\nobj\nendobj\nstream\nendstream\nxref\ntrailer\nstartxref\n',
      'utf-8',
    );
  }

  function buildMockPng(lines: string[]) {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`\n${lines.join('\n')}\n`, 'utf-8'),
    ]);
  }

  function buildUnreadablePng() {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0xff, 0x10, 0x89, 0xab, 0xcd]),
    ]);
  }

  function binaryParser(res: any, callback: (error: Error | null, body?: Buffer) => void) {
    const data: Buffer[] = [];
    res.on('data', (chunk: Buffer) => data.push(Buffer.from(chunk)));
    res.on('end', () => callback(null, Buffer.concat(data)));
  }

  function getCurrentPadronVersionId(summary: any) {
    return summary.body.currentVersion.padronVersionId as string;
  }

  function decodePdfBody(body: Buffer) {
    const raw = body.toString('utf-8');

    if (raw.startsWith('{"type":"Buffer"')) {
      const parsed = JSON.parse(raw) as { type: string; data: number[] };
      return Buffer.from(parsed.data);
    }

    return body;
  }

  async function createConfiguredEvent() {
    const created = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        votingStart: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 74 * 60 * 60 * 1000).toISOString(),
      },
    );

    expect(created.status).toBe(201);
    const eventId = created.body.id as string;

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

    return eventId;
  }

  async function uploadAndConfirmPdfPadron(eventId: string) {
    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si', '789000 no', 'ABC789 si']),
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');
    expect(upload.body.summary.validCount).toBe(3);

    const confirmed = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.state).toBe('CONFIRMED');

    return {
      importJobId: upload.body.importJobId as string,
      padronVersionId: confirmed.body.padronVersionId as string,
    };
  }

  async function approveCurrentPadron(eventId: string, padronVersionId?: string) {
    const response = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/comparison-report/status`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ status: 'OK', padronVersionId });

    expect(response.status).toBe(200);
    return response;
  }

  async function prepareReadyForReviewEvent() {
    const eventId = await createConfiguredEvent();
    const { padronVersionId } = await uploadAndConfirmPdfPadron(eventId);
    await approveCurrentPadron(eventId, padronVersionId);

    const ready = await markInstitutionalEventReadyForReview(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect([200, 201]).toContain(ready.status);
    expect(ready.body.state).toBe('READY_FOR_REVIEW');

    return eventId;
  }

  async function prepareOfficiallyPublishedEvent() {
    const eventId = await prepareReadyForReviewEvent();

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
        },
      },
    );

    return eventId;
  }

  it('PAD-UPL-P0-001 / PAD-PRC-P0-002 / PAD-STG-P0-001 | sube PDF, crea staging y expone el resultado parseado', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si', '789000 no', 'ABC789 si']),
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');
    expect(upload.body.summary).toEqual(
      expect.objectContaining({
        parsedCount: 3,
        validCount: 3,
        duplicateCount: 0,
        invalidCount: 0,
        stagingCount: 3,
      }),
    );

    const importDetail = await getPadronImport(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      upload.body.importJobId,
    );
    expect(importDetail.status).toBe(200);
    expect(importDetail.body).toEqual(
      expect.objectContaining({
        importJobId: upload.body.importJobId,
        status: 'PARSED',
      }),
    );

    const staging = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(staging.status).toBe(200);
    expect(staging.body.data).toHaveLength(3);
    expect(staging.body.data[0]).toEqual(
      expect.objectContaining({
        ci: expect.any(String),
        enabled: expect.any(Boolean),
      }),
    );

    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toBeNull();
    expect(summary.body.activeDraft).toEqual(
      expect.objectContaining({
        importJobId: upload.body.importJobId,
        status: 'PARSED',
      }),
    );
  });

  it('PAD-PRC-P0-003 | maneja error de parseo y deja el import job con estado FAILED', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildEmptyMockPdf(),
      'padron-vacio.pdf',
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('FAILED');
    expect(upload.body.summary.stagingCount).toBe(0);
    expect(upload.body.errors.length).toBeGreaterThan(0);
    expect(upload.body.errors.map((error: any) => error.code)).toEqual(
      expect.arrayContaining(['EMPTY_RESULT', 'EMPTY_STAGING']),
    );
  });

  it('PAD-UPL-P0-001 / PAD-NRM-P0-001 / PAD-STG-P0-001 | importa una imagen clara de tabla y la normaliza al mismo staging', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronImage(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPng(['carnet habilitado', '123456 si', '789000 no', 'ABC789 si']),
      'padron.png',
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');
    expect(upload.body.sourceType).toBe('IMAGE');
    expect(upload.body.summary.validCount).toBe(3);

    const staging = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(staging.status).toBe(200);
    expect(staging.body.data).toHaveLength(3);
    expect(staging.body.data.map((row: any) => row.ci)).toEqual(['123456', '789000', 'ABC789']);
  });

  it('PAD-PRC-P0-003 / PAD-CFM-P0-001 | reporta imagen ilegible con estado FAILED y sin confirmar nada', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronImage(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildUnreadablePng(),
      'padron-ilegible.png',
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('FAILED');
    expect(upload.body.sourceType).toBe('IMAGE');
    expect(upload.body.summary.stagingCount).toBe(0);
    expect(upload.body.errors.length).toBeGreaterThan(0);

    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toBeNull();
    expect(summary.body.activeDraft).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        sourceType: 'IMAGE',
      }),
    );
  });

  it('PAD-CFM-P0-001 / PAD-STG-P0-001 | confirma una imagen importada como versión vigente usando el mismo staging', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronImage(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPng(['carnet habilitado', '123456 si', '789000 no']),
      'padron-confirmable.png',
    );

    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');
    expect(upload.body.sourceType).toBe('IMAGE');

    const confirmed = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.sourceType).toBe('IMAGE_IMPORT');

    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toEqual(
      expect.objectContaining({
        sourceType: 'IMAGE_IMPORT',
      }),
    );
  });

  it('PAD-FIL-P0-001 | rechaza archivos que no son PDF válidos', async () => {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      Buffer.from('no-es-pdf', 'utf-8'),
      'padron.txt',
    );

    expect(upload.status).toBe(400);
  });

  it('PAD-EDT-P0-001 / PAD-DEL-P0-001 | permite agregar, editar y eliminar entradas del staging antes de confirmar', async () => {
    const eventId = await createConfiguredEvent();
    await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildEmptyMockPdf(),
      'padron-vacio.pdf',
    );

    const added = await addPadronStagingEntry(ctx.httpServer, ctx.adminToken, eventId, {
      ci: '123.456',
      enabled: true,
    });
    expect(added.status).toBe(201);
    expect(added.body.ci).toBe('123456');

    const updated = await updatePadronStagingEntry(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      added.body.id,
      {
        ci: 'ABC-789',
        enabled: false,
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.ci).toBe('ABC789');
    expect(updated.body.enabled).toBe(false);

    const duplicate = await addPadronStagingEntry(ctx.httpServer, ctx.adminToken, eventId, {
      ci: 'ABC789',
      enabled: true,
    });
    expect(duplicate.status).toBe(400);

    const deleted = await deletePadronStagingEntry(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      updated.body.id,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    const staging = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(staging.status).toBe(200);
    expect(staging.body.total).toBe(0);
  });

  it('PAD-DEL-P0-001 / PAD-CON-P1-001 | bulk-delete elimina varias entradas del staging sin dejarlo vacío', async () => {
    const eventId = await createConfiguredEvent();
    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['100001 si', '100002 si', '100003 no', '100004 si']),
    );
    expect(upload.status).toBe(201);

    const before = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId, {
      limit: 10,
    });
    expect(before.status).toBe(200);
    expect(before.body.total).toBe(4);

    const idsToDelete = before.body.data.slice(0, 2).map((row: any) => row.id);
    const deleted = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/bulk-delete`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ entryIds: idsToDelete });

    expect(deleted.status).toBe(201);
    expect(deleted.body).toEqual(
      expect.objectContaining({
        requestedCount: 2,
        deletedCount: 2,
        materialized: false,
      }),
    );

    const after = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId, {
      limit: 10,
    });
    expect(after.status).toBe(200);
    expect(after.body.total).toBe(2);
    expect(after.body.data.map((row: any) => row.id)).not.toEqual(
      expect.arrayContaining(idsToDelete),
    );
  });

  it('PAD-PER-P0-001 / PAD-DEL-P0-001 | bulk-delete rechaza ids inválidos, ids ajenos y borrar todo el staging', async () => {
    const eventId = await createConfiguredEvent();
    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['200001 si', '200002 no']),
    );
    expect(upload.status).toBe(201);

    const invalid = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/bulk-delete`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ entryIds: ['bad-id'] });
    expect(invalid.status).toBe(400);

    const foreign = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/bulk-delete`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ entryIds: [String(new Types.ObjectId())] });
    expect(foreign.status).toBe(400);

    const staging = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(staging.status).toBe(200);
    expect(staging.body.total).toBe(2);

    const deleteAll = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/bulk-delete`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ entryIds: staging.body.data.map((row: any) => row.id) });
    expect(deleteAll.status).toBe(400);

    const after = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(after.status).toBe(200);
    expect(after.body.total).toBe(2);
  });

  it('PAD-CFM-P0-001 / PAD-RPL-P1-001 | confirma el staging como nueva versión vigente del padrón', async () => {
    const eventId = await createConfiguredEvent();
    const uploaded = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si', '789000 no']),
    );

    const confirmed = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toEqual(
      expect.objectContaining({
        importJobId: uploaded.body.importJobId,
        state: 'CONFIRMED',
        sourceType: 'PDF_IMPORT',
      }),
    );

    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toEqual(
      expect.objectContaining({
        sourceType: 'PDF_IMPORT',
        comparisonStatus: 'PENDING',
      }),
    );
    expect(summary.body.activeDraft).toEqual(
      expect.objectContaining({
        sourceType: 'SYSTEM',
        status: 'PARSED',
        isActiveDraft: true,
      }),
    );
    expect(summary.body.activeDraft.importJobId).not.toBe(uploaded.body.importJobId);
    expect(summary.body.editingRules).toEqual(
      expect.objectContaining({
        mode: 'FULL',
        canEditEverything: true,
      }),
    );

    const versions = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/versions`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(versions.status).toBe(200);
    expect(versions.body.data[0]).toEqual(
      expect.objectContaining({
        sourceType: 'PDF_IMPORT',
      }),
    );
  });

  it('PAD-STA-P0-001 / PAD-EDT-P0-001 | permite seguir editando padrón en READY_FOR_REVIEW sin volver de estado', async () => {
    const eventId = await prepareReadyForReviewEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['100001 si', '100002 si']),
      'padron-revision.pdf',
    );
    expect(upload.status).toBe(201);
    expect(upload.body.status).toBe('PARSED');

    const added = await addPadronStagingEntry(ctx.httpServer, ctx.adminToken, eventId, {
      ci: '100003',
      enabled: false,
    });
    expect(added.status).toBe(201);

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('READY_FOR_REVIEW');
  });

  it('PAD-STA-P1-002 / PAD-PER-P0-001 | bloquea upload y edición del padrón en OFFICIALLY_PUBLISHED', async () => {
    const eventId = await prepareOfficiallyPublishedEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si']),
    );
    expect(upload.status).toBe(400);

    const add = await addPadronStagingEntry(ctx.httpServer, ctx.adminToken, eventId, {
      ci: '999999',
      enabled: true,
    });
    expect(add.status).toBe(400);

    const confirm = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirm.status).toBe(404);
  });

  it('PAD-STA-P1-002 / PAD-DEL-P0-001 | bloquea bulk-delete en OFFICIALLY_PUBLISHED', async () => {
    const eventId = await createConfiguredEvent();
    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['300001 si', '300002 si']),
      'padron-publicado.pdf',
    );
    expect(upload.status).toBe(201);

    const staging = await listPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(staging.status).toBe(200);
    expect(staging.body.total).toBeGreaterThan(0);

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          state: 'OFFICIALLY_PUBLISHED',
        },
      },
    );

    const deleted = await request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/padron/staging/bulk-delete`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ entryIds: [staging.body.data[0].id] });
    expect(deleted.status).toBe(400);
  });

  it('PAD-DWN-P1-001 | descarga el padrón PDF vigente con headers HTTP después de publicación oficial', async () => {
    const eventId = await prepareOfficiallyPublishedEvent();
    const current = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(current.status).toBe(200);
    const padronVersionId = getCurrentPadronVersionId(current);

    const download = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/download-pdf`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .buffer(true)
      .parse(binaryParser);

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).toContain(`padron-${padronVersionId}.pdf`);
    expect(Buffer.isBuffer(download.body)).toBe(true);
    const pdfBody = decodePdfBody(download.body);
    expect(pdfBody.length).toBeGreaterThan(0);
    expect(pdfBody.toString('utf-8')).toContain('%PDF-1.4');
  });

  it('PAD-DWN-P1-001 / PAD-STA-P0-003 | descarga una versión específica del padrón PDF y bloquea la descarga antes de publicación', async () => {
    const eventId = await prepareReadyForReviewEvent();
    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    const padronVersionId = getCurrentPadronVersionId(summary);

    const beforePublication = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/download-pdf`)
      .query({ padronVersionId })
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(beforePublication.status).toBe(400);

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
        },
      },
    );

    const download = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/download-pdf`)
      .query({ padronVersionId })
      .auth(ctx.adminToken, { type: 'bearer' })
      .buffer(true)
      .parse(binaryParser);

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain(`padron-${padronVersionId}.pdf`);
    expect(decodePdfBody(download.body).length).toBeGreaterThan(0);
  });

  it('PAD-STA-P0-003 | expira por plazo y bloquea cambios de padrón en PUBLICATION_EXPIRED', async () => {
    const eventId = await prepareReadyForReviewEvent();

    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(eventId) },
      {
        $set: {
          publishDeadline: new Date(Date.now() - 60_000),
        },
      },
    );

    const lifecycle = ctx.app.get(InstitutionalVotingLifecycleService);
    await lifecycle.processLifecycle();

    const eventInDb = await ctx.conn
      .collection('voting_events')
      .findOne({ _id: new Types.ObjectId(eventId) });
    expect(eventInDb?.state).toBe('PUBLICATION_EXPIRED');

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si']),
    );
    expect(upload.status).toBe(400);

    const add = await addPadronStagingEntry(ctx.httpServer, ctx.adminToken, eventId, {
      ci: '111111',
      enabled: true,
    });
    expect(add.status).toBe(400);

    const confirm = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirm.status).toBe(404);
  });

  it('PAD-CSV-P1-001 | mantiene compatibilidad razonable con el flujo CSV legacy', async () => {
    const eventId = await createConfiguredEvent();

    const legacy = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(legacy.status).toBe(201);
    expect(legacy.body.sourceType).toBe('CSV_LEGACY');

    const summary = await getPadronSummary(ctx.httpServer, ctx.adminToken, eventId);
    expect(summary.status).toBe(200);
    expect(summary.body.currentVersion).toEqual(
      expect.objectContaining({
        sourceType: 'CSV_LEGACY',
      }),
    );
    expect(summary.body.activeDraft).toEqual(
      expect.objectContaining({
        sourceType: 'SYSTEM',
        status: 'PARSED',
        isActiveDraft: true,
      }),
    );
    expect(summary.body.editingRules).toEqual(
      expect.objectContaining({
        mode: 'FULL',
        canEditEverything: true,
      }),
    );
  });
});
