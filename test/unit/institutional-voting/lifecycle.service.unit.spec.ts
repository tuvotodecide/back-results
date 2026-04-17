import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { InstitutionalVotingLifecycleService } from '@/modules/institutional-voting/services/events/institutional-voting-lifecycle.service';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';

describe('InstitutionalVotingLifecycleService (unit)', () => {
  let service: InstitutionalVotingLifecycleService;
  let votingEventModel: any;
  let notificationsService: any;

  beforeEach(async () => {
    votingEventModel = {
      find: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    notificationsService = {
      sendOfficialPublicationReminder: jest.fn().mockResolvedValue({ sent: 1 }),
      notifyResultsAvailableIfEligible: jest.fn().mockResolvedValue({ sent: 0 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstitutionalVotingLifecycleService,
        { provide: getModelToken(VotingEvent.name), useValue: votingEventModel },
        {
          provide: InstitutionalVotingNotificationsService,
          useValue: notificationsService,
        },
      ],
    }).compile();

    service = moduleRef.get(InstitutionalVotingLifecycleService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('busca recordatorios en la ventana exacta publishDeadline - 30 minutos', async () => {
    const now = new Date('2026-04-23T23:31:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    const reminderEvent = {
      _id: new Types.ObjectId(),
      name: 'Eleccion institucional',
      publishDeadline: new Date('2026-04-24T00:01:00.000Z'),
    };
    const remindableQuery = {
      limit: jest.fn().mockResolvedValue([reminderEvent]),
    };
    const publishableQuery = {
      limit: jest.fn().mockResolvedValue([]),
    };
    votingEventModel.find
      .mockReturnValueOnce(remindableQuery)
      .mockReturnValueOnce(publishableQuery);

    await service.processLifecycle();

    expect(votingEventModel.find).toHaveBeenNthCalledWith(1, {
      state: { $in: ['DRAFT', 'READY_FOR_REVIEW'] },
      publishDeadline: {
        $gt: now,
        $lte: new Date('2026-04-24T00:01:00.000Z'),
      },
      $or: [
        { officialPublicationReminderSentAt: { $exists: false } },
        { officialPublicationReminderSentAt: null },
      ],
    });
    expect(notificationsService.sendOfficialPublicationReminder).toHaveBeenCalledWith(
      reminderEvent,
    );
  });
});
