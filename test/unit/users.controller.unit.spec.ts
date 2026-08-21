jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersController } from '@/modules/users/controllers/users.controller';
import { UsersService } from '@/modules/users/services/users.service';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import { ConfigService } from '@nestjs/config';
import { chain } from '../utils/chain';

const BROADCAST_TOPIC = 'broadcast_topic';

const mkUsersService = () => ({

  
  findOrCreateByDni: jest.fn(),
  findByDni: jest.fn(),
  updateVotePlaceByDni: jest.fn(),
  getVotePlaceByDni: jest.fn(),
});

const mkLogModel = () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
});

const mkUserNotificationModel = () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
});



describe('UsersController', () => {
  let ctrl: UsersController;
  const svc = mkUsersService();
  const logModel = mkLogModel();
  const userNotifModel = mkUserNotificationModel();

  beforeEach(async () => {
    jest.clearAllMocks();
    logModel.find.mockReturnValue(chain([]));
    logModel.countDocuments.mockResolvedValue(0);
    userNotifModel.find.mockReturnValue(chain([]));
    userNotifModel.countDocuments.mockResolvedValue(0);
    const mod = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: svc },
        { provide: getModelToken(NotificationLog.name), useValue: logModel },
        { provide: getModelToken(UserNotification.name), useValue: userNotifModel },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(BROADCAST_TOPIC) },
        },
      ],
    }).compile();
    ctrl = mod.get(UsersController);
  });

  it('register: devuelve user shape', async () => {
    svc.findOrCreateByDni.mockResolvedValue({
      _id: 'U1',
      dni: '123',
      active: true,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-02'),
    });
    const out = await ctrl.register({ dni: '123' } as any);
    expect(out._id).toBe('U1');
  });

  it('getByDni: ok', async () => {
    svc.findByDni.mockResolvedValue({
      _id: 'U2',
      dni: '555',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const out = await ctrl.getByDni('555');
    expect(out.dni).toBe('555');
  });

  it('vote-place delega en service', async () => {
    svc.updateVotePlaceByDni.mockResolvedValue({ dni: '7', location: null, table: null });
    const out = await ctrl.updateVotePlace('7', {});
    expect(out.dni).toBe('7');
  });

  it('listNotificationsByDni: sin location a lista vacía', async () => {
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U3', dni: '3' });
    const result = await ctrl.listNotificationsByDni('3', 1 as any, 10 as any);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('listNotificationsByDni: con location a pagina y filtra por topic', async () => {
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U4', dni: '4', votingLocationId: '507f1f' });
    logModel.find.mockReturnValue(chain([{ _id: 'N1', topic: 'loc_507f1f', text: 'hola' }]));
    logModel.countDocuments.mockResolvedValue(1);

    const result = await ctrl.listNotificationsByDni('4', 2 as any, 1 as any);
    expect(result.page).toBe(2);
    expect(result.total).toBe(1);
    // El topic de broadcast se suma siempre: es donde caen las notificaciones de las
    // votaciones abiertas, que no tienen padrón al que dirigirse por usuario.
    expect(logModel.find).toHaveBeenCalledWith({
      topic: { $in: ['loc_507f1f', 'user_U4', BROADCAST_TOPIC] },
    });
  });

  it('listNotificationsByDni: incluye historial durable aunque no exista log SENT', async () => {
    const createdAt = new Date('2026-07-23T10:00:00.000Z');
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U5', dni: '5' });
    userNotifModel.find.mockReturnValue(
      chain([
        {
          _id: 'UN1',
          userId: 'U5',
          topic: 'user_U5',
          title: 'Confirmación de publicación',
          data: {
            type: 'OFFICIAL_PUBLICATION_REQUEST',
            requestId: 'request-1',
            deduplicationKey: 'OFFICIAL_PUBLICATION_REQUEST:request-1:signer-1',
          },
          createdAt,
        },
      ]),
    );
    userNotifModel.countDocuments.mockResolvedValue(1);

    const result = await ctrl.listNotificationsByDni('5', 1 as any, 10 as any);

    expect(result.total).toBe(1);
    expect(result.data).toEqual([
      expect.objectContaining({
        _id: 'UN1',
        data: expect.objectContaining({
          type: 'OFFICIAL_PUBLICATION_REQUEST',
          requestId: 'request-1',
        }),
      }),
    ]);
  });

  it('listNotificationsByDni: deduplica log e historial por deduplicationKey', async () => {
    const createdAt = new Date('2026-07-23T10:00:00.000Z');
    const deduplicationKey = 'OFFICIAL_PUBLICATION_REQUEST:request-1:signer-1';
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U6', dni: '6' });
    logModel.find.mockReturnValue(
      chain([
        {
          _id: 'LOG1',
          topic: 'user_U6',
          title: 'Confirmación de publicación',
          data: { deduplicationKey },
          createdAt,
        },
      ]),
    );
    logModel.countDocuments.mockResolvedValue(1);
    userNotifModel.find.mockReturnValue(
      chain([
        {
          _id: 'UN1',
          userId: 'U6',
          topic: 'user_U6',
          title: 'Confirmación de publicación',
          data: { deduplicationKey },
          createdAt,
        },
      ]),
    );
    userNotifModel.countDocuments.mockResolvedValue(1);

    const result = await ctrl.listNotificationsByDni('6', 1 as any, 10 as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0]._id).toBe('LOG1');
  });
  it('getVotePlace: delega en service', async () => {
  svc.getVotePlaceByDni.mockResolvedValue({
    userId: 'U9',
    dni: '9',
    location: null,
    table: null,
  });
  const out = await ctrl.getVotePlace('9');
  expect(out.dni).toBe('9');
  expect(svc.getVotePlaceByDni).toHaveBeenCalledWith('9');
});

});
