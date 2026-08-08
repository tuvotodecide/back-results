import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model } from 'mongoose';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import { InstitutionalVotingNotificationsService } from '../notifications/institutional-voting-notifications.service';
import { VoteWritterService } from '../core/vote-writter.service';
import { HistoryService } from '@/modules/history/services/history.service';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';

@Injectable()
export class InstitutionalVotingLifecycleService {
  private readonly logger = new Logger(InstitutionalVotingLifecycleService.name);
  private static readonly REMINDER_WINDOW_MS = 60 * 1000;
  private static readonly VOTING_REMINDERS = [
    { phase: 'START' as const, offsetMinutes: 60 as const, field: 'votingStart' as const },
    { phase: 'START' as const, offsetMinutes: 15 as const, field: 'votingStart' as const },
    { phase: 'END' as const, offsetMinutes: 60 as const, field: 'votingEnd' as const },
    { phase: 'END' as const, offsetMinutes: 15 as const, field: 'votingEnd' as const },
  ];

  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    private readonly notificationsService: InstitutionalVotingNotificationsService,
    private readonly voteWritterService: VoteWritterService,
    private readonly historyService: HistoryService,
  ) {}

  @Cron('*/1 * * * *')
  async processLifecycle() {
    const now = new Date();
    const reminderWindowEnd = new Date(now.getTime() + 30 * 60 * 1000);

    await this.processVotingReminderNotifications(now);

    const remindable = await this.votingEventModel
      .find({
        state: { $in: ['DRAFT', 'READY_FOR_REVIEW'] },
        publishDeadline: { $gt: now, $lte: reminderWindowEnd },
        $or: [
          { officialPublicationReminderSentAt: { $exists: false } },
          { officialPublicationReminderSentAt: null },
        ],
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

    await this.processVoteLiquidation();

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

  async processVotingReminderNotifications(now = new Date()) {
    const windowStart = new Date(
      now.getTime() - InstitutionalVotingLifecycleService.REMINDER_WINDOW_MS,
    );
    const results: Array<Record<string, unknown>> = [];

    for (const reminder of InstitutionalVotingLifecycleService.VOTING_REMINDERS) {
      const scheduledFieldUpperBound = new Date(
        now.getTime() + reminder.offsetMinutes * 60 * 1000,
      );
      const scheduledFieldLowerBound = new Date(
        windowStart.getTime() + reminder.offsetMinutes * 60 * 1000,
      );
      const query: Record<string, any> = {
        state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED'] },
        [reminder.field]: {
          $gt: scheduledFieldLowerBound,
          $lte: scheduledFieldUpperBound,
        },
      };

      if (reminder.phase === 'END') {
        const votingEndLowerBound = new Date(
          Math.max(scheduledFieldLowerBound.getTime(), now.getTime()),
        );
        query.votingStart = { $lte: now };
        query.votingEnd = {
          $gt: votingEndLowerBound,
          $lte: scheduledFieldUpperBound,
        };
      }

      const events = await this.votingEventModel.find(query).limit(50);
      for (const event of events) {
        try {
          const result = await this.notificationsService.notifyVotingReminderIfEligible(
            event,
            reminder.phase,
            reminder.offsetMinutes,
          );
          results.push({
            eventId: String(event._id),
            phase: reminder.phase,
            offsetMinutes: reminder.offsetMinutes,
            ...result,
          });
        } catch (error: any) {
          this.logger.warn(
            `No se pudo enviar recordatorio de votación para eventId=${String(event._id)} phase=${reminder.phase} offset=${reminder.offsetMinutes}: ${error?.message ?? error}`,
          );
          results.push({
            eventId: String(event._id),
            phase: reminder.phase,
            offsetMinutes: reminder.offsetMinutes,
            sent: 0,
            failed: 1,
            error: String(error?.message ?? error ?? 'unknown_error'),
          });
        }
      }
    }

    return results;
  }

  async processVoteLiquidation() {
    const now = new Date();

    const endedElections = await this.votingEventModel.find(
      {
        state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'] },
        isLiquidated: false,
        votingEnd: { $lte: now },
      }
    );

    const promises = endedElections.map(async item => {
      const voteId = item._id.toString();
      try {
        const {txHash, date} = await this.voteWritterService.liquidateVote(voteId);
        await this.historyService.create({
          txHash,
          operationName: HistoryOperationKey.electionLiquidated,
          type: HistoryType.AUTOMATED,
          registerDate: date,
          electionId: voteId,
        });
        return item;
      } catch (error) {
        this.logger.error(`Error liquidating election ${voteId}: ` + error);
        throw error;
      }
    });

    const successElections = (await Promise.allSettled(promises))
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);

    await this.votingEventModel.updateMany({
      _id: { $in: successElections.map(i => i._id) }
    }, {
      $set: { isLiquidated: true }
    });
  }
}
