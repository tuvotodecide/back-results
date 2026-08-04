import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { InstitutionalTenant } from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import { ParticipationAnalyticsService } from '@/modules/institutional-voting/services/participation/participation-analytics.service';
import { ParticipationReportPdfService } from '@/modules/institutional-voting/services/participation/participation-report-pdf.service';
import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';
import { PadronEntry } from '@/modules/institutional-voting/schemas/padron-entry.schema';
import { PadronVersion } from '@/modules/institutional-voting/schemas/padron-version.schema';
import { Participation } from '@/modules/institutional-voting/schemas/participation.schema';

const SENSITIVE_FIELDS = [
  'candidateId',
  'selectedCandidateId',
  'candidateSelected',
  'optionId',
  'nullifier',
  'proof',
  'vote',
  'votes',
  'ranking',
  'winners',
  'txHash',
  'sessionToken',
  'receipt',
];

describe('ParticipationAnalyticsService (unit)', () => {
  let service: ParticipationAnalyticsService;
  let padronVersionModel: { findOne: jest.Mock };
  let padronEntryModel: { find: jest.Mock };
  let participationModel: { find: jest.Mock };
  let tenantModel: { findById: jest.Mock };
  let reportPdfService: { buildPdf: jest.Mock };
  let accessService: {
    getEventOrThrow: jest.Mock;
    assertTenantWriteAccess: jest.Mock;
  };

  const tenantId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const currentVersionId = new Types.ObjectId();
  const requester = { sub: new Types.ObjectId().toString(), role: 'GOVERNOR' };

  function chainLean<T>(value: T) {
    return { lean: jest.fn().mockResolvedValue(value) };
  }

  function chainSortLean<T>(value: T) {
    return {
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(value),
      }),
    };
  }

  function baseEvent(overrides: Record<string, unknown> = {}) {
    return {
      _id: eventId,
      tenantId,
      name: 'Eleccion de Prueba',
      state: 'PUBLISHED',
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 60_000),
      resultsPublishAt: new Date(Date.now() + 60 * 60_000),
      ...overrides,
    };
  }

  function enabledEntry(carnetNorm: string) {
    return {
      _id: new Types.ObjectId(),
      carnetNorm,
    };
  }

  beforeEach(async () => {
    padronVersionModel = { findOne: jest.fn() };
    padronEntryModel = { find: jest.fn() };
    participationModel = { find: jest.fn() };
    tenantModel = { findById: jest.fn() };
    reportPdfService = { buildPdf: jest.fn(() => Buffer.from('%PDF-1.4\nmock\n')) };
    accessService = {
      getEventOrThrow: jest.fn(),
      assertTenantWriteAccess: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ParticipationAnalyticsService,
        { provide: getModelToken(PadronVersion.name), useValue: padronVersionModel },
        { provide: getModelToken(PadronEntry.name), useValue: padronEntryModel },
        { provide: getModelToken(Participation.name), useValue: participationModel },
        { provide: getModelToken(InstitutionalTenant.name), useValue: tenantModel },
        { provide: InstitutionalVotingAccessService, useValue: accessService },
        { provide: ParticipationReportPdfService, useValue: reportPdfService },
      ],
    }).compile();

    service = moduleRef.get(ParticipationAnalyticsService);

    accessService.getEventOrThrow.mockResolvedValue(baseEvent());
    tenantModel.findById.mockReturnValue(chainLean({ name: 'Institucion QA' }));
    padronVersionModel.findOne.mockReturnValue(chainLean({ _id: currentVersionId }));
    padronEntryModel.find.mockReturnValue(
      chainSortLean([
        enabledEntry('A1'),
        enabledEntry('A2'),
        enabledEntry('A3'),
        enabledEntry('A4'),
      ]),
    );
    participationModel.find.mockReturnValue(
      chainLean([{ carnetNorm: 'A1' }, { carnetNorm: 'A2' }]),
    );
  });

  it('calcula totalEnabled desde el padrón vigente habilitado', async () => {
    const result = await service.getAnalytics(String(eventId), requester);

    expect(padronVersionModel.findOne).toHaveBeenCalledWith(
      { eventId, isCurrent: true },
      { _id: 1 },
    );
    expect(padronEntryModel.find).toHaveBeenCalledWith(
      { padronVersionId: currentVersionId, enabled: { $ne: false } },
      { _id: 1, carnetNorm: 1 },
    );
    expect(result.totalEnabled).toBe(4);
  });

  it('calcula totalParticipated desde participaciones confirmadas cruzadas contra habilitados', async () => {
    const result = await service.getAnalytics(String(eventId), requester);

    expect(participationModel.find).toHaveBeenCalledWith(
      { eventId },
      { carnetNorm: 1 },
    );
    expect(result.totalParticipated).toBe(2);
  });

  it('lista el padrón habilitado con el estado de participación paginado', async () => {
    const entries = [enabledEntry('A2'), enabledEntry('A3')];
    const lean = jest.fn().mockResolvedValue(entries);
    const limit = jest.fn().mockReturnValue({ lean });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    padronEntryModel.find.mockReturnValueOnce({ sort });
    (padronEntryModel as any).countDocuments = jest.fn().mockResolvedValue(4);
    participationModel.find.mockReturnValueOnce(chainLean([{ carnetNorm: 'A2' }]));

    const result = await service.getParticipationList(String(eventId), requester, 2, 2);

    expect(result).toEqual({
      data: [
        { id: String(entries[0]._id), carnetNorm: 'A2', status: 'PARTICIPATED' },
        { id: String(entries[1]._id), carnetNorm: 'A3', status: 'PENDING' },
      ],
      page: 2,
      limit: 2,
      total: 4,
      totalPages: 2,
      padronVersionId: String(currentVersionId),
    });
    expect(participationModel.find).toHaveBeenCalledWith(
      { eventId, carnetNorm: { $in: ['A2', 'A3'] } },
      { carnetNorm: 1 },
    );
  });

  it('calcula totalPending', async () => {
    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.totalPending).toBe(2);
  });

  it('calcula participationPercentage y redondea a 1 decimal', async () => {
    padronEntryModel.find.mockReturnValue(
      chainSortLean(Array.from({ length: 41 }, (_, index) => enabledEntry(`A${index + 1}`))),
    );
    participationModel.find.mockReturnValue(
      chainLean(Array.from({ length: 30 }, (_, index) => ({ carnetNorm: `A${index + 1}` }))),
    );

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.participationPercentage).toBe(73.2);
  });

  it('devuelve porcentaje 0 cuando totalEnabled es 0', async () => {
    padronEntryModel.find.mockReturnValue(chainSortLean([]));
    participationModel.find.mockReturnValue(chainLean([{ carnetNorm: 'A1' }]));

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result).toEqual(
      expect.objectContaining({
        totalEnabled: 0,
        totalParticipated: 0,
        totalPending: 0,
        participationPercentage: 0,
      }),
    );
  });

  it('devuelve 100% cuando todos participaron', async () => {
    participationModel.find.mockReturnValue(
      chainLean([
        { carnetNorm: 'A1' },
        { carnetNorm: 'A2' },
        { carnetNorm: 'A3' },
        { carnetNorm: 'A4' },
      ]),
    );

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.totalPending).toBe(0);
    expect(result.participationPercentage).toBe(100);
  });

  it('devuelve 0% cuando nadie participó', async () => {
    participationModel.find.mockReturnValue(chainLean([]));

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.totalParticipated).toBe(0);
    expect(result.participationPercentage).toBe(0);
  });

  it('ignora participaciones duplicadas', async () => {
    participationModel.find.mockReturnValue(
      chainLean([
        { carnetNorm: 'A1' },
        { carnetNorm: 'A1' },
        { carnetNorm: 'A2' },
      ]),
    );

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.totalParticipated).toBe(2);
  });

  it('excluye participantes no habilitados', async () => {
    participationModel.find.mockReturnValue(
      chainLean([{ carnetNorm: 'A1' }, { carnetNorm: 'NO_HABILITADO' }]),
    );

    const result = await service.getAnalytics(String(eventId), requester);

    expect(result.totalParticipated).toBe(1);
  });

  it('responde controladamente cuando no hay padrón vigente', async () => {
    padronVersionModel.findOne.mockReturnValue(chainLean(null));

    const result = await service.getAnalytics(String(eventId), requester);

    expect(padronEntryModel.find).not.toHaveBeenCalled();
    expect(participationModel.find).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        totalEnabled: 0,
        totalParticipated: 0,
        totalPending: 0,
        participationPercentage: 0,
      }),
    );
  });

  it('publishedAt solo aparece cuando los resultados están disponibles', async () => {
    const publishAt = new Date(Date.now() - 60_000);
    accessService.getEventOrThrow.mockResolvedValueOnce(
      baseEvent({
        state: 'RESULTS_PUBLISHED',
        votingStart: new Date(Date.now() - 3 * 60_000),
        votingEnd: new Date(Date.now() - 2 * 60_000),
        resultsPublishAt: publishAt,
      }),
    );

    const published = await service.getAnalytics(String(eventId), requester);
    expect(published.status).toBe('RESULTS_PUBLISHED');
    expect(published.publishedAt).toBe(publishAt.toISOString());

    accessService.getEventOrThrow.mockResolvedValueOnce(
      baseEvent({ resultsPublishAt: new Date(Date.now() + 60_000) }),
    );
    const notPublished = await service.getAnalytics(String(eventId), requester);
    expect(notPublished.publishedAt).toBeNull();
  });

  it('no incluye datos sensibles en analytics', async () => {
    const result = await service.getAnalytics(String(eventId), requester);
    const serialized = JSON.stringify(result);

    SENSITIVE_FIELDS.forEach((field) => {
      expect(result).not.toHaveProperty(field);
      expect(serialized).not.toContain(field);
    });
    expect(result).not.toHaveProperty('participants');
    expect(result).not.toHaveProperty('pending');
  });

  it('no consulta servicios de resultados, votos ni ballots', () => {
    expect((service as any).votingResultsService).toBeUndefined();
    expect((service as any).voteReaderService).toBeUndefined();
    expect((service as any).voteWritterService).toBeUndefined();
    expect((service as any).ballotModel).toBeUndefined();
    expect((service as any).worksheetModel).toBeUndefined();
    expect((service as any).attestationModel).toBeUndefined();
  });
});
