import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PoliticalPartyService } from '@/modules/political/services/political-party.service';
import { PoliticalParty } from '@/modules/political/schemas/political-party.schema';
import { ElectionParty } from '@/modules/political/schemas/election-party-schema';

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

describe('PoliticalPartyService (unit)', () => {
  let svc: PoliticalPartyService;
  const partyModel = mkModel();
  const electionPartyModel = mkModel();

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PoliticalPartyService,
        { provide: getModelToken(PoliticalParty.name), useValue: partyModel },
        {
          provide: getModelToken(ElectionParty.name),
          useValue: electionPartyModel,
        },
      ],
    }).compile();

    svc = mod.get(PoliticalPartyService);
    jest.clearAllMocks();
  });

  it('POL-SVC-001 create lanza 409 por 11000', async () => {
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

  it('POL-SVC-002 findOne 404 si no existe', async () => {
    (partyModel.findById as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.findOne('id')).rejects.toThrow(NotFoundException);
  });

  it('POL-SVC-003 update 404 si no existe', async () => {
    (partyModel.findById as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.update('id', {} as any)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('POL-SVC-004 update 409 por conflicto', async () => {
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

  it('POL-SVC-005 remove 404 si no existe', async () => {
    (partyModel.deleteOne as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    await expect(svc.remove('id')).rejects.toThrow(NotFoundException);
  });

  it('POL-SVC-006 getActiveParties sort por partyId asc', async () => {
    (partyModel.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }, { partyId: 'B' }]),
    });
    const out = await svc.getActiveParties();
    expect(out[0].partyId).toBe('A');
  });

  it('POL-SVC-007 validatePartyIds global true/false', async () => {
    (partyModel.find as any).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }, { partyId: 'B' }]),
    });
    expect(await svc.validatePartyIds(['A', 'B'])).toBe(true);
    (partyModel.find as any).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ partyId: 'A' }]),
    });
    expect(await svc.validatePartyIds(['A', 'B'])).toBe(false);
  });

  it('POL-SVC-008 validatePartyIds con electionId usa validatePartyIdsForElection', async () => {
    const spy = jest
      .spyOn(svc, 'validatePartyIdsForElection' as any)
      .mockResolvedValue(true);
    const ok = await svc.validatePartyIds(['X'], '65f0f0f0f0f0f0f0f0f0f0f0');
    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  const eid = '507f1f77bcf86cd799439011';

  it('POL-SVC-009 assignPartiesToElection retorna assigned (modified+upserted)', async () => {
    (electionPartyModel.bulkWrite as jest.Mock).mockResolvedValue({
      modifiedCount: 1,
      upsertedCount: 2,
    });
    const res = await svc.assignPartiesToElection(eid, ['A', 'B', 'B']);
    expect(res.assigned).toBe(3);
  });

  it('POL-SVC-010 removePartiesFromElection retorna removed', async () => {
    (electionPartyModel.updateMany as jest.Mock).mockResolvedValue({
      modifiedCount: 4,
    });
    const res = await svc.removePartiesFromElection(eid, ['A', 'B']);
    expect(res.removed).toBe(4);
  });

  it('POL-SVC-011 getElectionParties orden correcto', async () => {
    (electionPartyModel.find as jest.Mock).mockReturnValue({
      sort: jest.fn((o: any) => {
        expect(o).toEqual({ active: -1, ballotNumber: 1, partyId: 1 });
        return { lean: () => ({ exec: () => Promise.resolve([]) }) };
      }),
    });
    await svc.getElectionParties(eid);
  });

  it('POL-SVC-012 updateElectionParty 404 si no existe', async () => {
    (electionPartyModel.findByIdAndUpdate as jest.Mock).mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.updateElectionParty('x', {} as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});
