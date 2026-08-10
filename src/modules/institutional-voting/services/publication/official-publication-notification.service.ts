import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import * as admin from 'firebase-admin';
import { Model, Types } from 'mongoose';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { User, UserDocument } from '@/modules/users/schemas/user.schema';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import { VotingEvent, VotingEventDocument } from '../../schemas/voting-event.schema';
import {
  OfficialPublicationNotificationOutbox,
  OfficialPublicationNotificationOutboxDocument,
} from '../../schemas/official-publication-notification-outbox.schema';
import {
  OfficialPublicationRequestDocument,
} from '../../schemas/official-publication-request.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';

const NOTIFICATION_TYPE = 'OFFICIAL_PUBLICATION_REQUEST';
const INSTITUTIONAL_AUTHORIZATION_NOTIFICATION_TYPE = 'MOBILE_AUTHORIZATION_REQUESTED';
const MAX_ATTEMPTS = 5;

@Injectable()
export class OfficialPublicationNotificationService {
  private readonly logger = new Logger(OfficialPublicationNotificationService.name);

  constructor(
    @Inject('FIREBASE_ADMIN') private readonly fb: typeof admin,
    @InjectModel(OfficialPublicationNotificationOutbox.name)
    private readonly outboxModel: Model<OfficialPublicationNotificationOutboxDocument>,
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(UserNotification.name)
    private readonly userNotificationModel: Model<UserNotification>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLog>,
  ) {}

