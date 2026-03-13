import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '@/modules/users/schemas/user.schema';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import {
  ComparisonReport,
  ComparisonReportDocument,
} from '../../schemas/comparison-report.schema';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '../../schemas/padron-version.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';

@Injectable()
export class InstitutionalVotingNotificationsService {
  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(UserNotification.name)
    private readonly userNotificationModel: Model<UserNotification>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLog>,
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
  ) {}

  async notifyConvocationIfEligible(event: VotingEventDocument, additionalPerUserDniData: Record<string, Record<string, string>> = {}) {
    if (event.convocationNotifiedAt) return { sent: 0, skipped: 'already_notified' };
    const out = await this.notifyToCurrentPadron(event, {
      type: 'convocation',
      title: 'Nueva convocatoria de votacion',
      body: `Ya puedes participar en ${event.name}`,
      data: {
        type: 'INSTITUTIONAL_EVENT_PUBLISHED',
        eventId: String(event._id),
        deepLink: `myapp://event/${String(event._id)}`,
      },
    }, additionalPerUserDniData);

    await this.votingEventModel.updateOne(
      { _id: event._id },
      { $set: { convocationNotifiedAt: new Date() } },
    );

    return out;
  }

  async notifyResultsAvailableIfEligible(event: VotingEventDocument) {
    if (event.resultsNotifiedAt) return { sent: 0, skipped: 'already_notified' };
    const out = await this.notifyToCurrentPadron(event, {
      type: 'results_available',
      title: 'Resultados disponibles',
      body: `Consulta los resultados de ${event.name}`,
      data: {
        type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
        eventId: String(event._id),
        link: `/results/${String(event._id)}`,
      },
    });

    await this.votingEventModel.updateOne(
      { _id: event._id },
      { $set: { resultsNotifiedAt: new Date() } },
    );

    return out;
  }

  async notifyNewsToCurrentPadron(
    event: VotingEventDocument,
    payload: {
      title: string;
      body: string;
      imageUrl?: string;
      link?: string;
    },
  ) {
    return this.notifyToCurrentPadron(event, {
      type: 'news',
      title: payload.title,
      body: payload.body,
      data: {
        type: 'INSTITUTIONAL_NEWS',
        eventId: String(event._id),
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        ...(payload.link ? { link: payload.link } : {}),
      },
    });
  }

  private async notifyToCurrentPadron(
    event: VotingEventDocument,
    payload: {
      type: string;
      title: string;
      body: string;
      data: Record<string, string>;
    },
    additionalPerUserDniData: Record<string, Record<string, string>> = {},
  ) {
    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    if (!currentVersion) {
      return { sent: 0, skipped: 'no_current_padron' };
    }

    const reportOk = await this.comparisonReportModel.exists({
      padronVersionId: currentVersion._id,
      status: 'OK',
    });
    if (!reportOk) {
      return { sent: 0, skipped: 'comparison_not_ok' };
    }

    const entries = await this.padronEntryModel
      .find({ padronVersionId: currentVersion._id }, { carnetNorm: 1 })
      .lean();
    if (!entries.length) {
      return { sent: 0, skipped: 'empty_padron' };
    }

    const carnetSet = new Set(entries.map((e) => e.carnetNorm));
    const users = await this.userModel.find({ active: true }, { _id: 1, dni: 1 }).lean();
    const recipients = users.filter((u) => carnetSet.has(normalizeCarnet(u.dni) ?? ''));

    if (!recipients.length) {
      return { sent: 0, skipped: 'no_linked_users' };
    }

    const topic = `tenant_${String(event.tenantId)}`;
    const batch = recipients.map((u) => ({
      userId: u._id as Types.ObjectId,
      dni: u.dni,
      topic,
      title: payload.title,
      body: payload.body,
      data: {
        ...payload.data,
        ...additionalPerUserDniData[u.dni],
      },
      status: 'NEW' as const,
    }));
    await this.userNotificationModel.insertMany(batch, { ordered: false });

    await this.notificationLogModel.create({
      type: 'generic',
      topic,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      status: 'SENT',
    });

    return { sent: recipients.length };
  }
}
