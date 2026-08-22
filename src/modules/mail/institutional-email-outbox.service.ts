import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { MailService } from './mail.service';
import {
  InstitutionalEmailOutbox,
  InstitutionalEmailOutboxDocument,
} from './schemas/institutional-email-outbox.schema';
import {
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import { RoledUser, RoledUserDocument } from '@/modules/auth/schemas/roledUser.schema';

type EnqueueEmailParams = {
  recipient: string;
  name: string;
  targetId: Types.ObjectId | string;
  correlationId?: string | null;
  session?: ClientSession;
};

@Injectable()
export class InstitutionalEmailOutboxService {
  private readonly logger = new Logger(InstitutionalEmailOutboxService.name);
  private readonly workerId = `institutional-email-outbox:${process.pid}:${randomUUID()}`;

  constructor(
    @InjectModel(InstitutionalEmailOutbox.name)
    private readonly outboxModel: Model<InstitutionalEmailOutboxDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
    @InjectModel(RoledUser.name)
    private readonly roledUserModel: Model<RoledUserDocument>,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  async enqueueInstitutionalVerificationEmail(params: EnqueueEmailParams) {
    const document = {
      type: 'INSTITUTIONAL_VERIFY_EMAIL' as const,
      recipient: params.recipient.trim().toLowerCase(),
      subject: 'Verifica tu solicitud de administrador institucional',
      template: 'verify-email',
      safePayload: { name: this.safeFirstName(params.name) },
      idempotencyKey: params.correlationId?.trim()
        ? this.buildIdempotencyKey(
            'INSTITUTIONAL_VERIFY_EMAIL',
            `${params.targetId}:${params.correlationId.trim()}`,
          )
        : this.buildIdempotencyKey('INSTITUTIONAL_VERIFY_EMAIL', params.targetId),
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      correlationId: params.correlationId?.trim() || null,
      targetId: this.toObjectId(params.targetId),
    };
    return this.upsertPending(document, params.session);
  }

  async enqueueInstitutionalPasswordResetEmail(params: EnqueueEmailParams) {
    const document = {
      type: 'INSTITUTIONAL_PASSWORD_RESET' as const,
      recipient: params.recipient.trim().toLowerCase(),
      subject: 'Restablecer contraseña',
      template: 'reset-password',
      safePayload: { name: this.safeFirstName(params.name) },
      idempotencyKey: this.buildIdempotencyKey('INSTITUTIONAL_PASSWORD_RESET', params.targetId),
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      correlationId: params.correlationId?.trim() || null,
      targetId: this.toObjectId(params.targetId),
    };
    return this.upsertPending(document, params.session);
  }

  async enqueueInstitutionalEmailChangeNotice(params: EnqueueEmailParams & {
    previousEmail?: string | null;
  }) {
    const document = {
      type: 'INSTITUTIONAL_EMAIL_CHANGE_NOTICE' as const,
      recipient: params.recipient.trim().toLowerCase(),
      subject: 'Correo administrativo actualizado',
      template: 'email-change-notice',
      safePayload: {
        name: this.safeFirstName(params.name),
        previousEmail: params.previousEmail?.trim().toLowerCase() ?? null,
      },
      idempotencyKey: params.correlationId?.trim()
        ? this.buildIdempotencyKey(
            'INSTITUTIONAL_EMAIL_CHANGE_NOTICE',
            `${params.targetId}:${params.correlationId.trim()}`,
          )
        : this.buildIdempotencyKey('INSTITUTIONAL_EMAIL_CHANGE_NOTICE', params.targetId),
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
      correlationId: params.correlationId?.trim() || null,
      targetId: this.toObjectId(params.targetId),
    };
    return this.upsertPending(document, params.session);
  }

  @Interval(30_000)
  async processScheduledBatch() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    if (this.configService.get<string>('INSTITUTIONAL_EMAIL_OUTBOX_WORKER_ENABLED') === 'false') {
      return;
    }
    await this.processPendingBatch();
  }

  async processPendingBatch(limit = 10) {
    const now = new Date();
    await this.markExpiredProcessingAsNeedsReview(now);
    for (let i = 0; i < limit; i += 1) {
      const claimed = await this.claimNext(now);
      if (!claimed) {
        break;
      }
      await this.processClaimed(claimed);
    }
  }

  async retryNeedsReview(outboxId: Types.ObjectId | string, nextAttemptAt = new Date()) {
    return this.outboxModel.findOneAndUpdate(
      {
        _id: this.toObjectId(outboxId),
        status: 'NEEDS_REVIEW',
      },
      {
        $set: {
          status: 'PENDING',
          nextAttemptAt,
        },
        $unset: {
          lockedAt: '',
          lockedBy: '',
          processingStartedAt: '',
          lastErrorSanitized: '',
        },
      },
      { returnDocument: 'after' },
    );
  }

  private async upsertPending(document: any, session?: ClientSession) {
    try {
      return await this.outboxModel.findOneAndUpdate(
        { idempotencyKey: document.idempotencyKey },
        {
          $setOnInsert: document,
        },
        {
          upsert: true,
          returnDocument: 'after',
          session,
        },
      );
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error;
      }
      const query = this.outboxModel.findOne({ idempotencyKey: document.idempotencyKey });
      if (session) {
        query.session(session);
      }
      return query;
    }
  }

  private async claimNext(now: Date) {
    return this.outboxModel.findOneAndUpdate(
      {
        status: { $in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { $lte: now },
        $or: [{ lockedAt: null }, { lockedAt: { $exists: false } }],
      },
      {
        $set: {
          status: 'PROCESSING',
          lockedAt: now,
          lockedBy: this.workerId,
          processingStartedAt: now,
        },
      },
      {
        sort: { nextAttemptAt: 1, createdAt: 1, _id: 1 },
        returnDocument: 'after',
      },
    );
  }

  private async processClaimed(locked: InstitutionalEmailOutboxDocument) {
    let deliveryAttempted = false;
    try {
      const data = await this.buildTemplateData(locked);
      await this.mailService.sendEmail(
        locked.recipient,
        locked.subject,
        locked.template,
        data,
      );
      deliveryAttempted = true;
      await this.outboxModel.updateOne(
        { _id: locked._id, status: 'PROCESSING', lockedBy: this.workerId },
        {
          $set: {
            status: 'SENT',
            sentAt: new Date(),
            lastErrorSanitized: null,
          },
          $unset: {
            lockedAt: '',
            lockedBy: '',
          },
        },
      );
    } catch (error) {
      const attempts = (locked.attempts ?? 0) + 1;
      await this.outboxModel.updateOne(
        { _id: locked._id, status: 'PROCESSING', lockedBy: this.workerId },
        {
          $set: deliveryAttempted
            ? {
                status: 'NEEDS_REVIEW',
                lastErrorSanitized: this.sanitizeError(error),
              }
            : {
                status: 'FAILED',
                attempts,
                nextAttemptAt: new Date(Date.now() + this.retryDelayMs(attempts)),
                lastErrorSanitized: this.sanitizeError(error),
              },
          $unset: {
            lockedAt: '',
            lockedBy: '',
          },
        },
      );
      this.logger.warn(
        `Institutional email outbox delivery failed: ${JSON.stringify({
          outboxId: String(locked._id),
          type: locked.type,
          attempts,
          status: deliveryAttempted ? 'NEEDS_REVIEW' : 'FAILED',
        })}`,
      );
    }
  }

  private async markExpiredProcessingAsNeedsReview(now: Date) {
    await this.outboxModel.updateMany(
      {
        status: 'PROCESSING',
        lockedAt: { $lte: new Date(now.getTime() - 5 * 60_000) },
      },
      {
        $set: {
          status: 'NEEDS_REVIEW',
          lastErrorSanitized: 'processing lock expired before completion',
        },
        $unset: {
          lockedAt: '',
          lockedBy: '',
        },
      },
    );
  }

  private async buildTemplateData(row: InstitutionalEmailOutboxDocument) {
    if (row.type === 'INSTITUTIONAL_VERIFY_EMAIL') {
      const application = row.targetId
        ? await this.applicationModel.findById(row.targetId).lean()
        : null;
      if (!application?.verificationToken) {
        throw new Error('verification token unavailable');
      }
      const verificationBaseUrl =
        this.configService.get<string>('app.mail.verificationBaseUrl') || '';
      if (!verificationBaseUrl) {
        throw new Error('verification base URL unavailable');
      }
      return {
        name: row.safePayload?.name,
        verificationLink: this.buildUrlWithToken(
          verificationBaseUrl,
          application.verificationToken,
          '/votacion/verificar-correo',
        ),
      };
    }

    if (row.type === 'INSTITUTIONAL_EMAIL_CHANGE_NOTICE') {
      return {
        name: row.safePayload?.name,
        previousEmail: row.safePayload?.previousEmail ?? null,
      };
    }

    const user = row.targetId ? await this.roledUserModel.findById(row.targetId).lean() : null;
    if (!user?.passwordResetToken) {
      throw new Error('password reset token unavailable');
    }
    const resetBaseUrl = this.configService.get<string>('app.mail.passwordResetBaseUrl') || '';
    if (!resetBaseUrl) {
      throw new Error('password reset base URL unavailable');
    }
    return {
      name: row.safePayload?.name,
      resetLink: this.buildUrlWithToken(
        resetBaseUrl,
        user.passwordResetToken,
        '/votacion/restablecer',
      ),
    };
  }

  private buildUrlWithToken(baseUrl: string, token: string, canonicalPath: string): string {
    try {
      const url = new URL(baseUrl);
      url.pathname = canonicalPath;
      url.search = '';
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      const normalizedBase = baseUrl.replace(/\/$/, '');
      return `${normalizedBase}${canonicalPath}?token=${token}`;
    }
  }

  private retryDelayMs(attempts: number): number {
    return Math.min(60 * 60_000, Math.max(1, attempts) * 60_000);
  }

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, 200);
  }

  private safeFirstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? '';
  }

  private toObjectId(value: Types.ObjectId | string): Types.ObjectId {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }

  private buildIdempotencyKey(type: string, targetId: Types.ObjectId | string): string {
    return `${type}:${String(targetId)}`;
  }
}
