import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({
  InstitutionalVotingService: class InstitutionalVotingService {},
}));

import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { InstitutionalVotingPublicController } from '@/modules/institutional-voting/controllers/institutional-voting-public.controller';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { ZkAuthController } from '@/modules/zk-auth/controllers/zk-auth.controller';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

describe('ZK vote contract E2E (mocked)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let institutionalVotingService: {
    getVoteVc: jest.Mock;
    emitVote: jest.Mock;
  };
  let zkAuthService: {
    getAuthRequest: jest.Mock;
    getVoteRequest: jest.Mock;
    zkAuthCallback: jest.Mock;
    isApiKeyValid: jest.Mock;
  };

  beforeEach(async () => {
    institutionalVotingService = {
      getVoteVc: jest.fn().mockResolvedValue({ vc: 'mock-vc' }),
      emitVote: jest.fn().mockResolvedValue({
        body: {
          scope: [
            { id: 1, vp: { verifiableCredential: { credentialSubject: { eventId: 'event-1' } } } },
            { id: 2, vp: { verifiableCredential: { credentialSubject: { nullifier: 'nullifier-1' } } } },
          ],
        },
      }),
    };
    zkAuthService = {
      getAuthRequest: jest.fn().mockReturnValue({
        apiKey: 'mock-api-key',
        request: { body: { scope: [] } },
      }),
      getVoteRequest: jest.fn().mockReturnValue({
        request: { body: { scope: [{ id: 1 }, { id: 2 }] } },
      }),
      zkAuthCallback: jest.fn().mockResolvedValue({
        body: { scope: [] },
      }),
      isApiKeyValid: jest.fn().mockResolvedValue(true),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [InstitutionalVotingPublicController, ZkAuthController],
      providers: [
        { provide: InstitutionalVotingService, useValue: institutionalVotingService },
        { provide: ZkAuthService, useValue: zkAuthService },
        {
          provide: ZkAuthGuard,
          useValue: { canActivate: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'app.apiKey.header') return 'x-api-key';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  it('[MX-07][VOT-PRE-P0-002][E2E] GET /api/v1/voting/events/vote/cred-vc devuelve VC mínima', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/voting/events/vote/cred-vc')
      .set('x-api-key', 'mock-api-key')
      .query({ eventId: 'event-1', dni: '123456' })
      .expect(200);

    expect(response.body).toEqual({ vc: 'mock-vc' });
    expect(institutionalVotingService.getVoteVc).toHaveBeenCalledWith(
      'event-1',
      '123456',
    );
  });

  it('VOT-PRE-P0-004 / VOT-CHN-P0-001 | POST /api/v1/voting/events/vote emite voto con proof mockeado', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/voting/events/vote')
      .query({ optionId: 'blank' })
      .send({ proof: 'mock-proof' })
      .expect(200);

    expect(response.body.body.scope).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain('mock-proof');
    expect(JSON.stringify(response.body)).not.toContain('private');
    expect(institutionalVotingService.emitVote).toHaveBeenCalledWith(
      'blank',
      { proof: 'mock-proof' },
    );
  });

  it('VOT-PRE-P0-004 / VOT-ERR-P1-003 | POST /api/v1/voting/events/vote propaga error controlado de proof inválido', async () => {
    institutionalVotingService.emitVote.mockRejectedValueOnce(
      new BadRequestException('invalid mocked proof'),
    );

    await request(app.getHttpServer())
      .post('/api/v1/voting/events/vote')
      .query({ optionId: 'blank' })
      .send({ proof: 'bad-proof' })
      .expect(400);
  });

  it('VOT-CHN-P0-003 | POST /api/v1/voting/events/vote propaga error controlado de opción inexistente', async () => {
    institutionalVotingService.emitVote.mockRejectedValueOnce(
      new NotFoundException('Voting option not found'),
    );

    await request(app.getHttpServer())
      .post('/api/v1/voting/events/vote')
      .query({ optionId: 'missing-option' })
      .send({ proof: 'mock-proof' })
      .expect(404);
  });

  it('GET /api/v1/zk-auth/request devuelve apiKey y request mínimos', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/zk-auth/request')
      .expect(200);

    expect(response.body).toEqual({
      apiKey: 'mock-api-key',
      request: { body: { scope: [] } },
    });
    expect(zkAuthService.getAuthRequest).toHaveBeenCalledTimes(1);
  });

  it('GET /api/v1/zk-auth/request/vote devuelve request de voto mínimo', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/zk-auth/request/vote')
      .expect(200);

    expect(response.body.request.body.scope).toEqual([{ id: 1 }, { id: 2 }]);
    expect(zkAuthService.getVoteRequest).toHaveBeenCalledTimes(1);
  });

  it('POST /api/v1/zk-auth/callback delega sessionId y body al service mockeado', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/zk-auth/callback')
      .query({ sessionId: 'session-1' })
      .send({ proof: 'mock-proof' })
      .expect(200);

    expect(response.body).toEqual({ body: { scope: [] } });
    expect(zkAuthService.zkAuthCallback).toHaveBeenCalledWith(
      'session-1',
      { proof: 'mock-proof' },
    );
  });
});
