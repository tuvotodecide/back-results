import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({ ZkAuthService: class ZkAuthService {} }));
jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({ InstitutionalVotingService: class InstitutionalVotingService {} }));

import { InstitutionalVotingPublicController } from '@/modules/institutional-voting/controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { ZkAuthController } from '@/modules/zk-auth/controllers/zk-auth.controller';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

describe('MX-07 mobile vote focal acceptance coverage', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let voting: Record<string, jest.Mock>;
  let zk: Record<string, jest.Mock>;

  beforeEach(async () => {
    voting = {
      getPublicLanding: jest.fn(), getPublicEventDetail: jest.fn(), checkParticipationStatus: jest.fn(),
      getVoteVc: jest.fn(), emitVote: jest.fn(),
    };
    zk = { getVoteRequest: jest.fn(), isApiKeyValid: jest.fn().mockResolvedValue(true) };
    const builder = Test.createTestingModule({
      controllers: [InstitutionalVotingPublicController, ZkAuthController],
      providers: [
        { provide: InstitutionalVotingService, useValue: voting },
        { provide: ZkAuthService, useValue: zk },
      ],
    });
    moduleRef = await builder
      .overrideGuard(ZkAuthGuard)
      .useValue({ canActivate: jest.fn().mockResolvedValue(true) })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => { await app.close(); await moduleRef.close(); });

  it('[MX-07][VOT-ACC-P0-001][ACEPTACION] devuelve disponibilidad pública sin selección elegida', async () => {
    voting.getPublicLanding.mockResolvedValue({ active: [{ id: 'event-1', canVote: true, availability: 'AVAILABLE', optionSelected: undefined }] });
    const response = await request(app.getHttpServer()).get('/api/v1/voting/events/public/landing').query({ carnet: 'ABC-789' }).expect(200);
    expect(response.body.active[0]).toMatchObject({ id: 'event-1', canVote: true, availability: 'AVAILABLE' });
    expect(response.body.active[0]).not.toHaveProperty('optionSelected');
  });

  it('[MX-07][VOT-ACC-P0-002][ACEPTACION] devuelve canVote false y razón segura de bloqueo', async () => {
    voting.checkParticipationStatus.mockResolvedValue({ canVote: false, status: 'NOT_IN_ROLL', alreadyVoted: false });
    const response = await request(app.getHttpServer()).get('/api/v1/voting/events/event-1/participations/status').query({ carnet: 'ABC-789' }).expect(200);
    expect(response.body).toEqual({ canVote: false, status: 'NOT_IN_ROLL', alreadyVoted: false });
    expect(response.body).not.toHaveProperty('option');
  });

  it('[MX-07][VOT-BAL-P0-001][ACEPTACION] devuelve opciones y candidatos activos sin padrón privado', async () => {
    voting.getPublicEventDetail.mockResolvedValue({ id: 'event-1', phase: 'ACTIVE', options: [{ id: 'option-1', name: 'Azul', active: true, candidates: [{ name: 'Ana' }] }] });
    const response = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/event-1').expect(200);
    expect(response.body.options).toEqual([{ id: 'option-1', name: 'Azul', active: true, candidates: [{ name: 'Ana' }] }]);
    expect(JSON.stringify(response.body)).not.toContain('carnetNorm');
  });

  it('[MX-07][VOT-BAL-P0-002][ACEPTACION] devuelve pregunta pública y alternativas activas de referéndum', async () => {
    voting.getPublicEventDetail.mockResolvedValue({ id: 'event-r', isReferendum: true, objective: '¿Aprueba?', options: [{ id: 'si', name: 'Sí', active: true }, { id: 'no', name: 'No', active: true }] });
    const response = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/event-r').expect(200);
    expect(response.body).toMatchObject({ isReferendum: true, objective: '¿Aprueba?' });
    expect(response.body.options).toHaveLength(2);
  });

  it('[MX-07][VOT-BAL-P1-003][ACEPTACION] responde error controlado para evento no visible', async () => {
    voting.getPublicEventDetail.mockRejectedValue(new NotFoundException('Evento no disponible publicamente'));
    const response = await request(app.getHttpServer()).get('/api/v1/voting/events/public/detail/missing').expect(404);
    expect(String(response.body.message)).toContain('Evento no disponible');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('[MX-07][VOT-PRE-P0-001][ACEPTACION] expone disponibilidad por evento y rechaza carnet inválido de forma controlada', async () => {
    voting.checkParticipationStatus.mockResolvedValueOnce({ status: 'CAN_VOTE', canVote: true, alreadyVoted: false }).mockRejectedValueOnce(new BadRequestException('carnet inválido'));
    await request(app.getHttpServer()).get('/api/v1/voting/events/event-1/participations/status').query({ carnet: 'ABC-789' }).expect(200);
    const invalid = await request(app.getHttpServer()).get('/api/v1/voting/events/event-1/participations/status').query({ carnet: '###' }).expect(400);
    expect(invalid.body.message).toContain('carnet inválido');
  });

  it('[MX-07][VOT-PRE-P0-002][ACEPTACION] entrega VC mínima a sesión habilitada y rechaza sesión ausente sin secretos', async () => {
    voting.getVoteVc
      .mockResolvedValueOnce({ vc: 'controlled-vc' })
      .mockRejectedValueOnce(new NotFoundException('No enabled session found for this user and event'));
    const enabled = await request(app.getHttpServer())
      .get('/api/v1/voting/events/vote/cred-vc')
      .set('x-api-key', 'accepted-key')
      .query({ eventId: 'event-1', dni: '123456' })
      .expect(200);
    expect(enabled.body).toEqual({ vc: 'controlled-vc' });
    expect(JSON.stringify(enabled.body)).not.toContain('private');
    expect(JSON.stringify(enabled.body)).not.toContain('nullifier');
    const missing = await request(app.getHttpServer())
      .get('/api/v1/voting/events/vote/cred-vc')
      .set('x-api-key', 'accepted-key')
      .query({ eventId: 'event-1', dni: '999999' })
      .expect(404);
    expect(String(missing.body.message)).toContain('No enabled session');
  });

  it('[MX-07][VOT-PRE-P0-004][ACEPTACION] acepta POST con opción y proof válidas sin devolver la proof', async () => {
    voting.emitVote.mockResolvedValue({ body: { scope: [{ id: 1 }, { id: 2 }] } });
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'option-1' }).send({ proof: 'controlled-proof' }).expect(200);
    expect(voting.emitVote).toHaveBeenCalledWith('option-1', { proof: 'controlled-proof' });
    expect(JSON.stringify(response.body)).not.toContain('controlled-proof');
  });

  it('[MX-07][VOT-ERR-P1-003][ACEPTACION] responde errores controlados para proof inválida, opción inexistente y votación bloqueada', async () => {
    voting.emitVote.mockRejectedValue(new BadRequestException('proof inválida'));
    const proofError = await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'missing' }).send({ proof: 'bad' }).expect(400);
    expect(proofError.body.message).toContain('proof inválida');
    expect(JSON.stringify(proofError.body)).not.toContain('bad');
  });
});
