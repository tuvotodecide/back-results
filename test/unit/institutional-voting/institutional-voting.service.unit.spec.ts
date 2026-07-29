jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';

describe('InstitutionalVotingService reward notification after participation', () => {
  const makeService = (overrides: Record<string, any> = {}) => {
    const participationService = {
      createParticipation: jest.fn().mockResolvedValue({
        statusCode: 201,
        body: {
          id: 'participation-1',
          participated: true,
          participatedAt: '2026-01-01T12:00:00.000Z',
        },
      }),
      checkParticipationStatus: jest.fn().mockResolvedValue({
        status: 'ALREADY_VOTED',
        alreadyVoted: true,
      }),
      ...overrides.participationService,
    };
    const notificationsService = {
      notifyVoteRewardAvailableIfEligible: jest.fn().mockResolvedValue({ sent: 1 }),
      ...overrides.notificationsService,
    };
    const presentialSessionsService = {
      assertSessionCanRegisterParticipation: jest.fn().mockResolvedValue(undefined),
      completeSessionForParticipation: jest.fn().mockResolvedValue(undefined),
      ...overrides.presentialSessionsService,
    };

    const service = new InstitutionalVotingService(
      {} as any,
      {} as any,
      {} as any,
      participationService as any,
      presentialSessionsService as any,
      {} as any,
      {} as any,
      notificationsService as any,
    );

    return { service, participationService, notificationsService };
  };

  it('notifica recompensa después de crear participación y confirmar ALREADY_VOTED', async () => {
    const { service, participationService, notificationsService } = makeService();

    const result = await service.createParticipation(
      'event-1',
      { carnet: '1234567' },
      'idem-1',
    );

    expect(result.body.participated).toBe(true);
    expect(participationService.createParticipation).toHaveBeenCalledWith(
      'event-1',
      { carnet: '1234567' },
      'idem-1',
    );
    expect(participationService.checkParticipationStatus).toHaveBeenCalledWith(
      'event-1',
      '1234567',
    );
    expect(notificationsService.notifyVoteRewardAvailableIfEligible).toHaveBeenCalledWith(
      'event-1',
      '1234567',
    );
  });

  it('no consulta recompensa si la participación no queda confirmada como ALREADY_VOTED', async () => {
    const { service, notificationsService } = makeService({
      participationService: {
        checkParticipationStatus: jest.fn().mockResolvedValue({
          status: 'CAN_VOTE',
          alreadyVoted: false,
        }),
      },
    });

    await service.createParticipation('event-1', { carnet: '1234567' }, 'idem-1');

    expect(notificationsService.notifyVoteRewardAvailableIfEligible).not.toHaveBeenCalled();
  });

  it('no invalida la participación si falla el flujo de notificación posterior', async () => {
    const { service, notificationsService } = makeService({
      notificationsService: {
        notifyVoteRewardAvailableIfEligible: jest.fn().mockRejectedValue(new Error('rpc down')),
      },
    });

    const result = await service.createParticipation(
      'event-1',
      { carnet: '1234567' },
      'idem-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        statusCode: 201,
        body: expect.objectContaining({ participated: true }),
      }),
    );
    expect(notificationsService.notifyVoteRewardAvailableIfEligible).toHaveBeenCalledTimes(1);
  });
});
