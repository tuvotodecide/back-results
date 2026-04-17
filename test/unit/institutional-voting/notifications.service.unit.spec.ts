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

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionalVotingNotificationsService,
        { provide: 'FIREBASE_ADMIN', useValue: { messaging: jest.fn() } },
        {
          provide: getModelToken(UserNotification.name),
          useValue: { insertMany: jest.fn() },
        },
        {
          provide: getModelToken(NotificationLog.name),
          useValue: { insertMany: jest.fn() },
        },
        {
          provide: getModelToken(VotingEvent.name),
          useValue: { updateOne: jest.fn() },
        },
        {
          provide: getModelToken(TenantAdminAssignment.name),
          useValue: tenantAdminAssignmentModel,
        },
        { provide: getModelToken(RoledUser.name), useValue: roledUserModel },
        {
          provide: PadronUsersService,
          useValue: {
            getPadronUsersFromEvent: jest.fn(),
            getUsersByCarnets: jest.fn(),
          },
        },
        { provide: MailService, useValue: mailService },
      ],
    }).compile();

    service = moduleRef.get(InstitutionalVotingNotificationsService);
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
