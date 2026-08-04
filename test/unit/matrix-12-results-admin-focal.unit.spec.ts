import { Types } from 'mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { ClientResultsService } from '@/modules/contracts/services/client-results.service';
import { ForbiddenException } from '@nestjs/common';

const aggregateResult = (value: unknown) => ({
  allowDiskUse: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(value) }),
});

describe('MX-12 Backend Results — unidad focal', () => {
  let ballotModel: { aggregate: jest.Mock; countDocuments: jest.Mock; createIndexes: jest.Mock };
  let service: ResultsService;

  beforeEach(() => {
    ballotModel = {
      aggregate: jest.fn(),
      countDocuments: jest.fn(),
      createIndexes: jest.fn(),
    };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    service = new ResultsService(
      ballotModel as never,
      model as never,
      model as never,
      model as never,
      model as never,
      model as never,
      model as never,
      { getActiveConfigs: jest.fn().mockResolvedValue([]), getActiveConfig: jest.fn() } as never,
    );
  });

  it('[MX-12][RES-CAT-P0-001][UNITARIA] selecciona el grupo de votos real por tipo de elección soportado', () => {
    const getVotesPath = (service as any).getVotesPath.bind(service);

    expect(getVotesPath('presidential')).toBe('votes.parties');
    expect(getVotesPath('departamental')).toBe('votes.parties');
    expect(getVotesPath('municipal')).toBe('votes.parties');
    expect(getVotesPath('deputies')).toBe('votes.deputies');
    expect(getVotesPath('assembly')).toBe('votes.deputies');
    expect(getVotesPath('council')).toBe('votes.deputies');
  });

  it('[MX-12][RES-ACC-P0-001][UNITARIA] aplica periodos final y preliminar sobre la configuración activa real', async () => {
    const now = Date.now();
    const config = {
      getActiveConfigs: jest.fn().mockResolvedValue([{
        id: 'e-1', resultsStartDate: new Date(now - 1_000),
        votingStartDate: new Date(now - 2_000), votingEndDate: new Date(now + 1_000),
      }]),
    };
    const finalGuard = new ResultsPeriodGuard(config as never);
    const liveGuard = new PreliminaryResultsGuard(config as never);
    const context = { switchToHttp: () => ({ getRequest: () => ({ query: { electionId: 'e-1' }, headers: {} }) }) } as never;

    await expect(finalGuard.canActivate(context)).resolves.toBe(true);
    await expect(liveGuard.canActivate(context)).resolves.toBe(true);
    expect(config.getActiveConfigs).toHaveBeenCalledTimes(2);
  });

  it('[MX-12][RES-ACC-P0-002][UNITARIA] fuerza territorio contractual y rechaza subfiltro fuera de alcance', async () => {
    const results = { getResultsByLocation: jest.fn().mockResolvedValue({ ok: true }) };
    const connection = { collection: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }) };
    const client = new ClientResultsService(
      { getMyContract: jest.fn().mockResolvedValue({ hasContract: true, contract: { active: true, departmentId: 'd-1', departmentName: 'La Paz' } }) } as never,
      results as never, connection as never,
    );

    await client.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'presidential' }, 'u-1');
    await expect(client.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'presidential', province: 'Ajena' }, 'u-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ department: 'La Paz', mode: 'final' }));
  });

  it('[MX-12][RES-SUM-P0-001][UNITARIA] construye el pipeline final con mesas activas, caso aceptado y winningBallotId', async () => {
    const electionId = new Types.ObjectId().toString();
    const pipeline = await (service as any).attestedEffectiveBallotsPipeline(
      undefined,
      electionId,
      'final',
      'presidential',
    );
    const serialized = JSON.stringify(pipeline);

    expect(serialized).toContain('electoral_tables');
    expect(serialized).toContain('attestation_cases');
    expect(serialized).toContain('PENDING');
    expect(serialized).toContain('CONSENSUAL');
    expect(serialized).toContain('CLOSED');
    expect(serialized).toContain('winningBallotId');
    expect(serialized).toContain('valuable');
  });

  it('[MX-12][RES-CAS-P0-003][UNITARIA] excluye VERIFYING del pipeline final y exige la coincidencia del acta ganadora', async () => {
    const pipeline = await (service as any).attestedEffectiveBallotsPipeline(
      undefined,
      new Types.ObjectId().toString(),
      'final',
      'presidential',
    );
    const serialized = JSON.stringify(pipeline);

    expect(serialized).not.toContain('VERIFYING');
    expect(serialized).toContain('$_id');
    expect(serialized).toContain('$case.winningBallotId');
  });

  it('[MX-12][RES-SUM-P0-002][UNITARIA] construye fallback live con una sola versión por mesa', async () => {
    const pipeline = await (service as any).attestedEffectiveBallotsPipeline(undefined, new Types.ObjectId().toString(), 'live', 'presidential');
    const serialized = JSON.stringify(pipeline);

    expect(serialized).toContain('countVersions');
    expect(serialized).toContain('"$match":{"countVersions":1}');
    expect(serialized).toContain('"status":{"$in":["processed","synced"]}');
  });

  it('[MX-12][RES-TER-P0-001][UNITARIA] resuelve catálogo por ObjectId y conserva tableCode en el match real', async () => {
    const department = { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ name: 'La Paz' }) }) };
    (service as any).departmentModel = department;
    const location = await (service as any).buildLocationMatch({ department: new Types.ObjectId().toString(), tableCode: 'T-1' });

    expect(department.findById).toHaveBeenCalled();
    expect(location).toMatchObject({ 'location.department': 'La Paz', tableCode: 'T-1' });
  });

  it('[MX-12][RES-TER-P0-002][UNITARIA] rechaza municipio contractual incompatible antes de consultar resultados', async () => {
    const results = { getResultsByLocation: jest.fn() };
    const client = new ClientResultsService(
      { getMyContract: jest.fn().mockResolvedValue({ hasContract: true, contract: { active: true, municipalityId: 'm-1', municipalityName: 'Cochabamba' } }) } as never,
      results as never, { collection: jest.fn() } as never,
    );

    await expect(client.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'municipal', municipality: 'Quillacollo' }, 'u-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(results.getResultsByLocation).not.toHaveBeenCalled();
  });

  it('[MX-12][RES-SUM-P0-003][UNITARIA] ejecuta ResultsService y calcula total, porcentaje y cero votos válidos', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(
        aggregateResult([
          {
            results: [{ partyId: 'A', totalVotes: 1, departmentsCovered: 1 }],
            summary: { validVotes: 3, blankVotes: 2, nullVotes: 1, tablesProcessed: ['T-1'] },
          },
        ]),
      )
      .mockReturnValueOnce(
        aggregateResult([
          {
            results: [{ partyId: 'A', totalVotes: 0, departmentsCovered: 1 }],
            summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] },
          },
        ]),
      );

    const nonZero = await service.getQuickCount(undefined, 'final', 'presidential');
    const zero = await service.getQuickCount(undefined, 'final', 'presidential');

    expect(nonZero.summary).toMatchObject({ validVotes: 3, blankVotes: 2, nullVotes: 1, totalVotes: 6, tablesProcessed: 1 });
    expect(nonZero.results[0]).toMatchObject({ partyId: 'A', percentage: '33.33' });
    expect(zero.results[0]).toMatchObject({ percentage: '0.00' });
  });

  it('[MX-12][RES-MES-P1-004][UNITARIA] usa el pipeline efectivo, orden descendente y paginación al listar actas contadas', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ total: 3 }]))
      .mockReturnValueOnce(aggregateResult([{ tableCode: 'T-3', createdAt: '2026-01-03T00:00:00.000Z' }]));

    const result = await service.getCountedBallots({
      electionId: new Types.ObjectId().toString(), electionType: 'presidential', mode: 'final', page: 2, limit: 2,
    } as never);
    const listPipeline = ballotModel.aggregate.mock.calls[1][0];

    expect(result).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2, mode: 'final' });
    expect(listPipeline).toEqual(expect.arrayContaining([{ $sort: { createdAt: -1 } }, { $skip: 2 }, { $limit: 2 }]));
  });

  it('[MX-12][RES-CON-P0-001][UNITARIA] deduplica por mesa y selecciona únicamente winningBallotId en final', async () => {
    const pipeline = await (service as any).attestedEffectiveBallotsPipeline(undefined, new Types.ObjectId().toString(), 'final', 'presidential');
    const serialized = JSON.stringify(pipeline);

    expect(serialized).toContain('"_id":"$tableCode"');
    expect(serialized).toContain('$case.winningBallotId');
    expect(serialized).toContain('"valuable":true');
  });

  it('[MX-12][RES-CON-P0-002][UNITARIA] usa fallback live con una versión y regla final con acta ganadora', async () => {
    const live = JSON.stringify(await (service as any).attestedEffectiveBallotsPipeline(undefined, new Types.ObjectId().toString(), 'live', 'presidential'));
    const final = JSON.stringify(await (service as any).attestedEffectiveBallotsPipeline(undefined, new Types.ObjectId().toString(), 'final', 'presidential'));

    expect(live).toContain('countVersions');
    expect(live).toContain('"countVersions":1');
    expect(final).toContain('winningBallotId');
    expect(final).toContain('CONSENSUAL');
  });

  it('[MX-12][RES-UPD-P1-002][UNITARIA] cachea el total de mesas sin cambiar la clave de filtros', async () => {
    const tables = { aggregate: jest.fn().mockReturnValue({ allowDiskUse: () => ({ option: () => ({ exec: () => Promise.resolve([{ n: 7 }]) }) }) }) };
    (service as any).electoralTableModel = tables;
    const filters = { electionId: new Types.ObjectId().toString(), department: 'La Paz' };

    await expect((service as any).getTotalTablesCount(filters)).resolves.toBe(7);
    await expect((service as any).getTotalTablesCount({ ...filters })).resolves.toBe(7);
    expect(tables.aggregate).toHaveBeenCalledTimes(1);
  });

  it('[MX-12][RES-SEC-P0-001][UNITARIA] exige usuario, elección y contrato activo en el consumidor territorial', async () => {
    const results = { getResultsByLocation: jest.fn() };
    const client = new ClientResultsService({ getMyContract: jest.fn().mockResolvedValue({ hasContract: false }) } as never, results as never, { collection: jest.fn() } as never);

    await expect(client.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'municipal' }, '')).rejects.toBeInstanceOf(Error);
    await expect(client.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'municipal' }, 'u-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(results.getResultsByLocation).not.toHaveBeenCalled();
  });

  it('[MX-12][RES-TRA-P1-003][UNITARIA] propaga lastUpdate en respuestas reales de resultados', async () => {
    ballotModel.aggregate.mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }]));

    const result = await service.getQuickCount(undefined, 'final', 'presidential');

    expect(result.lastUpdate).toBeInstanceOf(Date);
    expect(result.summary).toMatchObject({ validVotes: 0, totalVotes: 0 });
  });
});
