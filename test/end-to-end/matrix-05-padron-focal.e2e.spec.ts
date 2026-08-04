import request from 'supertest';
import { Types } from 'mongoose';
import { institutionalVotingFixtures } from '../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  confirmPadronStaging,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
  uploadPadronPdf,
} from '../utils/institutional-voting.helpers';

describe('MX-05 Backend Results — E2E focal de padrón', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  const pdf = (lines: string[]) => Buffer.from(`%PDF-1.4\n${lines.join('\n')}\n`, 'utf8');

  async function createEvent() {
    const response = await createInstitutionalEvent(ctx.httpServer, ctx.adminToken, ctx.createdTenantId, {
      ...institutionalVotingFixtures.event,
      name: `MX-05 focal ${Date.now()}`,
      votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
      resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
    });
    expect(response.status).toBe(201);
    return response.body.id as string;
  }

  it('[MX-05][PAD-FIL-P0-001][E2E] rechaza archivo inválido sin crear una versión vigente', async () => {
    const eventId = await createEvent();
    const before = await ctx.conn.collection('padron_versions').countDocuments({ eventId: new Types.ObjectId(eventId), isCurrent: true });

    const response = await uploadPadronPdf(ctx.httpServer, ctx.adminToken, eventId, Buffer.from('not-a-pdf'), 'padron.txt');
    const after = await ctx.conn.collection('padron_versions').countDocuments({ eventId: new Types.ObjectId(eventId), isCurrent: true });

    expect(response.status).toBe(400);
    expect(after).toBe(before);
  });

  it('[MX-05][PAD-PRC-P0-002][E2E] recorre HTTP, guardas, controller, servicio y staging persistido para PDF válido', async () => {
    const eventId = await createEvent();
    const uploaded = await uploadPadronPdf(ctx.httpServer, ctx.adminToken, eventId, pdf(['carnet habilitado', '123456 si', '789000 no']));
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ status: 'PARSED', summary: { stagingCount: 2, validCount: 2 } });

    const persisted = await ctx.conn.collection('padron_staging_entries').find({ eventId: new Types.ObjectId(eventId) }).sort({ ciNorm: 1 }).toArray();
    expect(persisted.map((entry) => [entry.ciNorm, entry.enabled])).toEqual([['123456', true], ['789000', false]]);
  });

  it('[MX-05][PAD-EDT-P0-001][E2E] guarda edición del staging con carnet normalizado y habilitación indicada', async () => {
    const eventId = await createEvent();
    await uploadPadronPdf(ctx.httpServer, ctx.adminToken, eventId, pdf(['123456 si']));
    const staging = await request(ctx.httpServer).get(`/api/v1/voting/events/${eventId}/padron/staging`).auth(ctx.adminToken, { type: 'bearer' });
    expect(staging.status).toBe(200);

    const edited = await request(ctx.httpServer)
      .patch(`/api/v1/voting/events/${eventId}/padron/staging/${staging.body.data[0].id}`)
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({ ci: 'AB-123', enabled: false });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ ci: 'AB123', enabled: false });

    const persisted = await ctx.conn.collection('padron_staging_entries').findOne({ _id: new Types.ObjectId(staging.body.data[0].id) });
    expect(persisted).toMatchObject({ ciNorm: 'AB123', enabled: false });
  });

  it('[MX-05][PAD-CFM-P0-001][E2E] confirma staging, materializa versión vigente y conserva la constancia', async () => {
    const eventId = await createEvent();
    await uploadPadronPdf(ctx.httpServer, ctx.adminToken, eventId, pdf(['123456 si', '789000 no']));
    const confirmed = await confirmPadronStaging(ctx.httpServer, ctx.adminToken, eventId);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ state: 'CONFIRMED', totals: { validCount: 2 }, certificate: { exists: true } });

    const version = await ctx.conn.collection('padron_versions').findOne({ _id: new Types.ObjectId(confirmed.body.padronVersionId), isCurrent: true });
    const certificate = await ctx.conn.collection('padron_certificates').findOne({ padronVersionId: new Types.ObjectId(confirmed.body.padronVersionId) });
    expect(version).toMatchObject({ totals: { validCount: 2 } });
    expect(certificate).toBeTruthy();
  });
});
