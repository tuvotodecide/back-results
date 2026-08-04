import { Types } from 'mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { ClientReportsService } from '@/modules/contracts/services/client-reports.service';
import { ClientResultsService } from '@/modules/contracts/services/client-results.service';
import { ContractsService } from '@/modules/contracts/services/contracts.service';

const aggregateResult = (value: unknown) => ({
  allowDiskUse: () => ({ option: () => ({ exec: () => Promise.resolve(value) }), exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

describe('MX-12 Backend Results — integración focal', () => {
  it('[MX-12][RES-ACC-P0-002][INTEGRACION] integra contrato activo con filtros autoritativos antes del agregado', async () => {
    const resultsMock = {
      getResultsByLocation: jest.fn().mockResolvedValue({ results: [] }),
    } satisfies Pick<ResultsService, 'getResultsByLocation'>;
    const contractsServiceMock = {
      getMyContract: jest.fn().mockResolvedValue({
        hasContract: true,
        contract: {
          active: true,
          municipalityId: 'm-1',
          municipalityName: 'Cochabamba',
        },
      }),
    } satisfies Partial<ContractsService>;
    const service = new ClientResultsService(
      contractsServiceMock as unknown as ContractsService,
      resultsMock as unknown as ResultsService,
      { collection: jest.fn() } as never,
    );

    await service.getResultsRestrictedToMyContract({ electionId: 'e-1', electionType: 'municipal', mode: 'live', tableCode: 'T-1' }, 'user-1');

    expect(resultsMock.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ municipality: 'Cochabamba', tableCode: 'T-1', mode: 'live' }));
  });

  it('[MX-12][RES-SUM-P0-001][INTEGRACION] integra casos, mesas y actas en un pipeline final deduplicado', async () => {
    const ballot = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }])) };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(ballot as never, model as never, model as never, model as never, model as never, model as never, model as never, { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);

    await service.getQuickCount(new Types.ObjectId().toString(), 'final', 'presidential');

    const pipeline = JSON.stringify(ballot.aggregate.mock.calls[0][0]);
    expect(pipeline).toContain('attestation_cases');
    expect(pipeline).toContain('winningBallotId');
    expect(pipeline).toContain('"$group":{"_id":"$tableCode"');
  });

  it('[MX-12][RES-SUM-P0-002][INTEGRACION] integra fallback live con una sola versión por mesa', async () => {
    const ballot = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }])) };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(ballot as never, model as never, model as never, model as never, model as never, model as never, model as never, { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);

    await service.getQuickCount(new Types.ObjectId().toString(), 'live', 'presidential');

    const pipeline = JSON.stringify(ballot.aggregate.mock.calls[0][0]);
    expect(pipeline).toContain('countVersions');
    expect(pipeline).toContain('"$match":{"countVersions":1}');
  });

  it('[MX-12][RES-SUM-P0-003][INTEGRACION] agrega varias mesas, partido sin votos y total cero', async () => {
    const ballot = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ results: [{ partyId: 'A', totalVotes: 0 }], summary: { validVotes: 0, blankVotes: 4, nullVotes: 1, tablesProcessed: ['T-1', 'T-2'] } }])) };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(ballot as never, model as never, model as never, model as never, model as never, model as never, model as never, { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);

    const result = await service.getQuickCount(undefined, 'final', 'presidential');

    expect(result.summary).toMatchObject({ validVotes: 0, blankVotes: 4, nullVotes: 1, totalVotes: 5, tablesProcessed: 2 });
    expect(result.results).toEqual([expect.objectContaining({ partyId: 'A', percentage: '0.00' })]);
  });

  it('[MX-12][RES-CAS-P0-003][INTEGRACION] conserva estados aceptados y acta ganadora al componer el agregado', async () => {
    const ballot = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }])) };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(ballot as never, model as never, model as never, model as never, model as never, model as never, model as never, { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);

    await service.getQuickCount(new Types.ObjectId().toString(), 'final', 'presidential');

    const pipeline = JSON.stringify(ballot.aggregate.mock.calls[0][0]);
    expect(pipeline).toContain('PENDING');
    expect(pipeline).toContain('CONSENSUAL');
    expect(pipeline).toContain('CLOSED');
    expect(pipeline).not.toContain('VERIFYING');
  });

  it('[MX-12][RES-CON-P0-001][INTEGRACION] integra deduplicación final por tableCode sin contar versiones dos veces', async () => {
    const ballot = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0, tablesProcessed: [] } }])) };
    const model = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(ballot as never, model as never, model as never, model as never, model as never, model as never, model as never, { getActiveConfigs: jest.fn().mockResolvedValue([]) } as never);

    await service.getQuickCount(new Types.ObjectId().toString(), 'final', 'presidential');

    expect(JSON.stringify(ballot.aggregate.mock.calls[0][0])).toContain('"_id":"$tableCode"');
  });
  it('[MX-12][RES-CON-P0-002][INTEGRACION] entrega el mismo agregado completo ante consultas simultáneas del servicio real', async () => {
    const ballotModel = {
      aggregate: jest.fn().mockReturnValue(aggregateResult([
        { results: [{ partyId: 'A', totalVotes: 8, locationsCovered: 1 }], summary: { validVotes: 8, blankVotes: 0, nullVotes: 0, totalTables: ['T-1'] } },
      ])),
      createIndexes: jest.fn(), countDocuments: jest.fn(),
    };
    const tableModel = { aggregate: jest.fn().mockReturnValue(aggregateResult([{ n: 1 }])), createIndexes: jest.fn(), findById: jest.fn() };
    const service = new ResultsService(
      ballotModel as never, tableModel as never, tableModel as never, tableModel as never,
      tableModel as never, tableModel as never, tableModel as never,
      { getActiveConfigs: jest.fn().mockResolvedValue([]), getActiveConfig: jest.fn() } as never,
    );
    const filters = { electionId: new Types.ObjectId().toString(), electionType: 'presidential', mode: 'final' } as never;

    const [first, second] = await Promise.all([service.getResultsByLocation(filters), service.getResultsByLocation(filters)]);

    expect(first).toEqual(second);
    expect(first.summary).toMatchObject({ validVotes: 8, totalVotes: 8, totalTables: 1 });
    expect(ballotModel.aggregate).toHaveBeenCalledTimes(2);
  });

  it('[MX-12][RES-REP-P1-001][INTEGRACION] agrega actividad persistida solo de delegados autorizados del contrato', async () => {
    const contractId = new Types.ObjectId();
    const electionId = new Types.ObjectId();
    const delegateId = new Types.ObjectId();
    const attestationModel = { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([
      { dni: 'delegate-fixture', userId: delegateId, tableCode: 'T-1', support: true, createdAt: new Date('2026-01-01T00:00:00.000Z'), location: { electoralLocationName: 'Recinto', department: 'La Paz' } },
    ]) }) };
    const service = new ClientReportsService(
      { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: contractId, departmentName: 'La Paz' }) }) } as never,
      { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ dni: 'delegate-fixture', name: 'Delegada', userId: delegateId, active: true }]) }) } as never,
      attestationModel as never, {} as never, {} as never,
    );

    const report = await service.getDelegateActivityReport({ contractId: contractId.toString(), electionId: electionId.toString(), groupBy: 'table' });

    expect(report).toMatchObject({ groupBy: 'table', totalTables: 1 });
    expect(report.data[0]).toMatchObject({ tableCode: 'T-1', totalAttestations: 1, support: 1, against: 0 });
    expect(JSON.stringify(attestationModel.aggregate.mock.calls[0][0])).toContain(contractId.toString());
  });

  it('[MX-12][RES-REP-P1-002][INTEGRACION] calcula resumen ejecutivo con métricas únicas de contrato', async () => {
    const contractId = new Types.ObjectId();
    const electionId = new Types.ObjectId();
    const service = new ClientReportsService(
      { findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: contractId, departmentName: 'La Paz' }) }) } as never,
      {
        find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ userId: new Types.ObjectId() }]) }),
        countDocuments: jest.fn().mockResolvedValue(3),
      } as never,
      { aggregate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) } as never,
      {} as never, {} as never,
    );
    jest.spyOn(service as any, 'getContractAttestations').mockResolvedValue([
      { tableCode: 'T-1', location: { electoralLocationName: 'A' }, createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { tableCode: 'T-1', location: { electoralLocationName: 'A' }, createdAt: new Date('2026-01-02T00:00:00.000Z') },
    ]);

    const summary = await service.getExecutiveSummary({ contractId: contractId.toString(), electionId: electionId.toString() });

    expect(summary.summary).toMatchObject({ totalDelegatesAuthorized: 3, totalAttestations: 2, uniqueTablesAttested: 1, uniqueLocationsAttested: 1 });
  });
});
