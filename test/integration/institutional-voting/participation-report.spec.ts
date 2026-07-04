import request from 'supertest';
import { Types } from 'mongoose';
import { deflateSync } from 'zlib';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';
import {
  bootstrapInstitutionalVotingContext,
  createInstitutionalEvent,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';

const SENSITIVE_REPORT_TERMS = [
  'candidateId',
  'selectedCandidateId',
  'candidateSelected',
  'optionId',
  'nullifier',
  'proof',
  'vote',
  'votes',
  'txHash',
  'sessionToken',
  'receipt',
  'ranking',
  'winners',
  'Frente Azul',
  'Frente Verde',
];

const crcTable = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createPngDataUrl() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rawRgbWithFilter = Buffer.from([0, 69, 145, 81]);
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rawRgbWithFilter)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

const VALID_MODAL_SCREENSHOT = createPngDataUrl();
const VALID_MODAL_SCREENSHOT_RAW_BASE64 = VALID_MODAL_SCREENSHOT.replace(/^data:image\/png;base64,/, '');
const VALID_JPEG_MODAL_SCREENSHOT = `data:image/jpeg;base64,${Buffer.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03,
  0x01, 0x11, 0x00,
  0x02, 0x11, 0x00,
  0x03, 0x11, 0x00,
  0xff, 0xd9,
]).toString('base64')}`;

