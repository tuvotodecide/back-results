import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PadronGeminiImportService } from '@/modules/institutional-voting/services/core/padron-gemini-import.service';
import { PadronPdfParserService } from '@/modules/institutional-voting/services/core/padron-pdf-parser.service';
import { PadronService } from '@/modules/institutional-voting/services/padron/padron.service';
import { normalizeCarnet } from '@/modules/institutional-voting/utils/carnet-normalizer';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortedLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue(lean(value)) };
}

function createPadronHarness() {
  const event = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    state: 'DRAFT',
    publicEligibilityEnabled: true,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const models = {
    version: { findOne: jest.fn(), find: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    entry: { findOne: jest.fn(), find: jest.fn(), insertMany: jest.fn(), countDocuments: jest.fn() },
    comparison: { exists: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() },
    job: { findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() },
    staging: { find: jest.fn(), findOne: jest.fn(), exists: jest.fn(), create: jest.fn(), insertMany: jest.fn(), countDocuments: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn(), findOneAndDelete: jest.fn(), deleteMany: jest.fn() },
    certificate: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn(), findById: jest.fn(), deleteMany: jest.fn() },
    user: { find: jest.fn() },
    session: { insertOne: jest.fn() },
  };
  const access = {
    getEventOrThrow: jest.fn().mockResolvedValue(event),
    assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
    assertGlobalAdminAccess: jest.fn(),
    canFullyEditEvent: jest.fn().mockReturnValue(true),
    canModifyPadronDuringVoting: jest.fn().mockReturnValue(false),
    canEnableExistingPadronEntriesPostPublication: jest.fn().mockReturnValue(true),
    hasPublicationWindowExpired: jest.fn().mockReturnValue(false),
    isOfficialPublicationConfirmed: jest.fn().mockReturnValue(false),
    getCreateLeadHours: jest.fn().mockReturnValue(12),
    getOfficialPublicationLeadHours: jest.fn().mockReturnValue(6),
  };
  const issuer = { getDidsByDnis: jest.fn().mockResolvedValue([]), issueCredential: jest.fn() };
  const service = new PadronService(
    models.version as never, models.entry as never, models.comparison as never,
    models.job as never, models.staging as never, models.certificate as never,
    models.user as never, models.session as never, access as never, { buildPdf: jest.fn(() => Buffer.from('%PDF-1.4\n')) } as never,
    { validateSourceFile: jest.fn(), getSourceType: jest.fn(), parseDocument: jest.fn() } as never,
    { analyzeDocument: jest.fn() } as never, { notifyConvocationIfEligible: jest.fn(), notifyPadronAvailabilityEnabledForUser: jest.fn() } as never,
    issuer as never, { addNewVoters: jest.fn() } as never,
  );
  return { service, event, models, access, issuer, requester: { sub: new Types.ObjectId().toString(), role: 'ADMIN' } };
}

