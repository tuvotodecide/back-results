import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ResultsService } from '@/modules/results/services/results.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

const mkAgg = (result: any) => ({
  aggregate: jest.fn().mockReturnValue({
    allowDiskUse: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(result) }),
  }),
  createIndexes: jest.fn().mockResolvedValue(undefined),
  countDocuments: jest.fn(),
});

describe('ResultsService (unit)', () => {
  let svc: ResultsService;
  const ballotModel = mkAgg([]);
  const tableModel = mkAgg([]);
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
        { provide: ElectionConfigService, useValue: electionCfg },
      ],
    }).compile();

    svc = mod.get(ResultsService);
    jest.clearAllMocks();
  });

  it('RES-SVC-001 parseSingleElectionId varios casos', () => {
    const f = (svc as any).parseSingleElectionId.bind(svc);
    expect(f(undefined)).toBeUndefined();
    expect(f('507f1f77bcf86cd799439011')).toBe('507f1f77bcf86cd799439011');
    expect(f('507f...,deadbeef')).toBeUndefined();
    expect(f('trash')).toBeUndefined();
  });

  it('RES-SVC-002 currentElectionMatch con ids mezcla', async () => {
    const out = await (svc as any).currentElectionMatch(
      '507f1f77bcf86cd799439011,trash,507f1f77bcf86cd799439012',
    );
    expect(out).toHaveProperty('electionId.$in');
  });

  it('RES-SVC-003 currentElectionMatch sin id y sin activas ⇒ {}', async () => {
    electionCfg.getActiveConfigs.mockResolvedValue([]);
    const out = await (svc as any).currentElectionMatch();
    expect(out).toEqual({});
  });

  it('RES-SVC-004 getQuickCount calcula porcentajes', async () => {
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

  it('RES-SVC-005 getQuickCount con 0 válidos', async () => {
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

  it('RES-SVC-006 getResultsByLocation usa votesPath y totalTables', async () => {
    // facet de ballots
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
    // count de electoral_tables
    (tableModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({ exec: () => Promise.resolve([{ n: 10 }]) }),
    });

    const out = await svc.getResultsByLocation({
      electionType: 'deputies',
    } as any);
    expect(out.summary.validVotes).toBe(50);
    expect(out.summary.totalTables).toBe(10);
    expect(out.results[0].percentage).toBe('100.00');
  });

  it('RES-SVC-007 getRegistrationProgress rellena byStatus y porcentaje', async () => {
    // totalTables
    (tableModel.aggregate as jest.Mock).mockReturnValueOnce({
      allowDiskUse: () => ({ exec: () => Promise.resolve([{ n: 100 }]) }),
    });
    // registeredBallots
    const countDocs = jest.spyOn<any, any>(
      (svc as any).ballotModel,
      'countDocuments',
    );
    countDocs.mockResolvedValueOnce(70);
    // byStatus
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

  it('RES-SVC-008 getSystemStatistics mapea counters', async () => {
    // Limpia cualquier comportamiento previo de aggregate y countDocuments
    (ballotModel.aggregate as jest.Mock).mockReset();
    (ballotModel.countDocuments as jest.Mock).mockReset();

    // 1. total ballots
    (ballotModel as any).countDocuments.mockResolvedValue(1234);

    // 2. Secuencia controlada de aggregates
    let aggregateCallCount = 0;
    (ballotModel.aggregate as jest.Mock).mockImplementation(() => {
      aggregateCallCount++;

      if (aggregateCallCount === 1) {
        // byStatus
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
        // departmentCoverage
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
      // recentActivity
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

  // RES-SVC-009 (corregido: normalizar partyPercentages vacío)
  it('RES-SVC-009 getHeatMapData conserva percentages (incluye 0)', async () => {
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
              partyPercentages: { MAS: 0 }, // ← Mock lo incluye
            },
          ]),
      }),
    });

    const out = await svc.getHeatMapData({
      electionType: 'presidential',
      locationType: 'department',
    });

    const data = Array.isArray(out) ? out : out.data;

    // Verificar que partyPercentages existe y tiene MAS
    expect(data[0].partyPercentages).toBeDefined();
    expect(data[0].partyPercentages.MAS).toBe(0); // ← Ahora debería pasar
  });

  it('RES-SVC-010 onModuleInit no lanza si no hay config y ejecuta warm-up', async () => {
    electionCfg.getActiveConfig.mockRejectedValueOnce(new Error('no hay')); // atrapado por try/catch
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
