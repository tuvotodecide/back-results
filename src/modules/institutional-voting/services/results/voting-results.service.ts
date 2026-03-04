import { ForbiddenException, Injectable } from '@nestjs/common';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';

@Injectable()
export class VotingResultsService {
  constructor(
    private readonly accessService: InstitutionalVotingAccessService,
  ) {}

  async getResults(eventId: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    const now = new Date();

    if (!event.resultsPublishAt || now < event.resultsPublishAt) {
      throw new ForbiddenException({ error: 'RESULTS_NOT_AVAILABLE' });
    }

    return {
      eventId: String(event._id),
      publishedAt: event.resultsPublishAt,
      source: 'BLOCKCHAIN_PENDING_INTEGRATION',
      roles: [],
    };
  }
}
