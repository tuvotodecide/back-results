import { BadRequestException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
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
import { AttestationController } from '@/modules/attestation/controllers/attestation.controller';
import { AttestationService } from '@/modules/attestation/services/attestation.service';
import { VotingPeriodGuard } from '@/modules/elections/guards/voting-period.guard';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { CanonicalCacheInterceptor } from '@/core/interceptors/canonical-cache.interceptor';

type Harness = {
  app: INestApplication;
  voting: Record<string, jest.Mock>;
  results: Record<string, jest.Mock>;
  ballots: Record<string, jest.Mock>;
  attestations: Record<string, jest.Mock>;
};

async function createHarness(): Promise<Harness> {
  const voting = {
    getPublicLanding: jest.fn(async (_tenant?: string, _limit?: number, carnet?: string) => {
      if (carnet === 'bad') throw new BadRequestException('carnet invalido');
      return { upcoming: [{ id: 'up-1', phase: 'UPCOMING' }], active: [{ id: 'active-1', phase: 'ACTIVE' }], results: [{ id: 'result-1', phase: 'RESULTS' }], totals: { upcoming: 1, active: 1, results: 1 } };
    }),
    getPublicEventDetail: jest.fn(async (eventId: string) => {
      if (eventId === 'missing' || eventId === 'private') throw new NotFoundException('Evento no disponible publicamente');
      return { id: eventId, name: 'Elección pública', objective: 'O', state: 'RESULTS_PUBLISHED', phase: eventId === 'cancelled' ? 'UNAVAILABLE' : 'RESULTS', resultsAvailable: eventId !== 'cancelled', roles: [{ id: 'r-1', name: 'Alcalde', maxWinners: 1 }], options: [{ id: 'o-1', name: 'Lista Azul', active: true }], results: eventId === 'cancelled' ? [] : [{ option: 'Lista Azul', votes: 3 }] };
    }),
  };
  const results = {
    getResultsByLocation: jest.fn(async (filters: Record<string, unknown>) => {
      if (filters.electionType === 'invalid') throw new BadRequestException('electionType invalido');
      if (filters.department === 'Incompatible') throw new NotFoundException('territorio incompatible');
      return { electionId: filters.electionId, mode: filters.mode ?? 'final', totalVotes: 3, results: [{ option: 'Lista Azul', votes: 3 }] };
    }),
    getCountedBallots: jest.fn(async (filters: Record<string, unknown>) => ({ data: [{ tableCode: 'M-1', electionId: filters.electionId, mode: filters.mode }], page: filters.page, limit: filters.limit })),
  };
  const ballots = {
    findOne: jest.fn((id: string) => ({ id, tableCode: 'M-1', electionId: 'e-1' })),
    findByTableCode: jest.fn((tableCode: string, electionId?: string) => {
      if (electionId === 'other') throw new NotFoundException('mesa fuera de elección');
      return { tableCode, electionId: electionId ?? 'e-1' };
    }),
  };
  const attestations = {
    findByBallot: jest.fn(() => [{ id: 'a-1' }]),
    getMostSupportedVersion: jest.fn(() => ({ ballotId: 'b-1', version: 1, supportCount: 2, totalAttestations: 2 })),
    listCases: jest.fn(() => ({ data: [{ tableCode: 'M-1', status: 'PENDING' }] })),
    getAuditMatchReport: jest.fn(() => ({ match: true })),
  };
  const electionConfig = {
    getActiveConfigs: jest.fn().mockResolvedValue([{
      id: 'e-1',
      resultsStartDate: '2020-01-01T00:00:00.000Z',
      votingStartDate: '2020-01-01T00:00:00.000Z',
      votingEndDate: '2100-01-01T00:00:00.000Z',
      allowDataModification: true,
    }]),
  };
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [InstitutionalVotingPublicController, ResultsController, BallotController, AttestationController],
    providers: [
      { provide: InstitutionalVotingService, useValue: voting },
      { provide: ResultsService, useValue: results },
      { provide: BallotService, useValue: ballots },
      { provide: AttestationService, useValue: attestations },
      { provide: ElectionConfigService, useValue: electionConfig },
      { provide: JwtService, useValue: { verifyAsync: jest.fn() } },
      { provide: Reflector, useValue: new Reflector() },
      { provide: getConnectionToken(), useValue: { models: {}, model: jest.fn() } },
    ],
  })
    .overrideGuard(VotingPeriodGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .overrideGuard(AdminOnlyGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })
    .overrideInterceptor(CanonicalCacheInterceptor).useValue({ intercept: (_context: unknown, next: { handle: () => unknown }) => next.handle() })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, voting, results, ballots, attestations };
}

