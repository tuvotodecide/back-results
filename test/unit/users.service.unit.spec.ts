import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from '@/modules/users/services/users.service';
import { User } from '@/modules/users/schemas/user.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import { chain } from '../utils/chain';

const oid = () => new Types.ObjectId();

describe('UsersService', () => {
  let service: UsersService;

  const userModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    findById: jest.fn(),
  };

  const locationModel = {
    exists: jest.fn(),
  };

  const tableModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(ElectoralTable.name), useValue: tableModel },
        {
          provide: getModelToken(ElectoralLocation.name),
          useValue: locationModel,
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('findByDni: 404 si no existe', async () => {
    userModel.findOne.mockReturnValue(chain(null));
    await expect(service.findByDni('xxx')).rejects.toThrow(NotFoundException);
  });

  it('findByDni: retorna doc', async () => {
    userModel.findOne.mockReturnValue(chain({ _id: oid(), dni: '78945612' }));
    const u = await service.findByDni('78945612');
    expect(u.dni).toBe('78945612');
  });

  it('findOrCreateByDni: upsert ok', async () => {
    const u = { _id: oid(), dni: '12345678', active: true };
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain(u),
    } as any);
    const out = await service.findOrCreateByDni('12345678');
    expect(out.dni).toBe('12345678');
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dni: '12345678' },
      { $setOnInsert: { dni: '12345678', active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('findOrCreateByDni: dup 11000 a lee y retorna', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => ({ exec: jest.fn().mockRejectedValue(dup) }),
    } as any);
    userModel.findOne.mockReturnValue(chain({ _id: oid(), dni: '12345678' }));
    const out = await service.findOrCreateByDni('12345678');
    expect(out.dni).toBe('12345678');
    expect(userModel.findOne).toHaveBeenCalledWith({ dni: '12345678' });
  });

  it('updateVotePlaceByDni: DNI requerido', async () => {
    // @ts-ignore
    await expect(service.updateVotePlaceByDni('', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updateVotePlaceByDni: locationId no existe a 404', async () => {
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: oid(), dni: '1' }),
    } as any);
    locationModel.exists.mockResolvedValue(null);
    await expect(
      service.updateVotePlaceByDni('1', { locationId: oid().toString() }),
    ).rejects.toThrow('Recinto no encontrado');
  });

  it('updateVotePlaceByDni: tableId no existe a 404', async () => {
    const uId = oid();
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: uId, dni: '1' }),
    } as any);
    locationModel.exists.mockResolvedValue(true);
    tableModel.findById.mockReturnValue(chain(null));
    await expect(
      service.updateVotePlaceByDni('1', {
        locationId: oid().toString(),
        tableId: oid().toString(),
      }),
    ).rejects.toThrow('Mesa no encontrada');
  });

  it('updateVotePlaceByDni: valida que la mesa pertenezca al recinto', async () => {
    const locId = oid();
    const uId = oid();
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: uId, dni: '1' }),
    } as any);
    locationModel.exists.mockResolvedValue(true);
    tableModel.findById.mockReturnValue(
      chain({ _id: oid(), electoralLocationId: oid() }),
    );
    await expect(
      service.updateVotePlaceByDni('1', {
        locationId: locId.toString(),
        tableId: oid().toString(),
      }),
    ).rejects.toThrow('La mesa seleccionada no pertenece al recinto indicado');
  });

  it('updateVotePlaceByDni: setea locationId y table por tableCode, y borra mesa previa si cambió de recinto', async () => {
    const locId = oid();
    const prevLocId = oid();
    const uId = oid();

    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: uId, dni: '9', votingTableId: oid() }),
    } as any);

    locationModel.exists.mockResolvedValue(true);

    tableModel.findById.mockResolvedValue(null);
    tableModel.findOne.mockReturnValue(
      chain({ _id: oid(), electoralLocationId: locId }),
    );

    userModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const fresh = {
      _id: uId,
      dni: '9',
      votingLocationId: { _id: locId, name: 'L', address: 'A', code: 'C' },
      votingTableId: { _id: oid(), tableCode: 'TC', tableNumber: 1 },
    };
    const findByIdChain = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(fresh),
    };
    userModel.findById = jest.fn().mockReturnValue(findByIdChain as any);

    (service as any).electoralTableModel.findById = jest
      .fn()
      .mockReturnValue(chain({ electoralLocationId: prevLocId }));

    const out = await service.updateVotePlaceByDni('9', {
      locationId: locId.toString(),
      tableCode: 'TC',
    });
    expect(out.location?.code).toBe('C');
    expect(userModel.updateOne).toHaveBeenCalled();
  });

  it('getVotePlaceByDni: crea si no existe y devuelve shape', async () => {
    const uId = oid();
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: uId, dni: '10' }),
    } as any);
    const fresh = {
      _id: uId,
      dni: '10',
      votingLocationId: null,
      votingTableId: null,
    };
    const findByIdChain = {
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(fresh),
    };
    userModel.findById = jest.fn().mockReturnValue(findByIdChain as any);

    const out = await service.getVotePlaceByDni('10');
    expect(out.userId).toBe(uId.toString());
    expect(out.location).toBeNull();
    expect(out.table).toBeNull();
  });
  it('getVotePlaceByDni: DNI requerido', async () => {
    // @ts-ignore
    await expect(service.getVotePlaceByDni('')).rejects.toThrow(
      BadRequestException,
    );
  });
});
