import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as admin from 'firebase-admin';
import { MailService } from '@/modules/mail/mail.service';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import { PadronUsersService } from '../core/padron-users.service';

const CONVOCATION_DATA_TYPE = 'INSTITUTIONAL_PADRON_REVIEW_OPEN';

type NotificationPayload = {
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

type NotificationRecipient = {
  _id: Types.ObjectId;
  dni: string;
  active: boolean;
  enabled: boolean;
};

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
    @InjectModel(TenantAdminAssignment.name)
    private readonly tenantAdminAssignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    private readonly padronUsersService: PadronUsersService,
    private readonly mailService: MailService,
  ) {}

  private buildPublicElectionPath(eventId: string) {
    return `/votacion/elecciones/${eventId}/publica`;
  }

  private buildPublicElectionUrl(eventId: string) {
    const base = String(process.env.PUBLIC_RESULTS_WEB_BASE_URL || '').trim();
    if (!base) {
      return '';
    }

    return `${base.replace(/\/+$/, '')}${this.buildPublicElectionPath(eventId)}`;
  }

  private formatHumanVotingStart(votingStart?: Date | null) {
    if (!votingStart) {
      return '';
    }

    return new Intl.DateTimeFormat('es', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(votingStart);
  }

  private formatReminderDeadline(deadline?: Date | null) {
    if (!deadline) {
      return '';
    }

    return new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(deadline);
  }

  async notifyConvocationIfEligible(event: VotingEventDocument, additionalPerUserDniData: Record<string, Record<string, string>> = {}) {
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);
    const mode = event.convocationNotifiedAt ? 'incremental' : 'initial';
    const payload = {
      type: 'convocation',
      title: 'Revision de padron disponible',
      body: `Revisa tu habilitacion para ${event.name}`,
      data: {
        type: CONVOCATION_DATA_TYPE,
        eventId,
        electionId: eventId,
        eventName: event.name,
        state: String(event.state),
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
        deepLink: `myapp://event/${eventId}`,
      },
    };

    const recipients = (
      await this.padronUsersService.getPadronUsersFromEvent(event, {
        includeDisabled: false,
      })
    ).filter((recipient) => recipient.enabled !== false);
    const totalEligible = recipients.length;

    if (!recipients.length) {
      return {
        status: 'no_pending_voters',
        mode,
        totalEligible,
        alreadyNotified: 0,
        newlyNotified: 0,
        skippedWithoutUser: 0,
        failed: 0,
      };
    }

    const notifiedStateByTopic = await this.getSentConvocationStateByTopic(eventId);
    const pendingRecipients = recipients.filter((recipient) => {
      const topic = this.buildUserTopic(recipient);
      const notifiedStates = notifiedStateByTopic.get(topic);
      return !notifiedStates?.has(this.toEligibleFlag(recipient));
    });

    if (!pendingRecipients.length) {
      return {
        status: 'no_pending_voters',
        mode,
        totalEligible,
        alreadyNotified: totalEligible,
        newlyNotified: 0,
        skippedWithoutUser: 0,
        failed: 0,
      };
    }

    const out = await this.notifyRecipients(
      payload,
      pendingRecipients,
      additionalPerUserDniData,
      eventId,
    );
    const sent = out.sent ?? 0;
    const failed = out.failed ?? 0;

    if (!event.convocationNotifiedAt && sent > 0) {
      await this.votingEventModel.updateOne(
        { _id: event._id },
        { $set: { convocationNotifiedAt: new Date() } },
      );
    }

    return {
      status: sent > 0 ? (failed > 0 ? 'partial_success' : 'success') : 'failed',
      mode,
      totalEligible,
      alreadyNotified: totalEligible - pendingRecipients.length,
      newlyNotified: sent,
      skippedWithoutUser: 0,
      failed,
    };
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

  async notifyOfficialPublicationConfirmed(event: VotingEventDocument) {
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);
    const humanVotingStart = this.formatHumanVotingStart(event.votingStart);
    const body = humanVotingStart
      ? `La elección ${event.name} iniciará el ${humanVotingStart}.`
      : `La elección ${event.name} fue publicada oficialmente.`;

    return this.notifyToCurrentPadron(event, {
      type: 'official_publication_confirmed',
      title: 'La elección fue publicada oficialmente',
      body,
      data: {
        type: 'INSTITUTIONAL_OFFICIAL_PUBLICATION_CONFIRMED',
        eventId,
        eventName: event.name,
        votingStart: event.votingStart?.toISOString?.() ?? '',
        votingEnd: event.votingEnd?.toISOString?.() ?? '',
        resultsPublishAt: event.resultsPublishAt?.toISOString?.() ?? '',
        bannerTitle: 'Elección publicada oficialmente',
        bannerSubtitle: body,
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
        deepLink: `myapp://event/${eventId}`,
      },
    });
  }

  async notifyVotingCancelledToCurrentPadron(event: VotingEventDocument) {
    const eventId = String(event._id);

    return this.notifyToCurrentPadron(event, {
      type: 'voting_cancelled',
      title: 'Votación eliminada',
      body: 'La votación ya no está disponible porque fue eliminada por el administrador.',
      data: {
        type: 'INSTITUTIONAL_VOTING_CANCELLED',
        eventId,
        electionId: eventId,
        eventName: event.name,
        state: 'CANCELLED',
        status: 'cancelled',
        severity: 'error',
        bannerTitle: 'Esta votación fue eliminada',
        bannerSubtitle: 'No es necesario realizar ninguna acción.',
      },
    });
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

  async notifyPadronAvailabilityEnabledForUser(
    event: VotingEventDocument,
    carnet: string,
    reason: 'ADDED_ENABLED' | 'ENABLED_DURING_VOTING',
  ) {
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);

    return this.notifyUsersByCarnet(event, [carnet], {
      type: 'padron_enabled_for_voting',
      title: 'Ya puedes votar',
      body: `Tu habilitación para ${event.name} ya está activa`,
      data: {
        type: 'INSTITUTIONAL_VOTING_ENABLED',
        eventId,
        eventName: event.name,
        reason,
        bannerTitle: 'Habilitación actualizada',
        bannerSubtitle: 'Tu registro fue actualizado y ya puedes emitir tu voto',
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
        deepLink: `myapp://event/${eventId}`,
      },
    });
  }

  async sendOfficialPublicationReminder(event: VotingEventDocument) {
    if (event.officialPublicationReminderSentAt) {
      return { sent: 0, skipped: 'already_sent' };
    }

    const assignments = await this.tenantAdminAssignmentModel
      .find(
        {
          tenantId: event.tenantId,
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        { userId: 1 },
      )
      .lean();

    const userIds = Array.from(
      new Set(assignments.map((assignment) => String(assignment.userId)).filter(Boolean)),
    );
    if (!userIds.length) {
      return { sent: 0, skipped: 'no_recipients' };
    }

    const recipients = await this.roledUserModel
      .find(
        { _id: { $in: userIds.map((id) => new Types.ObjectId(id)) }, active: true },
        { email: 1, name: 1 },
      )
      .lean();

    const mails = Array.from(
      new Map(
        recipients
          .filter((recipient) => recipient.email)
          .map((recipient) => [String(recipient.email).trim().toLowerCase(), recipient]),
      ).values(),
    );

    if (!mails.length) {
      return { sent: 0, skipped: 'no_emails' };
    }

    const deadline = this.formatReminderDeadline(event.publishDeadline);
    await Promise.all(
      mails.map((recipient) =>
        this.mailService.sendEmail(
          recipient.email,
          `Recordatorio: Confirmar publicación oficial de ${event.name}`,
          'institutional-publication-reminder',
          {
            recipientName: recipient.name,
            eventName: event.name,
            eventId: String(event._id),
            deadline,
          },
        ),
      ),
    );

    await this.markOfficialPublicationReminderSent(event);
    return { sent: mails.length };
  }

  private async notifyToCurrentPadron(
    event: VotingEventDocument,
    payload: NotificationPayload,
    additionalPerUserDniData: Record<string, Record<string, string>> = {},
  ) {
    const recipients = await this.padronUsersService.getPadronUsersFromEvent(event, {
      includeDisabled: true,
    });

    return this.notifyRecipients(payload, recipients, additionalPerUserDniData, String(event._id));
  }

  private async notifyUsersByCarnet(
    event: VotingEventDocument,
    carnets: string[],
    payload: NotificationPayload,
  ) {
    const recipients = await this.padronUsersService.getUsersByCarnets(carnets);
    return this.notifyRecipients(payload, recipients, {}, String(event._id));
  }

  private async notifyRecipients(
    payload: NotificationPayload,
    recipients: NotificationRecipient[],
    additionalPerUserDniData: Record<string, Record<string, string>> = {},
    eventIdForLog?: string,
  ) {

    if (!recipients.length) {
      return { sent: 0, skipped: 'no_linked_users' };
    }

    const inboxBatch = recipients.map((u) => ({
      userId: u._id as Types.ObjectId,
      dni: u.dni,
      topic: this.buildUserTopic(u),
      title: payload.title,
      body: payload.body,
      data: {
        ...payload.data,
        eligible: this.toEligibleFlag(u),
        carnetNorm: u.dni,
        dni: u.dni,
        userId: String(u._id),
        ...(additionalPerUserDniData[u.dni] || {}),
      },
      status: 'NEW' as const,
    }));
    await this.userNotificationModel.insertMany(inboxBatch, { ordered: false });

    const deliveryResults = await Promise.all(
      recipients.map(async (u) => {
        const topic = this.buildUserTopic(u);
        const data = {
          ...payload.data,
          eligible: this.toEligibleFlag(u),
          carnetNorm: u.dni,
          dni: u.dni,
          userId: String(u._id),
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
            dni: u.dni,
            userId: String(u._id),
            status: 'SENT' as const,
            messageId,
          };
        } catch (error: any) {
          console.error('[InstitutionalVotingNotifications] Push delivery failed', {
            eventId: eventIdForLog ?? null,
            userId: String(u._id),
            dni: u.dni,
            topic,
            error: error?.message || String(error),
          });

          return {
            topic,
            data,
            dni: u.dni,
            userId: String(u._id),
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

  private buildUserTopic(recipient: Pick<NotificationRecipient, '_id'>) {
    return `user_${String(recipient._id)}`;
  }

  private toEligibleFlag(recipient: Pick<NotificationRecipient, 'enabled'>) {
    return recipient.enabled ? 'true' : 'false';
  }

  private async getSentConvocationStateByTopic(eventId: string) {
    const rows = await this.notificationLogModel
      .find(
        {
          type: 'generic',
          status: 'SENT',
          'data.eventId': eventId,
          'data.type': CONVOCATION_DATA_TYPE,
        },
        { topic: 1, data: 1 },
      )
      .lean();

    const out = new Map<string, Set<string>>();
    for (const row of rows) {
      const topic = String(row?.topic ?? '').trim();
      if (!topic) {
        continue;
      }

      const eligible = String(row?.data?.eligible ?? 'true');
      if (!out.has(topic)) {
        out.set(topic, new Set<string>());
      }
      out.get(topic)!.add(eligible);
    }

    return out;
  }

  private async markOfficialPublicationReminderSent(event: VotingEventDocument) {
    const sentAt = new Date();
    event.officialPublicationReminderSentAt = sentAt;
    await event.save();
  }
}
