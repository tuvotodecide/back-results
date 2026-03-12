import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';

import { AttestationService } from '@/modules/attestation/services/attestation.service';
import { UsersService } from '@/modules/users/services/users.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { Types } from 'mongoose';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { BallotComparison } from '@/modules/attestation/schemas/ballot-comparison.schema';

const attModel = () => ({
  create: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  aggregate: jest.fn(),
  distinct: jest.fn(),
});

const ballotModel = () => ({
  find: jest.fn(),
  findById: jest.fn(),
  aggregate: jest.fn(),
  countDocuments: jest.fn(),
  exists: jest.fn(),
});

const attCaseModel = () => ({
  create: jest.fn(),
  find: jest.fn(),
  aggregate: jest.fn(),
});

const ballotComparisonModel = () => ({
  findOneAndUpdate: jest.fn(),
});

const electionCfg = {
  getActiveConfigs: jest.fn().mockResolvedValue([{ id: 'Election1' }]),
  getActiveConfig: jest.fn(),
  findOne: jest.fn(),
};
const userSvc = { findOrCreateByDni: jest.fn() };
const delegatesSvc = { getAuthorizedContracts: jest.fn() };
const contractsSvc = { getClientContract: jest.fn() };

describe('AttestationService', () => {
  let svc: AttestationService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AttestationService,
        { provide: getModelToken('Attestation'), useValue: attModel() },
        { provide: getModelToken(Ballot.name), useValue: ballotModel() },
        { provide: getModelToken('AttestationCase'), useValue: attCaseModel() },
        {
          provide: getModelToken(BallotComparison.name),
          useValue: ballotComparisonModel(),
        },
        { provide: UsersService, useValue: userSvc },
        { provide: ElectionConfigService, useValue: electionCfg },
        { provide: DelegatesService, useValue: delegatesSvc },
        { provide: ContractsService, useValue: contractsSvc },
      ],
    }).compile();

    svc = mod.get(AttestationService);
    jest.clearAllMocks();
  });

  it('crear attestation crea usuario si no existe', async () => {
    const validBallotId = new Types.ObjectId().toString();
    const validElectionId = new Types.ObjectId().toString();

    (svc as any).attestationModel.create.mockResolvedValue({ ok: 1 });
    userSvc.findOrCreateByDni.mockResolvedValue({ _id: 'U1' });

    await (svc as any).create({
      dni: '12345678',
      ballotId: validBallotId,
      electionId: validElectionId,
      support: true,
    });

    expect(userSvc.findOrCreateByDni).toHaveBeenCalledWith('12345678');
  });

  it('unicidad retorna error', async () => {
    const validBallotId = new Types.ObjectId().toString();
    const validElectionId = new Types.ObjectId().toString();

    const dup = Object.assign(new Error('dup'), { code: 11000 });
    (svc as any).attestationModel.create.mockRejectedValue(dup);
    userSvc.findOrCreateByDni.mockResolvedValue({ _id: 'U1' });

    await expect(
      (svc as any).create({
        dni: '12345678',
        ballotId: validBallotId, 
        electionId: validElectionId,
        support: true,
      }),
    ).rejects.toThrow(/ya atestiguó/i);
  });

  it('filtros por electionId/isJury/support', async () => {
    (svc as any).attestationModel.find.mockReturnValue({
      skip: () => ({
        limit: () => ({ sort: () => ({ lean: () => [{ _id: 'A1' }] }) }),
      }),
    });
    (svc as any).attestationModel.countDocuments.mockResolvedValue(42);

    const res = await (svc as any).list({
      electionId: 'Election1',
      isJury: true,
      support: false,
      page: 2,
      pageSize: 10,
    });
    expect(res.total).toBe(42);
    expect(Array.isArray(res.items)).toBe(true);
  });

  it('runBallotComparisons persiste MATCH cuando coincide con TSE', async () => {
    const electionId = new Types.ObjectId().toString();
    const ballotId = new Types.ObjectId();

    electionCfg.getActiveConfig.mockResolvedValue(null);
    electionCfg.findOne.mockResolvedValue({ id: electionId, type: 'presidential' });

    (svc as any).ballotModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: ballotId,
              electionId: new Types.ObjectId(electionId),
              tableCode: '2010691',
              version: 1,
              status: 'processed',
              votes: {
                parties: {
                  validVotes: 216,
                  nullVotes: 6,
                  blankVotes: 1,
                  totalVotes: 223,
                  partyVotes: [
                    { partyId: 'pdc', votes: 98 },
                    { partyId: 'libre', votes: 118 },
                  ],
                },
              },
              createdAt: new Date(),
            },
          ]),
        }),
      }),
    });

    (svc as any).attestationModel.distinct.mockResolvedValue([ballotId]);
    (svc as any).ballotModel.db = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === 'political_parties') {
          return {
            find: jest.fn().mockReturnValue({
              project: jest.fn().mockReturnValue({
                toArray: jest.fn().mockResolvedValue([
                  { partyId: 'pdc', shortName: 'PDC' },
                  { partyId: 'libre', shortName: 'LIBRE' },
                ]),
              }),
            }),
          };
        }
        return { find: jest.fn() };
      }),
    };

    jest
      .spyOn(svc as any, 'fetchTseMesaResult')
      .mockResolvedValue({
        tabla: [[
          { nombre: 'PDC', valor: '98' },
          { nombre: 'LIBRE', valor: '118' },
          { nombre: 'voto_valido', valor: '216' },
          { nombre: 'voto_blanco', valor: '1' },
          { nombre: 'voto_nulo', valor: '6' },
          { nombre: 'voto_emitido', valor: '223' },
        ]],
        fecha: '10/03/2026 13:31:05',
      });

    (svc as any).ballotComparisonModel.findOneAndUpdate.mockResolvedValue({});

    const result = await (svc as any).runBallotComparisons({
      electionId,
      onlyAttested: true,
    });

    expect(result.processed).toBe(1);
    expect(result.byStatus.MATCH).toBe(1);
    expect((svc as any).ballotComparisonModel.findOneAndUpdate).toHaveBeenCalled();
  });
});
