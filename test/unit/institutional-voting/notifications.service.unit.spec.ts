import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
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
import { VoteContractReads } from '@/api/vote';

jest.mock('@/api/vote', () => ({
  VoteContractReads: {
    rewardByVote: jest.fn(),
    getTokenBalance: jest.fn(),
  },
}));

const TOKEN_ADDRESS = '0x0000000000000000000000000000000000000tvd';

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
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      insertMany: jest.fn().mockResolvedValue([]),
    };
    notificationLogModel = {
      find: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
      exists: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      insertMany: jest.fn().mockResolvedValue([]),
    };
    votingEventModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    padronUsersService = {
      getResolvedPadronUsersFomEvent: jest.fn(),
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
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'app.tvd.tokenContractAddress' ? TOKEN_ADDRESS : 'hardhat',
            ),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(InstitutionalVotingNotificationsService);
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValue(5n);
    (VoteContractReads.getTokenBalance as jest.Mock).mockResolvedValue(1000n);
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
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '1234567', active: true, enabled: true },
      { _id: userB, dni: '7654321', active: true, enabled: false },
    ]);

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
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
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
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
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
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
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '3000001', active: true, enabled: false },
    ]);

    const result = await service.notifyConvocationIfEligible(event as any);

    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
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

  it('PAR-RWD-P0-002 / PAR-RWD-P0-003 / PAR-NTF-P0-001 notifica recompensa por voto una sola vez cuando rewardByVote es mayor que cero', async () => {
    const userId = new Types.ObjectId();
    padronUsersService.getUsersByCarnets.mockResolvedValue([
      { _id: userId, dni: '1234567', active: true, enabled: true },
    ]);

    const result = await service.notifyVoteRewardAvailableIfEligible('event-1', '1234567');

    expect(VoteContractReads.rewardByVote).toHaveBeenCalledWith('hardhat');
    expect(VoteContractReads.getTokenBalance).toHaveBeenCalledWith('hardhat', TOKEN_ADDRESS);
    expect(userNotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        dni: '1234567',
        topic: `user_${String(userId)}`,
        title: 'Recompensa disponible',
        body: 'Tu voto fue registrado correctamente. Tienes una recompensa disponible para reclamar.',
        data: {
          type: 'VOTE_REWARD_AVAILABLE',
          action: 'OPEN_VOTE_REWARD',
          eventId: 'event-1',
          deduplicationKey: `VOTE_REWARD_AVAILABLE:event-1:${String(userId)}`,
        },
      }),
    );
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${String(userId)}`,
        data: {
          type: 'VOTE_REWARD_AVAILABLE',
          action: 'OPEN_VOTE_REWARD',
          eventId: 'event-1',
          deduplicationKey: `VOTE_REWARD_AVAILABLE:event-1:${String(userId)}`,
        },
      }),
    );
    expect(notificationLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SENT',
        data: expect.objectContaining({
          type: 'VOTE_REWARD_AVAILABLE',
          action: 'OPEN_VOTE_REWARD',
        }),
      }),
    );
    expect(result).toEqual({ sent: 1 });
    expect(JSON.stringify(userNotificationModel.create.mock.calls)).not.toMatch(
      /candidate|option|plancha|proof|nullifier|credential|privateKey|authToken|deviceToken/i,
    );
  });

  it('PAR-RWD-P0-002 no notifica recompensa por voto cuando rewardByVote es cero', async () => {
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValueOnce(0n);

    const result = await service.notifyVoteRewardAvailableIfEligible('event-1', '1234567');

    expect(result).toEqual({ sent: 0, skipped: 'no_reward' });
    expect(padronUsersService.getUsersByCarnets).not.toHaveBeenCalled();
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
  });

  it('PAR-RWD-P0-002 no notifica recompensa por voto cuando el contrato no tiene saldo suficiente de token', async () => {
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValueOnce(5n);
    (VoteContractReads.getTokenBalance as jest.Mock).mockResolvedValueOnce(5n);

    const result = await service.notifyVoteRewardAvailableIfEligible('event-1', '1234567');

    expect(result).toEqual({ sent: 0, skipped: 'no_reward' });
    expect(padronUsersService.getUsersByCarnets).not.toHaveBeenCalled();
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
  });

  it('PAR-RWD-P0-003 / PAR-ERR-P1-003 no duplica recompensa por voto cuando ya existe deduplicationKey', async () => {
    const userId = new Types.ObjectId();
    padronUsersService.getUsersByCarnets.mockResolvedValue([
      { _id: userId, dni: '1234567', active: true, enabled: true },
    ]);
    userNotificationModel.create.mockRejectedValueOnce({ code: 11000 });

    const result = await service.notifyVoteRewardAvailableIfEligible('event-1', '1234567');

    expect(result).toEqual({ sent: 0, skipped: 'already_notified' });
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
  });

  it('PAR-RWD-P1-004 / PAR-ERR-P1-003 mantiene el flujo exitoso aunque falle RPC o Firebase al notificar recompensa', async () => {
    (VoteContractReads.rewardByVote as jest.Mock).mockRejectedValueOnce(new Error('rpc down'));

    await expect(
      service.notifyVoteRewardAvailableIfEligible('event-1', '1234567'),
    ).resolves.toEqual({ sent: 0, skipped: 'reward_lookup_failed' });

    (VoteContractReads.getTokenBalance as jest.Mock).mockRejectedValueOnce(
      new Error('token balance rpc down'),
    );

    await expect(
      service.notifyVoteRewardAvailableIfEligible('event-1', '1234567'),
    ).resolves.toEqual({ sent: 0, skipped: 'reward_lookup_failed' });

    const userId = new Types.ObjectId();
    (VoteContractReads.rewardByVote as jest.Mock).mockResolvedValueOnce(5n);
    padronUsersService.getUsersByCarnets.mockResolvedValueOnce([
      { _id: userId, dni: '1234567', active: true, enabled: true },
    ]);
    firebaseMessaging.send.mockRejectedValueOnce(new Error('firebase down'));

    await expect(
      service.notifyVoteRewardAvailableIfEligible('event-1', '1234567'),
    ).resolves.toEqual({ sent: 0, failed: 1 });
    expect(notificationLogModel.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error: 'firebase down',
      }),
    );
    expect(JSON.stringify(notificationLogModel.create.mock.calls)).not.toMatch(
      /candidate|option|plancha|proof|nullifier|credential|privateKey|authToken|deviceToken/i,
    );
  });

  it('notifica votación eliminada a los usuarios del padrón actual con payload de cancelación', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion cancelada',
      state: 'CANCELLED',
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '4000001', active: true, enabled: true },
    ]);

    const result = await service.notifyVotingCancelledToCurrentPadron(event as any);

    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
      includeDisabled: true,
    });
    expect(userNotificationModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          dni: '4000001',
          topic: `user_${String(userA)}`,
          title: 'Votación eliminada',
          body: 'Eleccion cancelada fue eliminada por el administrador.',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_VOTING_CANCELLED',
            eventId: String(event._id),
            electionId: String(event._id),
            eventName: 'Eleccion cancelada',
            state: 'CANCELLED',
            status: 'cancelled',
            severity: 'error',
            bannerTitle: 'Eleccion cancelada',
            bannerSubtitle: 'Ya no está disponible.',
            reasonText: 'Fue eliminada por el administrador.',
            eligible: 'true',
            dni: '4000001',
          }),
        }),
      ],
      { ordered: false },
    );
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${String(userA)}`,
        notification: {
          title: 'Votación eliminada',
          body: 'Eleccion cancelada fue eliminada por el administrador.',
        },
        data: expect.objectContaining({
          type: 'INSTITUTIONAL_VOTING_CANCELLED',
          eventName: 'Eleccion cancelada',
          state: 'CANCELLED',
          status: 'cancelled',
          severity: 'error',
          bannerTitle: 'Eleccion cancelada',
          bannerSubtitle: 'Ya no está disponible.',
          reasonText: 'Fue eliminada por el administrador.',
        }),
      }),
    );
    expect(notificationLogModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'generic',
          topic: `user_${String(userA)}`,
          title: 'Votación eliminada',
          body: 'Eleccion cancelada fue eliminada por el administrador.',
          status: 'SENT',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_VOTING_CANCELLED',
            eventId: String(event._id),
            eventName: 'Eleccion cancelada',
            state: 'CANCELLED',
            status: 'cancelled',
            severity: 'error',
            bannerTitle: 'Eleccion cancelada',
            bannerSubtitle: 'Ya no está disponible.',
            reasonText: 'Fue eliminada por el administrador.',
          }),
        }),
      ]),
      { ordered: false },
    );
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('notifica resultados a usuarios habilitados sin depender de participación o voto', async () => {
    const userVoted = new Types.ObjectId();
    const userNotVoted = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion con resultados',
      objective: 'Elección para conformar el directorio de la gestión 2026.',
      state: 'RESULTS_PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userVoted, dni: '6000001', active: true, enabled: true },
      { _id: userNotVoted, dni: '6000002', active: true, enabled: true },
    ]);

    const result = await service.notifyResultsAvailableIfEligible(event as any);

    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
      includeDisabled: false,
    });
    expect(userNotificationModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          dni: '6000001',
          title: 'Resultados disponibles',
          body: 'Resultados de Eleccion con resultados',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
            eventId: String(event._id),
            electionId: String(event._id),
            eventName: 'Eleccion con resultados',
            eventTitle: 'Eleccion con resultados',
            eventDescription: 'Elección para conformar el directorio de la gestión 2026.',
            objective: 'Elección para conformar el directorio de la gestión 2026.',
            status: 'results_available',
            bannerTitle: 'Eleccion con resultados',
            bannerSubtitle: 'Elección para conformar el directorio de la gestión 2026.',
            eligible: 'true',
          }),
        }),
        expect.objectContaining({
          dni: '6000002',
          title: 'Resultados disponibles',
          body: 'Resultados de Eleccion con resultados',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
            eventId: String(event._id),
            electionId: String(event._id),
            eventName: 'Eleccion con resultados',
            eventTitle: 'Eleccion con resultados',
            eventDescription: 'Elección para conformar el directorio de la gestión 2026.',
            objective: 'Elección para conformar el directorio de la gestión 2026.',
            status: 'results_available',
            bannerTitle: 'Eleccion con resultados',
            bannerSubtitle: 'Elección para conformar el directorio de la gestión 2026.',
            eligible: 'true',
          }),
        }),
      ]),
      { ordered: false },
    );
    expect(firebaseMessaging.send).toHaveBeenCalledTimes(2);
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: {
          title: 'Resultados disponibles',
          body: 'Resultados de Eleccion con resultados',
        },
        data: expect.objectContaining({
          type: 'INSTITUTIONAL_RESULTS_AVAILABLE',
          eventTitle: 'Eleccion con resultados',
          eventDescription: 'Elección para conformar el directorio de la gestión 2026.',
          objective: 'Elección para conformar el directorio de la gestión 2026.',
          bannerTitle: 'Eleccion con resultados',
          bannerSubtitle: 'Elección para conformar el directorio de la gestión 2026.',
        }),
      }),
    );
    expect(votingEventModel.updateOne).toHaveBeenCalledWith(
      { _id: event._id },
      { $set: { resultsNotifiedAt: expect.any(Date) } },
    );
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it('no incluye usuarios inhabilitados en notificación de resultados aunque el resolvedor los devuelva', async () => {
    const enabledUser = new Types.ObjectId();
    const disabledUser = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion con inhabilitado',
      state: 'RESULTS_PUBLISHED',
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: enabledUser, dni: '6000003', active: true, enabled: true },
      { _id: disabledUser, dni: '6000004', active: true, enabled: false },
    ]);

    const result = await service.notifyResultsAvailableIfEligible(event as any);

    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
      includeDisabled: false,
    });
    expect(firebaseMessaging.send).toHaveBeenCalledTimes(1);
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${String(enabledUser)}`,
        data: expect.objectContaining({
          dni: '6000003',
          eligible: 'true',
        }),
      }),
    );
    expect(userNotificationModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          dni: '6000003',
        }),
      ],
      { ordered: false },
    );
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('no marca resultados como notificados si no hay destinatarios resolubles', async () => {
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion sin usuarios',
      state: 'RESULTS_PUBLISHED',
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([]);

    const result = await service.notifyResultsAvailableIfEligible(event as any);

    expect(result).toEqual({ sent: 0, skipped: 'no_linked_users' });
    expect(votingEventModel.updateOne).not.toHaveBeenCalled();
    expect(userNotificationModel.insertMany).not.toHaveBeenCalled();
    expect(notificationLogModel.insertMany).not.toHaveBeenCalled();
  });

  it('marca resultados como notificados solo si hubo al menos un envío', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion notificada',
      state: 'RESULTS_PUBLISHED',
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '6000005', active: true, enabled: true },
    ]);

    const result = await service.notifyResultsAvailableIfEligible(event as any);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(votingEventModel.updateOne).toHaveBeenCalledWith(
      { _id: event._id },
      { $set: { resultsNotifiedAt: expect.any(Date) } },
    );
  });

  it('no reenvía resultados si ya existe resultsNotifiedAt', async () => {
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion ya notificada',
      state: 'RESULTS_PUBLISHED',
      resultsNotifiedAt: new Date('2026-07-10T20:00:00.000Z'),
    };

    const result = await service.notifyResultsAvailableIfEligible(event as any);

    expect(result).toEqual({ sent: 0, skipped: 'already_notified' });
    expect(padronUsersService.getResolvedPadronUsersFomEvent).not.toHaveBeenCalled();
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(votingEventModel.updateOne).not.toHaveBeenCalled();
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

  it('envía recordatorio de inicio 1h a votantes habilitados con payload institucional', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion recordatorio',
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '5000001', active: true, enabled: true },
    ]);

    const result = await service.notifyVotingReminderIfEligible(event as any, 'START', 60);

    expect(notificationLogModel.exists).toHaveBeenCalledWith({
      type: 'generic',
      status: 'SENT',
      'data.eventId': String(event._id),
      'data.type': 'INSTITUTIONAL_VOTING_STARTS_IN_1H',
      'data.phase': 'START',
      'data.offsetMinutes': '60',
    });
    expect(padronUsersService.getResolvedPadronUsersFomEvent).toHaveBeenCalledWith(event, {
      includeDisabled: false,
    });
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${String(userA)}`,
        notification: {
          title: 'La votación inicia en 1 hora',
          body: 'Eleccion recordatorio comienza a las 10:00.',
        },
        data: expect.objectContaining({
          type: 'INSTITUTIONAL_VOTING_STARTS_IN_1H',
          eventId: String(event._id),
          eventName: 'Eleccion recordatorio',
          phase: 'START',
          offsetMinutes: '60',
          scheduledFor: '2026-07-10T14:00:00.000Z',
          severity: 'info',
          votingStart: '2026-07-10T14:00:00.000Z',
          votingEnd: '2026-07-10T18:00:00.000Z',
          publicPath: `/votacion/elecciones/${String(event._id)}/publica`,
        }),
      }),
    );
    expect(userNotificationModel.insertMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          dni: '5000001',
          title: 'La votación inicia en 1 hora',
          body: 'Eleccion recordatorio comienza a las 10:00.',
          data: expect.objectContaining({
            type: 'INSTITUTIONAL_VOTING_STARTS_IN_1H',
            eligible: 'true',
          }),
        }),
      ],
      { ordered: false },
    );
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it('envía recordatorio de cierre 15m solo a habilitados y con copy de cierre', async () => {
    const userA = new Types.ObjectId();
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion activa',
      state: 'PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      resultsPublishAt: new Date('2026-07-10T19:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
      { _id: userA, dni: '5000002', active: true, enabled: true },
    ]);

    const result = await service.notifyVotingReminderIfEligible(event as any, 'END', 15);

    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: {
          title: 'La votación termina en 15 minutos',
          body: 'Eleccion activa cierra a las 14:00.',
        },
        data: expect.objectContaining({
          type: 'INSTITUTIONAL_VOTING_ENDS_IN_15M',
          phase: 'END',
          offsetMinutes: '15',
          scheduledFor: '2026-07-10T18:00:00.000Z',
          votingStart: '2026-07-10T14:00:00.000Z',
          votingEnd: '2026-07-10T18:00:00.000Z',
        }),
      }),
    );
    expect(result).toEqual({ sent: 1, failed: 0 });
  });

  it.each([
    ['START', 60, 'INSTITUTIONAL_VOTING_STARTS_IN_1H', 'La votación inicia en 1 hora', 'Eleccion tabla comienza a las 10:00.'],
    ['START', 15, 'INSTITUTIONAL_VOTING_STARTS_IN_15M', 'La votación inicia en 15 minutos', 'Eleccion tabla comienza a las 10:00.'],
    ['END', 60, 'INSTITUTIONAL_VOTING_ENDS_IN_1H', 'La votación termina en 1 hora', 'Eleccion tabla cierra a las 14:00.'],
    ['END', 15, 'INSTITUTIONAL_VOTING_ENDS_IN_15M', 'La votación termina en 15 minutos', 'Eleccion tabla cierra a las 14:00.'],
  ])(
    'usa copy con nombre y hora para %s %s',
    async (phase, offsetMinutes, expectedType, expectedTitle, expectedBody) => {
      const userA = new Types.ObjectId();
      const event = {
        _id: new Types.ObjectId(),
        name: 'Eleccion tabla',
        state: 'PUBLISHED',
        votingStart: new Date('2026-07-10T14:00:00.000Z'),
        votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      };
      padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([
        { _id: userA, dni: '5000099', active: true, enabled: true },
      ]);

      await service.notifyVotingReminderIfEligible(event as any, phase as any, offsetMinutes as any);

      expect(firebaseMessaging.send).toHaveBeenCalledWith(
        expect.objectContaining({
          notification: {
            title: expectedTitle,
            body: expectedBody,
          },
          data: expect.objectContaining({
            type: expectedType,
            eventId: String(event._id),
            eventName: 'Eleccion tabla',
            scheduledFor: phase === 'START'
              ? '2026-07-10T14:00:00.000Z'
              : '2026-07-10T18:00:00.000Z',
            votingStart: '2026-07-10T14:00:00.000Z',
            votingEnd: '2026-07-10T18:00:00.000Z',
          }),
        }),
      );
    },
  );

  it('no duplica recordatorios si ya existe NotificationLog SENT', async () => {
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion duplicada',
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
    };
    notificationLogModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

    const result = await service.notifyVotingReminderIfEligible(event as any, 'START', 15);

    expect(result).toEqual({ sent: 0, skipped: 'already_sent' });
    expect(padronUsersService.getResolvedPadronUsersFomEvent).not.toHaveBeenCalled();
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(userNotificationModel.insertMany).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'DISABLED', 'CLOSED', 'RESULTS_PUBLISHED', 'DRAFT', 'READY_FOR_REVIEW'])(
    'no envía recordatorios para estado no válido %s',
    async (state) => {
      const event = {
        _id: new Types.ObjectId(),
        name: 'Eleccion no valida',
        state,
        votingStart: new Date('2026-07-10T14:00:00.000Z'),
        votingEnd: new Date('2026-07-10T18:00:00.000Z'),
      };

      const result = await service.notifyVotingReminderIfEligible(event as any, 'START', 60);

      expect(result).toEqual({ sent: 0, skipped: 'invalid_state' });
      expect(notificationLogModel.exists).not.toHaveBeenCalled();
      expect(firebaseMessaging.send).not.toHaveBeenCalled();
    },
  );

  it('no rompe si no hay destinatarios habilitados', async () => {
    const event = {
      _id: new Types.ObjectId(),
      name: 'Eleccion sin destinatarios',
      state: 'OFFICIALLY_PUBLISHED',
      votingStart: new Date('2026-07-10T14:00:00.000Z'),
      votingEnd: new Date('2026-07-10T18:00:00.000Z'),
    };
    padronUsersService.getResolvedPadronUsersFomEvent.mockResolvedValue([]);

    const result = await service.notifyVotingReminderIfEligible(event as any, 'START', 60);

    expect(result).toEqual({ sent: 0, skipped: 'no_linked_users' });
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(notificationLogModel.insertMany).not.toHaveBeenCalled();
  });
});
