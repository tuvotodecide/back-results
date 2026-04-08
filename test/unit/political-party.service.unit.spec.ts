import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PoliticalPartyService } from '@/modules/political/services/political-party.service';
import { PoliticalParty } from '@/modules/political/schemas/political-party.schema';
import { ElectionParty } from '@/modules/political/schemas/election-party-schema';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';

const mkModel = () => ({
  find: jest.fn().mockReturnThis(),
  findOne: jest.fn().mockReturnThis(),
  findById: jest.fn().mockReturnThis(),
  findByIdAndUpdate: jest.fn().mockReturnThis(),
  findByIdAndDelete: jest.fn().mockReturnThis(),
  updateMany: jest.fn().mockResolvedValue({}),
  deleteOne: jest.fn().mockReturnThis(),
  countDocuments: jest.fn().mockResolvedValue(0),
  bulkWrite: jest
    .fn()
    .mockResolvedValue({ modifiedCount: 0, upsertedCount: 0 }),
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  exec: jest.fn(),
  lean: jest.fn().mockReturnThis(),
});

describe('PoliticalPartyService', () => {
  let svc: PoliticalPartyService;
  const partyModel = mkModel();
  const electionPartyModel = mkModel();
  const departmentModel = mkModel();
  const municipalityModel = mkModel();

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PoliticalPartyService,
        { provide: getModelToken(PoliticalParty.name), useValue: partyModel },
        {
          provide: getModelToken(ElectionParty.name),
          useValue: electionPartyModel,
        },
        { provide: getModelToken(Department.name), useValue: departmentModel },
        { provide: getModelToken(Municipality.name), useValue: municipalityModel },
      ],
    }).compile();

    svc = mod.get(PoliticalPartyService);
    jest.clearAllMocks();
  });

  it('create lanza 409 por 11000', async () => {
    const save = jest.fn().mockRejectedValue({ code: 11000 });
    (svc as any).politicalPartyModel = function (data: any) {
      return { ...data, save };
    };
    await expect(
      svc.create({
        partyId: 'MAS',
        fullName: 'x',
        shortName: 'x',
        color: '#000',
      } as any),
    ).rejects.toThrow(ConflictException);
  });

  it('create acepta colors[] y deriva color principal normalizado', async () => {
    const save = jest.fn().mockResolvedValue({
      _id: 'party-1',
      partyId: 'MAS',
      fullName: 'Movimiento al Socialismo',
      shortName: 'MAS',
      color: '#123456',
      colors: ['#123456', '#ABCDEF'],
      active: true,
      toObject() {
        return this;
      },
    });
    (svc as any).politicalPartyModel = function (data: any) {
      return { ...data, save };
    };

    const created = await svc.create({
      partyId: 'MAS',
      fullName: 'Movimiento al Socialismo',
      shortName: 'MAS',
      colors: ['#123456', '#abcdef', '#123456'],
    } as any);

    expect(save).toHaveBeenCalled();
    expect(created.color).toBe('#123456');
    expect(created.colors).toEqual(['#123456', '#ABCDEF']);
  });

  it('findOne 404 si no existe', async () => {
    (partyModel.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.findOne('id')).rejects.toThrow(NotFoundException);
  });

  it('update 404 si no existe', async () => {
    (partyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.update('id', {} as any)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('update 409 por conflicto', async () => {
    (partyModel.findById as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: 'x' }),
    });
    (partyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });
    await expect(svc.update('id', {} as any)).rejects.toThrow(
      ConflictException,
    );
  });

  it('update acepta colors[] y persiste color derivado', async () => {
    (partyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'party-1',
        partyId: 'MAS',
        fullName: 'Movimiento al Socialismo',
        shortName: 'MAS',
        color: '#00AAFF',
        colors: ['#00AAFF', '#FFFFFF'],
        active: true,
        toObject() {
          return this;
        },
      }),
    });

    const updated = await svc.update('party-1', {
      colors: ['#00aaff', '#ffffff', '#00AAFF'],
    } as any);

    expect(updated.color).toBe('#00AAFF');
    expect(updated.colors).toEqual(['#00AAFF', '#FFFFFF']);
    expect(partyModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'party-1',
      {
        $set: expect.objectContaining({
          color: '#00AAFF',
          colors: ['#00AAFF', '#FFFFFF'],
        }),
      },
      { new: true, runValidators: true },
    );
  });

  it('findOne expone colors[] a partir de color legacy', async () => {
    (partyModel.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        _id: 'party-1',
        partyId: 'LIBRE',
        fullName: 'Alianza Libre',
        shortName: 'LIBRE',
        color: '#2196f3',
      }),
    });

    const party = await svc.findOne('party-1');

    expect(party.color).toBe('#2196F3');
    expect(party.colors).toEqual(['#2196F3']);
  });

  it('rechaza colores invalidos antes de escribir', async () => {
    await expect(
      svc.create({
        partyId: 'MAS',
        fullName: 'Movimiento al Socialismo',
        shortName: 'MAS',
        colors: ['azul'],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('remove 404 si no existe', async () => {
    (partyModel.deleteOne as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    await expect(svc.remove('id')).rejects.toThrow(NotFoundException);
  });

  it('getActiveParties sort por partyId asc', async () => {
    (partyModel.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }, { partyId: 'B' }]),
    });
    const out = await svc.getActiveParties();
    expect(out[0].partyId).toBe('A');
  });

  it('validatePartyIds global true/false', async () => {
    (partyModel.find as any).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      collation: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }, { partyId: 'B' }]),
    });
    expect(await svc.validatePartyIds(['A', 'B'])).toBe(true);
    (partyModel.find as any).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      collation: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }]),
    });
    expect(await svc.validatePartyIds(['A', 'B'])).toBe(false);
  });

  it(' validatePartyIds con electionId usa validatePartyIdsForElection', async () => {
    const spy = jest
      .spyOn(svc, 'validatePartyIdsForElection' as any)
      .mockResolvedValue(true);
    const ok = await svc.validatePartyIds(['X'], '65f0f0f0f0f0f0f0f0f0f0f0');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  const eid = '507f1f77bcf86cd799439011';

  it('assignPartiesToElection retorna assigned (modified+upserted)', async () => {
    (electionPartyModel.bulkWrite as jest.Mock).mockResolvedValue({
      modifiedCount: 1,
      upsertedCount: 2,
    });
    const res = await svc.assignPartiesToElection(eid, ['A', 'B', 'B']);
    expect(res.assigned).toBe(3);
  });

  it('removePartiesFromElection retorna removed', async () => {
    (electionPartyModel.updateMany as jest.Mock).mockResolvedValue({
      modifiedCount: 4,
    });
    const res = await svc.removePartiesFromElection(eid, ['A', 'B']);
    expect(res.removed).toBe(4);
  });

  it('getElectionParties orden correcto', async () => {
    (electionPartyModel.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { _id: '2', partyId: 'B', active: false, ballotNumber: 2 },
        { _id: '1', partyId: 'A', active: true, ballotNumber: 5 },
        { _id: '3', partyId: 'C', active: true, ballotNumber: 1 },
      ]),
    });
    (partyModel.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      collation: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { partyId: 'A', color: '#111111' },
        { partyId: 'B', color: '#222222' },
        { partyId: 'C', color: '#333333' },
      ]),
    });
    const result = await svc.getElectionParties(eid);
    expect(result.map((item: any) => item.partyId)).toEqual(['C', 'B', 'A']);
    expect(result[0].colors).toEqual(['#333333']);
  });

  it('updateElectionParty 404 si no existe', async () => {
    (electionPartyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.updateElectionParty('x', {} as any)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updateElectionParty acepta payload legacy y colors[]', async () => {
    (electionPartyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: 'ep-1',
        partyId: 'A',
        ballotNumber: 10,
        color: '#00FF00',
        colors: ['#00FF00', '#FFFFFF'],
        active: false,
        toObject() {
          return this;
        },
      }),
    });
    (partyModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      collation: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({
        partyId: 'A',
        shortName: 'A',
        fullName: 'Partido A',
        color: '#111111',
      }),
    });

    const updated = await svc.updateElectionParty('ep-1', {
      ballotNumber: 10,
      colors: ['#00ff00', '#ffffff'],
      active: false,
    });

    expect(updated.color).toBe('#00FF00');
    expect(updated.colors).toEqual(['#00FF00', '#FFFFFF']);
  });
});
