import { Types } from 'mongoose';
import { InstitutionalEmailOutboxService } from '@/modules/mail/institutional-email-outbox.service';

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Outbox correo institucional', () => {
  let outboxModel: any;
  let applicationModel: any;
  let roledUserModel: any;
  let mailService: any;
  let configService: any;
  let service: InstitutionalEmailOutboxService;

  beforeEach(() => {
    outboxModel = {
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      findOne: jest.fn(),
    };
    applicationModel = {
      findById: jest.fn(),
    };
    roledUserModel = {
      findById: jest.fn(),
    };
    mailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.mail.verificationBaseUrl') return 'https://front.example.test';
        if (key === 'app.mail.passwordResetBaseUrl') return 'https://front.example.test';
        return undefined;
      }),
    };
    service = new InstitutionalEmailOutboxService(
      outboxModel,
      applicationModel,
      roledUserModel,
      mailService,
      configService,
    );
  });

  const leanQuery = (value: any) => ({ lean: jest.fn().mockResolvedValue(value) });

it('D-MAIL-013 | usa idempotencyKey deterministica y no duplica outbox al encolar', async () => {
    const targetId = new Types.ObjectId();
    const created = { _id: new Types.ObjectId(), targetId };
    outboxModel.findOneAndUpdate.mockResolvedValue(created);

    await expect(
      service.enqueueInstitutionalVerificationEmail({
        recipient: 'Admin@Example.com',
        name: 'Admin Tenant',
        targetId,
      }),
    ).resolves.toBe(created);

    expect(outboxModel.findOneAndUpdate).toHaveBeenCalledWith(
      { idempotencyKey: `INSTITUTIONAL_VERIFY_EMAIL:${String(targetId)}` },
      {
        $setOnInsert: expect.objectContaining({
          idempotencyKey: `INSTITUTIONAL_VERIFY_EMAIL:${String(targetId)}`,
          recipient: 'admin@example.com',
          status: 'PENDING',
          safePayload: { name: 'Admin' },
        }),
      },
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
    expect(JSON.stringify(outboxModel.findOneAndUpdate.mock.calls[0])).not.toContain('token');
  });

it('D-MAIL-013 | reclama con una operacion atomica, envia y marca SENT', async () => {
    const outboxId = new Types.ObjectId();
    const targetId = new Types.ObjectId();
    outboxModel.findOneAndUpdate
      .mockResolvedValueOnce({
        _id: outboxId,
        type: 'INSTITUTIONAL_VERIFY_EMAIL',
        recipient: 'admin@example.com',
        subject: 'Verifica',
        template: 'verify-email',
        safePayload: { name: 'Admin' },
        targetId,
        attempts: 0,
      })
      .mockResolvedValueOnce(null);
    applicationModel.findById.mockReturnValue(leanQuery({
      _id: targetId,
      verificationToken: 'verification-token-secret',
    }));

    await service.processPendingBatch(2);

    expect(outboxModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ['PENDING', 'FAILED'] },
        nextAttemptAt: expect.any(Object),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'PROCESSING', lockedAt: expect.any(Date) }),
      }),
      expect.objectContaining({ sort: expect.any(Object), returnDocument: 'after' }),
    );
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(outboxModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: outboxId, status: 'PROCESSING' }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

it('D-MAIL-014 | si falla despues de enviar deja NEEDS_REVIEW y no agenda retry automatico', async () => {
    const outboxId = new Types.ObjectId();
    outboxModel.findOneAndUpdate
      .mockResolvedValueOnce({
        _id: outboxId,
        type: 'INSTITUTIONAL_PASSWORD_RESET',
        recipient: 'admin@example.com',
        subject: 'Reset',
        template: 'reset-password',
        safePayload: { name: 'Admin' },
        targetId: new Types.ObjectId(),
        attempts: 0,
      })
      .mockResolvedValueOnce(null);
    roledUserModel.findById.mockReturnValue(leanQuery({
      passwordResetToken: 'reset-token-secret',
    }));
    outboxModel.updateOne.mockRejectedValueOnce(new Error('db write failed')).mockResolvedValueOnce({});

    await service.processPendingBatch(1);

    expect(outboxModel.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ _id: outboxId, status: 'PROCESSING' }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'NEEDS_REVIEW' }),
      }),
    );
  });

it('D-MAIL-014 | permite reintento interno consciente de NEEDS_REVIEW sin endpoint publico', async () => {
    const outboxId = new Types.ObjectId();
    const retryAt = new Date('2026-01-01T00:00:00.000Z');
    const retried = { _id: outboxId, status: 'PENDING' };
    outboxModel.findOneAndUpdate.mockResolvedValue(retried);

    await expect(service.retryNeedsReview(outboxId, retryAt)).resolves.toBe(retried);

    expect(outboxModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: outboxId,
        status: 'NEEDS_REVIEW',
      },
      {
        $set: {
          status: 'PENDING',
          nextAttemptAt: retryAt,
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
  });
});
