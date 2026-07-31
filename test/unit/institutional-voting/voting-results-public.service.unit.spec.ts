import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VotingResultsService } from '@/modules/institutional-voting/services/results/voting-results.service';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';

describe('VotingResultsService public results (MX-13)', () => {
  let service: VotingResultsService;
  let snapshotModel: any;
  let accessService: any;

  const eventId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const publishedEvent = {
    _id: eventId,
    tenantId,
    state: 'OFFICIALLY_PUBLISHED',
    resultsPublishAt: new Date(Date.now() - 60_000),
  };

  beforeEach(() => {
    snapshotModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn().mockResolvedValue(publishedEvent),
      assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
    };
    service = new VotingResultsService(snapshotModel, accessService);
  });

  function leanResult(value: unknown) {
    return {
      lean: jest.fn().mockResolvedValue(value),
    };
  }

  async function expectForbiddenError(promise: Promise<unknown>, error: string) {
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ error }),
    });
  }

  it('[PUB-CNS-P0-001][PUB-ACC-P0-002][PUB-SEC-P0-001] bloquea lectura pública cuando estado o fecha no permiten resultados', async () => {
    accessService.getEventOrThrow.mockResolvedValueOnce({
      ...publishedEvent,
      state: 'READY_FOR_REVIEW',
    });

    await expectForbiddenError(
      service.getResults(String(eventId)),
      'RESULTS_NOT_AVAILABLE',
    );

    accessService.getEventOrThrow.mockResolvedValueOnce({
      ...publishedEvent,
      resultsPublishAt: new Date(Date.now() + 60_000),
    });

    await expectForbiddenError(
      service.getResults(String(eventId)),
      'RESULTS_NOT_AVAILABLE',
    );

    expect(snapshotModel.findOne).not.toHaveBeenCalled();
  });

  it('[PUB-RES-P0-001][PUB-CNS-P0-002][PUB-SEC-P0-001] devuelve shape público mínimo cuando no existe snapshot', async () => {
    snapshotModel.findOne.mockReturnValueOnce(leanResult(null));

    const result = await service.getResults(String(eventId));

    expect(snapshotModel.findOne).toHaveBeenCalledWith({ eventId });
    expect(result).toEqual({
      eventId: String(eventId),
      publishedAt: publishedEvent.resultsPublishAt,
      source: 'BLOCKCHAIN',
      txHash: null,
      blockNumber: null,
      roles: [],
    });
    expect(JSON.stringify(result)).not.toContain('tenantId');
    expect(JSON.stringify(result)).not.toContain('admin');
  });

  it('[PUB-RES-P0-001][PUB-RES-P0-002][PUB-CNS-P0-002] devuelve snapshot público persistido sin declarar ganador oficial', async () => {
    snapshotModel.findOne.mockReturnValueOnce(
      leanResult({
        source: 'BLOCKCHAIN',
        txHash: '0xsnapshot',
        blockNumber: '123',
        roles: institutionalVotingFixtures.resultsSnapshot.roles,
      }),
    );

    const result = await service.getResults(String(eventId));

    expect(result).toEqual({
      eventId: String(eventId),
      publishedAt: publishedEvent.resultsPublishAt,
      source: 'BLOCKCHAIN',
      txHash: '0xsnapshot',
      blockNumber: '123',
      roles: institutionalVotingFixtures.resultsSnapshot.roles,
    });
    expect(result).not.toHaveProperty('winner');
    expect(result).not.toHaveProperty('officialWinner');
  });
});
