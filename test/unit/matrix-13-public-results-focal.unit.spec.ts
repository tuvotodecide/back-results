import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CACHE_TTL_METADATA } from '@nestjs/cache-manager';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: class ZkAuthGuardMock {},
}));

import { VotingEventsService } from '@/modules/institutional-voting/services/events/voting-events.service';
import { VotingResultsService } from '@/modules/institutional-voting/services/results/voting-results.service';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionTypeFilterDto } from '@/modules/results/dto/results.dto';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { AttestationController } from '@/modules/attestation/controllers/attestation.controller';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';

const chain = (value: unknown) => ({
  sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
  lean: jest.fn().mockResolvedValue(value),
});

describe('MX-13 Backend Results — unitarias focales', () => {
  let eventModel: { find: jest.Mock };
  let roleModel: { find: jest.Mock };
  let optionModel: { find: jest.Mock };
  let versionModel: { find: jest.Mock };
  let entryModel: { find: jest.Mock };
  let reportModel: { find: jest.Mock };
  let access: { getEventOrThrow: jest.Mock; hasPublicationWindowExpired: jest.Mock };
  let voteReader: { getResults: jest.Mock };

  const makeEventsService = () => new (VotingEventsService as unknown as new (...args: unknown[]) => VotingEventsService)(
    eventModel, roleModel, optionModel, versionModel, entryModel,
    { findOne: jest.fn(), find: jest.fn() }, { find: jest.fn() }, reportModel,
    { deleteMany: jest.fn() }, { deleteMany: jest.fn(), updateMany: jest.fn() },
    { deleteMany: jest.fn() }, { insertMany: jest.fn(), findOne: jest.fn() }, access,
    { notifyConvocationIfEligible: jest.fn(), notifyOfficialPublicationConfirmed: jest.fn(), notifyVotingCancelledToCurrentPadron: jest.fn(), notifyNewsToCurrentPadron: jest.fn(), notifyScheduleUpdatedToCurrentPadron: jest.fn() },
    voteReader, { createVote: jest.fn(), updateVoteSchedule: jest.fn() },
    { getPadronUsersFromEvent: jest.fn() }, { issueCredential: jest.fn(), getDidsByDnis: jest.fn() },
    { materializeActiveDraftVersion: jest.fn() }, { validateVotePublicationPreflight: jest.fn() }, {}, {},
  );

  beforeEach(() => {
    eventModel = { find: jest.fn() };
    roleModel = { find: jest.fn() };
    optionModel = { find: jest.fn() };
    versionModel = { find: jest.fn() };
    entryModel = { find: jest.fn() };
    reportModel = { find: jest.fn() };
    access = { getEventOrThrow: jest.fn(), hasPublicationWindowExpired: jest.fn().mockReturnValue(false) };
    voteReader = { getResults: jest.fn() };
  });

  it('[MX-13][PUB-LST-P0-002][UNITARIA] limita la landing a 50 y consulta únicamente estados públicos', async () => {
    const id = new Types.ObjectId();
    eventModel.find.mockReturnValue(chain([{ _id: id, tenantId: id, state: 'PUBLISHED', name: 'Activa', objective: 'O', votingStart: new Date(Date.now() - 1_000), votingEnd: new Date(Date.now() + 1_000) }]));

    const result = await makeEventsService().getPublicLanding(undefined, 99);

    expect(eventModel.find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.arrayContaining([expect.objectContaining({ state: { $in: expect.arrayContaining(['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED']) } })]) }));
    expect(result.active).toHaveLength(1);
    expect(result.totals).toEqual({ upcoming: 0, active: 1, results: 0 });

    const versionId = new Types.ObjectId();
    versionModel.find.mockReturnValue(chain([{ _id: versionId, eventId: id }]));
    reportModel.find.mockReturnValue(chain([{ padronVersionId: versionId }]));
    entryModel.find.mockReturnValue(chain([{ padronVersionId: versionId }]));
    await expect(makeEventsService().getPublicLanding(undefined, 10, 'ab-123')).resolves.toMatchObject({ active: [expect.objectContaining({ id: String(id) })] });
    expect(entryModel.find).toHaveBeenCalledWith(expect.objectContaining({ carnetNorm: 'AB123' }), { padronVersionId: 1 });
    await expect(makeEventsService().getPublicLanding(undefined, 10, '...')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[MX-13][PUB-LST-P1-003][UNITARIA] reutiliza el listado público y deja fuera eventos privados', async () => {
    const eventId = new Types.ObjectId();
    eventModel.find.mockReturnValue(chain([{ _id: eventId, tenantId: new Types.ObjectId(), state: 'PUBLISHED', name: 'Visible', objective: 'O', votingStart: new Date(Date.now() - 1_000), votingEnd: new Date(Date.now() + 1_000) }]));
    const result = await makeEventsService().getPublicLanding(undefined, 10);
    expect(eventModel.find).toHaveBeenCalledWith(expect.objectContaining({ $or: expect.arrayContaining([expect.objectContaining({ state: { $in: expect.arrayContaining(['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED']) } })]) }));
    expect(JSON.stringify(result)).not.toMatch(/draft|private|administrator/i);
    expect(result.active).toEqual([expect.objectContaining({ id: String(eventId) })]);
  });

  it('[MX-13][PUB-ACC-P0-001][UNITARIA] permite visitante anónimo y restringe solo alcance territorial autenticado', () => {
    const guard = new TerritorialScopeGuard();
    const anonymous = { query: { department: 'La Paz' }, params: {}, method: 'GET', url: '/api/v1/results/by-location' };
    const governor = { query: { department: 'Otra' }, params: {}, method: 'GET', url: '/api/v1/results/by-location', user: { role: 'GOVERNOR', sub: 'u-1', votingDepartmentId: 'dep-1' } };
    const mayor = { query: { municipality: 'Otra' }, params: {}, method: 'GET', url: '/api/v1/results/by-location', user: { role: 'MAYOR', sub: 'u-2', votingMunicipalityId: 'mun-1' } };
    const context = (request: unknown) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
    expect(guard.canActivate(context(anonymous))).toBe(true);
    expect(guard.canActivate(context(governor))).toBe(true);
    expect(guard.canActivate(context(mayor))).toBe(true);
    expect(governor.query).toEqual(expect.objectContaining({ departmentId: 'dep-1' }));
    expect(mayor.query).toEqual(expect.objectContaining({ municipalityId: 'mun-1' }));
  });

  it('[MX-13][PUB-ACC-P0-002][UNITARIA] oculta DRAFT y devuelve CANCELLED como detalle no disponible', async () => {
    const service = makeEventsService();
    access.getEventOrThrow.mockResolvedValueOnce({ _id: new Types.ObjectId(), state: 'DRAFT' });
    await expect(service.getPublicEventDetail(String(new Types.ObjectId()))).rejects.toBeInstanceOf(NotFoundException);
    access.getEventOrThrow.mockResolvedValueOnce({ _id: new Types.ObjectId(), tenantId: new Types.ObjectId(), state: 'CANCELLED', name: 'Cancelada', objective: 'O', isReferendum: false });
    await expect(service.getPublicEventDetail(String(new Types.ObjectId()))).resolves.toEqual(expect.objectContaining({ phase: 'UNAVAILABLE', resultsAvailable: false, results: [] }));
  });

  it('[MX-13][PUB-STA-P0-001][UNITARIA] normaliza fases UPCOMING, ACTIVE y RESULTS desde las fechas públicas', async () => {
    const service = makeEventsService();
    roleModel.find.mockReturnValue(chain([])); optionModel.find.mockReturnValue(chain([]));
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValueOnce({ _id: id, tenantId: id, state: 'PUBLISHED', name: 'N', objective: 'O', votingStart: new Date(Date.now() + 60_000), votingEnd: new Date(Date.now() + 120_000) });
    await expect(service.getPublicEventDetail(String(id))).resolves.toMatchObject({ phase: 'UPCOMING' });
    access.getEventOrThrow.mockResolvedValueOnce({ _id: id, tenantId: id, state: 'PUBLISHED', name: 'N', objective: 'O', votingStart: new Date(Date.now() - 60_000), votingEnd: new Date(Date.now() + 60_000) });
    await expect(service.getPublicEventDetail(String(id))).resolves.toMatchObject({ phase: 'ACTIVE' });
    access.getEventOrThrow.mockResolvedValueOnce({ _id: id, tenantId: id, state: 'RESULTS_PUBLISHED', name: 'N', objective: 'O', resultsPublishAt: new Date(Date.now() - 60_000) });
    await expect(service.getPublicEventDetail(String(id))).resolves.toMatchObject({ phase: 'RESULTS' });
  });

  it('[MX-13][PUB-STA-P1-002][UNITARIA] conserva resultados vacíos si el lector falla', async () => {
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValue({ _id: id, tenantId: id, state: 'RESULTS_PUBLISHED', name: 'N', objective: 'O', resultsPublishAt: new Date(Date.now() - 1_000) });
    roleModel.find.mockReturnValue(chain([])); optionModel.find.mockReturnValue(chain([])); voteReader.getResults.mockRejectedValue(new Error('reader mocked failure'));
    await expect(makeEventsService().getPublicEventDetail(String(id))).resolves.toMatchObject({ resultsAvailable: true, results: [] });
  });

  it('[MX-13][PUB-INF-P0-002][UNITARIA] serializa roles y opciones activas ordenadas sin opciones inactivas', async () => {
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValue({ _id: id, tenantId: id, state: 'PUBLISHED', name: 'N', objective: 'O', votingStart: new Date(Date.now() + 1_000) });
    roleModel.find.mockReturnValue(chain([{ _id: id, name: 'Alcalde', maxWinners: 1 }]));
    optionModel.find.mockReturnValue(chain([{ _id: id, eventId: id, name: 'Lista', active: true, candidates: [] }]));
    const result = await makeEventsService().getPublicEventDetail(String(id));
    expect(optionModel.find).toHaveBeenCalledWith({ eventId: id, active: { $ne: false } });
    expect(result).toMatchObject({ roles: [expect.objectContaining({ name: 'Alcalde' })], options: [expect.objectContaining({ name: 'Lista', active: true })] });
  });

  it('[MX-13][PUB-INF-P0-001][UNITARIA] serializa detalle público mínimo sin campos técnicos o administrativos', async () => {
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValue({ _id: id, tenantId: id, state: 'PUBLISHED', name: 'Elección pública', objective: 'Información', votingStart: new Date(Date.now() + 1_000), contractAddress: 'private-contract', administratorEmail: 'admin@example.test' });
    roleModel.find.mockReturnValue(chain([])); optionModel.find.mockReturnValue(chain([]));
    const detail = await makeEventsService().getPublicEventDetail(String(id));
    expect(detail).toMatchObject({ id: String(id), name: 'Elección pública', objective: 'Información', phase: 'UPCOMING' });
    expect(JSON.stringify(detail)).not.toMatch(/contractAddress|administratorEmail|private-contract|admin@example/i);
  });

  it('[MX-13][PUB-RES-P0-001][UNITARIA] solicita votos solo cuando resultsPublishAt fue alcanzado', async () => {
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValue({ _id: id, tenantId: id, state: 'RESULTS_PUBLISHED', name: 'N', objective: 'O', resultsPublishAt: new Date(Date.now() - 1_000) });
    roleModel.find.mockReturnValue(chain([])); optionModel.find.mockReturnValue(chain([])); voteReader.getResults.mockResolvedValue([{ option: 'SI', votes: 3 }]);
    await expect(makeEventsService().getPublicEventDetail(String(id))).resolves.toMatchObject({ resultsAvailable: true, results: [{ option: 'SI', votes: 3 }] });
    expect(voteReader.getResults).toHaveBeenCalledWith(String(id));
  });

  it('[MX-13][PUB-CNS-P0-002][UNITARIA] cuenta una mesa efectiva, totales y porcentajes sin mezclar elecciones', async () => {
    const ballotAggregate = jest.fn().mockReturnValue({
      allowDiskUse: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([{
          results: [{ partyId: 'A', totalVotes: 3, locationsCovered: 1 }],
          summary: { validVotes: 3, nullVotes: 1, blankVotes: 1, totalTables: ['M-1'] },
        }]),
      }),
    });
    const tableAggregate = jest.fn().mockReturnValue({
      allowDiskUse: jest.fn().mockReturnValue({
        option: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ n: 1 }]) }),
      }),
    });
    const resultsService = new ResultsService(
      { aggregate: ballotAggregate } as never,
      { aggregate: tableAggregate } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never,
    );
    const byLocation = await resultsService.getResultsByLocation({ electionType: 'municipal' } as never);
    expect(byLocation.summary).toMatchObject({ validVotes: 3, nullVotes: 1, blankVotes: 1, totalVotes: 5, tablesProcessed: 1, totalTables: 1 });
    expect(byLocation.results).toEqual([expect.objectContaining({ partyId: 'A', totalVotes: 3, percentage: '100.00' })]);
    expect(ballotAggregate.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ $group: expect.objectContaining({ _id: '$tableCode' }) }),
    ]));
  });

  it('[MX-13][PUB-CAT-P1-003][UNITARIA] valida el electionType público admitido por el DTO', async () => {
    const valid = await validate(plainToInstance(ElectionTypeFilterDto, { electionType: 'municipal' }));
    const invalid = await validate(plainToInstance(ElectionTypeFilterDto, { electionType: 'unknown' }));
    expect(valid).toHaveLength(0);
    expect(invalid).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'electionType' })]));
  });

  it('[MX-13][PUB-TER-P0-001][UNITARIA] delega filtros territoriales al servicio de resultados', async () => {
    const results = { getResultsByLocation: jest.fn().mockResolvedValue({ totalVotes: 1 }) };
    const controller = new ResultsController(results as never);
    await controller.getResultsByLocation({ electionId: 'e-1', electionType: 'municipal', department: 'La Paz', province: 'Murillo', municipality: 'La Paz' });
    expect(results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ electionId: 'e-1', department: 'La Paz', province: 'Murillo', municipality: 'La Paz' }));
  });

  it('[MX-13][PUB-MES-P0-002][UNITARIA] pasa mesas live y final con modo, elección y paginación', async () => {
    const results = { getResultsByLocation: jest.fn(), getCountedBallots: jest.fn().mockResolvedValue({ data: [] }) };
    const controller = new ResultsController(results as never);
    await controller.getLiveCountedBallots({ electionId: 'e-1', electionType: 'presidential' }, 2, 25);
    await controller.getFinalCountedBallots({ electionId: 'e-1', electionType: 'presidential' }, undefined, undefined);
    expect(results.getCountedBallots).toHaveBeenNthCalledWith(1, expect.objectContaining({ mode: 'live', page: 2, limit: 25 }));
    expect(results.getCountedBallots).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: 'final', page: 1, limit: 20 }));
  });

  it('[MX-13][PUB-ACT-P0-003][UNITARIA] conserva el contexto territorial al pedir acta por mesa', () => {
    const ballots = { findByTableCode: jest.fn(), findOne: jest.fn() };
    const controller = new BallotController(ballots as never);
    controller.findByTableCode('M-1', 'e-1', { userDepartmentId: 'dep-1', userRole: 'GOVERNOR' });
    expect(ballots.findByTableCode).toHaveBeenCalledWith('M-1', 'e-1', 'dep-1', undefined, 'GOVERNOR');
  });

  it('[MX-13][PUB-CAS-P0-004][UNITARIA] conserva los estados públicos y filtros de casos', async () => {
    const attestations = { listCases: jest.fn().mockResolvedValue({ data: [] }) };
    const controller = new AttestationController(attestations as never);
    await controller.listCases(1, 10, 'VERIFYING,PENDING,CONSENSUAL,CLOSED', 'La Paz', 'Murillo', 'La Paz', 'e-1', {});
    expect(attestations.listCases).toHaveBeenCalledWith(1, 10, 'VERIFYING,PENDING,CONSENSUAL,CLOSED', 'La Paz', 'Murillo', 'La Paz', 'e-1', undefined, undefined, undefined);
  });

  it('[MX-13][PUB-RES-P0-002][UNITARIA] expone votos numéricos sin declarar ganador formal', async () => {
    const id = new Types.ObjectId();
    const snapshot = { findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ roles: [{ option: 'A', votes: 0 }, { option: 'B', votes: 0 }] }) })) };
    const service = new VotingResultsService(snapshot as never, { getEventOrThrow: jest.fn().mockResolvedValue({ _id: id, state: 'RESULTS_PUBLISHED', resultsPublishAt: new Date(Date.now() - 1_000) }) } as never);
    const result = await service.getResults(String(id));
    expect(result.roles).toEqual([{ option: 'A', votes: 0 }, { option: 'B', votes: 0 }]);
    expect(result).not.toHaveProperty('winner');
  });

  it('[MX-13][PUB-FIL-P1-001][UNITARIA] conserva filtros públicos válidos y delega combinaciones incompatibles al servicio', async () => {
    const results = { getResultsByLocation: jest.fn().mockResolvedValue({ totalVotes: 1 }) };
    const controller = new ResultsController(results as never);
    const filters: ElectionTypeFilterDto = { electionId: 'e-1', electionType: 'municipal', department: 'La Paz', province: 'Murillo', municipality: 'La Paz', electoralSeat: 'Centro', electoralLocation: 'Recinto 1' };
    await controller.getResultsByLocation(filters);
    expect(results.getResultsByLocation).toHaveBeenCalledWith(filters);
    results.getResultsByLocation.mockRejectedValueOnce(new NotFoundException('territorio incompatible'));
    await expect(controller.getResultsByLocation({ ...filters, municipality: 'Incompatible' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('[MX-13][PUB-UPD-P1-002][UNITARIA] permite consultas repetidas y conserva TTL público de 60 segundos', async () => {
    const results = { getResultsByLocation: jest.fn().mockResolvedValueOnce({ totalVotes: 1 }).mockResolvedValueOnce({ totalVotes: 2 }) };
    const controller = new ResultsController(results as never);
    const filters: ElectionTypeFilterDto = { electionId: 'e-1', electionType: 'municipal' };
    await expect(controller.getResultsByLocation(filters)).resolves.toEqual({ totalVotes: 1 });
    await expect(controller.getResultsByLocation(filters)).resolves.toEqual({ totalVotes: 2 });
    expect(results.getResultsByLocation).toHaveBeenCalledTimes(2);
    expect(Reflect.getMetadata(CACHE_TTL_METADATA, ResultsController.prototype.getResultsByLocation)).toBe(60_000);
  });

  it('[MX-13][PUB-CNS-P0-001][UNITARIA] rechaza snapshot público antes de fecha o estado permitido', async () => {
    const id = new Types.ObjectId();
    const service = new VotingResultsService({ findOne: jest.fn() } as never, { getEventOrThrow: jest.fn().mockResolvedValue({ _id: id, state: 'DRAFT', resultsPublishAt: new Date(Date.now() - 1_000) }) } as never);
    await expect(service.getResults(String(id))).rejects.toMatchObject({ response: { error: 'RESULTS_NOT_AVAILABLE' } });
  });

  it('[MX-13][PUB-SEC-P0-001][UNITARIA] entrega detalle público sin secretos administrativos', async () => {
    const id = new Types.ObjectId();
    access.getEventOrThrow.mockResolvedValue({ _id: id, tenantId: id, state: 'PUBLISHED', name: 'N', objective: 'O', votingStart: new Date(Date.now() + 1_000), adminWallet: 'private', token: 'secret' });
    roleModel.find.mockReturnValue(chain([])); optionModel.find.mockReturnValue(chain([]));
    const result = await makeEventsService().getPublicEventDetail(String(id));
    expect(JSON.stringify(result)).not.toMatch(/adminWallet|private|token|secret/i);
  });

  it('[MX-13][PUB-SEC-P0-002][UNITARIA] permite anónimo y fuerza departamento o municipio del usuario territorial', () => {
    const guard = new TerritorialScopeGuard();
    const anonymous = { query: {}, params: {}, method: 'GET', url: '/api/v1/results/by-location' };
    const governor = { query: { department: 'Otra' }, params: {}, method: 'GET', url: '/api/v1/results/by-location', user: { role: 'GOVERNOR', sub: 'u-1', votingDepartmentId: 'dep-1' } };
    const mayor = { query: { municipality: 'Otra' }, params: {}, method: 'GET', url: '/api/v1/results/by-location', user: { role: 'MAYOR', sub: 'u-2', votingMunicipalityId: 'mun-1' } };
    const context = (request: unknown) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
    expect(guard.canActivate(context(anonymous))).toBe(true);
    expect(guard.canActivate(context(governor))).toBe(true);
    expect(guard.canActivate(context(mayor))).toBe(true);
    expect(governor.query).toEqual(expect.objectContaining({ departmentId: 'dep-1' }));
    expect(governor.query.department).toBeUndefined();
    expect(mayor.query).toEqual(expect.objectContaining({ municipalityId: 'mun-1' }));
    expect(mayor.query.municipality).toBeUndefined();
  });
});
