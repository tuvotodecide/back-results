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
      notifyVotingReminderIfEligible: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
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

  const emptyFindQuery = () => ({
    limit: jest.fn().mockResolvedValue([]),
  });

  const mockEmptyVotingReminderQueries = () => {
    votingEventModel.find
      .mockReturnValueOnce(emptyFindQuery())
      .mockReturnValueOnce(emptyFindQuery())
      .mockReturnValueOnce(emptyFindQuery())
      .mockReturnValueOnce(emptyFindQuery());
  };

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
    mockEmptyVotingReminderQueries();
    votingEventModel.find.mockReturnValueOnce(remindableQuery).mockReturnValueOnce(publishableQuery);

    await service.processLifecycle();

    expect(votingEventModel.find).toHaveBeenNthCalledWith(5, {
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

  it('marca automáticamente como PUBLICATION_EXPIRED a los eventos cuyo plazo venció', async () => {
    const now = new Date('2026-04-24T00:05:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    const remindableQuery = {
      limit: jest.fn().mockResolvedValue([]),
    };
    const publishableQuery = {
      limit: jest.fn().mockResolvedValue([]),
    };
    mockEmptyVotingReminderQueries();
    votingEventModel.find.mockReturnValueOnce(remindableQuery).mockReturnValueOnce(publishableQuery);

    await service.processLifecycle();

    expect(votingEventModel.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        state: { $in: ['DRAFT', 'READY_FOR_REVIEW'] },
        publishDeadline: { $lte: now },
      },
      {
        $set: {
          state: 'PUBLICATION_EXPIRED',
          publicationExpiredAt: now,
          publicationConfirmed: false,
        },
      },
    );
  });

  it('procesa recordatorios de inicio y cierre en ventanas de 1 minuto sin depender del frontend', async () => {
    const now = new Date('2026-07-10T13:00:30.000Z');
    jest.useFakeTimers().setSystemTime(now);

    const startEvent = {
      _id: new Types.ObjectId(),
      name: 'Eleccion inicia pronto',
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
    };
    const endEvent = {
      _id: new Types.ObjectId(),
      name: 'Eleccion termina pronto',
      state: 'PUBLISHED',
      votingStart: new Date('2026-07-10T12:00:00.000Z'),
      votingEnd: new Date('2026-07-10T14:00:00.000Z'),
    };

    votingEventModel.find
      .mockReturnValueOnce({ limit: jest.fn().mockResolvedValue([startEvent]) })
      .mockReturnValueOnce(emptyFindQuery())
      .mockReturnValueOnce({ limit: jest.fn().mockResolvedValue([endEvent]) })
      .mockReturnValueOnce(emptyFindQuery());

    const result = await service.processVotingReminderNotifications(now);

    expect(votingEventModel.find).toHaveBeenNthCalledWith(1, {
      state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED'] },
      votingStart: {
        $gt: new Date('2026-07-10T13:59:30.000Z'),
        $lte: new Date('2026-07-10T14:00:30.000Z'),
      },
    });
    expect(votingEventModel.find).toHaveBeenNthCalledWith(3, {
      state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED'] },
      votingEnd: {
        $gt: new Date('2026-07-10T13:59:30.000Z'),
        $lte: new Date('2026-07-10T14:00:30.000Z'),
      },
      votingStart: { $lte: now },
    });
    expect(notificationsService.notifyVotingReminderIfEligible).toHaveBeenCalledWith(
      startEvent,
      'START',
      60,
    );
    expect(notificationsService.notifyVotingReminderIfEligible).toHaveBeenCalledWith(
      endEvent,
      'END',
      60,
    );
    expect(result).toEqual([
      expect.objectContaining({
        eventId: String(startEvent._id),
        phase: 'START',
        offsetMinutes: 60,
        sent: 1,
      }),
      expect.objectContaining({
        eventId: String(endEvent._id),
        phase: 'END',
        offsetMinutes: 60,
        sent: 1,
      }),
    ]);
  });

  it('el cron invoca recordatorios antes de cerrar eventos vencidos', async () => {
    const now = new Date('2026-07-10T17:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    mockEmptyVotingReminderQueries();
    votingEventModel.find.mockReturnValueOnce(emptyFindQuery()).mockReturnValueOnce(emptyFindQuery());

    await service.processLifecycle();

    expect(notificationsService.notifyVotingReminderIfEligible).not.toHaveBeenCalled();
    expect(votingEventModel.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        state: { $in: ['OFFICIALLY_PUBLISHED', 'PUBLISHED'] },
        votingEnd: { $lte: now },
      },
      {
        $set: { state: 'CLOSED' },
      },
    );
  });
});
