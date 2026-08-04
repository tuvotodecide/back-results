import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({
  InstitutionalVotingService: class InstitutionalVotingServiceMock {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: class ZkAuthGuardMock {},
}));

import { InstitutionalVotingPublicController } from '@/modules/institutional-voting/controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { BallotService } from '@/modules/ballot/services/ballot.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

describe('MX-13 Backend Results — E2E focal local', () => {
  let app: INestApplication | undefined;

  beforeEach(async () => {
    const voting = {
      getPublicLanding: jest.fn(() => ({ upcoming: [], active: [], results: [{ id: 'published' }], totals: { upcoming: 0, active: 0, results: 1 } })),
      getPublicEventDetail: jest.fn((id: string) => {
        if (id === 'draft') throw new NotFoundException('Evento no disponible publicamente');
        if (id === 'published') return { id, phase: 'RESULTS', resultsAvailable: true, results: [{ option: 'A', votes: 2 }] };
        return { id, phase: 'RESULTS', resultsAvailable: true, results: [{ option: id, votes: 1 }] };
      }),
    };
    const results = {
      getResultsByLocation: jest.fn((filters: Record<string, unknown>) => ({ electionId: filters.electionId, rows: [{ electionId: filters.electionId, votes: 2 }] })),
      getCountedBallots: jest.fn(() => ({ data: [] })),
    };
    const ballots = {
      findByTableCode: jest.fn((tableCode: string, electionId?: string) => {
        if (electionId === 'other-election') throw new NotFoundException('mesa fuera de elección');
        return { tableCode, electionId: electionId ?? 'published' };
      }),
      findOne: jest.fn(() => ({ id: '507f1f77bcf86cd799439011' })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [InstitutionalVotingPublicController, ResultsController, BallotController],
      providers: [
        { provide: InstitutionalVotingService, useValue: voting },
        { provide: ResultsService, useValue: results },
        { provide: BallotService, useValue: ballots },
      ],
    })
      .overrideGuard(ResultsPeriodGuard).useValue({ canActivate: () => true })
      .overrideGuard(PreliminaryResultsGuard).useValue({ canActivate: () => true })
      .overrideGuard(TerritorialScopeGuard).useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(VotingPeriodGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideInterceptor(CanonicalCacheInterceptor).useValue({ intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('[MX-13][PUB-CNS-P0-001][E2E] no expone resultados por acceso directo no publicado y expone publicados', async () => {
    if (!app) throw new Error('MX-13 E2E app no inicializada');
    const hidden = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/draft');
    const published = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/published');
    expect(hidden.status).toBe(404); expect(JSON.stringify(hidden.body)).not.toMatch(/results|stack|token/i);
    expect(published.status).toBe(200); expect(published.body).toMatchObject({ id: 'published', resultsAvailable: true, results: [{ option: 'A', votes: 2 }] });
  });

  it('[MX-13][PUB-CNS-P0-002][E2E] mantiene listado, detalle y resultados aislados por elección', async () => {
    if (!app) throw new Error('MX-13 E2E app no inicializada');
    const landing = await request(app.getHttpServer()).get('/api/v1/voting/events/public/landing');
    const detail = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/published');
    const byLocation = await request(app.getHttpServer()).get('/api/v1/results/by-location?electionId=published&electionType=municipal');
    expect(landing.body.results).toEqual([{ id: 'published' }]);
    expect(detail.body.id).toBe('published');
    expect(byLocation.body).toEqual({ electionId: 'published', rows: [{ electionId: 'published', votes: 2 }] });
  });

  it('[MX-13][PUB-SEC-P0-002][E2E] rechaza mesa de otra elección y no filtra datos del recurso', async () => {
    if (!app) throw new Error('MX-13 E2E app no inicializada');
    const allowed = await request(app.getHttpServer()).get('/api/v1/ballots/by-table/M-1?electionId=published');
    const incompatible = await request(app.getHttpServer()).get('/api/v1/ballots/by-table/M-1?electionId=other-election');
    expect(allowed.status).toBe(200); expect(allowed.body).toMatchObject({ tableCode: 'M-1', electionId: 'published' });
    expect(incompatible.status).toBe(404); expect(JSON.stringify(incompatible.body)).not.toMatch(/tableCode|electionId|stack|token/i);
  });
});
