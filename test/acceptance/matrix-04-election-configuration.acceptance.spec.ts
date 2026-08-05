jest.mock('@/core/guards/zk-auth.guard', () => ({ ZkAuthGuard: class ZkAuthGuard {} }));
jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({
  InstitutionalVotingService: class InstitutionalVotingService {},
}));

import { BadRequestException, CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { InstitutionalVotingAdminController } from '@/modules/institutional-voting/controllers/institutional-voting-admin.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';

const admin = { sub: 'mx04-admin', role: 'ADMIN', tenantId: 'tenant-1' };
const tenantId = '507f1f77bcf86cd799439011';
const jwtGuard = {
  canActivate: jest.fn((context: ExecutionContext) => {
    context.switchToHttp().getRequest<{ user?: typeof admin }>().user = admin;
    return true;
  }),
} satisfies CanActivate;

describe('MX-04 Backend Results — aceptación canónica', () => {
  let app: INestApplication | undefined;
  const voting = { getEventDetail: jest.fn(), createEvent: jest.fn() } satisfies Partial<InstitutionalVotingService>;
  const server = () => {
    if (!app) throw new Error('Nest acceptance app unavailable');
    return app.getHttpServer();
  };

  beforeAll(async () => {
    const builder = Test.createTestingModule({
      controllers: [InstitutionalVotingAdminController],
      providers: [
        { provide: InstitutionalVotingService, useValue: voting },
        { provide: TvdCapacityService, useValue: { getEventCapacity: jest.fn() } },
      ],
    });
    builder.overrideGuard(JwtAuthGuard).useValue(jwtGuard);
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    app.useGlobalGuards(jwtGuard);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => { if (app) await app.close(); });
  beforeEach(() => {
    jest.clearAllMocks();
    voting.getEventDetail.mockResolvedValue({ id: 'event-1', state: 'DRAFT', isReferendum: false });
    voting.createEvent.mockResolvedValue({ id: 'event-1', state: 'DRAFT', tenantId });
  });

  it('[MX-04][ELE-LST-P1-006][ACEPTACION] entrega detalle con estado y tipo actuales para navegación', async () => {
    const states = [['DRAFT', false], ['DRAFT', true], ['READY_FOR_REVIEW', false], ['OFFICIALLY_PUBLISHED', false], ['ACTIVE', false], ['CLOSED', false], ['RESULTS_PUBLISHED', false]] as const;
    for (const [state, isReferendum] of states) {
      voting.getEventDetail.mockResolvedValueOnce({ id: 'event-1', state, isReferendum });
      const response = await request(server()).get('/api/v1/voting/events/event-1').set('Authorization', 'Bearer token').expect(200);
      expect(response.body).toMatchObject({ id: 'event-1', state, isReferendum });
    }
    expect(voting.getEventDetail).toHaveBeenCalledWith('event-1', admin);
  });

  it('[MX-04][ELE-NEW-P0-002][ACEPTACION] rechaza todas las longitudes inválidas de nombre y objetivo', async () => {
    const dates = { tenantId, votingStart: '2030-07-10T08:00:00.000Z', votingEnd: '2030-07-10T10:00:00.000Z', resultsPublishAt: '2030-07-10T11:00:00.000Z' };
    const invalidPayloads = [
      { ...dates, name: '', objective: 'Objetivo válido de votación' },
      { ...dates, name: 'ab', objective: 'Objetivo válido de votación' },
      { ...dates, name: 'n'.repeat(161), objective: 'Objetivo válido de votación' },
      { ...dates, name: 'Nombre válido', objective: '' },
      { ...dates, name: 'Nombre válido', objective: 'corta' },
      { ...dates, name: 'Nombre válido', objective: 'o'.repeat(1001) },
    ];
    for (const payload of invalidPayloads) {
      await request(server()).post('/api/v1/voting/events').set('Authorization', 'Bearer token').send(payload).expect(400);
    }
    expect(voting.createEvent).not.toHaveBeenCalled();
  });

  it('[MX-04][ELE-NEW-P1-007][ACEPTACION] devuelve error de creación sin presentar evento persistido', async () => {
    voting.createEvent.mockRejectedValueOnce(new BadRequestException('Fechas incompatibles'));
    const response = await request(server()).post('/api/v1/voting/events').set('Authorization', 'Bearer token')
      .send({ tenantId, name: 'Elección válida', objective: 'Objetivo suficientemente descriptivo', votingStart: '2030-07-10T08:00:00.000Z', votingEnd: '2030-07-10T10:00:00.000Z', resultsPublishAt: '2030-07-10T11:00:00.000Z' }).expect(400);
    expect(response.body.message).toBe('Fechas incompatibles');
    expect(voting.createEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId }), expect.anything());
    expect(response.body).not.toHaveProperty('id');
  });

  it('[MX-04][ELE-HTTP-P0-001][ACEPTACION] rechaza formato de fecha inválido sin invocar creación', async () => {
    const response = await request(server()).post('/api/v1/voting/events').set('Authorization', 'Bearer token')
      .send({ tenantId, name: 'Elección válida', objective: 'Objetivo suficientemente descriptivo', votingStart: 'fecha-inválida', votingEnd: '2030-07-10T10:00:00.000Z', resultsPublishAt: '2030-07-10T11:00:00.000Z' }).expect(400);
    expect(response.body).toEqual(expect.objectContaining({ statusCode: 400 }));
    expect(response.body).not.toHaveProperty('id');
    expect(voting.createEvent).not.toHaveBeenCalled();
  });
});

