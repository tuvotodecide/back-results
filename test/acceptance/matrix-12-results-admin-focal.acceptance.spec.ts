import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResultsController } from '@/modules/results/controllers/results.controller';
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { ResultsPeriodGuard } from '@/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '@/modules/elections/guards/preliminary-results.guard';
import { TerritorialScopeGuard } from '@/core/guards/territorial-scope.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

describe('MX-12 Backend Results — aceptación focal', () => {
  let app: any;
  const results = {
    getQuickCount: jest.fn(), getResultsByLocation: jest.fn(), getHeatMapData: jest.fn(),
    getResultsByCircunscripcion: jest.fn(), getRegistrationProgress: jest.fn(),
    getSystemStatistics: jest.fn(), getCountedBallots: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [
        { provide: ResultsService, useValue: results },
        { provide: ElectionConfigService, useValue: { getActiveConfigs: jest.fn() } },
      ],
    })
      .overrideGuard(ResultsPeriodGuard).useValue({ canActivate: () => true })
      .overrideGuard(PreliminaryResultsGuard).useValue({ canActivate: () => true })
      .overrideGuard(TerritorialScopeGuard).useValue({ canActivate: () => true })
      .overrideInterceptor(CanonicalCacheInterceptor).useValue({ intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('[MX-12][RES-ACC-P0-001][ACEPTACION] enruta final y live a los modos controlados por guards de periodo', async () => {
    results.getQuickCount.mockResolvedValue({ results: [], summary: { validVotes: 0 }, lastUpdate: '2026-01-01T00:00:00.000Z' });

    await request(app.getHttpServer()).get('/api/v1/results/quick-count?electionId=e-final&electionType=presidential').expect(200);
    await request(app.getHttpServer()).get('/api/v1/results/live/quick-count?electionId=e-live&electionType=presidential').expect(200);

    expect(results.getQuickCount).toHaveBeenNthCalledWith(1, 'e-final', 'final', 'presidential');
    expect(results.getQuickCount).toHaveBeenNthCalledWith(2, 'e-live', 'live', 'presidential');
  });

  it('[MX-12][RES-TER-P0-001][ACEPTACION] entrega filtros territoriales y rechaza electionType no soportado', async () => {
    results.getResultsByLocation.mockResolvedValue({ results: [], summary: {}, lastUpdate: '2026-01-01T00:00:00.000Z' });

    await request(app.getHttpServer()).get('/api/v1/results/by-location?electionType=municipal&department=La%20Paz&tableCode=T-1').expect(200);
    await request(app.getHttpServer()).get('/api/v1/results/by-location?electionType=invalid').expect(400);

    expect(results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ electionType: 'municipal', department: 'La Paz', tableCode: 'T-1' }));
  });

  it('[MX-12][RES-ACC-P1-003][ACEPTACION] responde vacío para elección válida sin datos y propaga el filtro elegido', async () => {
    results.getQuickCount.mockResolvedValue({ results: [], summary: { validVotes: 0, blankVotes: 0, nullVotes: 0 }, lastUpdate: '2026-01-01T00:00:00.000Z' });

    const response = await request(app.getHttpServer()).get('/api/v1/results/quick-count?electionId=e-empty&electionType=presidential').expect(200);

    expect(response.body).toMatchObject({ results: [], summary: { validVotes: 0 } });
    expect(results.getQuickCount).toHaveBeenCalledWith('e-empty', 'final', 'presidential');
  });

  it('[MX-12][RES-SUM-P0-001][ACEPTACION] responde resumen final con elección y filtro válidos', async () => {
    results.getResultsByLocation.mockResolvedValue({ results: [{ partyId: 'A', totalVotes: 3 }], summary: { validVotes: 3, totalVotes: 3 }, lastUpdate: '2026-01-01T00:00:00.000Z' });

    const response = await request(app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=presidential&department=La%20Paz').expect(200);

    expect(response.body.summary).toMatchObject({ validVotes: 3, totalVotes: 3 });
    expect(results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ electionId: 'e-1', electionType: 'presidential', department: 'La Paz' }));
  });

  it('[MX-12][RES-SUM-P0-002][ACEPTACION] responde resultados live con el modo preliminar', async () => {
    results.getResultsByLocation.mockResolvedValue({ results: [], summary: { validVotes: 0 }, lastUpdate: '2026-01-01T00:00:00.000Z' });

    await request(app.getHttpServer()).get('/api/v1/results/live/by-location?electionId=e-live&electionType=municipal').expect(200);

    expect(results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ electionId: 'e-live', electionType: 'municipal', mode: 'live' }));
  });

  it('[MX-12][RES-CAT-P0-001][ACEPTACION] acepta cada tipo documentado y rechaza un tipo fuera del DTO', async () => {
    results.getResultsByLocation.mockResolvedValue({ results: [], summary: {}, lastUpdate: '2026-01-01T00:00:00.000Z' });

    for (const electionType of ['presidential', 'deputies', 'departamental', 'assembly', 'municipal', 'council']) {
      await request(app.getHttpServer()).get(`/api/v1/results/by-location?electionType=${electionType}`).expect(200);
    }
    await request(app.getHttpServer()).get('/api/v1/results/by-location?electionType=unsupported').expect(400);

    expect(results.getResultsByLocation).toHaveBeenCalledTimes(6);
  });

  it('[MX-12][RES-MES-P1-004][ACEPTACION] conserva total y páginas al consultar actas finales contadas', async () => {
    results.getCountedBallots.mockResolvedValue({ data: [{ tableCode: 'T-3' }], total: 3, page: 2, limit: 2, totalPages: 2, mode: 'final' });

    const response = await request(app.getHttpServer()).get('/api/v1/results/final/ballots?electionType=presidential&page=2&limit=2').expect(200);

    expect(response.body).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2, mode: 'final' });
    expect(results.getCountedBallots).toHaveBeenCalledWith(expect.objectContaining({ electionType: 'presidential', mode: 'final', page: 2, limit: 2 }));
  });

  it('[MX-12][RES-CON-P1-003][ACEPTACION] mantiene lectura idempotente para consultas repetidas', async () => {
    const payload = { results: [{ partyId: 'A', totalVotes: 5 }], summary: { validVotes: 5 }, lastUpdate: '2026-01-01T00:00:00.000Z' };
    results.getQuickCount.mockResolvedValue(payload);

    const first = await request(app.getHttpServer()).get('/api/v1/results/quick-count?electionType=presidential').expect(200);
    const second = await request(app.getHttpServer()).get('/api/v1/results/quick-count?electionType=presidential').expect(200);

    expect(second.body).toEqual(first.body);
    expect(results.getQuickCount).toHaveBeenCalledTimes(2);
  });
});
