import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { MailService } from '@/modules/mail/mail.service';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';

describe('InstitutionalVotingNotificationsService (unit)', () => {
  let service: InstitutionalVotingNotificationsService;
  let tenantAdminAssignmentModel: any;
  let roledUserModel: any;
  let mailService: any;
  let userNotificationModel: any;
  let notificationLogModel: any;
  let votingEventModel: any;
  let padronUsersService: any;
  let firebaseMessaging: any;

  beforeEach(async () => {
    tenantAdminAssignmentModel = {
      find: jest.fn(),
    };
    roledUserModel = {
      find: jest.fn(),
    };
    mailService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    userNotificationModel = {
      insertMany: jest.fn().mockResolvedValue([]),
    };
    notificationLogModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
      insertMany: jest.fn().mockResolvedValue([]),
    };
    votingEventModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    padronUsersService = {
      getPadronUsersFromEvent: jest.fn(),
      getUsersByCarnets: jest.fn(),
    };
    firebaseMessaging = {
      send: jest.fn().mockResolvedValue('message-id'),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionalVotingNotificationsService,
        { provide: 'FIREBASE_ADMIN', useValue: { messaging: jest.fn(() => firebaseMessaging) } },
        {
          provide: getModelToken(UserNotification.name),
          useValue: userNotificationModel,
        },
        {
          provide: getModelToken(NotificationLog.name),
          useValue: notificationLogModel,
        },
        {
          provide: getModelToken(VotingEvent.name),
          useValue: votingEventModel,
        },
        {
          provide: getModelToken(TenantAdminAssignment.name),
          useValue: tenantAdminAssignmentModel,
        },
        { provide: getModelToken(RoledUser.name), useValue: roledUserModel },
        {
          provide: PadronUsersService,
          useValue: padronUsersService,
        },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(InstitutionalVotingNotificationsService);
  });

  it('notifica convocatoria inicial solo a empadronados habilitados y marca primera notificación', async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion inicial',
      state: 'READY_FOR_REVIEW',
      convocationNotifiedAt: null,
    };
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([
      { _id: userA, dni: '1234567', active: true, enabled: true },
      { _id: userB, dni: '7654321', active: true, enabled: false },
    ]);

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(padronUsersService.getPadronUsersFromEvent).toHaveBeenCalledWith(event, {
      includeDisabled: false,
    });
    expect(notificationLogModel.find).toHaveBeenCalledWith(
      {
        type: 'generic',
        status: 'SENT',
        'data.eventId': String(event._id),
        'data.type': 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
      },
      { topic: 1, data: 1 },
    );
    expect(firebaseMessaging.send).toHaveBeenCalledTimes(1);
    expect(userNotificationModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          dni: '1234567',
          topic: `user_${String(userA)}`,
          data: expect.objectContaining({
            eventId: String(event._id),
            eligible: 'true',
            carnetNorm: '1234567',
          }),
        }),
      ],
      { ordered: false },
    );
    expect(notificationLogModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          topic: `user_${String(userA)}`,
          status: 'SENT',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_PADRON_REVIEW_OPEN',
            eligible: 'true',
            dni: '1234567',
          }),
        }),
      ]),
      { ordered: false },
    );
    expect(votingEventModel.updateOne).toHaveBeenCalledWith(
      { _id: event._id },
      { $set: { convocationNotifiedAt: expect.any(Date) } },
    );
    expect(result).toEqual({
      status: 'success',
      mode: 'initial',
      totalEligible: 1,
      alreadyNotified: 0,
      newlyNotified: 1,
      skippedWithoutUser: 0,
      failed: 0,
    });
  });

  it('notifica solo nuevos pendientes cuando la convocatoria ya fue enviada antes', async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const userC = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion incremental',
      state: 'READY_FOR_REVIEW',
      convocationNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([
      { _id: userA, dni: '1000001', active: true, enabled: true },
      { _id: userB, dni: '1000002', active: true, enabled: false },
      { _id: userC, dni: '1000003', active: true, enabled: true },
    ]);
    notificationLogModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topic: `user_${String(userA)}`,
          data: { eventId: String(event._id), type: 'INSTITUTIONAL_PADRON_REVIEW_OPEN', eligible: 'true' },
        },
        {
          topic: `user_${String(userB)}`,
          data: { eventId: String(event._id), type: 'INSTITUTIONAL_PADRON_REVIEW_OPEN', eligible: 'false' },
        },
      ]),
    });

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(firebaseMessaging.send).toHaveBeenCalledTimes(1);
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${String(userC)}`,
        data: expect.objectContaining({
          eventId: String(event._id),
          eligible: 'true',
          dni: '1000003',
        }),
      }),
    );
    expect(votingEventModel.updateOne).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'success',
      mode: 'incremental',
      totalEligible: 2,
      alreadyNotified: 1,
      newlyNotified: 1,
      skippedWithoutUser: 0,
      failed: 0,
    });
  });

  it('responde no_pending_voters cuando todos ya tienen convocatoria para su estado actual', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion sin pendientes',
      state: 'READY_FOR_REVIEW',
      convocationNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([
      { _id: userA, dni: '2000001', active: true, enabled: true },
    ]);
    notificationLogModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        {
          topic: `user_${String(userA)}`,
          data: { eventId: String(event._id), type: 'INSTITUTIONAL_PADRON_REVIEW_OPEN', eligible: 'true' },
        },
      ]),
    });

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(userNotificationModel.insertMany).not.toHaveBeenCalled();
    expect(notificationLogModel.insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'no_pending_voters',
      mode: 'incremental',
      totalEligible: 1,
      alreadyNotified: 1,
      newlyNotified: 0,
      skippedWithoutUser: 0,
      failed: 0,
    });
  });

  it('no notifica usuarios deshabilitados aunque el resolvedor los devuelva por error', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion con deshabilitado',
      state: 'READY_FOR_REVIEW',
      convocationNotifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    padronUsersService.getPadronUsersFromEvent.mockResolvedValue([
      { _id: userA, dni: '3000001', active: true, enabled: false },
    ]);

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(padronUsersService.getPadronUsersFromEvent).toHaveBeenCalledWith(event, {
      includeDisabled: false,
    });
    expect(notificationLogModel.find).not.toHaveBeenCalled();
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(userNotificationModel.insertMany).not.toHaveBeenCalled();
    expect(notificationLogModel.insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'no_pending_voters',
      mode: 'incremental',
      totalEligible: 0,
      alreadyNotified: 0,
      newlyNotified: 0,
      skippedWithoutUser: 0,
      failed: 0,
    });
  });

  it('envía reminder de publicación oficial a admins activos/aprobados del tenant y marca enviado', async () => {
    const tenantId = new Types.ObjectId();
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      tenantId,
      name: 'Eleccion institucional',
      publishDeadline: new Date('2026-04-24T00:01:00.000Z'),
      save: jest.fn().mockResolvedValue(undefined),
    };

    tenantAdminAssignmentModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { userId: userA },
        { userId: userB },
        { userId: userA },
      ]),
    });
    roledUserModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: userA, email: 'Admin@Example.com', name: 'Admin Uno' },
        { _id: userB, email: 'admin2@example.com', name: 'Admin Dos' },
      ]),
    });

    const result = await service.sendOfficialPublicationReminder(event as any);

    expect(tenantAdminAssignmentModel.find).toHaveBeenCalledWith(
      {
        tenantId,
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      },
      { userId: 1 },
    );
    const [recipientQuery, recipientProjection] = roledUserModel.find.mock.calls[0];
    expect(recipientQuery.active).toBe(true);
    expect(recipientQuery._id.$in.map(String)).toEqual([String(userA), String(userB)]);
    expect(recipientProjection).toEqual({ email: 1, name: 1 });
    expect(mailService.sendEmail).toHaveBeenCalledTimes(2);
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      'Admin@Example.com',
      'Recordatorio: Confirmar publicación oficial de Eleccion institucional',
      'institutional-publication-reminder',
      {
        recipientName: 'Admin Uno',
        eventName: 'Eleccion institucional',
        eventId: String(event._id),
        deadline: '23/04/2026, 20:01',
      },
    );
    expect((event as any).officialPublicationReminderSentAt).toBeInstanceOf(Date);
    expect(event.save).toHaveBeenCalled();
    expect(result).toEqual({ sent: 2 });
  });
});
