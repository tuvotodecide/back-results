import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as admin from 'firebase-admin';
import { MailService } from '@/modules/mail/mail.service';
import { VoteContractReads } from '@/api/vote';
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
  VotingEventState,
} from '../../schemas/voting-event.schema';
import { PadronUsersService } from '../core/padron-users.service';

const CONVOCATION_DATA_TYPE = 'INSTITUTIONAL_PADRON_REVIEW_OPEN';
const VOTE_REWARD_AVAILABLE_TYPE = 'VOTE_REWARD_AVAILABLE';

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

type VotingReminderPhase = 'START' | 'END';
type VotingReminderOffsetMinutes = 60 | 15;

@Injectable()
export class InstitutionalVotingNotificationsService {
  private readonly logger = new Logger(InstitutionalVotingNotificationsService.name);
  private readonly chain: string;
  private readonly broadcastTopic: string;
  private readonly tokenAddr: string;

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
    private readonly configService: ConfigService,
  ) {
    this.chain = this.configService.get<string>(
      'app.blockchain.chain',
    )!;
    this.broadcastTopic = this.configService.get<string>(
      'app.notifications.broadcastTopic',
    )!;
    this.tokenAddr = this.configService.get<string>(
      'app.tvd.tokenContractAddress',
    )!;
  }

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

  private formatVotingReminderTime(deadline?: Date | null) {
    if (!deadline) {
      return '';
    }

    return new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz',
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

    if (event.isOpenVoting) {
      return this.notifyConvocationBroadcast(event, payload, mode);
    }

    const recipients = (
      await this.padronUsersService.getResolvedPadronUsersFomEvent(event, {
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

  private async notifyConvocationBroadcast(
    event: VotingEventDocument,
    payload: NotificationPayload,
    mode: 'initial' | 'incremental',
  ) {
    if (event.convocationNotifiedAt) {
      return {
        status: 'no_pending_voters',
        mode,
        totalEligible: 0,
        alreadyNotified: 1,
        newlyNotified: 0,
        skippedWithoutUser: 0,
        failed: 0,
      };
    }

    const { sent, failed } = await this.sendBroadcastNotification(payload);

    if (sent > 0) {
      await this.votingEventModel.updateOne(
        { _id: event._id },
        { $set: { convocationNotifiedAt: new Date() } },
      );
    }

    return {
      status: sent > 0 ? 'success' : 'failed',
      mode,
      totalEligible: sent + failed,
      alreadyNotified: 0,
      newlyNotified: sent,
      skippedWithoutUser: 0,
      failed,
    };
  }

  private async sendBroadcastNotification(payload: NotificationPayload) {
    const topic = this.broadcastTopic;

    let status: 'SENT' | 'FAILED' = 'SENT';
    let messageId: string | undefined;
    let error: string | undefined;

    try {
      messageId = await this.fb.messaging().send({
        topic,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      });
    } catch (e: any) {
      status = 'FAILED';
      error = e?.message || String(e);
      console.error('[InstitutionalVotingNotifications] Broadcast push delivery failed', {
        topic,
        type: payload.data?.type,
        error,
      });
    }

    await Promise.all([
      this.userNotificationModel.create({
        topic,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        status: 'NEW',
      }),
      this.notificationLogModel.create({
        type: 'generic',
        topic,
        title: payload.title,
        body: payload.body,
        data: payload.data,
        status,
        ...(messageId ? { messageId } : {}),
        ...(error ? { error } : {}),
      }),
    ]);

    return {
      sent: status === 'SENT' ? 1 : 0,
      failed: status === 'SENT' ? 0 : 1,
    };
  }

  async notifyResultsAvailableIfEligible(event: VotingEventDocument) {
    if (event.resultsNotifiedAt) return { sent: 0, skipped: 'already_notified' };
    const eventId = String(event._id);
    const publicUrl = this.buildPublicElectionUrl(eventId);
    const eventTitle = String(event.name || '').trim();
    const eventDescription = String(event.objective || '').trim();
    const out = await this.notifyResultsAvailableToCurrentPadron(event, {
      type: 'results_available',
      title: 'Resultados disponibles',
      body: eventTitle ? `Resultados de ${eventTitle}` : 'Resultados disponibles',
      data: {
        type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
        eventId,
        electionId: eventId,
        eventName: event.name,
        eventTitle,
        eventDescription,
        objective: eventDescription,
        status: 'results_available',
        votingStart: event.votingStart?.toISOString?.() ?? '',
        votingEnd: event.votingEnd?.toISOString?.() ?? '',
        resultsPublishAt: event.resultsPublishAt?.toISOString?.() ?? '',
        bannerTitle: eventTitle || 'Resultados disponibles',
        bannerSubtitle: eventDescription || 'Resultados disponibles para consultar.',
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
      },
    });

    if ((out.sent ?? 0) > 0) {
      await this.votingEventModel.updateOne(
        { _id: event._id },
        { $set: { resultsNotifiedAt: new Date() } },
      );
    }

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
      body: `${event.name} fue eliminada por el administrador.`,
      data: {
        type: 'INSTITUTIONAL_VOTING_CANCELLED',
        eventId,
        electionId: eventId,
        eventName: event.name,
        state: 'CANCELLED',
        status: 'cancelled',
        severity: 'error',
        bannerTitle: event.name,
        bannerSubtitle: 'Ya no está disponible.',
        reasonText: 'Fue eliminada por el administrador.',
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

  async notifyVoteRewardAvailableIfEligible(eventId: string, carnet: string) {
    let rewardAmount: bigint;
    let tokenBalance: bigint;
    try {
      rewardAmount = await VoteContractReads.rewardByVote(this.chain);
      tokenBalance = await VoteContractReads.getTokenBalance(this.chain, this.tokenAddr);
    } catch (error: any) {
      this.logger.warn({
        message: 'Vote reward lookup failed after confirmed participation',
        eventId,
        error: error?.message || String(error),
      });
      return { sent: 0, skipped: 'reward_lookup_failed' };
    }

    if (rewardAmount <= 0n || tokenBalance <= rewardAmount) {
      return { sent: 0, skipped: 'no_reward' };
    }

    const recipients = await this.padronUsersService.getUsersByCarnets([carnet], {
      createMissing: false,
    });
    const recipient = recipients[0];
    if (!recipient?._id) {
      return { sent: 0, skipped: 'no_linked_user' };
    }

    const userId = String(recipient._id);
    const topic = `user_${userId}`;
    const deduplicationKey = `${VOTE_REWARD_AVAILABLE_TYPE}:${eventId}:${userId}`;
    const data = {
      type: VOTE_REWARD_AVAILABLE_TYPE,
      action: 'OPEN_VOTE_REWARD',
      eventId,
      deduplicationKey,
    };

    try {
      await this.userNotificationModel.create({
        userId: recipient._id,
        dni: recipient.dni,
        topic,
        title: 'Recompensa disponible',
        body: 'Tu voto fue registrado correctamente. Tienes una recompensa disponible para reclamar.',
        data,
        status: 'NEW',
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        return { sent: 0, skipped: 'already_notified' };
      }
      this.logger.warn({
        message: 'Vote reward notification inbox registration failed',
        eventId,
        userId,
        error: error?.message || String(error),
      });
      return { sent: 0, skipped: 'notification_registration_failed' };
    }

    try {
      const messageId = await this.fb.messaging().send({
        topic,
        notification: {
          title: 'Recompensa disponible',
          body: 'Tu voto fue registrado correctamente. Tienes una recompensa disponible para reclamar.',
        },
        data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      });

      await this.notificationLogModel.create({
        type: 'generic',
        topic,
        title: 'Recompensa disponible',
        body: 'Tu voto fue registrado correctamente. Tienes una recompensa disponible para reclamar.',
        data,
        status: 'SENT',
        messageId,
      });

      return { sent: 1 };
    } catch (error: any) {
      this.logger.warn({
        message: 'Vote reward push delivery failed',
        eventId,
        userId,
        error: error?.message || String(error),
      });

      await this.notificationLogModel.create({
        type: 'generic',
        topic,
        title: 'Recompensa disponible',
        body: 'Tu voto fue registrado correctamente. Tienes una recompensa disponible para reclamar.',
        data,
        status: 'FAILED',
        error: error?.message || String(error),
      }).catch(() => undefined);

      return { sent: 0, failed: 1 };
    }
  }

  async notifyVotingReminderIfEligible(
    event: VotingEventDocument,
    phase: VotingReminderPhase,
    offsetMinutes: VotingReminderOffsetMinutes,
  ) {
    const eventId = String(event._id);
    const type = this.buildVotingReminderType(phase, offsetMinutes);
    const scheduledFor =
      (phase === 'START' ? event.votingStart : event.votingEnd)?.toISOString?.() ?? '';

    if (!this.isReminderEventStateAllowed(event.state)) {
      return { sent: 0, skipped: 'invalid_state' };
    }

    if (!scheduledFor) {
      return { sent: 0, skipped: 'missing_schedule' };
    }

    if (await this.hasSentVotingReminder(eventId, type, phase, offsetMinutes)) {
      return { sent: 0, skipped: 'already_sent' };
    }

    const publicUrl = this.buildPublicElectionUrl(eventId);
    const reminderTime = this.formatVotingReminderTime(
      phase === 'START' ? event.votingStart : event.votingEnd,
    );
    const copy = this.buildVotingReminderCopy(event.name, phase, offsetMinutes, reminderTime);
    const payload: NotificationPayload = {
      type: 'voting_reminder',
      title: copy.title,
      body: copy.body,
      data: {
        type,
        eventId,
        electionId: eventId,
        eventName: event.name,
        phase,
        offsetMinutes: String(offsetMinutes),
        scheduledFor,
        severity: 'info',
        votingStart: event.votingStart?.toISOString?.() ?? '',
        votingEnd: event.votingEnd?.toISOString?.() ?? '',
        resultsPublishAt: event.resultsPublishAt?.toISOString?.() ?? '',
        bannerTitle: copy.title,
        bannerSubtitle: copy.body,
        publicPath: this.buildPublicElectionPath(eventId),
        publicUrl,
        link: this.buildPublicElectionPath(eventId),
        deepLink: `myapp://event/${eventId}`,
      },
    };

    if (event.isOpenVoting) {
      return this.sendBroadcastNotification(payload);
    }

    const recipients = (
      await this.padronUsersService.getResolvedPadronUsersFomEvent(event, {
        includeDisabled: false,
      })
    ).filter((recipient) => recipient.enabled !== false && !!recipient._id);

    return this.notifyRecipients(payload, recipients, {}, eventId);
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
    if (event.isOpenVoting) {
      return this.sendBroadcastNotification(payload);
    }

    const recipients = await this.padronUsersService.getResolvedPadronUsersFomEvent(event, {
      includeDisabled: true,
    });

    return this.notifyRecipients(payload, recipients, additionalPerUserDniData, String(event._id));
  }

  private async notifyResultsAvailableToCurrentPadron(
    event: VotingEventDocument,
    payload: NotificationPayload,
  ) {
    if (event.isOpenVoting) {
      return this.sendBroadcastNotification(payload);
    }

    const recipients = (
      await this.padronUsersService.getResolvedPadronUsersFomEvent(event, {
        includeDisabled: false,
      })
    ).filter((recipient) => recipient.enabled !== false);

    return this.notifyRecipients(payload, recipients, {}, String(event._id));
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

  private buildVotingReminderType(
    phase: VotingReminderPhase,
    offsetMinutes: VotingReminderOffsetMinutes,
  ) {
    if (phase === 'START') {
      return offsetMinutes === 60
        ? 'INSTITUTIONAL_VOTING_STARTS_IN_1H'
        : 'INSTITUTIONAL_VOTING_STARTS_IN_15M';
    }

    return offsetMinutes === 60
      ? 'INSTITUTIONAL_VOTING_ENDS_IN_1H'
      : 'INSTITUTIONAL_VOTING_ENDS_IN_15M';
  }

  private buildVotingReminderCopy(
    eventName: string,
    phase: VotingReminderPhase,
    offsetMinutes: VotingReminderOffsetMinutes,
    reminderTime: string,
  ) {
    const actionText =
      phase === 'START'
        ? (reminderTime ? `comienza a las ${reminderTime}.` : 'está próxima a iniciar.')
        : (reminderTime ? `cierra a las ${reminderTime}.` : 'está próxima a cerrar.');
    const body = `${eventName} ${actionText}`;

    if (phase === 'START' && offsetMinutes === 60) {
      return {
        title: 'La votación inicia en 1 hora',
        body,
      };
    }

    if (phase === 'START' && offsetMinutes === 15) {
      return {
        title: 'La votación inicia en 15 minutos',
        body,
      };
    }

    if (phase === 'END' && offsetMinutes === 60) {
      return {
        title: 'La votación termina en 1 hora',
        body,
      };
    }

    return {
      title: 'La votación termina en 15 minutos',
      body,
    };
  }

  private isReminderEventStateAllowed(state: VotingEventState) {
    return ['OFFICIALLY_PUBLISHED', 'PUBLISHED'].includes(state);
  }

  private async hasSentVotingReminder(
    eventId: string,
    type: string,
    phase: VotingReminderPhase,
    offsetMinutes: VotingReminderOffsetMinutes,
  ) {
    const existing = await this.notificationLogModel.exists({
      type: 'generic',
      status: 'SENT',
      'data.eventId': eventId,
      'data.type': type,
      'data.phase': phase,
      'data.offsetMinutes': String(offsetMinutes),
    });

    return Boolean(existing);
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
