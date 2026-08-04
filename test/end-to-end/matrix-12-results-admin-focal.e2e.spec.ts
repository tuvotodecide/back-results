import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

const aggregateResult = (value: unknown) => ({ allowDiskUse: () => ({ exec: () => Promise.resolve(value) }) });

describe('MX-12 Backend Results — E2E focal en proceso', () => {
  let app: any;
  const ballotModel = { aggregate: jest.fn(), createIndexes: jest.fn(), countDocuments: jest.fn() };

  beforeAll(async () => {
    const emptyModel = { aggregate: jest.fn(), createIndexes: jest.fn(), findById: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [
        {
          provide: ResultsService,
          useFactory: () => new ResultsService(
            ballotModel as never, emptyModel as never, emptyModel as never, emptyModel as never,
            emptyModel as never, emptyModel as never, emptyModel as never,
            { getActiveConfigs: jest.fn().mockResolvedValue([]), getActiveConfig: jest.fn() } as never,
          ),
        },
        { provide: ElectionConfigService, useValue: { getActiveConfigs: jest.fn() } },
      ],
    })
      .overrideGuard(ResultsPeriodGuard).useValue({ canActivate: () => true })
      .overrideGuard(TerritorialScopeGuard).useValue({ canActivate: () => true })
      .overrideInterceptor(CanonicalCacheInterceptor).useValue({ intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('[MX-12][RES-CAS-P0-003][E2E] recorre HTTP, controller y ResultsService final con el pipeline de acta ganadora', async () => {
    ballotModel.aggregate.mockReturnValue(aggregateResult([{ results: [{ partyId: 'A', totalVotes: 10 }], summary: { validVotes: 10, blankVotes: 0, nullVotes: 0, tablesProcessed: ['T-1'] } }]));

    const response = await request(app.getHttpServer()).get('/api/v1/results/quick-count?electionType=presidential').expect(200);

    expect(response.body.summary).toMatchObject({ validVotes: 10, tablesProcessed: 1 });
    expect(JSON.stringify(ballotModel.aggregate.mock.calls[0][0])).toContain('winningBallotId');
  });

  it('[MX-12][RES-CON-P0-001][E2E] recorre la lista final sin duplicar la mesa en el contrato de paginación', async () => {
    ballotModel.aggregate
      .mockReturnValueOnce(aggregateResult([{ total: 1 }]))
      .mockReturnValueOnce(aggregateResult([{ tableCode: 'T-1', version: 2 }]));

    const response = await request(app.getHttpServer()).get('/api/v1/results/final/ballots?electionType=presidential&page=1&limit=20').expect(200);

    expect(response.body).toMatchObject({ total: 1, totalPages: 1, mode: 'final' });
    expect(response.body.data).toEqual([{ tableCode: 'T-1', version: 2 }]);
  });
});