describe('MX-13 Backend Results — aceptación focal', () => {
  let harness: Harness | undefined;

  beforeEach(async () => { harness = await createHarness(); });
  afterEach(async () => { await harness?.app.close(); harness = undefined; });
  const app = () => {
    if (!harness) throw new Error('MX-13 acceptance app no inicializada');
    return harness;
  };

  it('[MX-13][PUB-LST-P0-002][ACEPTACION] responde landing agrupada y rechaza carnet inválido', async () => {
    const ok = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/landing?limit=50');
    const invalid = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/landing?carnet=bad');
    expect(ok.status).toBe(200); expect(ok.body).toEqual(expect.objectContaining({ upcoming: expect.any(Array), active: expect.any(Array), results: expect.any(Array), totals: { upcoming: 1, active: 1, results: 1 } }));
    expect(invalid.status).toBe(400); expect(invalid.body.message).toBe('carnet invalido');
  });

  it('[MX-13][PUB-LST-P1-003][ACEPTACION] reutiliza listado público sin eventos no públicos', async () => {
    const response = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/landing');
    expect(response.status).toBe(200); expect(JSON.stringify(response.body)).not.toMatch(/private|draft|admin/i);
  });

  it('[MX-13][PUB-ACC-P0-001][ACEPTACION] permite landing y resultados públicos sin Authorization', async () => {
    const landing = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/landing');
    const results = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    expect(landing.status).toBe(200); expect(results.status).toBe(200);
  });

  it('[MX-13][PUB-ACC-P0-002][ACEPTACION] responde detalle válido y controla inexistente o no público', async () => {
    const valid = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    const missing = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/missing');
    expect(valid.status).toBe(200); expect(valid.body).toMatchObject({ id: 'e-1', phase: 'RESULTS' });
    expect(missing.status).toBe(404); expect(JSON.stringify(missing.body)).not.toMatch(/stack|token|wallet/i);
  });

  it('[MX-13][PUB-STA-P0-001][ACEPTACION] entrega fase y disponibilidad pública controladas', async () => {
    const response = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ phase: 'RESULTS', resultsAvailable: true });
  });

  it('[MX-13][PUB-INF-P0-001][ACEPTACION] devuelve únicamente el detalle público permitido', async () => {
    const response = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    expect(response.body).toEqual(expect.objectContaining({ id: 'e-1', name: 'Elección pública', objective: 'O', phase: 'RESULTS' }));
    expect(JSON.stringify(response.body)).not.toMatch(/administrator|delegate|credential|wallet|token|secret/i);
  });

  it('[MX-13][PUB-INF-P0-002][ACEPTACION] expone opciones y roles públicos sin datos privados', async () => {
    const response = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    expect(response.body.roles).toEqual([expect.objectContaining({ name: 'Alcalde' })]);
    expect(response.body.options).toEqual([expect.objectContaining({ name: 'Lista Azul', active: true })]);
  });

  it('[MX-13][PUB-RES-P0-001][ACEPTACION] devuelve filas solo cuando el detalle declara resultados disponibles', async () => {
    const published = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    const cancelled = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/cancelled');
    expect(published.body).toMatchObject({ resultsAvailable: true, results: [{ option: 'Lista Azul', votes: 3 }] });
    expect(cancelled.body).toMatchObject({ phase: 'UNAVAILABLE', resultsAvailable: false, results: [] });
  });

  it('[MX-13][PUB-CAT-P1-003][ACEPTACION] responde categoría válida y controla una no admitida', async () => {
    const valid = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    const invalid = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=invalid');
    expect(valid.status).toBe(200); expect(valid.body).toMatchObject({ electionId: 'e-1', mode: 'final' });
    expect(invalid.status).toBe(400);
  });

  it('[MX-13][PUB-TER-P0-001][ACEPTACION] responde ubicación final y live con filtros públicos', async () => {
    const final = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal&department=La%20Paz');
    const live = await request(app().app.getHttpServer()).get('/api/v1/results/live/by-location?electionId=e-1&electionType=municipal&department=La%20Paz');
    expect(final.body.mode).toBe('final'); expect(live.body.mode).toBe('live');
    expect(app().results.getResultsByLocation).toHaveBeenCalledWith(expect.objectContaining({ department: 'La Paz' }));
  });

  it('[MX-13][PUB-MES-P0-002][ACEPTACION] responde ballots live, final y mesa pública compatible', async () => {
    const live = await request(app().app.getHttpServer()).get('/api/v1/results/live/ballots?electionId=e-1&electionType=municipal');
    const final = await request(app().app.getHttpServer()).get('/api/v1/results/final/ballots?electionId=e-1&electionType=municipal');
    const table = await request(app().app.getHttpServer()).get('/api/v1/ballots/by-table/M-1?electionId=e-1');
    expect(live.body.data[0].mode).toBe('live'); expect(final.body.data[0].mode).toBe('final'); expect(table.body).toMatchObject({ tableCode: 'M-1', electionId: 'e-1' });
  });

  it('[MX-13][PUB-ACT-P0-003][ACEPTACION] expone acta y atestiguamientos públicos permitidos', async () => {
    const ballot = await request(app().app.getHttpServer()).get('/api/v1/ballots/507f1f77bcf86cd799439011');
    const attestations = await request(app().app.getHttpServer()).get('/api/v1/attestations/ballot/b-1');
    expect(ballot.status).toBe(200); expect(ballot.body).toMatchObject({ tableCode: 'M-1' });
    expect(attestations.status).toBe(200); expect(attestations.body).toEqual([{ id: 'a-1' }]);
  });

  it('[MX-13][PUB-CAS-P0-004][ACEPTACION] responde most-supported, cases y audit-match con filtros válidos', async () => {
    const supported = await request(app().app.getHttpServer()).get('/api/v1/attestations/most-supported/M-1?electionId=e-1');
    const cases = await request(app().app.getHttpServer()).get('/api/v1/attestations/cases?status=PENDING&electionId=e-1');
    const audit = await request(app().app.getHttpServer()).get('/api/v1/attestations/audit-match/M-1?electionId=e-1');
    expect(supported.body).toMatchObject({ ballotId: 'b-1' }); expect(cases.body.data[0]).toMatchObject({ status: 'PENDING' }); expect(audit.body).toEqual({ match: true });
  });

  it('[MX-13][PUB-FIL-P1-001][ACEPTACION] rechaza combinación territorial incompatible sin datos', async () => {
    const response = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal&department=Incompatible');
    expect(response.status).toBe(404); expect(response.body.data).toBeUndefined();
  });

  it('[MX-13][PUB-UPD-P1-002][ACEPTACION] refleja una nueva consulta pública vigente', async () => {
    app().results.getResultsByLocation.mockResolvedValueOnce({ totalVotes: 1 }).mockResolvedValueOnce({ totalVotes: 2 });
    const first = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    const second = await request(app().app.getHttpServer()).get('/api/v1/results/by-location?electionId=e-1&electionType=municipal');
    expect(first.body.totalVotes).toBe(1); expect(second.body.totalVotes).toBe(2);
  });

  it('[MX-13][PUB-SEC-P0-001][ACEPTACION] no filtra secretos en respuestas públicas anónimas', async () => {
    const landing = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/landing');
    const detail = await request(app().app.getHttpServer()).get('/api/v1/voting/events/public/detail/e-1');
    expect(JSON.stringify({ landing: landing.body, detail: detail.body })).not.toMatch(/authorization|x-api-key|private.?key|wallet|token|admin/i);
  });
});
