import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { ForbiddenException } from '@nestjs/common';

const mkCtx = (query: any = {}, body: any = {}) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ query, body }),
    }),
  }) as any;

describe('Election Guards (unit)', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 60_000);

  const svc = {
    getActiveConfigs: jest.fn(),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  // VotingPeriodGuard
  it('GRD-UT-001 VotingPeriodGuard: sin activas → 403 NO_ELECTION_CONFIG', async () => {
    svc.getActiveConfigs.mockResolvedValue([]);
    const g = new VotingPeriodGuard(svc);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(ForbiddenException);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(
      /no hay configuración electoral activa/i,
    );
  });

  it('GRD-UT-002 VotingPeriodGuard: varias activas sin electionId → msg exacto', async () => {
    svc.getActiveConfigs.mockResolvedValue([
      { id: 'a', votingStartDate: past, votingEndDate: future },
      { id: 'b', votingStartDate: past, votingEndDate: future },
    ]);
    const g = new VotingPeriodGuard(svc);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(
      /Hay varias elecciones activas; envíe electionId/i,
    );
  });

  it('GRD-UT-003 VotingPeriodGuard: fuera de horario sin allowDataModification → 403', async () => {
    svc.getActiveConfigs.mockResolvedValue([
      {
        id: 'a',
        votingStartDate: past,
        votingEndDate: past,
        allowDataModification: false,
      },
    ]);
    const g = new VotingPeriodGuard(svc);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(
      /fuera de horario electoral/i,
    );
  });

  // ResultsPeriodGuard
  it('GRD-UT-004 ResultsPeriodGuard: antes de resultsStartDate → 403 RESULTS_NOT_AVAILABLE', async () => {
    svc.getActiveConfigs.mockResolvedValue([
      { id: 'a', resultsStartDate: future },
    ]);
    const g = new ResultsPeriodGuard(svc);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(
      /resultados no disponibles aún/i,
    );
  });

  // PreliminaryResultsGuard
  it('GRD-UT-005 PreliminaryResultsGuard: varias activas sin electionId → LIVE msg', async () => {
    svc.getActiveConfigs.mockResolvedValue([
      { id: 'a', votingStartDate: past, votingEndDate: future },
      { id: 'b', votingStartDate: past, votingEndDate: future },
    ]);
    const g = new PreliminaryResultsGuard(svc);
    await expect(g.canActivate(mkCtx())).rejects.toThrow(
      /envíe electionId para usar LIVE/i,
    );
  });

  it('GRD-UT-006 PreliminaryResultsGuard: ok dentro de horario', async () => {
    svc.getActiveConfigs.mockResolvedValue([
      { id: 'a', votingStartDate: past, votingEndDate: future },
    ]);
    const g = new PreliminaryResultsGuard(svc);
    await expect(g.canActivate(mkCtx())).resolves.toBe(true);
  });
  it('GRD-UT-007 valida contra la config indicada por electionId', async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    svc.getActiveConfigs.mockResolvedValue([
      { id: 'pres', votingStartDate: past, votingEndDate: future },
      { id: 'cong', votingStartDate: past, votingEndDate: future },
    ]);
    const g = new VotingPeriodGuard(svc);
    await expect(g.canActivate(mkCtx({ electionId: 'pres' }))).resolves.toBe(
      true,
    );
  });
});
