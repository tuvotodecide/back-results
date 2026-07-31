import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';

const chain = (value: unknown) => ({
  sort: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  }),
  lean: jest.fn().mockResolvedValue(value),
});

type VotingEventsPublicService = Pick<
  VotingEventsService,
  'getPublicLanding' | 'getPublicEventDetail'
>;

describe('MX-13 public voting landing and detail (unit)', () => {
  let service: VotingEventsPublicService;
  let votingEventModel: { find: jest.Mock };
  let eventRoleModel: { find: jest.Mock };
  let votingOptionModel: { find: jest.Mock };
  let padronVersionModel: { find: jest.Mock };
  let padronEntryModel: { find: jest.Mock };
  let comparisonReportModel: { find: jest.Mock };
  let accessService: { getEventOrThrow: jest.Mock; hasPublicationWindowExpired: jest.Mock };
  let voteReaderService: { getResults: jest.Mock };

  const createService = () =>
    new (VotingEventsService as unknown as new (...args: unknown[]) => VotingEventsService)(
      votingEventModel,
      eventRoleModel,
      votingOptionModel,
      padronVersionModel,
      padronEntryModel,
      { findOne: jest.fn(), find: jest.fn() },
      { find: jest.fn() },
      comparisonReportModel,
      { deleteMany: jest.fn() },
      { deleteMany: jest.fn(), updateMany: jest.fn() },
      { deleteMany: jest.fn() },
      { insertMany: jest.fn(), findOne: jest.fn() },
      accessService,
      {
        notifyConvocationIfEligible: jest.fn(),
        notifyOfficialPublicationConfirmed: jest.fn(),
        notifyVotingCancelledToCurrentPadron: jest.fn(),
        notifyNewsToCurrentPadron: jest.fn(),
        notifyScheduleUpdatedToCurrentPadron: jest.fn(),
      },
      voteReaderService,
      { createVote: jest.fn(), updateVoteSchedule: jest.fn() },
      { getPadronUsersFromEvent: jest.fn() },
      { issueCredential: jest.fn(), getDidsByDnis: jest.fn() },
      { materializeActiveDraftVersion: jest.fn() },
      { validateVotePublicationPreflight: jest.fn() },
      {},
      {},
    );

  beforeEach(() => {
    votingEventModel = { find: jest.fn() };
    eventRoleModel = { find: jest.fn() };
    votingOptionModel = { find: jest.fn() };
    padronVersionModel = { find: jest.fn() };
    padronEntryModel = { find: jest.fn() };
    comparisonReportModel = { find: jest.fn() };
    accessService = {
      getEventOrThrow: jest.fn(),
      hasPublicationWindowExpired: jest.fn().mockReturnValue(false),
    };
    voteReaderService = { getResults: jest.fn() };
    service = createService();
  });

  it('[PUB-LST-P0-002][PUB-LST-P1-003][PUB-STA-P0-001] clasifica landing publica, limita a 50 y filtra solo estados visibles', async () => {
    const tenantId = new Types.ObjectId();
    const now = Date.now();
    const upcomingId = new Types.ObjectId();
    const activeId = new Types.ObjectId();
    const resultsId = new Types.ObjectId();
    votingEventModel.find.mockReturnValue(
      chain([
        {
          _id: upcomingId,
          tenantId,
          name: 'Próxima',
          objective: 'Convocatoria',
          state: 'READY_FOR_REVIEW',
          publishDeadline: new Date(now + 60_000),
          votingStart: new Date(now + 3_600_000),
          votingEnd: new Date(now + 7_200_000),
          resultsPublishAt: new Date(now + 8_200_000),
        },
        {
          _id: activeId,
          tenantId,
          name: 'Activa',
          objective: 'Jornada',
          state: 'PUBLISHED',
          votingStart: new Date(now - 60_000),
          votingEnd: new Date(now + 60_000),
          resultsPublishAt: new Date(now + 120_000),
          publicEligibilityEnabled: true,
        },
        {
          _id: resultsId,
          tenantId,
          name: 'Resultados',
          objective: 'Publicada',
          state: 'RESULTS_PUBLISHED',
          votingStart: new Date(now - 7_200_000),
          votingEnd: new Date(now - 3_600_000),
          resultsPublishAt: new Date(now - 60_000),
        },
      ]),
    );

    const result = await service.getPublicLanding(undefined, 99);

    const query = votingEventModel.find.mock.calls[0][0];
    expect(query).toMatchObject({
      $or: [
        { state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'] } },
        { state: 'READY_FOR_REVIEW', publishDeadline: expect.objectContaining({ $gt: expect.any(Date) }) },
      ],
    });
    expect(result.upcoming).toEqual([expect.objectContaining({ id: String(upcomingId), phase: 'UPCOMING' })]);
    expect(result.active).toEqual([expect.objectContaining({ id: String(activeId), phase: 'ACTIVE' })]);
    expect(result.results).toEqual([expect.objectContaining({ id: String(resultsId), phase: 'RESULTS' })]);
    expect(result.totals).toEqual({ upcoming: 1, active: 1, results: 1 });
  });

  it('[PUB-LST-P0-002][PUB-SEC-P0-001] filtra landing por carnet vigente aprobado y rechaza carnet invalido', async () => {
    const tenantId = new Types.ObjectId();
    const allowedEventId = new Types.ObjectId();
    const hiddenEventId = new Types.ObjectId();
    const allowedVersionId = new Types.ObjectId();
    const hiddenVersionId = new Types.ObjectId();

    votingEventModel.find.mockReturnValue(
      chain([
        {
          _id: allowedEventId,
          tenantId,
          name: 'Visible',
          objective: 'Empadronado',
          state: 'PUBLISHED',
          publicEligibilityEnabled: true,
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
        {
          _id: hiddenEventId,
          tenantId,
          name: 'Oculta',
          objective: 'No empadronado',
          state: 'PUBLISHED',
          publicEligibilityEnabled: true,
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60_000),
          resultsPublishAt: new Date(Date.now() + 120_000),
        },
      ]),
    );
    padronVersionModel.find.mockReturnValue(
      chain([
        { _id: allowedVersionId, eventId: allowedEventId },
        { _id: hiddenVersionId, eventId: hiddenEventId },
      ]),
    );
    comparisonReportModel.find.mockReturnValue(
      chain([{ padronVersionId: allowedVersionId }, { padronVersionId: hiddenVersionId }]),
    );
    padronEntryModel.find.mockReturnValue(chain([{ padronVersionId: allowedVersionId }]));

    const result = await service.getPublicLanding(undefined, 10, 'abc-123');

    expect(result.active).toEqual([expect.objectContaining({ id: String(allowedEventId), name: 'Visible' })]);
    expect(padronEntryModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        carnetNorm: 'ABC123',
        padronVersionId: { $in: [allowedVersionId, hiddenVersionId] },
      }),
      { padronVersionId: 1 },
    );

    await expect(service.getPublicLanding(undefined, 10, '...')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('[PUB-ACC-P0-002][PUB-INF-P0-001][PUB-INF-P0-002][PUB-STA-P1-002] devuelve detalle publico controlado y excluye opciones inactivas', async () => {
    const eventId = new Types.ObjectId();
    const tenantId = new Types.ObjectId();
    accessService.getEventOrThrow.mockResolvedValue({
      _id: eventId,
      tenantId,
      state: 'PUBLISHED',
      name: 'Elección pública',
      objective: 'Elegir representación',
      isReferendum: false,
      publicEligibilityEnabled: true,
      votingStart: new Date(Date.now() - 60_000),
      votingEnd: new Date(Date.now() + 60_000),
      resultsPublishAt: new Date(Date.now() + 120_000),
    });
    eventRoleModel.find.mockReturnValue(
      chain([{ _id: new Types.ObjectId(), name: 'Alcalde', maxWinners: 1 }]),
    );
    votingOptionModel.find.mockReturnValue(
      chain([
        {
          _id: new Types.ObjectId(),
          eventId,
          name: 'Frente Azul',
          color: '#2563eb',
          candidates: [{ name: 'Ana', roleName: 'Alcalde' }],
          active: true,
        },
      ]),
    );

    const result = await service.getPublicEventDetail(String(eventId));

    expect(votingOptionModel.find).toHaveBeenCalledWith({
      eventId,
      active: { $ne: false },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: String(eventId),
        tenantId: String(tenantId),
        name: 'Elección pública',
        phase: 'ACTIVE',
        resultsAvailable: false,
        results: [],
        publicEligibilityEnabled: true,
      }),
    );
    expect(result.roles).toEqual([expect.objectContaining({ name: 'Alcalde', maxWinners: 1 })]);
    expect(result.options).toEqual([expect.objectContaining({ name: 'Frente Azul' })]);
    expect(JSON.stringify(result)).not.toContain('wallet');
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it('[PUB-ACC-P0-002][PUB-CNS-P0-001][PUB-RES-P0-001] rechaza borrador o expirado y lee votos solo cuando resultsPublishAt fue alcanzado', async () => {
    const eventId = new Types.ObjectId();
    accessService.getEventOrThrow.mockResolvedValueOnce({
      _id: eventId,
      state: 'DRAFT',
    });

    await expect(service.getPublicEventDetail(String(eventId))).rejects.toBeInstanceOf(
      NotFoundException,
    );

    accessService.getEventOrThrow.mockResolvedValueOnce({
      _id: eventId,
      tenantId: new Types.ObjectId(),
      state: 'RESULTS_PUBLISHED',
      name: 'Con resultados',
      objective: 'Publicada',
      isReferendum: true,
      votingStart: new Date(Date.now() - 7_200_000),
      votingEnd: new Date(Date.now() - 3_600_000),
      resultsPublishAt: new Date(Date.now() - 60_000),
    });
    eventRoleModel.find.mockReturnValue(chain([]));
    votingOptionModel.find.mockReturnValue(chain([]));
    voteReaderService.getResults.mockResolvedValue([{ option: 'SI', votes: 10 }]);

    const result = await service.getPublicEventDetail(String(eventId));

    expect(result.phase).toBe('RESULTS');
    expect(result.resultsAvailable).toBe(true);
    expect(result.results).toEqual([{ option: 'SI', votes: 10 }]);
  });
});
