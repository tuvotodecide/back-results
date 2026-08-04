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
    certificate: { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() },
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
  const service = new PadronService(
    models.version as never, models.entry as never, models.comparison as never,
    models.job as never, models.staging as never, models.certificate as never,
    models.session as never, access as never, { buildPdf: jest.fn() } as never,
    { validateSourceFile: jest.fn(), getSourceType: jest.fn(), parseDocument: jest.fn() } as never,
    { analyzeDocument: jest.fn() } as never, { notifyConvocationIfEligible: jest.fn(), notifyPadronAvailabilityEnabledForUser: jest.fn() } as never,
    { getDidsByDnis: jest.fn().mockResolvedValue([]), issueCredential: jest.fn() } as never,
    { addNewVoters: jest.fn() } as never,
  );
  return { service, event, models, access, requester: { sub: new Types.ObjectId().toString(), role: 'ADMIN' } };
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
      dateValidationMinHours: 12,
      officialPublicationCutoffHours: 6,
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
});