  async enqueueForRequest(request: OfficialPublicationRequestDocument) {
    if (request.status !== 'PENDING_APPROVAL') {
      return { enqueued: false, skipped: 'not_pending_approval' };
    }

    const event = await this.votingEventModel.findById(request.eventId).lean();
    if (!event) {
      return { enqueued: false, skipped: 'event_not_found' };
    }

    if (!this.isWindowOpen(event)) {
      return this.cancelExisting(request, 'PUBLICATION_WINDOW_CLOSED');
    }

    const signer = await this.roledUserModel
      .findOne({ _id: request.signerUserId, active: true }, { dni: 1, name: 1 })
      .lean();
    if (!signer?.dni) {
      return { enqueued: false, skipped: 'signer_not_found' };
    }

    const assignment = await this.assignmentModel
      .findOne({
        _id: request.assignmentId,
        tenantId: request.tenantId,
        userId: request.signerUserId,
        active: true,
        status: 'APPROVED',
        accountAddressNormalized: request.smartAccountAddress.toLowerCase(),
      })
      .lean();
    if (!assignment) {
      return { enqueued: false, skipped: 'assignment_not_active' };
    }

    const dni = this.normalizeDni(signer.dni);
    const mobileUser = await this.findMobileUser(dni);
    if (!mobileUser) {
      return { enqueued: false, skipped: 'mobile_user_not_found' };
    }
    const topic = this.buildUserTopic(mobileUser._id);
    const deduplicationKey = `${NOTIFICATION_TYPE}:${request.requestId}:${String(request.signerUserId)}`;
    const notificationId = `opub_${request.requestId}`;
    const title = 'Confirmación de publicación';
    const body = `Tienes que confirmar la publicación oficial de “${event.name}”.`;
    const data = this.buildPayloadData({
      notificationId,
      request,
      event,
      deduplicationKey,
    });

    await this.ensureHistory({
      deduplicationKey,
      mobileUser,
      dni,
      topic,
      title,
      body,
      data,
    });

    const outbox = await this.outboxModel.findOneAndUpdate(
      { deduplicationKey },
      {
        $setOnInsert: {
          notificationId,
          deduplicationKey,
          type: NOTIFICATION_TYPE,
          requestId: request.requestId,
          eventId: request.eventId,
          recipientUserId: request.signerUserId,
          recipientMobileUserId: mobileUser._id,
          recipientIdentityId: dni,
          recipientTopic: topic,
          smartAccountAddress: request.smartAccountAddress.toLowerCase(),
          title,
          body,
          data,
          status: 'PENDING',
          attemptCount: 0,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    void this.processDueOutbox(1).catch((error) => {
      this.logger.warn({
        requestId: request.requestId,
        errorCode: 'OFFICIAL_PUBLICATION_NOTIFICATION_PROCESS_FAILED',
        message: error?.message || String(error),
      });
    });

    return { enqueued: true, notificationId, deduplicationKey, outbox };
  }

  async enqueueForInstitutionalAuthorization(applicationId: string) {
    if (!Types.ObjectId.isValid(applicationId)) {
      return { enqueued: false, skipped: 'authorization_not_found' };
    }
    const application = await this.applicationModel.findById(applicationId).lean();
    if (application?.status !== 'PENDING_MOBILE_AUTHORIZATION' || !application.tenantId) {
      return { enqueued: false, skipped: 'not_pending_mobile_authorization' };
    }
    const tenant = await this.tenantModel.findById(application.tenantId).lean();
    const signer = await this.resolveInstitutionalAuthorizationSigner(application);
    if (!tenant || !signer?.userId || !signer.accountAddress) {
      return { enqueued: false, skipped: 'primary_signer_not_found' };
    }
    const signerUser = await this.roledUserModel
      .findOne({ _id: signer.userId, active: true }, { dni: 1 })
      .lean();
    if (!signerUser?.dni) return { enqueued: false, skipped: 'signer_not_found' };

    const dni = this.normalizeDni(signerUser.dni);
    const mobileUser = await this.findMobileUser(dni);
    if (!mobileUser) return { enqueued: false, skipped: 'mobile_user_not_found' };

    const notificationId = `iauth_${String(application._id)}`;
    const deduplicationKey = `${INSTITUTIONAL_AUTHORIZATION_NOTIFICATION_TYPE}:${String(application._id)}:${String(signer.userId)}`;
    const topic = this.buildUserTopic(mobileUser._id);
    const title = 'Autorización pendiente';
    const body = `Revisa esta solicitud de ${tenant.name}.`;
    const data = {
      type: INSTITUTIONAL_AUTHORIZATION_NOTIFICATION_TYPE,
      applicationId: String(application._id),
      action: String(application.mobileAuthorizationAction || 'ADD_AUTHORIZED_ADDRESS'),
      deduplicationKey,
    };

    await this.ensureHistory({ deduplicationKey, mobileUser, dni, topic, title, body, data });
    const outbox = await this.outboxModel.findOneAndUpdate(
      { deduplicationKey },
      { $setOnInsert: {
        notificationId, deduplicationKey, type: INSTITUTIONAL_AUTHORIZATION_NOTIFICATION_TYPE,
        applicationId: application._id, tenantId: application.tenantId,
        recipientUserId: signer.userId, recipientMobileUserId: mobileUser._id,
        recipientIdentityId: dni, recipientTopic: topic,
        smartAccountAddress: String(signer.accountAddress).toLowerCase(),
        title, body, data, status: 'PENDING', attemptCount: 0, nextAttemptAt: new Date(),
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    void this.processDueOutbox(1).catch(() => undefined);
    return { enqueued: true, notificationId, deduplicationKey, outbox };
  }

  async processDueOutbox(limit = 10) {
    const now = new Date();
    const candidates = await this.outboxModel
      .find({
        status: { $in: ['PENDING', 'FAILED_RETRYABLE'] },
        nextAttemptAt: { $lte: now },
      })
      .sort({ nextAttemptAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();

    const results: Array<unknown> = [];
    for (const candidate of candidates) {
      results.push(await this.processOne(candidate.notificationId));
    }
    return results;
  }

  async processOne(notificationId: string) {
    const lockId = randomUUID();
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 60_000);
    const item = await this.outboxModel.findOneAndUpdate(
      {
        notificationId,
        status: { $in: ['PENDING', 'FAILED_RETRYABLE'] },
        $or: [
          { lockedUntil: null },
          { lockedUntil: { $exists: false } },
          { lockedUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: 'SENDING',
          lockId,
          lockedUntil,
        },
        $inc: { attemptCount: 1 },
      },
      { new: true },
    );

    if (!item) {
      return { processed: false, skipped: 'not_claimed' };
    }

    await this.upsertDeliveryLog(item, 'SENDING');

    try {
      const alreadySent = await this.notificationLogModel.exists({
        'data.deduplicationKey': item.deduplicationKey,
        status: 'SENT',
      });
      if (alreadySent) {
        await this.outboxModel.updateOne(
          { _id: item._id },
          {
            $set: {
              status: 'SENT',
              lockId: null,
              lockedUntil: null,
              lastErrorCode: null,
            },
          },
        );
        return { processed: true, status: 'SENT', skipped: 'already_sent' };
      }

      if (item.type !== INSTITUTIONAL_AUTHORIZATION_NOTIFICATION_TYPE) {
        const event = await this.votingEventModel.findById(item.eventId).lean();
        if (!event || !this.isWindowOpen(event)) {
          await this.markCancelled(item, 'PUBLICATION_WINDOW_CLOSED');
          return { processed: true, status: 'CANCELLED' };
        }
      } else if (!(await this.isInstitutionalAuthorizationDeliverable(item))) {
        await this.markCancelled(item, 'INSTITUTIONAL_AUTHORIZATION_NOT_DELIVERABLE');
        return { processed: true, status: 'CANCELLED' };
      }

      const messageId = await this.fb.messaging().send({
        topic: item.recipientTopic,
        notification: {
          title: item.title,
          body: item.body,
        },
        data: item.data,
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      });

      await this.outboxModel.updateOne(
        { _id: item._id },
        {
          $set: {
            status: 'SENT',
            sentAt: new Date(),
            messageId,
            lockId: null,
            lockedUntil: null,
            lastErrorCode: null,
          },
        },
      );
      await this.upsertDeliveryLog(item, 'SENT', { messageId });
      return { processed: true, status: 'SENT', messageId };
    } catch (error: any) {
      const errorCode = this.safeErrorCode(error);
      const permanent = this.isPermanentFirebaseError(errorCode);
      const attempts = item.attemptCount ?? 1;
      const shouldRetry = !permanent && attempts < MAX_ATTEMPTS;
      const nextStatus = shouldRetry ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
      const nextAttemptAt = shouldRetry
        ? new Date(Date.now() + this.backoffMs(attempts))
        : item.nextAttemptAt;

      await this.outboxModel.updateOne(
        { _id: item._id },
        {
          $set: {
            status: nextStatus,
            nextAttemptAt,
            lastErrorCode: errorCode,
            lockId: null,
            lockedUntil: null,
          },
        },
      );
      await this.upsertDeliveryLog(item, nextStatus, { error: errorCode });
      return { processed: true, status: nextStatus, errorCode };
    }
  }

  private async ensureHistory(params: {
    deduplicationKey: string;
    mobileUser: UserDocument;
    dni: string;
    topic: string;
    title: string;
    body: string;
    data: Record<string, string>;
  }) {
    const existing = await this.userNotificationModel.exists({
      'data.deduplicationKey': params.deduplicationKey,
    });
    if (existing) {
      return;
    }

    await this.userNotificationModel.create({
      userId: params.mobileUser._id,
      dni: params.dni,
      topic: params.topic,
      title: params.title,
      body: params.body,
      data: params.data,
      status: 'NEW',
    });
  }

  private async upsertDeliveryLog(
    item: OfficialPublicationNotificationOutboxDocument,
    status: NotificationLog['status'],
    extra: { messageId?: string; error?: string } = {},
  ) {
    await this.notificationLogModel.findOneAndUpdate(
      { 'data.deduplicationKey': item.deduplicationKey },
      {
        $set: {
          type: 'generic',
          topic: item.recipientTopic,
          title: item.title,
          body: item.body,
          data: item.data,
          status,
          ...(extra.messageId ? { messageId: extra.messageId } : {}),
          ...(extra.error ? { error: extra.error } : {}),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  private async markCancelled(
    item: OfficialPublicationNotificationOutboxDocument,
    errorCode: string,
  ) {
    await this.outboxModel.updateOne(
      { _id: item._id },
      {
        $set: {
          status: 'CANCELLED',
          lastErrorCode: errorCode,
          lockId: null,
          lockedUntil: null,
        },
      },
    );
    await this.upsertDeliveryLog(item, 'CANCELLED', { error: errorCode });
  }

  private async cancelExisting(
    request: OfficialPublicationRequestDocument,
    errorCode: string,
  ) {
    await this.outboxModel.updateMany(
      { requestId: request.requestId, status: { $in: ['PENDING', 'SENDING', 'FAILED_RETRYABLE'] } },
      {
        $set: {
          status: 'CANCELLED',
          lastErrorCode: errorCode,
          lockId: null,
          lockedUntil: null,
        },
      },
    );
    return { enqueued: false, skipped: errorCode };
  }

  private buildPayloadData(params: {
    notificationId: string;
    request: OfficialPublicationRequestDocument;
    event: VotingEventDocument | VotingEvent;
    deduplicationKey: string;
  }): Record<string, string> {
    const requestId = params.request.requestId;
    const eventId = String(params.request.eventId);
    return {
      type: NOTIFICATION_TYPE,
      notificationId: params.notificationId,
      requestId,
      route: 'OfficialPublicationRequest',
      deepLink: `tuvotodecide://official-publication/${requestId}`,
      eventId,
      electionId: eventId,
      eventName: String(params.event.name || ''),
      deduplicationKey: params.deduplicationKey,
    };
  }

  private async resolveInstitutionalAuthorizationSigner(application: any) {
    const filter: Record<string, any> = {
      tenantId: application.tenantId, institutionalRole: 'PRIMARY', active: true, status: 'APPROVED',
    };
    if (application.mobileAuthorizationAction === 'CHANGE_INSTITUTION_ADMIN') {
      if (!application.approvedBy || !application.initiatedByAssignmentId || !application.initiatedByWallet) return null;
      filter._id = application.initiatedByAssignmentId;
      filter.userId = application.approvedBy;
    }
    const signer = await this.assignmentModel.findOne(filter).lean();
    if (!signer?.accountAddress) return null;
    if (application.initiatedByWallet && String(signer.accountAddress).toLowerCase() !== String(application.initiatedByWallet).toLowerCase()) return null;
    return signer;
  }

  private async isInstitutionalAuthorizationDeliverable(item: any) {
    if (!item.applicationId) return false;
    const application = await this.applicationModel.findById(item.applicationId).lean();
    if (application?.status !== 'PENDING_MOBILE_AUTHORIZATION') return false;
    const signer = await this.resolveInstitutionalAuthorizationSigner(application);
    return Boolean(signer && String(signer.userId) === String(item.recipientUserId));
  }

  private async findMobileUser(dni: string) {
    return this.userModel.findOne({ dni, active: { $ne: false } });
  }

  private normalizeDni(dni: string) {
    return normalizeCarnet(dni) ?? String(dni ?? '').trim();
  }

  private buildUserTopic(userId: Types.ObjectId) {
    return `user_${String(userId)}`;
  }

  private isWindowOpen(event: Pick<VotingEvent, 'publishDeadline'>) {
    return Boolean(event.publishDeadline && new Date() < new Date(event.publishDeadline));
  }

  private safeErrorCode(error: any) {
    return String(error?.code || error?.errorInfo?.code || error?.message || 'FCM_ERROR')
      .slice(0, 120);
  }

  private isPermanentFirebaseError(errorCode: string) {
    return [
      'messaging/invalid-argument',
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/mismatched-credential',
    ].includes(errorCode);
  }

  private backoffMs(attempt: number) {
    return Math.min(15 * 60_000, 30_000 * Math.max(1, attempt));
  }
}
