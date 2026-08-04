import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({ ZkAuthService: class ZkAuthService {} }));
jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({ InstitutionalVotingService: class InstitutionalVotingService {} }));

import { InstitutionalVotingPublicController } from '@/modules/institutional-voting/controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';

describe('MX-07 mobile vote focal E2E coverage', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let voting: { getVoteVc: jest.Mock; emitVote: jest.Mock };
  let guard: { canActivate: jest.Mock };

  beforeEach(async () => {
    voting = { getVoteVc: jest.fn().mockResolvedValue({ vc: 'controlled-vc' }), emitVote: jest.fn().mockResolvedValue({ body: { scope: [{ id: 1 }, { id: 2 }] } }) };
    guard = { canActivate: jest.fn().mockResolvedValue(true) };
    const builder = Test.createTestingModule({
      controllers: [InstitutionalVotingPublicController],
      providers: [{ provide: InstitutionalVotingService, useValue: voting }],
    });
    moduleRef = await builder.overrideGuard(ZkAuthGuard).useValue(guard).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('[MX-07][VOT-PRE-P0-003][E2E] recorre HTTP, controller y servicio con proof válida sin material criptográfico en respuesta', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'option-1' }).send({ proof: 'proof-controlled' }).expect(200);
    expect(guard.canActivate).not.toHaveBeenCalled();
    expect(voting.emitVote).toHaveBeenCalledWith('option-1', { proof: 'proof-controlled' });
    expect(JSON.stringify(response.body)).not.toContain('proof-controlled');
  });

  it('[MX-07][VOT-CHN-P0-002][E2E] confirma HTTP solo después de respuesta de servicio con evidencia válida', async () => {
    voting.emitVote.mockResolvedValueOnce({ receipt: { status: 'success' }, event: { eventName: 'Voted', args: { voteId: 'event-1' } } });
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'blank' }).send({ proof: 'proof' }).expect(200);
    expect(response.body).toMatchObject({ receipt: { status: 'success' }, event: { eventName: 'Voted' } });
  });

  it('[MX-07][VOT-CHN-P0-003][E2E] propaga prueba inválida y opción inexistente como HTTP controlado', async () => {
    voting.emitVote.mockRejectedValueOnce(new BadRequestException('proof inválida')).mockRejectedValueOnce(new NotFoundException('opción inexistente'));
    await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'option-1' }).send({ proof: 'bad' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'missing' }).send({ proof: 'valid' }).expect(404);
  });

  it('[MX-07][VOT-UX-P1-001][E2E] recorre un voto válido desde HTTP hasta respuesta confirmada controlada', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/voting/events/vote').query({ optionId: 'blank' }).send({ proof: 'proof' }).expect(200);
    expect(voting.emitVote).toHaveBeenCalledTimes(1);
    expect(response.body.body.scope).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
