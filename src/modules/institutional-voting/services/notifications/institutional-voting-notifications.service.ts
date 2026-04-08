import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as admin from 'firebase-admin';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import { PadronUsersService } from '../core/padron-users.service';

@Injectable()
export class InstitutionalVotingNotificationsService {
  constructor(
    @Inject('FIREBASE_ADMIN')
    private readonly fb: typeof admin,
    @InjectModel(UserNotification.name)
    private readonly userNotificationModel: Model<UserNotification>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLog>,
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    private readonly padronUsersService: PadronUsersService,
  ) {}

  private buildPublicElectionPath(eventId: string) {
    return `/elections/${eventId}/public`;
  }

  private buildPublicElectionUrl(eventId: string) {
    const base = String(process.env.PUBLIC_RESULTS_WEB_BASE_URL || '').trim();
    if (!base) {
      return '';
    }

    return `${base.replace(/\/+$/, '')}${this.buildPublicElectionPath(eventId)}`;
  }

  async notifyConvocationIfEligible(event: VotingEventDocument, additionalPerUserDniData: Record<string, Record<string, string>> = {}) {
    if (event.convocationNotifiedAt) return { sent: 0, skipped: 'already_notified' };
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);
    const out = await this.notifyToCurrentPadron(event, {
      type: 'convocation',
      title: 'Revision de padron disponible',
      body: `Revisa tu habilitacion para ${event.name}`,
      data: {
        type: 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
        eventId: String(event._id),
        state: String(event.state),
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
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);
    const out = await this.notifyToCurrentPadron(event, {
      type: 'results_available',
      title: 'Resultados disponibles',
      body: `Consulta los resultados de ${event.name}`,
      data: {
        type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
        eventId,
        eventName: event.name,
        votingStart: event.votingStart?.toISOString?.() ?? '',
        votingEnd: event.votingEnd?.toISOString?.() ?? '',
        resultsPublishAt: event.resultsPublishAt?.toISOString?.() ?? '',
        bannerTitle: 'Resultados publicados',
        bannerSubtitle: 'Consulta el resumen y el detalle completo',
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
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

  async notifyScheduleUpdatedToCurrentPadron(event: VotingEventDocument) {
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);

    return this.notifyToCurrentPadron(event, {
      type: 'schedule_updated',
      title: 'Horario actualizado',
      body: `Se actualizó el horario de ${event.name}`,
      data: {
        type: 'INSTITUTIONAL_SCHEDULE_UPDATED',
        eventId,
        eventName: event.name,
        votingStart: event.votingStart?.toISOString?.() ?? '',
        votingEnd: event.votingEnd?.toISOString?.() ?? '',
        resultsPublishAt: event.resultsPublishAt?.toISOString?.() ?? '',
        bannerTitle: 'Horario actualizado',
        bannerSubtitle: 'Revisa las nuevas fechas de la votación',
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        deepLink: `myapp://event/${eventId}`,
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
    const recipients = await this.padronUsersService.getPadronUsersFromEvent(event, {
      includeDisabled: true,
    });


    if (!recipients.length) {
      return { sent: 0, skipped: 'no_linked_users' };
    }

    const inboxBatch = recipients.map((u) => ({
      userId: u._id as Types.ObjectId,
      dni: u.dni,
      topic: `user_${String(u._id)}`,
      title: payload.title,
      body: payload.body,
      data: {
        ...payload.data,
        eligible: u.enabled ? 'true' : 'false',
        ...(additionalPerUserDniData[u.dni] || {}),
      },
      status: 'NEW' as const,
    }));
    await this.userNotificationModel.insertMany(inboxBatch, { ordered: false });

    const deliveryResults = await Promise.all(
      recipients.map(async (u) => {
        const topic = `user_${String(u._id)}`;
        const data = {
          ...payload.data,
          eligible: u.enabled ? 'true' : 'false',
          ...(additionalPerUserDniData[u.dni] || {}),
        };

        try {
          const messageId = await this.fb.messaging().send({
            topic,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data,
            android: { priority: 'high' },
            apns: { headers: { 'apns-priority': '10' } },
          });

          return {
            topic,
            data,
            status: 'SENT' as const,
            messageId,
          };
        } catch (error: any) {
          console.error('[InstitutionalVotingNotifications] Push delivery failed', {
            eventId: String(event._id),
            userId: String(u._id),
            dni: u.dni,
            topic,
            error: error?.message || String(error),
          });

          return {
            topic,
            data,
            status: 'FAILED' as const,
            error: error?.message || String(error),
          };
        }
      }),
    );

    await this.notificationLogModel.insertMany(
      deliveryResults.map((item) => ({
        type: 'generic',
        topic: item.topic,
        title: payload.title,
        body: payload.body,
        data: item.data,
        status: item.status,
        ...('messageId' in item && item.messageId ? { messageId: item.messageId } : {}),
        ...('error' in item && item.error ? { error: item.error } : {}),
      })),
      { ordered: false },
    );

    const sent = deliveryResults.filter((item) => item.status === 'SENT').length;
    const failed = deliveryResults.length - sent;

 
    return { sent, failed };
  }
}
