import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersController } from '@/modules/users/controllers/users.controller';
import { UsersService } from '@/modules/users/services/users.service';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { chain } from '../utils/chain';

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



describe('UsersController (unit)', () => {
  let ctrl: UsersController;
  const svc = mkUsersService();
  const logModel = mkLogModel();

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: svc },
        { provide: getModelToken(NotificationLog.name), useValue: logModel },
      ],
    }).compile();
    ctrl = mod.get(UsersController);
  });

  it('USR-CTL-001 register: devuelve user shape', async () => {
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

  it('USR-CTL-002 getByDni: ok', async () => {
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

  it('USR-CTL-003 vote-place PATCH: delega en service', async () => {
    svc.updateVotePlaceByDni.mockResolvedValue({ dni: '7', location: null, table: null });
    const out = await ctrl.updateVotePlace('7', {});
    expect(out.dni).toBe('7');
  });

  it('USR-CTL-004 listNotificationsByDni: sin location → lista vacía', async () => {
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U3', dni: '3' });
    const result = await ctrl.listNotificationsByDni('3', 1 as any, 10 as any);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('USR-CTL-005 listNotificationsByDni: con location → pagina y filtra por topic', async () => {
    svc.findOrCreateByDni.mockResolvedValue({ _id: 'U4', dni: '4', votingLocationId: '507f1f77bcf86cd799439011' });
    logModel.find.mockReturnValue(chain([{ _id: 'N1', topic: 'loc_507f1f77bcf86cd799439011', text: 'hola' }]));
    logModel.countDocuments.mockResolvedValue(1);

    const result = await ctrl.listNotificationsByDni('4', 2 as any, 1 as any);
    expect(result.page).toBe(2);
    expect(result.total).toBe(1);
    expect(logModel.find).toHaveBeenCalledWith({ topic: 'loc_507f1f77bcf86cd799439011' });
  });
  it('USR-CTL-006 getVotePlace: delega en service', async () => {
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
