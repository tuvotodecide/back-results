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

describe('UsersService (unit)', () => {
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

  it('USR-SVC-001 findByDni: 404 si no existe', async () => {
    userModel.findOne.mockReturnValue(chain(null));
    await expect(service.findByDni('xxx')).rejects.toThrow(NotFoundException);
  });

  it('USR-SVC-002 findByDni: retorna doc', async () => {
    userModel.findOne.mockReturnValue(chain({ _id: oid(), dni: '123' }));
    const u = await service.findByDni('123');
    expect(u.dni).toBe('123');
  });

  it('USR-SVC-003 findOrCreateByDni: upsert ok', async () => {
    const u = { _id: oid(), dni: '999', active: true };
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain(u),
    } as any);
    const out = await service.findOrCreateByDni('999');
    expect(out.dni).toBe('999');
    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { dni: '999' },
      { $setOnInsert: { dni: '999', active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });

  it('USR-SVC-004 findOrCreateByDni: dup 11000 → lee y retorna', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => ({ exec: jest.fn().mockRejectedValue(dup) }),
    } as any);
    userModel.findOne.mockReturnValue(chain({ _id: oid(), dni: '777' }));
    const out = await service.findOrCreateByDni('777');
    expect(out.dni).toBe('777');
    expect(userModel.findOne).toHaveBeenCalledWith({ dni: '777' });
  });

  it('USR-SVC-005 updateVotePlaceByDni: DNI requerido', async () => {
    // @ts-ignore
    await expect(service.updateVotePlaceByDni('', {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('USR-SVC-006 updateVotePlaceByDni: locationId no existe → 404', async () => {
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: oid(), dni: '1' }),
    } as any);
    locationModel.exists.mockResolvedValue(null);
    await expect(
      service.updateVotePlaceByDni('1', { locationId: oid().toString() }),
    ).rejects.toThrow('Recinto no encontrado');
  });

  it('USR-SVC-007 updateVotePlaceByDni: tableId no existe → 404', async () => {
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

  it('USR-SVC-008 updateVotePlaceByDni: valida que la mesa pertenezca al recinto', async () => {
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

  it('USR-SVC-009 updateVotePlaceByDni: setea locationId y table por tableCode, y borra mesa previa si cambió de recinto', async () => {
    const locId = oid();
    const prevLocId = oid();
    const uId = oid();
    // findOrCreate
    userModel.findOneAndUpdate.mockReturnValue({
      orFail: () => chain({ _id: uId, dni: '9', votingTableId: oid() }),
    } as any);
    // existe recinto
    locationModel.exists.mockResolvedValue(true);
    // table por código
    tableModel.findById.mockResolvedValue(null);
    tableModel.findOne.mockReturnValue(
      chain({ _id: oid(), electoralLocationId: locId }),
    );
    // user.updateOne
    userModel.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    // traer fresh poblado
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

    // además: al cambiar de recinto, el código borra mesa previa si no corresponde
    // simulamos que la mesa previa pertenece a otro recinto (prevLocId)
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

  it('USR-SVC-010 getVotePlaceByDni: crea si no existe y devuelve shape', async () => {
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
  it('USR-SVC-011 getVotePlaceByDni: DNI requerido', async () => {
    // @ts-ignore
    await expect(service.getVotePlaceByDni('')).rejects.toThrow(
      BadRequestException,
    );
  });
});
