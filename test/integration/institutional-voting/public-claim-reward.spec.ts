import request from 'supertest';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import {
  bootstrapInstitutionalVotingContext,
  teardownInstitutionalVotingContext,
} from '../../utils/institutional-voting.helpers';
// Importado después de los helpers: estos registran el jest.mock de ZkAuthService
// que emit-vote.service.ts necesita para no cargar los circuitos ZK reales.
import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';

const VALID_RECIPIENT = '0x1234567890123456789012345678901234567890';

describe('Institutional voting integration - public claim reward', () => {
  let ctx: Awaited<ReturnType<typeof bootstrapInstitutionalVotingContext>>;
  let emitVoteService: { claimReward: jest.Mock; getVoteVc: jest.Mock; emitVote: jest.Mock };

  beforeAll(async () => {
    ctx = await bootstrapInstitutionalVotingContext();
    emitVoteService = ctx.moduleRef.get(EmitVoteService);
  });

  afterAll(async () => {
    await teardownInstitutionalVotingContext(ctx);
  });

  beforeEach(() => {
    emitVoteService.claimReward = jest.fn();
  });

  it('RR-P0-06-001 otorga la recompensa y devuelve la respuesta del servicio sin exponer la prueba ZK', async () => {
    const serviceResponse = {
      body: {
        scope: [
          { id: 1, vp: { verifiableCredential: { credentialSubject: { eventId: 'event-1' } } } },
          { id: 2, vp: { verifiableCredential: { credentialSubject: { nullifier: 'nullifier-1' } } } },
        ],
      },
    };
    emitVoteService.claimReward.mockResolvedValue(serviceResponse);

    const response = await request(ctx.httpServer)
      .post('/api/v1/voting/events/claim-reward')
      .query({ recipient: VALID_RECIPIENT })
      .send({ proof: 'mock-zk-proof' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(serviceResponse);
    expect(JSON.stringify(response.body)).not.toContain('mock-zk-proof');
    expect(emitVoteService.claimReward).toHaveBeenCalledWith(
      VALID_RECIPIENT,
      { proof: 'mock-zk-proof' },
    );
  });

  it('RR-P0-06-002 devuelve 400 cuando el recipient no es una dirección de wallet válida', async () => {
    const response = await request(ctx.httpServer)
      .post('/api/v1/voting/events/claim-reward')
      .query({ recipient: 'not-an-address' })
      .send({ proof: 'mock-zk-proof' });

    expect(response.status).toBe(400);
    expect(emitVoteService.claimReward).not.toHaveBeenCalled();
  });

  it('RR-P0-06-003 devuelve 400 cuando no se envía el query param recipient', async () => {
    const response = await request(ctx.httpServer)
      .post('/api/v1/voting/events/claim-reward')
      .send({ proof: 'mock-zk-proof' });

    expect(response.status).toBe(400);
    expect(emitVoteService.claimReward).not.toHaveBeenCalled();
  });

  it('RR-P0-06-004 propaga un 400 cuando el servicio indica que la recompensa ya fue reclamada', async () => {
    emitVoteService.claimReward.mockRejectedValue(
      new BadRequestException('User has already claimed the reward'),
    );

    const response = await request(ctx.httpServer)
      .post('/api/v1/voting/events/claim-reward')
      .query({ recipient: VALID_RECIPIENT })
      .send({ proof: 'mock-zk-proof' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('User has already claimed the reward');
  });

  it('RR-P0-06-005 propaga un 500 cuando el servicio falla de forma inesperada al reclamar la recompensa', async () => {
    emitVoteService.claimReward.mockRejectedValue(
      new InternalServerErrorException('An error occurred while casting the vote'),
    );

    const response = await request(ctx.httpServer)
      .post('/api/v1/voting/events/claim-reward')
      .query({ recipient: VALID_RECIPIENT })
      .send({ proof: 'mock-zk-proof' });

    expect(response.status).toBe(500);
  });
});
