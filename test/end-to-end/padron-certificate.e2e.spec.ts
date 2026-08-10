import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  confirmPadronStaging,
  createInstitutionalEvent,
  getPadronCertificateMetadata,
  markInstitutionalEventReadyForReview,
  materializePadronCertificate,
  teardownInstitutionalVotingContext,
  uploadPadronCsv,
  uploadPadronPdf,
} from '../utils/institutional-voting.helpers';

jest.setTimeout(240000);

describe('MX-05 | Padrón, staging, elegibilidad y archivos | Backend Results | E2E constancia', () => {
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

  function binaryParser(res: any, callback: (error: Error | null, body?: Buffer) => void) {
    const data: Buffer[] = [];
    res.on('data', (chunk: Buffer) => data.push(Buffer.from(chunk)));
    res.on('end', () => callback(null, Buffer.concat(data)));
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

  async function prepareConfirmedVersionEvent() {
    const eventId = await createConfiguredEvent();

    const upload = await uploadPadronPdf(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      buildMockPdf(['123456 si', '789000 no', 'ABC789 si']),
    );
    expect(upload.status).toBe(201);

    const confirm = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirm.status).toBe(201);

    return {
      eventId,
      padronVersionId: confirm.body.padronVersionId as string,
    };
  }

  it('PAD-CFM-P0-001 / PAD-DWN-P1-001 | genera constancia PDF inmediatamente desde una versión confirmada', async () => {
    const { eventId, padronVersionId } = await prepareConfirmedVersionEvent();

    const metadata = await getPadronCertificateMetadata(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      padronVersionId,
    );

    expect(metadata.status).toBe(200);
    expect(metadata.body).toEqual(
      expect.objectContaining({
        exists: true,
        padronVersionId,
        sourceType: 'PDF_IMPORT',
        generationMode: 'ON_CONFIRMATION',
      }),
    );
    expect(metadata.body.totals).toEqual({
      totalCount: 3,
      enabledCount: 2,
      disabledCount: 1,
    });
  });

  it('PAD-DWN-P1-001 | permite descargar la constancia PDF y contiene metadatos coherentes', async () => {
    const { eventId, padronVersionId } = await prepareConfirmedVersionEvent();

    const download = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/certificate/download`)
      .query({ padronVersionId })
      .auth(ctx.adminToken, { type: 'bearer' })
      .buffer(true)
      .parse(binaryParser);

    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain(`padron-constancia-${padronVersionId}.pdf`);

    expect(Buffer.isBuffer(download.body)).toBe(true);
    expect(download.body.subarray(0, 5).toString('utf-8')).toBe('%PDF-');
    const text = download.body.toString('utf-8');
    expect(text).toContain('CONSTANCIA DE PADRON CONFIRMADO');
    expect(text).toContain('Eleccion Directiva 2026');
    expect(text).toContain(padronVersionId);
    expect(text).toContain('123456 | HABILITADO');
    expect(text).toContain('789000 | INHABILITADO');
  });

  it('PAD-LST-P1-002 | informa ausencia de constancia cuando no existe versión confirmada', async () => {
    const eventId = await createConfiguredEvent();

    const metadata = await getPadronCertificateMetadata(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
    );
    expect(metadata.status).toBe(200);
    expect(metadata.body).toEqual(
      expect.objectContaining({
        exists: false,
        padronVersionId: null,
        reason: 'NO_CONFIRMED_PADRON_VERSION',
      }),
    );

    const download = await request(ctx.httpServer)
      .get(`/api/v1/voting/events/${eventId}/padron/certificate/download`)
      .auth(ctx.adminToken, { type: 'bearer' });
    expect(download.status).toBe(404);
  });

  it('PAD-CSV-P1-001 / PAD-DWN-P1-001 | materializa constancia para una versión legacy que no la tenía', async () => {
    const eventId = await createConfiguredEvent();

    const legacy = await uploadPadronCsv(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      institutionalVotingFixtures.padronCsv,
    );
    expect(legacy.status).toBe(201);

    await ctx.conn.collection('padron_certificates').deleteMany({
      padronVersionId: new Types.ObjectId(legacy.body.padronVersionId),
    });

    const missing = await getPadronCertificateMetadata(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      legacy.body.padronVersionId,
    );
    expect(missing.status).toBe(200);
    expect(missing.body).toEqual(
      expect.objectContaining({
        exists: false,
        padronVersionId: legacy.body.padronVersionId,
        materializable: true,
      }),
    );

    const materialized = await materializePadronCertificate(
      ctx.httpServer,
      ctx.adminToken,
      eventId,
      { padronVersionId: legacy.body.padronVersionId },
    );
    expect(materialized.status).toBe(201);
    expect(materialized.body).toEqual(
      expect.objectContaining({
        exists: true,
        padronVersionId: legacy.body.padronVersionId,
        sourceType: 'CSV_LEGACY',
        generationMode: 'ON_DEMAND',
      }),
    );
  });

  it('PAD-STA-P0-001 / PAD-STA-P0-003 | permite consultar constancia en estados posteriores permitidos', async () => {
    const { eventId, padronVersionId } = await prepareConfirmedVersionEvent();

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

    const states = [
      'READY_FOR_REVIEW',
      'OFFICIALLY_PUBLISHED',
      'PUBLICATION_EXPIRED',
      'CLOSED',
      'RESULTS_PUBLISHED',
    ];

    for (const state of states) {
      await ctx.conn.collection('voting_events').updateOne(
        { _id: new Types.ObjectId(eventId) },
        { $set: { state } },
      );

      const metadata = await getPadronCertificateMetadata(
        ctx.httpServer,
        ctx.adminToken,
        eventId,
        padronVersionId,
      );
      expect(metadata.status).toBe(200);
      expect(metadata.body).toEqual(
        expect.objectContaining({
          exists: true,
          padronVersionId,
        }),
      );
    }
  });
});
