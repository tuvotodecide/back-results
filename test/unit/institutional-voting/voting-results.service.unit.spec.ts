import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { VotingResultsService } from '@/modules/institutional-voting/services/results/voting-results.service';
import { institutionalVotingFixtures } from '../../fixtures.institutional-voting';

describe('VotingResultsService (unit)', () => {
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

  async function expectForbiddenError(promise: Promise<unknown>, error: string) {
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ error }),
    });
  }

  it('upsert permite estados publicados y fuerza source BLOCKCHAIN', async () => {
    snapshotModel.findOneAndUpdate.mockResolvedValueOnce({
      eventId,
      source: 'BLOCKCHAIN',
      txHash: '0xunit',
      blockNumber: '777',
      roles: institutionalVotingFixtures.resultsSnapshot.roles,
    });

    const result = await service.upsertResultsSnapshot(
      String(eventId),
      {
        txHash: '0xunit',
        blockNumber: '777',
        roles: institutionalVotingFixtures.resultsSnapshot.roles,
      },
      { sub: 'admin-1' },
    );

    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(tenantId, {
      sub: 'admin-1',
    });
    expect(snapshotModel.findOneAndUpdate).toHaveBeenCalledWith(
      { eventId },
      {
        $set: {
          eventId,
          source: 'BLOCKCHAIN',
          txHash: '0xunit',
          blockNumber: '777',
          roles: institutionalVotingFixtures.resultsSnapshot.roles,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    expect(result).toEqual({
      eventId: String(eventId),
      source: 'BLOCKCHAIN',
      txHash: '0xunit',
      blockNumber: '777',
      roles: institutionalVotingFixtures.resultsSnapshot.roles,
    });
  });

  it('upsert bloquea estados no publicados con RESULTS_SNAPSHOT_NOT_ALLOWED', async () => {
    accessService.getEventOrThrow.mockResolvedValueOnce({
      ...publishedEvent,
      state: 'READY_FOR_REVIEW',
    });

    await expectForbiddenError(
      service.upsertResultsSnapshot(
        String(eventId),
        institutionalVotingFixtures.resultsSnapshot,
        { sub: 'admin-1' },
      ),
      'RESULTS_SNAPSHOT_NOT_ALLOWED',
    );
    expect(accessService.assertTenantWriteAccess).toHaveBeenCalledWith(tenantId, {
      sub: 'admin-1',
    });
    expect(snapshotModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
