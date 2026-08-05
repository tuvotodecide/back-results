import { Types } from 'mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { ClientResultsService } from '@/modules/contracts/services/client-results.service';
import { ClientReportsService } from '@/modules/contracts/services/client-reports.service';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { CACHE_TTL_METADATA } from '@nestjs/cache-manager';
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

  it('[MX-12][RES-ACC-P0-001][UNITARIA] aplica configuración, tipo y periodos final y preliminar sobre la elección activa', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    try {
      const active = {
        id: 'e-1', resultsStartDate: new Date('2026-02-01T11:00:00.000Z'),
        votingStartDate: new Date('2026-02-01T10:00:00.000Z'), votingEndDate: new Date('2026-02-01T14:00:00.000Z'),
      };
      const config = { getActiveConfigs: jest.fn().mockResolvedValue([active]) };
      const finalGuard = new ResultsPeriodGuard(config as never);
      const liveGuard = new PreliminaryResultsGuard(config as never);
      const context = (electionId: string) => ({ switchToHttp: () => ({ getRequest: () => ({ query: { electionId }, headers: {} }) }) }) as never;

      await expect(finalGuard.canActivate(context('e-1'))).resolves.toBe(true);
      await expect(liveGuard.canActivate(context('e-1'))).resolves.toBe(true);
      await expect(finalGuard.canActivate(context('missing'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((service as any).getConfigTypeForElectionType('council')).toBe('municipal');
      expect((service as any).getConfigTypeForElectionType('unsupported')).toBeUndefined();

      const withoutConfig = new ResultsPeriodGuard({ getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);
      await expect(withoutConfig.canActivate(context('e-1'))).rejects.toBeInstanceOf(ForbiddenException);

      const outsideFinal = new ResultsPeriodGuard({ getActiveConfigs: jest.fn().mockResolvedValue([{ ...active, resultsStartDate: new Date('2026-02-01T13:00:00.000Z') }]) } as never);
      await expect(outsideFinal.canActivate(context('e-1'))).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      jest.useRealTimers();
    }
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

  it('[MX-12][RES-CON-P1-003][UNITARIA] conserva consultas repetidas como lecturas idempotentes sin mutar actas', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    try {
      ballotModel.aggregate.mockReturnValue(aggregateResult([{ results: [{ partyId: 'A', totalVotes: 4, departmentsCovered: 1 }], summary: { validVotes: 4, blankVotes: 0, nullVotes: 0, tablesProcessed: ['T-1'] } }]));
      const electionId = new Types.ObjectId().toString();

      const first = await service.getQuickCount(electionId, 'final', 'presidential');
      const replay = await service.getQuickCount(electionId, 'final', 'presidential');

      expect(replay).toEqual(first);
      expect(ballotModel.aggregate).toHaveBeenCalledTimes(2);
      expect((ballotModel as any).create).toBeUndefined();
      expect((ballotModel as any).updateOne).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('[MX-12][RES-UPD-P1-002][UNITARIA] cachea el total de mesas sin cambiar la clave de filtros', async () => {
    const tables = { aggregate: jest.fn().mockReturnValue({ allowDiskUse: () => ({ option: () => ({ exec: () => Promise.resolve([{ n: 7 }]) }) }) }) };
    (service as any).electoralTableModel = tables;
    const filters = { electionId: new Types.ObjectId().toString(), department: 'La Paz' };

    await expect((service as any).getTotalTablesCount(filters)).resolves.toBe(7);
    await expect((service as any).getTotalTablesCount({ ...filters })).resolves.toBe(7);
    expect(tables.aggregate).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(CACHE_TTL_METADATA, ResultsController.prototype.getLiveQuickCount)).toBe(15_000);
    expect(Reflect.getMetadata(CACHE_TTL_METADATA, ResultsController.prototype.getLiveByLocation)).toBe(30_000);
    expect(Reflect.getMetadata(CACHE_TTL_METADATA, ResultsController.prototype.getResultsByLocation)).toBe(60_000);
    expect(Reflect.getMetadata(CACHE_TTL_METADATA, ResultsController.prototype.getHeatMapData)).toBe(120_000);
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

  it('[MX-12][RES-ACC-P1-003][UNITARIA] entrega vacío estable para elección válida sin datos y normaliza parámetros de elección inválidos', async () => {
    ballotModel.aggregate.mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }]));
    const electionId = new Types.ObjectId().toString();

    const empty = await service.getQuickCount(electionId, 'final', 'presidential');
    const malformed = (service as any).parseSingleElectionId('not-an-id');
    const multiple = (service as any).parseSingleElectionId(`${electionId},${new Types.ObjectId().toString()}`);

    expect(empty).toMatchObject({ results: [], summary: { validVotes: 0, totalVotes: 0 } });
    expect(malformed).toBeUndefined();
    expect(multiple).toBeUndefined();
  });

  it('[MX-12][RES-CAT-P1-002][UNITARIA] mantiene independientes los totales principales y secundarios de las actas', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ results: [{ partyId: 'P', totalVotes: 7 }], summary: { validVotes: 7, blankVotes: 0, nullVotes: 0, totalTables: ['T-1'] } }]))
      .mockReturnValueOnce(aggregateResult([{ results: [{ partyId: 'S', totalVotes: 3 }], summary: { validVotes: 3, blankVotes: 1, nullVotes: 0, totalTables: ['T-2'] } }]));

    const electionId = new Types.ObjectId().toString();
    const primary = await service.getResultsByLocation({ electionId, electionType: 'municipal', mode: 'final' });
    const secondary = await service.getResultsByLocation({ electionId, electionType: 'council', mode: 'final' });

    expect(primary.results).toEqual([expect.objectContaining({ partyId: 'P', totalVotes: 7, percentage: '100.00' })]);
    expect(secondary.results).toEqual([expect.objectContaining({ partyId: 'S', totalVotes: 3, percentage: '100.00' })]);
    expect((service as any).getVotesPath('municipal')).toBe('votes.parties');
    expect((service as any).getVotesPath('council')).toBe('votes.deputies');
  });

  it('[MX-12][RES-TER-P1-003][UNITARIA] agrega heat map por dimensión soportada y conserva porcentajes recibidos', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ location: 'La Paz', locationType: 'department', validVotes: 3, partyPercentages: { A: 66.67 } }]))
      .mockReturnValueOnce(aggregateResult([{ location: 'Murillo', locationType: 'province', validVotes: 2, partyPercentages: { A: 50 } }]))
      .mockReturnValueOnce(aggregateResult([{ location: 'La Paz', locationType: 'municipality', validVotes: 0, partyPercentages: {} }]));
    const electionId = new Types.ObjectId().toString();

    const byDepartment = await service.getHeatMapData({ electionId, electionType: 'presidential', locationType: 'department' });
    const byProvince = await service.getHeatMapData({ electionId, electionType: 'presidential', locationType: 'province' });
    const byMunicipality = await service.getHeatMapData({ electionId, electionType: 'presidential', locationType: 'municipality' });
    const pipelines = ballotModel.aggregate.mock.calls.map(([pipeline]) => JSON.stringify(pipeline));

    expect(byDepartment.data).toEqual([expect.objectContaining({ location: 'La Paz', partyPercentages: { A: 66.67 } })]);
    expect(byProvince.data).toEqual([expect.objectContaining({ location: 'Murillo', partyPercentages: { A: 50 } })]);
    expect(byMunicipality.data).toEqual([expect.objectContaining({ location: 'La Paz', partyPercentages: {} })]);
    expect(pipelines).toEqual(expect.arrayContaining([expect.stringContaining('$location.department'), expect.stringContaining('$location.province'), expect.stringContaining('$location.municipality')]));
  });

  it('[MX-12][RES-MES-P0-005][UNITARIA] filtra detalle de mesa por tableCode y conserva acta, caso efectivo y versión informativa', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ total: 1 }]))
      .mockReturnValueOnce(aggregateResult([{ _id: 'ballot-winning', tableCode: 'T-9', version: 2, image: 'image://fixture', createdAt: new Date('2026-01-01T00:00:00.000Z') }]));
    const electionId = new Types.ObjectId().toString();

    const detail = await service.getCountedBallots({ electionId, electionType: 'presidential', tableCode: 'T-9', mode: 'final', page: 1, limit: 10 });
    const pipeline = JSON.stringify(ballotModel.aggregate.mock.calls[1][0]);

    expect(detail).toMatchObject({ total: 1, data: [expect.objectContaining({ tableCode: 'T-9', version: 2, image: 'image://fixture' })] });
    expect(pipeline).toContain('"tableCode":"T-9"');
    expect(pipeline).toContain('winningBallotId');
    expect(pipeline).toContain('"version":1');
  });

  it('[MX-12][RES-ACT-P0-001][UNITARIA] proyecta acta contabilizada autorizada con imagen y rechaza territorio contractual ajeno', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ total: 1 }]))
      .mockReturnValueOnce(aggregateResult([{ _id: 'ballot-1', tableCode: 'T-1', votes: { parties: { validVotes: 1 } }, image: 'image://authorized', createdAt: new Date('2026-01-01T00:00:00.000Z') }]));
    const electionId = new Types.ObjectId().toString();
    const counted = await service.getCountedBallots({ electionId, electionType: 'presidential', tableCode: 'T-1', mode: 'final' });
    const results = { getResultsByLocation: jest.fn() };
    const client = new ClientResultsService(
      { getMyContract: jest.fn().mockResolvedValue({ hasContract: true, contract: { active: true, municipalityId: 'm-1', municipalityName: 'Cochabamba' } }) } as never,
      results as never, { collection: jest.fn() } as never,
    );

    await expect(client.getResultsRestrictedToMyContract({ electionId, electionType: 'municipal', municipality: 'Ajeno' }, 'u-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(counted.data[0]).toMatchObject({ _id: 'ballot-1', tableCode: 'T-1', image: 'image://authorized', votes: { parties: { validVotes: 1 } } });
    expect(results.getResultsByLocation).not.toHaveBeenCalled();
  });

  it('[MX-12][RES-ACT-P0-002][UNITARIA] distingue versiones informativas de winningBallotId para una mesa válida', async () => {
    const electionId = new Types.ObjectId().toString();
    const pipeline = JSON.stringify(await (service as any).attestedEffectiveBallotsPipeline({ tableCode: 'T-2' }, electionId, 'final', 'presidential'));

    expect(pipeline).toContain('"tableCode":"T-2"');
    expect(pipeline).toContain('winningBallotId');
    expect(pipeline).toContain('"version":-1');
    expect(pipeline).toContain('"valuable":true');
  });

  it('[MX-12][RES-FIL-P1-001][UNITARIA] consume búsqueda por mesa y elección única sin aceptar listas o identificadores inválidos', async () => {
    const electionId = new Types.ObjectId().toString();
    const match = await (service as any).buildLocationMatch({ tableCode: 'T-44', department: 'La Paz' });

    expect((service as any).parseSingleElectionId(electionId)).toBe(electionId);
    expect((service as any).parseSingleElectionId(`${electionId},${new Types.ObjectId().toString()}`)).toBeUndefined();
    expect((service as any).parseSingleElectionId('invalido')).toBeUndefined();
    expect(match).toEqual({ 'location.department': 'La Paz', tableCode: 'T-44' });
  });

  it('[MX-12][RES-REP-P1-001][UNITARIA] agrupa actividad por delegado, ubicación y mesa dentro del contrato existente', async () => {
    const contractId = new Types.ObjectId().toString();
    const electionId = new Types.ObjectId().toString();
    const delegateId = new Types.ObjectId();
    const contract = { _id: new Types.ObjectId(contractId), departmentName: 'La Paz' };
    const delegates = [{ dni: '111', name: 'Ana', userId: delegateId, active: true }];
    const reports = new ClientReportsService(
      { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(contract) }) } as never,
      { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(delegates) }) } as never,
      {} as never, {} as never, {} as never,
    );
    jest.spyOn(reports as any, 'getContractAttestations').mockResolvedValue([{ dni: '111', userId: delegateId, tableCode: 'T-1', support: true, createdAt: new Date('2026-01-02T00:00:00.000Z'), location: { electoralLocationName: 'Recinto', department: 'La Paz' } }]);

    const byDelegate = await reports.getDelegateActivityReport({ contractId, electionId, groupBy: 'delegate' });
    const byLocation = await reports.getDelegateActivityReport({ contractId, electionId, groupBy: 'location' });
    const byTable = await reports.getDelegateActivityReport({ contractId, electionId, groupBy: 'table' });

    expect(byDelegate).toMatchObject({ groupBy: 'delegate', activeDelegates: 1, data: [expect.objectContaining({ dni: '111', support: 1 })] });
    expect(byLocation).toMatchObject({ groupBy: 'location', totalLocations: 1, data: [expect.objectContaining({ location: 'Recinto', tablesCount: 1 })] });
    expect(byTable).toMatchObject({ groupBy: 'table', totalTables: 1, data: [expect.objectContaining({ tableCode: 'T-1', totalAttestations: 1 })] });
  });

  it('[MX-12][RES-REP-P1-002][UNITARIA] calcula métricas del contrato con atestiguamientos limitados a su alcance', async () => {
    const contractId = new Types.ObjectId().toString();
    const electionId = new Types.ObjectId().toString();
    const delegateId = new Types.ObjectId();
    const reports = new ClientReportsService(
      { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(contractId), clientRole: 'MAYOR', municipalityName: 'Cochabamba' }) }) } as never,
      { countDocuments: jest.fn().mockResolvedValue(3), find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ userId: delegateId }]) }) } as never,
      {} as never, {} as never, {} as never,
    );
    jest.spyOn(reports as any, 'getContractAttestations').mockResolvedValue([
      { userId: delegateId, tableCode: 'T-1', location: { electoralLocationName: 'A' } },
      { userId: delegateId, tableCode: 'T-1', location: { electoralLocationName: 'A' } },
    ]);

    const summary = await reports.getExecutiveSummary({ contractId, electionId });

    expect(summary).toMatchObject({ contract: { territory: { municipalityName: 'Cochabamba' } }, summary: { totalDelegatesAuthorized: 3, activeDelegates: 1, totalAttestations: 2, uniqueTablesAttested: 1, uniqueLocationsAttested: 1, participationRate: '33.33%', avgAttestationsPerDelegate: '2.00' } });
  });

  it('[MX-12][RES-REP-P1-003][UNITARIA] entrega resumen y detalle de auditoría filtrado al alcance del contrato', async () => {
    const contractId = new Types.ObjectId().toString();
    const electionId = new Types.ObjectId().toString();
    const ballotId = new Types.ObjectId();
    const reports = new ClientReportsService(
      { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(contractId), departmentName: 'La Paz' }) }) } as never,
      { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ userId: new Types.ObjectId() }]) }) } as never,
      {} as never, {} as never,
      { find: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([{ ballotId, status: 'MATCH', comparedAt: new Date('2026-01-03T00:00:00.000Z') }]) }) }) } as never,
    );
    jest.spyOn(reports as any, 'getContractAttestations').mockResolvedValue([
      { ballotId, tableCode: 'T-1', tableNumber: '1', delegateName: 'Ana', delegateDni: '111', version: 2, location: { department: 'La Paz', electoralLocationName: 'Recinto' } },
      { ballotId: new Types.ObjectId(), tableCode: 'T-2', location: { department: 'Otro', electoralLocationName: 'Fuera' } },
    ]);

    const audit = await reports.getAuditMatchReport({ contractId, electionId, department: 'La Paz', tableCode: 'T-1' });

    expect(audit).toMatchObject({ total: 1, sinObservaciones: 1, observados: 0, details: [expect.objectContaining({ tableCode: 'T-1', comparisonStatus: 'MATCH', auditoria: 'Sin Obs', version: 2 })] });
  });

  it('[MX-12][RES-SEC-P0-002][UNITARIA] serializa el resumen de resultados sin credenciales ni datos personales', async () => {
    ballotModel.aggregate.mockReturnValue(aggregateResult([{ results: [{ partyId: 'A', totalVotes: 2, locationsCovered: 1 }], summary: { validVotes: 2, blankVotes: 0, nullVotes: 0, tablesProcessed: ['T-1'] } }]));

    const response = await service.getQuickCount(new Types.ObjectId().toString(), 'final', 'presidential');
    const serialized = JSON.stringify(response);

    expect(response).toEqual(expect.objectContaining({ results: [expect.objectContaining({ partyId: 'A', totalVotes: 2, percentage: '100.00' })], summary: expect.objectContaining({ validVotes: 2, totalVotes: 2 }), lastUpdate: expect.any(Date) }));
    expect(serialized).not.toMatch(/dni|token|password|credential/i);
  });
});