describe('MX-05 Backend Results — unitarias focales de padrón', () => {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'app.ai.gemini.apiKey') return 'gemini-only-test-key';
      if (key === 'app.ai.gemini.model') return 'gemini-test';
      return undefined;
    }),
  };
  const http = { axiosRef: { post: jest.fn() } };
  const parser = () => new PadronPdfParserService(config as never, http as never);
  const gemini = () => new PadronGeminiImportService(config as never, http as never);
  const pdf = (text: string) => ({
    originalname: 'padron.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n${text}\n`, 'utf8'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('[MX-05][PAD-FIL-P0-001][UNITARIA] rechaza ausencia, extensión no permitida y firmas incompatibles antes de analizar', () => {
    const service = parser();
    expect(() => service.validateSourceFile({ originalname: 'padron.pdf', mimetype: 'application/pdf', buffer: Buffer.alloc(0) })).toThrow(BadRequestException);
    expect(() => service.validateSourceFile({ originalname: 'padron.txt', mimetype: 'text/plain', buffer: Buffer.from('123456 si') })).toThrow(BadRequestException);
    expect(() => service.validateSourceFile({ originalname: 'padron.png', mimetype: 'image/png', buffer: Buffer.from('not-a-png') })).toThrow(BadRequestException);
    expect(http.axiosRef.post).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-EXT-P1-001][UNITARIA] mantiene la key en backend y normaliza la respuesta Gemini simulada', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ records: [{ carnet: '123.456', habilitado: true }], observations: [] }) }] } }] } });
    const result = await gemini().analyzeDocument({ ...pdf('123456 si'), size: 20 });
    expect(http.axiosRef.post).toHaveBeenCalledWith(expect.not.stringContaining('gemini-only-test-key'), expect.any(Object), expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-only-test-key' }) }));
    expect(result.records).toEqual([expect.objectContaining({ carnet: '123456', enabled: true })]);
  });

  it('[MX-05][PAD-PRC-P0-002][UNITARIA] produce filas procesables y resumen determinístico sin usar Gemini para PDF claro', async () => {
    const result = await parser().parseDocument(pdf('carnet habilitado\n123456 si\n789000 no'));
    expect(result.rows).toEqual([{ ci: '123456', enabled: true, sourceRow: 2 }, { ci: '789000', enabled: false, sourceRow: 3 }]);
    expect(result.errors).toEqual([]);
    expect(result.provider).toBe('deterministic-text');
    expect(http.axiosRef.post).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-ROW-P0-002][UNITARIA] conserva explícitamente la habilitación extraída por cada identidad', async () => {
    const result = await parser().parseDocument(pdf('123456 si\n789000 no'));
    expect(result.rows.map((row) => [row.ci, row.enabled])).toEqual([['123456', true], ['789000', false]]);
  });

  it('[MX-05][PAD-NRM-P0-001][UNITARIA] normaliza antes de persistir y rechaza carnet inválido', () => {
    expect(normalizeCarnet(' 123.456 ')).toBe('123456');
    expect(normalizeCarnet(' ab - 123 ')).toBe('AB123');
    expect(normalizeCarnet('ABCDEF')).toBe('');
    expect(normalizeCarnet('@@@')).toBe('');
    expect(normalizeCarnet('AB12')).toBe('');
    expect(normalizeCarnet(`A${'1'.repeat(20)}`)).toBe('');
  });

  it('[MX-05][PAD-VAL-P0-001][UNITARIA] conserva fila, código y valor crudo de observaciones de extracción', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ rows: [{ ci: '123456', enabled: true, sourceRow: 7 }], errors: [{ code: 'INVALID_CI', message: 'CI ilegible', rowIndex: 8, rawValue: '---' }] }) }] } }] } });
    const result = await parser().parseDocument(pdf('obj\nendobj\nstream\nendstream'));
    expect(result.rows).toEqual([expect.objectContaining({ ci: '123456', sourceRow: 7 })]);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'INVALID_CI', rowIndex: 8, rawValue: '---' })]);
  });

  it('[MX-05][PAD-DUP-P0-001][UNITARIA] elimina el segundo carnet normalizado y lo informa como observación', async () => {
    http.axiosRef.post.mockResolvedValue({ data: { candidates: [{ content: { parts: [{ text: JSON.stringify({ records: [{ carnet: '123.456', habilitado: true }, { carnet: '123456', habilitado: false }], observations: [] }) }] } }] } });
    const result = await gemini().analyzeDocument({ ...pdf('ambiguous'), size: 20 });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ carnet: '123456', enabled: true });
    expect(result.observations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DUPLICATE_CARNET' })]));
  });

  it('[MX-05][PAD-DEL-P0-001][UNITARIA] rechaza el borrado masivo que dejaría vacío el staging activo', async () => {
    const h = createPadronHarness();
    const importJobId = new Types.ObjectId();
    const entryId = new Types.ObjectId();
    h.models.job.findOne.mockReturnValue(sortedLean({ _id: importJobId, eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true }));
    h.models.staging.find.mockReturnValue(lean([{ _id: entryId }]));
    h.models.staging.countDocuments.mockResolvedValue(1);

    await expect(h.service.bulkDeletePadronStagingEntries(String(h.event._id), { entryIds: [String(entryId)] }, h.requester)).rejects.toThrow('No se puede eliminar todos los registros del padrón.');

    expect(h.models.staging.find).toHaveBeenCalledWith({ _id: { $in: [entryId] }, importJobId }, { _id: 1 });
    expect(h.models.staging.deleteMany).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-CFM-P0-001][UNITARIA] rechaza confirmar un staging sin filas válidas antes de crear la versión vigente', async () => {
    const h = createPadronHarness();
    const importJobId = new Types.ObjectId();
    const importJob = { _id: importJobId, eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true, importErrors: [] };
    h.models.job.findOne.mockReturnValue(sortedLean(importJob));
    h.models.job.findById.mockReturnValue(lean(importJob));
    h.models.staging.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]), sort: jest.fn().mockReturnValue(lean([])) });

    await expect(h.service.confirmPadronStaging(String(h.event._id), h.requester)).rejects.toThrow('No se puede materializar un staging vacío');

    expect(h.models.job.updateOne).toHaveBeenCalledWith({ _id: importJobId }, expect.objectContaining({ $set: expect.objectContaining({ status: 'FAILED' }) }));
    expect(h.models.version.create).not.toHaveBeenCalled();
    expect(h.models.certificate.create).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-CSV-P1-001][UNITARIA] importa CSV legacy sin columna de habilitación como versión vigente habilitada', async () => {
    const h = createPadronHarness();
    const versionId = new Types.ObjectId();
    h.models.version.create.mockResolvedValue({
      _id: versionId,
      eventId: h.event._id,
      tenantId: h.event.tenantId,
      createdBy: new Types.ObjectId(h.requester.sub),
      fileDigest: 'digest',
      totals: { validCount: 2, duplicateCount: 0, invalidCount: 0 },
      isCurrent: true,
      sourceType: 'CSV_LEGACY',
    });
    h.models.certificate.findOne.mockResolvedValue({
      _id: new Types.ObjectId(), eventId: h.event._id, tenantId: h.event.tenantId,
      padronVersionId: versionId, generatedAt: new Date(), generationMode: 'ON_CONFIRMATION',
      fileName: 'constancia.pdf', mimeType: 'application/pdf', fileSha256: 'sha', fileSize: 1,
      sourceType: 'CSV_LEGACY', totalCount: 2, enabledCount: 2, disabledCount: 0, storageKind: 'INLINE_BASE64',
    });

    const result = await h.service.importPadron(String(h.event._id), 'carnet\n123.456\nAB-789\n', h.requester);

    expect(h.models.version.updateMany).toHaveBeenCalledWith({ eventId: h.event._id, isCurrent: true }, { $set: { isCurrent: false } });
    expect(h.models.entry.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ padronVersionId: versionId, carnetNorm: '123456', enabled: true }),
      expect.objectContaining({ padronVersionId: versionId, carnetNorm: 'AB789', enabled: true }),
    ], { ordered: false });
    expect(result).toMatchObject({ padronVersionId: String(versionId), sourceType: 'CSV_LEGACY', totals: { validCount: 2, duplicateCount: 0, invalidCount: 0 } });
  });

  it('[MX-05][PAD-PER-P0-001][UNITARIA] corta una escritura de padrón cuando el control institucional global rechaza al solicitante', async () => {
    const h = createPadronHarness();
    const requester = { sub: new Types.ObjectId().toString(), role: 'GOVERNOR' };
    h.access.assertGlobalAdminAccess.mockImplementation(() => {
      throw new ForbiddenException('Solo un administrador global puede aprobar o rechazar el padrón');
    });

    await expect(h.service.updateComparisonReportStatus(String(h.event._id), 'OK', requester, String(new Types.ObjectId()))).rejects.toThrow(ForbiddenException);

    expect(h.access.assertGlobalAdminAccess).toHaveBeenCalledWith(requester, 'aprobar o rechazar el padrón');
    expect(h.access.getEventOrThrow).not.toHaveBeenCalled();
    expect(h.models.comparison.updateOne).not.toHaveBeenCalled();
  });

});
