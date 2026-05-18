import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UpsertEventResultsSnapshotDto } from '../../dto/results-snapshot.dto';
import {
  EventResultsSnapshot,
  EventResultsSnapshotDocument,
} from '../../schemas/event-results-snapshot.schema';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';

@Injectable()
export class VotingResultsService {
  constructor(
    @InjectModel(EventResultsSnapshot.name)
    private readonly snapshotModel: Model<EventResultsSnapshotDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
  ) {}

  async getResults(eventId: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    const now = new Date();

    if (!['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'].includes(event.state)) {
      throw new ForbiddenException({ error: 'RESULTS_NOT_AVAILABLE' });
    }

    if (!event.resultsPublishAt || now < event.resultsPublishAt) {
      throw new ForbiddenException({ error: 'RESULTS_NOT_AVAILABLE' });
    }

    const snapshot = await this.snapshotModel.findOne({ eventId: event._id }).lean();

    return {
      eventId: String(event._id),
      publishedAt: event.resultsPublishAt,
      source: snapshot?.source ?? 'BLOCKCHAIN',
      txHash: snapshot?.txHash ?? null,
      blockNumber: snapshot?.blockNumber ?? null,
      roles: snapshot?.roles ?? [],
    };
  }

  async upsertResultsSnapshot(
    eventId: string,
    dto: UpsertEventResultsSnapshotDto,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    if (!['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'].includes(event.state)) {
      throw new ForbiddenException({ error: 'RESULTS_SNAPSHOT_NOT_ALLOWED' });
    }

    const updated = await this.snapshotModel.findOneAndUpdate(
      { eventId: new Types.ObjectId(eventId) },
      {
        $set: {
          eventId: new Types.ObjectId(eventId),
          source: 'BLOCKCHAIN',
          txHash: dto.txHash,
          blockNumber: dto.blockNumber,
          roles: dto.roles,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return {
      eventId: String(updated.eventId),
      source: updated.source,
      txHash: updated.txHash ?? null,
      blockNumber: updated.blockNumber ?? null,
      roles: updated.roles,
    };
  }
}
