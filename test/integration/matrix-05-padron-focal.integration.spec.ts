import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PadronService } from '@/modules/institutional-voting/services/padron/padron.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortedLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue(lean(value)) };
}

function createHarness() {
  const event = {
    _id: new Types.ObjectId(), tenantId: new Types.ObjectId(), state: 'DRAFT',
    publicEligibilityEnabled: true, save: jest.fn(),
  };
  const models = {
    version: { findOne: jest.fn(), find: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    entry: { findOne: jest.fn(), find: jest.fn(), insertMany: jest.fn(), countDocuments: jest.fn() },
    comparison: { exists: jest.fn(), findOne: jest.fn(), updateOne: jest.fn() },
    job: { findOne: jest.fn(), findById: jest.fn(), create: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() },
    staging: { find: jest.fn(), findOne: jest.fn(), exists: jest.fn(), create: jest.fn(), insertMany: jest.fn(), countDocuments: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn(), findOneAndDelete: jest.fn(), deleteMany: jest.fn() },
    certificate: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn(), findById: jest.fn(), deleteMany: jest.fn() },
    user: { find: jest.fn().mockReturnValue(lean([])) },
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
    getCreateLeadHours: jest.fn().mockReturnValue(1),
    getOfficialPublicationLeadHours: jest.fn().mockReturnValue(0),
  };
  const issuer = { getDidsByDnis: jest.fn().mockResolvedValue([]), issueCredential: jest.fn() };
  const voteWritter = { addNewVoters: jest.fn() };
  const notifications = { notifyConvocationIfEligible: jest.fn(), notifyPadronAvailabilityEnabledForUser: jest.fn() };
  const service = new PadronService(
    models.version as never, models.entry as never, models.comparison as never,
    models.job as never, models.staging as never, models.certificate as never,
    models.user as never, models.session as never, access as never, { buildPdf: jest.fn(() => Buffer.from('%PDF-1.4\n')) } as never,
    { validateSourceFile: jest.fn(), getSourceType: jest.fn(), parseDocument: jest.fn() } as never,
    { analyzeDocument: jest.fn() } as never, notifications as never,
    issuer as never, voteWritter as never,
  );
  return { service, event, models, access, issuer, voteWritter, notifications, requester: { sub: new Types.ObjectId().toString(), role: 'ADMIN' } };
}

