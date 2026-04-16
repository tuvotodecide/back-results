import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import { InstitutionalVotingNotificationsService } from '../notifications/institutional-voting-notifications.service';

@Injectable()
export class InstitutionalVotingLifecycleService {
  private readonly logger = new Logger(InstitutionalVotingLifecycleService.name);

  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    private readonly notificationsService: InstitutionalVotingNotificationsService,
  ) {}

  @Cron('*/1 * * * *')
  async processLifecycle() {
    const now = new Date();
    const reminderWindowEnd = new Date(now.getTime() + 30 * 60 * 1000);

    const remindable = await this.votingEventModel
      .find({
        state: { $in: ['DRAFT', 'READY_FOR_REVIEW'] },
        publishDeadline: { $gt: now, $lte: reminderWindowEnd },
        officialPublicationReminderSentAt: { $exists: false },
      })
      .limit(50);

    for (const event of remindable) {
      try {
        await this.notificationsService.sendOfficialPublicationReminder(event);
      } catch (error: any) {
        this.logger.warn(
          `No se pudo enviar recordatorio de publicación oficial para eventId=${String(event._id)}: ${error?.message ?? error}`,
        );
      }
    }

    await this.votingEventModel.updateMany(
      {
        state: { $in: ['DRAFT', 'READY_FOR_REVIEW'] },
        publishDeadline: { $lte: now },
      },
      {
        $set: {
          state: 'PUBLICATION_EXPIRED',
          publicationExpiredAt: now,
          publicationConfirmed: false,
        },
      },
    );

    await this.votingEventModel.updateMany(
      {
        state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED'] },
        votingEnd: { $lte: now },
      },
      {
        $set: { state: 'CLOSED' },
      },
    );

    const publishable = await this.votingEventModel
      .find({
        state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'] },
        resultsPublishAt: { $lte: now },
        resultsNotifiedAt: { $exists: false },
      })
      .limit(50);

    for (const event of publishable) {
      if (event.state !== 'RESULTS_PUBLISHED') {
        event.state = 'RESULTS_PUBLISHED';
      }

      try {
        await event.save();
        await this.notificationsService.notifyResultsAvailableIfEligible(event);
        event.resultsNotificationFailedAt = undefined;
        event.resultsNotificationError = undefined;
        await event.save();
      } catch (error: any) {
        event.resultsNotificationFailedAt = new Date();
        event.resultsNotificationError = String(error?.message ?? error ?? 'unknown_error');
        await event.save();
        this.logger.warn(
          `No se pudo notificar resultados para eventId=${String(event._id)}: ${error?.message ?? error}`,
        );
      }
    }
  }
}
