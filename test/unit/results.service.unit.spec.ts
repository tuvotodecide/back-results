import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { Province } from '@/modules/geographic/schemas/province.schema';
import { ElectoralSeat } from '@/modules/geographic/schemas/electoral-seat.schema';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

const mkAgg = (result: any) => ({
  aggregate: jest.fn().mockReturnValue({
    allowDiskUse: jest
      .fn()
      .mockReturnValue({
        option: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(result),
        }),
        exec: jest.fn().mockResolvedValue(result),
      }),
  }),
  createIndexes: jest.fn().mockResolvedValue(undefined),
  countDocuments: jest.fn(),
  findById: jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(null),
  }),
});

describe('ResultsService (unit)', () => {
  let svc: ResultsService;
  const ballotModel = mkAgg([]);
  const tableModel = mkAgg([]);
  const departmentModel = mkAgg([]);
  const municipalityModel = mkAgg([]);
  const provinceModel = mkAgg([]);
  const electoralSeatModel = mkAgg([]);
  const electoralLocationModel = mkAgg([]);
  const electionCfg = {
    getActiveConfigs: jest.fn(),
    getActiveConfig: jest.fn(),
  };

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ResultsService,
        { provide: getModelToken(Ballot.name), useValue: ballotModel },
        { provide: getModelToken(ElectoralTable.name), useValue: tableModel },
        { provide: getModelToken(Department.name), useValue: departmentModel },
        { provide: getModelToken(Municipality.name), useValue: municipalityModel },
        { provide: getModelToken(Province.name), useValue: provinceModel },
        { provide: getModelToken(ElectoralSeat.name), useValue: electoralSeatModel },
        {
          provide: getModelToken(ElectoralLocation.name),
          useValue: electoralLocationModel,
        },
        { provide: ElectionConfigService, useValue: electionCfg },
      ],
    }).compile();

    svc = mod.get(ResultsService);
    jest.clearAllMocks();
  });

  it('[RES-FIL-P1-001][RES-SEC-P0-001] parsea un solo electionId valido y rechaza listas manipuladas', () => {
    const f = (svc as any).parseSingleElectionId.bind(svc);
    expect(f(undefined)).toBeUndefined();
    expect(f('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
    expect(f('507f...,deadbeef')).toBeUndefined();
    expect(f('trash')).toBeUndefined();
  });

  it('[RES-FIL-P1-001] construye filtro de elecciones activas desde ids validos', async () => {
    const out = await (svc as any).currentElectionMatch(
      '507f1f77bcf86cd799439011,trash,507f1f77bcf86cd799439012',
    );
    expect(out).toHaveProperty('electionId.$in');
  });

  it('[RES-ACC-P1-003] resuelve filtro vacio cuando no hay eleccion activa', async () => {
    electionCfg.getActiveConfigs.mockResolvedValue([]);
    const out = await (svc as any).currentElectionMatch();
    expect(out).toEqual({});
  });

  it('[RES-SUM-P0-003][RES-CON-P0-001] getQuickCount calcula porcentajes sobre votos validos', async () => {
    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () =>
          Promise.resolve([
            {
              results: [
                { partyId: 'MAS', totalVotes: 120, departmentsCovered: 2 },
                { partyId: 'CC', totalVotes: 80, departmentsCovered: 2 },
              ],
              summary: {
                validVotes: 200,
                nullVotes: 0,
                blankVotes: 0,
                tablesProcessed: ['A', 'B'],
              },
            },
          ]),
      }),
    });

    const out = await svc.getQuickCount();
    expect(out.summary.validVotes).toBe(200);
    const mas = out.results.find((r) => r.partyId === 'MAS')!;
    const cc = out.results.find((r) => r.partyId === 'CC')!;
    expect(mas.percentage).toBe('60.00');
    expect(cc.percentage).toBe('40.00');
    expect(out.summary.tablesProcessed).toBe(2);
  });

  it('[RES-SUM-P0-003] getQuickCount devuelve 0.00 con cero votos validos', async () => {
    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () =>
          Promise.resolve([
            {
              results: [
                { partyId: 'MAS', totalVotes: 0, departmentsCovered: 1 },
              ],
              summary: {
                validVotes: 0,
                nullVotes: 0,
                blankVotes: 0,
                tablesProcessed: [],
              },
            },
          ]),
      }),
    });
    const out = await svc.getQuickCount();
    expect(out.results[0].percentage).toBe('0.00');
  });

  it('[RES-CAT-P0-001][RES-TER-P0-001] getResultsByLocation usa grupo de votos y totalTables autorizado', async () => {
    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () =>
          Promise.resolve([
            {
              results: [
                { partyId: 'MAS', totalVotes: 50, locationsCovered: 1 },
              ],
              summary: {
                validVotes: 50,
                nullVotes: 0,
                blankVotes: 0,
                totalTables: ['T1'],
              },
            },
          ]),
      }),
    });

    (tableModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        option: () => ({ exec: () => Promise.resolve([{ n: 10 }]) }),
        exec: () => Promise.resolve([{ n: 10 }]),
      }),
    });

    const out = await svc.getResultsByLocation({
      electionType: 'deputies',
    } as any);
    expect(out.summary.validVotes).toBe(50);
    expect(out.summary.totalTables).toBe(10);
    expect(out.results[0].percentage).toBe('100.00');
  });

  it('[RES-REP-P1-002][RES-TRA-P1-003] getRegistrationProgress rellena estados porcentaje y trazabilidad', async () => {
    (tableModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({ exec: () => Promise.resolve([{ n: 100 }]) }),
    });

    const countDocs = jest.spyOn<any, any>(
      (svc as any).ballotModel,
      'countDocuments',
    );
    countDocs.mockResolvedValueOnce(70);

    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () => Promise.resolve([{ _id: 'processed', count: 60 }]),
      }),
    });
    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({ exec: () => Promise.resolve([]) }),
    });

    const out = await svc.getRegistrationProgress();
    expect(out.progress.totalTables).toBe(100);
    expect(out.progress.registeredBallots).toBe(70);
    expect(out.byStatus.pending).toBe(0);
    expect(out.byStatus.processed).toBe(60);
    expect(out.progress.percentage).toBe('70.00');
  });

  it('[RES-REP-P1-002][RES-TRA-P1-003] getSystemStatistics mapea contadores cobertura y actividad reciente', async () => {
    (ballotModel.aggregate as jest.Mock).mockReset();
    (ballotModel.countDocuments as jest.Mock).mockReset();

    (ballotModel as any).countDocuments.mockResolvedValue(1234);

    let aggregateCallCount = 0;
    (ballotModel.aggregate as jest.Mock).mockImplementation(() => {
      aggregateCallCount++;

      if (aggregateCallCount === 1) {
        return {
          allowDiskUse: () => ({
            exec: () =>
              Promise.resolve([
                { _id: 'processed', count: 100 },
                { _id: 'synced', count: 20 },
              ]),
          }),
        };
      } else if (aggregateCallCount === 2) {
        return {
          allowDiskUse: () => ({
            exec: () =>
              Promise.resolve([
                {
                  _id: 'La Paz',
                  ballotCount: 50,
                  lastUpdate: new Date('2025-01-24'),
                },
              ]),
          }),
        };
      }
      return {
        allowDiskUse: () => ({
          exec: () => Promise.resolve([{ _id: '2025-01-24 10:00', count: 5 }]),
        }),
      };
    });

    const out = await svc.getSystemStatistics();

    expect(out.summary.totalBallots).toBe(1234);
    expect(out.summary.byStatus.processed).toBe(100);
    expect(out.summary.byStatus.synced).toBe(20);
    expect(out.departmentCoverage[0].department).toBe('La Paz');
    expect(out.recentActivity[0].hour).toBe('2025-01-24 10:00');
  });

  it('[RES-TER-P1-003][RES-SUM-P0-003] getHeatMapData conserva porcentajes incluido cero', async () => {
    (ballotModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({
        exec: () =>
          Promise.resolve([
            {
              location: 'La Paz',
              locationType: 'department',
              validVotes: 0,
              nullVotes: 0,
              blankVotes: 0,
              totalVotes: 0,
              partyPercentages: { MAS: 0 },
            },
          ]),
      }),
    });

    const out = await svc.getHeatMapData({
      electionType: 'presidential',
      locationType: 'department',
    });

    const data = Array.isArray(out) ? out : out.data;

    expect(data[0].partyPercentages).toBeDefined();
    expect(data[0].partyPercentages.MAS).toBe(0);
  });

  it('[RES-UPD-P1-002] onModuleInit ejecuta warm-up sin bloquear cuando no hay config', async () => {
    electionCfg.getActiveConfig.mockRejectedValueOnce(new Error('no hay'));
    jest.spyOn(svc, 'getQuickCount').mockResolvedValue({} as any);
    jest.spyOn(svc, 'getResultsByLocation').mockResolvedValue({} as any);
    jest.spyOn(svc, 'getRegistrationProgress').mockResolvedValue({} as any);
    jest.spyOn(svc, 'getSystemStatistics').mockResolvedValue({} as any);
    jest.spyOn(svc, 'getHeatMapData').mockResolvedValue({} as any);

    (ballotModel.aggregate as jest.Mock).mockReturnValue({
      allowDiskUse: () => ({ exec: () => Promise.resolve([]) }),
    });

    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });
});