describe('Institutional voting integration - participation report PDF', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  async function createEvent(overrides: Record<string, unknown> = {}) {
    const response = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      ctx.createdTenantId,
      {
        ...institutionalVotingFixtures.event,
        name: `Reporte Participacion ${Date.now()} ${Math.random()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
        ...overrides,
      },
    );
    expect(response.status).toBe(201);
    return response.body;
  }

  async function seedCurrentPadron(
    eventId: string,
    tenantId: string,
    entries: Array<{ carnetNorm: string; enabled?: boolean }>,
  ) {
    const versionId = new Types.ObjectId();
    await ctx.conn.collection('padron_versions').insertOne({
      _id: versionId,
      eventId: new Types.ObjectId(eventId),
      tenantId: new Types.ObjectId(tenantId),
      createdBy: new Types.ObjectId(),
      fileDigest: `report-digest-${versionId.toString()}`,
      sourceType: 'CSV_LEGACY',
      totals: {
        validCount: entries.length,
        duplicateCount: 0,
        invalidCount: 0,
      },
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    if (entries.length) {
      await ctx.conn.collection('padron_entries').insertMany(
        entries.map((entry) => ({
          _id: new Types.ObjectId(),
          padronVersionId: versionId,
          eventId: new Types.ObjectId(eventId),
          carnetNorm: entry.carnetNorm,
          enabled: entry.enabled !== false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }
  }

  async function insertParticipations(eventId: string, carnets: string[]) {
    if (!carnets.length) return;
    await ctx.conn.collection('participations').insertMany(
      carnets.map((carnetNorm, index) => ({
        _id: new Types.ObjectId(),
        eventId: new Types.ObjectId(eventId),
        carnetNorm,
        idempotencyKey: `report-${eventId}-${index}-${carnetNorm}`,
        participatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      { ordered: false },
    );
  }

  function reportRequest(
    eventId: string,
    token?: string,
    body: Record<string, unknown> = { modalScreenshot: VALID_MODAL_SCREENSHOT },
  ) {
    const req = request(ctx.httpServer)
      .post(`/api/v1/voting/events/${eventId}/participation-report`)
      .send(body)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return token ? req.auth(token, { type: 'bearer' }) : req;
  }

  function pdfText(response: request.Response) {
    return Buffer.isBuffer(response.body)
      ? response.body.toString('utf-8')
      : Buffer.from(response.text ?? '', 'binary').toString('utf-8');
  }

  function encodeExpectedPdfText(value: string) {
    return `<${Buffer.from(`\ufeff${value}`, 'utf16le').swap16().toString('hex').toUpperCase()}>`;
  }

  function pdfDecodedText(response: request.Response) {
    const text = pdfText(response);
    const decoded: string[] = [];
    const matches = text.matchAll(/<([0-9A-F]+)>/gi);
    for (const match of matches) {
      const hex = match[1];
      if (!hex || hex.length % 4 !== 0 || !hex.toUpperCase().startsWith('FEFF')) {
        continue;
      }
      decoded.push(Buffer.from(hex, 'hex').swap16().toString('utf16le').replace(/^\ufeff/, ''));
    }
    return decoded.join('\n');
  }

  function expectReportPrivacy(text: string) {
    SENSITIVE_REPORT_TERMS.forEach((term) => {
      expect(text).not.toContain(term);
    });
  }

  it('usuario autorizado descarga PDF con captura real como primera página y tabla de participación', async () => {
    const event = await createEvent();
    await seedCurrentPadron(event.id, event.tenantId, [
      { carnetNorm: 'A1' },
      { carnetNorm: 'A2' },
      { carnetNorm: 'A3' },
      { carnetNorm: 'A4', enabled: false },
    ]);
    await insertParticipations(event.id, ['A1', 'A3', 'A4']);

    const response = await reportRequest(event.id, ctx.tenantAdminToken);
    const text = pdfText(response);
    const decodedText = pdfDecodedText(response);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain(`participation-report-${event.id}.pdf`);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(text).toContain('%PDF-1.4');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Im1 Do');
    expect(text.indexOf('/Im1 Do')).toBeLessThan(
      text.indexOf(encodeExpectedPdfText('Tabla de participación')),
    );
    expect(decodedText).toContain('Tabla de participación');
    expect(decodedText).toContain('Carnet');
    expect(decodedText).toContain('Participó');
    expect(decodedText).toContain('A1');
    expect(decodedText).toContain('A3');
    expect(decodedText).toContain('Sí');
    expect(decodedText).toContain('A2');
    expect(decodedText).toContain('No');
    expect(decodedText).not.toContain('A4');
    expect(decodedText).not.toContain('Tabla de participaci‡n');
    expect(decodedText).not.toContain('Particip‡');
    expect(decodedText).not.toContain('Sˆ');
    expect(decodedText).not.toContain('¢');
    expectReportPrivacy(decodedText);
  });

  it('sin token, sin permiso y admin tenant ajeno no descargan reporte', async () => {
    const event = await createEvent();

    expect((await reportRequest(event.id)).status).toBe(401);

    const mayorLogin = await request(ctx.httpServer).post('/api/v1/auth/login').send({
      email: 'mcbba@example.com',
      password: 'secret123',
    });
    expect((await reportRequest(event.id, mayorLogin.body.accessToken)).status).toBe(403);

    const otherTenant = await request(ctx.httpServer)
      .post('/api/v1/institutional-tenants')
      .auth(ctx.adminToken, { type: 'bearer' })
      .send({
        name: `Tenant reporte ajeno ${Date.now()}`,
        description: 'Tenant ajeno',
      });
    const otherEvent = await createInstitutionalEvent(
      ctx.httpServer,
      ctx.adminToken,
      otherTenant.body.id,
      {
        ...institutionalVotingFixtures.event,
        name: `Reporte ajeno ${Date.now()}`,
        votingStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        votingEnd: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
        resultsPublishAt: new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString(),
      },
    );
    expect((await reportRequest(otherEvent.body.id, ctx.tenantAdminToken)).status).toBe(403);
  });

  it('evento inexistente y capturas inválidas devuelven errores controlados', async () => {
    expect((await reportRequest(new Types.ObjectId().toString(), ctx.adminToken)).status).toBe(404);

    const event = await createEvent();
    await seedCurrentPadron(event.id, event.tenantId, [{ carnetNorm: 'A1' }]);

    expect((await reportRequest(event.id, ctx.adminToken, {})).status).toBe(400);
    expect(
      (await reportRequest(event.id, ctx.adminToken, {
        modalScreenshot: 'data:image/png;base64,invalid-image',
      })).status,
    ).toBe(400);
    expect(
      (await reportRequest(event.id, ctx.adminToken, {
        modalScreenshot: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`,
      })).status,
    ).toBe(400);
  });

  it('acepta captura PNG en base64 sin prefijo data URL y captura JPEG', async () => {
    const event = await createEvent();
    await seedCurrentPadron(event.id, event.tenantId, [{ carnetNorm: 'A1' }]);

    const rawBase64Report = await reportRequest(event.id, ctx.adminToken, {
      modalScreenshot: VALID_MODAL_SCREENSHOT_RAW_BASE64,
    });
    expect(rawBase64Report.status).toBe(200);
    expect(rawBase64Report.headers['content-type']).toContain('application/pdf');
    expect(pdfText(rawBase64Report)).toContain('/Subtype /Image');

    const jpegReport = await reportRequest(event.id, ctx.adminToken, {
      modalScreenshot: VALID_JPEG_MODAL_SCREENSHOT,
    });
    expect(jpegReport.status).toBe(200);
    expect(jpegReport.headers['content-type']).toContain('application/pdf');
    expect(pdfText(jpegReport)).toContain('/DCTDecode');
  });

  it('PDF funciona con cero participantes, todos participantes y votación finalizada sin publicación', async () => {
    const zero = await createEvent();
    await seedCurrentPadron(zero.id, zero.tenantId, [
      { carnetNorm: 'A1' },
      { carnetNorm: 'A2' },
    ]);
    const zeroReport = await reportRequest(zero.id, ctx.adminToken);
    const zeroText = pdfDecodedText(zeroReport);
    expect(zeroReport.status).toBe(200);
    expect(zeroText).toContain('A1');
    expect(zeroText).toContain('No');

    const all = await createEvent();
    await seedCurrentPadron(all.id, all.tenantId, [
      { carnetNorm: 'B1' },
      { carnetNorm: 'B2' },
    ]);
    await insertParticipations(all.id, ['B1', 'B2']);
    const allReport = await reportRequest(all.id, ctx.adminToken);
    const allText = pdfDecodedText(allReport);
    expect(allReport.status).toBe(200);
    expect(allText).toContain('B1');
    expect(allText).toContain('Sí');

    const finished = await createEvent();
    await ctx.conn.collection('voting_events').updateOne(
      { _id: new Types.ObjectId(finished.id) },
      {
        $set: {
          state: 'CLOSED',
          votingStart: new Date(Date.now() - 180_000),
          votingEnd: new Date(Date.now() - 120_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
      },
    );
    const finishedReport = await reportRequest(finished.id, ctx.adminToken);
    const finishedRawText = pdfText(finishedReport);
    const finishedText = pdfDecodedText(finishedReport);
    expect(finishedReport.status).toBe(200);
    expect(finishedRawText).toContain('/Subtype /Image');
    expect(finishedText).toContain('Tabla de participación');
    expectReportPrivacy(finishedText);
  });

  it('PDF pagina tablas largas y repite encabezado', async () => {
    const event = await createEvent();
    const entries = Array.from({ length: 80 }, (_, index) => ({
      carnetNorm: `C${String(index + 1).padStart(3, '0')}`,
    }));
    await seedCurrentPadron(event.id, event.tenantId, entries);
    await insertParticipations(event.id, entries.slice(0, 40).map((entry) => entry.carnetNorm));

    const response = await reportRequest(event.id, ctx.adminToken);
    const text = pdfDecodedText(response);

    expect(response.status).toBe(200);
    expect(text).toContain('C001');
    expect(text).toContain('C080');
    expect((text.match(/Tabla de participación/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((text.match(/Carnet/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
