import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

describe('MX-13 Backend Results — integración focal', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('[MX-13][PUB-UPD-P1-002][INTEGRACION] integra rutas públicas repetidas con modos live/final y límites simulados', async () => {
    const calls: Record<string, unknown>[] = [];
    const results = {
      getResultsByLocation: jest.fn(async (filters: Record<string, unknown>) => {
        calls.push(filters);
        return { mode: filters.mode ?? 'final', sequence: calls.length, totalVotes: calls.length };
      }),
      getCountedBallots: jest.fn(async (filters: Record<string, unknown>) => ({ data: [], mode: filters.mode, page: filters.page, limit: filters.limit })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [{ provide: ResultsService, useValue: results }],
    })
      .overrideGuard(ResultsPeriodGuard).useValue({ canActivate: () => true })
      .overrideGuard(PreliminaryResultsGuard).useValue({ canActivate: () => true })
      .overrideGuard(TerritorialScopeGuard).useValue({ canActivate: () => true })
      .overrideInterceptor(CanonicalCacheInterceptor).useValue({ intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const finalFirst = await request(app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    const finalSecond = await request(app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    const live = await request(app.getHttpServer()).get('/api/v1/results/live/by-location?electionId=e-1&electionType=municipal');
    const liveBallots = await request(app.getHttpServer()).get('/api/v1/results/live/ballots?electionId=e-1&electionType=municipal');
    const finalBallots = await request(app.getHttpServer()).get('/api/v1/results/final/ballots?electionId=e-1&electionType=municipal');

    expect(finalFirst.body).toEqual({ mode: 'final', sequence: 1, totalVotes: 1 });
    expect(finalSecond.body).toEqual({ mode: 'final', sequence: 2, totalVotes: 2 });
    expect(live.body).toEqual({ mode: 'live', sequence: 3, totalVotes: 3 });
    expect(liveBallots.body).toMatchObject({ mode: 'live', page: 1, limit: 20 });
    expect(finalBallots.body).toMatchObject({ mode: 'final', page: 1, limit: 20 });
    expect(calls).toEqual([
      { electionId: 'e-1', electionType: 'municipal' },
      { electionId: 'e-1', electionType: 'municipal' },
      { electionId: 'e-1', electionType: 'municipal', mode: 'live' },
    ]);
    expect(results.getCountedBallots).toHaveBeenNthCalledWith(1, {
      electionId: 'e-1',
      electionType: 'municipal',
      mode: 'live',
      page: 1,
      limit: 20,
    });
    expect(results.getCountedBallots).toHaveBeenNthCalledWith(2, {
      electionId: 'e-1',
      electionType: 'municipal',
      mode: 'final',
      page: 1,
      limit: 20,
    });
  });
});