describe('MX-05 Backend Results — integración focal de padrón', () => {
  it('[MX-05][PAD-STG-P0-001][INTEGRACION] conserva el contrato vacío de un único staging cuando no existe draft activo', async () => {
    const h = createHarness();
    h.models.job.findOne.mockReturnValue(sortedLean(null));
    h.models.version.findOne.mockReturnValue(lean(null));

    const result = await h.service.listPadronStaging(String(h.event._id), h.requester);

    expect(result).toMatchObject({ importJob: null, data: [], total: 0, totalPages: 0 });
    expect(result.editingRules).toMatchObject({
      mode: 'FULL',
      dateValidationMinHours: 1,
      officialPublicationCutoffHours: 0,
    });
    expect(h.access.assertTenantWriteAccess).toHaveBeenCalledWith(h.event.tenantId, h.requester);
    expect(h.models.version.create).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-DUP-P0-002][INTEGRACION] rechaza alta de CI normalizado duplicado en el staging real', async () => {
    const h = createHarness();
    const job = { _id: new Types.ObjectId(), eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true };
    h.models.job.findOne.mockReturnValue(sortedLean(job));
    h.models.staging.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(h.service.addPadronStagingEntry(String(h.event._id), { ci: '123.456', enabled: true }, h.requester)).rejects.toThrow(BadRequestException);
    expect(h.models.staging.exists).toHaveBeenCalledWith({ importJobId: job._id, ciNorm: '123456' });
    expect(h.models.staging.create).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-DEL-P0-001][INTEGRACION] elimina seleccionados y conserva al menos una fila del staging', async () => {
    const h = createHarness();
    const job = { _id: new Types.ObjectId(), eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true };
    const first = new Types.ObjectId();
    const second = new Types.ObjectId();
    h.models.job.findOne.mockReturnValue(sortedLean(job));
    h.models.staging.find
      .mockReturnValueOnce(lean([{ _id: first }, { _id: second }]))
      .mockReturnValueOnce(lean([{ _id: new Types.ObjectId(), ciNorm: '999999', enabled: true }]));
    h.models.staging.countDocuments.mockResolvedValue(3);
    h.models.staging.deleteMany.mockResolvedValue({ deletedCount: 2 });
    h.models.job.findById.mockReturnValue(lean({ _id: job._id, importErrors: [], summary: {} }));

    const result = await h.service.bulkDeletePadronStagingEntries(String(h.event._id), { entryIds: [String(first), String(second)] }, h.requester);

    expect(result).toMatchObject({ requestedCount: 2, deletedCount: 2, materialized: false });
    expect(h.models.staging.deleteMany).toHaveBeenCalledWith({ _id: { $in: [first, second] }, importJobId: job._id });
  });

  it('[MX-05][PAD-CFM-P0-001][INTEGRACION] impide materializar un import job fallido como versión vigente', async () => {
    const h = createHarness();
    h.models.job.findOne.mockReturnValue(sortedLean({ _id: new Types.ObjectId(), status: 'FAILED', isActiveDraft: true }));

    await expect(h.service.confirmPadronStaging(String(h.event._id), h.requester)).rejects.toThrow(BadRequestException);
    expect(h.models.version.create).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-ELG-P0-002][INTEGRACION] integra versión vigente, comparación OK y repositorio de entradas para elegibilidad pública', async () => {
    const h = createHarness();
    h.event.state = 'PUBLISHED';
    const versionId = new Types.ObjectId();
    h.models.version.findOne.mockReturnValue(lean({ _id: versionId, isCurrent: true }));
    h.models.comparison.exists.mockResolvedValue(true);
    h.models.entry.findOne.mockReturnValue(lean({ enabled: true }));

    const result = await h.service.checkPublicEligibility(String(h.event._id), '123.456');

    expect(result).toEqual({ status: 'ELIGIBLE', referenceVersion: String(versionId) });
    expect(h.models.entry.findOne).toHaveBeenCalledWith({ padronVersionId: versionId, carnetNorm: '123456' }, { enabled: 1 });
  });

  it('[MX-05][PAD-PER-P0-001][INTEGRACION] corta la consulta antes de tocar repositorios cuando el tenant no está autorizado', async () => {
    const h = createHarness();
    h.access.assertTenantWriteAccess.mockRejectedValue(new ForbiddenException('tenant no autorizado'));

    await expect(h.service.getPadronSummary(String(h.event._id), h.requester)).rejects.toThrow(ForbiddenException);
    expect(h.models.version.findOne).not.toHaveBeenCalled();
    expect(h.models.job.findOne).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-STA-P0-003][INTEGRACION] bloquea mutaciones estructurales fuera de la ventana editable', async () => {
    const h = createHarness();
    h.access.canFullyEditEvent.mockReturnValue(false);
    h.event.state = 'OFFICIALLY_PUBLISHED';

    await expect(h.service.addPadronStagingEntry(String(h.event._id), { ci: '123456', enabled: true }, h.requester)).rejects.toThrow(BadRequestException);
    expect(h.models.staging.create).not.toHaveBeenCalled();
  });

  it('[MX-05][PAD-STA-P0-001][INTEGRACION] permite una mutación estructural del staging durante la ventana FULL y recalcula su resumen', async () => {
    const h = createHarness();
    const importJobId = new Types.ObjectId();
    const importJob = { _id: importJobId, eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true, importErrors: [] };
    const createdId = new Types.ObjectId();
    const created = {
      _id: createdId, importJobId, eventId: h.event._id, tenantId: h.event.tenantId,
      ciNorm: '123456', enabled: true, sourceKind: 'MANUAL',
      toObject: () => ({ _id: createdId, importJobId, eventId: h.event._id, tenantId: h.event.tenantId, ciNorm: '123456', enabled: true, sourceKind: 'MANUAL' }),
    };
    h.models.job.findOne.mockReturnValue(sortedLean(importJob));
    h.models.staging.exists.mockResolvedValue(false);
    h.models.staging.create.mockResolvedValue(created);
    h.models.job.findById.mockReturnValue(lean(importJob));
    h.models.staging.find.mockReturnValue(lean([{ _id: created._id, ciNorm: '123456', enabled: true }]));
    h.issuer.getDidsByDnis.mockResolvedValue([{ dni: '123456' }]);

    const result = await h.service.addPadronStagingEntry(String(h.event._id), { ci: '123.456', enabled: true }, h.requester);

    expect(h.access.canFullyEditEvent).toHaveBeenCalledWith(h.event);
    expect(h.models.staging.create).toHaveBeenCalledWith(expect.objectContaining({ importJobId, ciNorm: '123456', enabled: true, sourceKind: 'MANUAL' }));
    expect(h.models.job.updateOne).toHaveBeenCalledWith({ _id: importJobId }, expect.objectContaining({ $set: expect.objectContaining({ status: 'PARSED', summary: expect.objectContaining({ stagingCount: 1, enabledCount: 1 }) }) }));
    expect(result).toMatchObject({ id: String(created._id), ci: '123456', enabled: true, sourceKind: 'MANUAL' });
  });

  it('[MX-05][PAD-STA-P1-002][INTEGRACION] habilita un votante vigente en modo limitado y rechaza crear uno nuevo', async () => {
    const h = createHarness();
    const event = { ...h.event, state: 'OFFICIALLY_PUBLISHED', publicationConfirmed: true, allowPostPublicationPadronEnable: true };
    const versionId = new Types.ObjectId();
    const voterId = new Types.ObjectId();
    const voter = { _id: voterId, carnetNorm: '123456', enabled: false, save: jest.fn().mockResolvedValue(undefined) };
    h.access.getEventOrThrow.mockResolvedValue(event);
    h.access.canFullyEditEvent.mockReturnValue(false);
    h.access.canModifyPadronDuringVoting.mockReturnValue(true);
    h.access.canEnableExistingPadronEntriesPostPublication.mockReturnValue(true);
    h.models.version.findOne.mockResolvedValue({ _id: versionId, isCurrent: true });
    h.models.entry.findOne.mockResolvedValue(voter);
    h.issuer.getDidsByDnis.mockResolvedValue([{ dni: '123456' }]);
    h.issuer.issueCredential.mockResolvedValue({ '123456': { credentialData: 'session-token' } });
    h.voteWritter.addNewVoters.mockResolvedValue(['nullifier']);

    const enabled = await h.service.enableCurrentPadronVoter(String(event._id), String(voterId), h.requester);
    await expect(h.service.addCurrentPadronVoter(String(event._id), { carnet: 'NEW-999', enabled: true }, h.requester)).rejects.toThrow('Después de la publicación oficial no se permite agregar nuevos votantes al padrón vigente');

    expect(enabled).toEqual({ id: String(voterId), padronVersionId: String(versionId), carnetNorm: '123456', enabled: true, mode: 'VOTING_LIMITED' });
    expect(voter.save).toHaveBeenCalledTimes(1);
    expect(h.models.session.insertOne).toHaveBeenCalledWith(expect.objectContaining({ eventId: event._id, dni: '123456', sessionToken: 'session-token' }));
    expect(h.models.certificate.deleteMany).toHaveBeenCalledWith({ padronVersionId: versionId });
    expect(h.notifications.notifyPadronAvailabilityEnabledForUser).toHaveBeenCalledWith(event, '123456', 'ENABLED_DURING_VOTING');
  });

  it('[MX-05][PAD-CON-P1-001][INTEGRACION] serializa confirmaciones concurrentes y materializa una sola versión vigente', async () => {
    const h = createHarness();
    const importJobId = new Types.ObjectId();
    const versionId = new Types.ObjectId();
    const importJob = {
      _id: importJobId, eventId: h.event._id, tenantId: h.event.tenantId, status: 'PARSED', isActiveDraft: true,
      sourceType: 'PDF', originalFileName: 'padron.pdf', originalFileMimeType: 'application/pdf', originalFileSha256: 'sha', parserProvider: 'test', parserModel: null, importErrors: [],
    };
    let activeDraft = true;
    const remaining = { _id: new Types.ObjectId(), ciNorm: '123456', enabled: true };
    h.models.job.findOne.mockImplementation(() => sortedLean(activeDraft ? importJob : null));
    h.models.job.findById.mockReturnValue(lean(importJob));
    h.models.job.updateOne.mockImplementation(async (_filter: unknown, update: any) => {
      if (update?.$set?.isActiveDraft === false) activeDraft = false;
      return { acknowledged: true };
    });
    h.models.staging.find.mockImplementation((_filter: unknown, projection?: unknown) => projection ? lean([remaining]) : sortedLean([remaining]));
    h.issuer.getDidsByDnis.mockResolvedValue([{ dni: '123456' }]);
    h.models.version.findOne.mockReturnValue(lean(null));
    h.models.version.create.mockResolvedValue({ _id: versionId, sourceType: 'PDF_IMPORT', totals: { validCount: 1, duplicateCount: 0, invalidCount: 0 } });
    h.models.certificate.findOne.mockResolvedValue(null);
    h.models.entry.find.mockReturnValue(sortedLean([{ carnetNorm: '123456', enabled: true }]));
    h.models.certificate.create.mockResolvedValue({
      _id: new Types.ObjectId(), eventId: h.event._id, tenantId: h.event.tenantId, padronVersionId: versionId,
      generatedAt: new Date(), generationMode: 'ON_CONFIRMATION', fileName: 'constancia.pdf', mimeType: 'application/pdf', fileSha256: 'sha', fileSize: 1,
      sourceType: 'PDF_IMPORT', totalCount: 1, enabledCount: 1, disabledCount: 0, storageKind: 'INLINE_BASE64',
    });

    const results = await Promise.allSettled([
      h.service.confirmPadronStaging(String(h.event._id), h.requester),
      h.service.confirmPadronStaging(String(h.event._id), h.requester),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.models.version.updateMany).toHaveBeenCalledTimes(1);
    expect(h.models.version.create).toHaveBeenCalledTimes(1);
    expect(h.models.entry.insertMany).toHaveBeenCalledWith([expect.objectContaining({ padronVersionId: versionId, carnetNorm: '123456', enabled: true })], { ordered: false });
    expect(h.models.job.updateOne).toHaveBeenCalledWith({ _id: importJobId }, expect.objectContaining({ $set: expect.objectContaining({ confirmedPadronVersionId: versionId, status: 'CONFIRMED', isActiveDraft: false }) }));
  });
});
