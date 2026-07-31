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

const attModel = () => {
  const model: any = jest.fn().mockImplementation((data: any) => ({
    ...data,
    save: model.saveMock,
    toObject: () => ({ _id: new Types.ObjectId(), ...data }),
  }));
  model.saveMock = jest.fn().mockImplementation(async function (this: any) {
    return {
      ...this,
      toObject: () => ({ _id: new Types.ObjectId(), ...this }),
    };
  });
  model.create = jest.fn();
  model.countDocuments = jest.fn();
  model.find = jest.fn();
  model.aggregate = jest.fn();
  model.distinct = jest.fn();
  return model;
};

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

  it('[ACT-SND-P0-004][SEC-DNI-P0-002] crea atestiguamiento con DNI recibido y usuario normalizado', async () => {
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

  it('[REC-DUP-P0-004] rechaza atestiguamiento duplicado por usuario y acta', async () => {
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

  it('[SEC-ACC-P0-001][SEC-DEL-P0-005] filtra atestiguamientos por eleccion jurado soporte y alcance minimo', async () => {
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

  it('[ADM-AUD-P1-005][TRA-P1-004] persiste comparacion MATCH con trazabilidad temporal disponible', async () => {
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

  it('[REC-DUP-P0-004][REC-PAR-P0-006] reporta duplicado en errors y conserva resumen sin persistencia doble', async () => {
    const ballotId = new Types.ObjectId();
    const electionId = new Types.ObjectId();

    (svc as any).ballotModel.exists.mockResolvedValue(true);
    (svc as any).ballotModel.findById
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: ballotId, electionId }),
        }),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: ballotId,
          electionId,
          location: { department: 'La Paz', municipality: 'La Paz' },
        }),
      });
    userSvc.findOrCreateByDni.mockResolvedValue({
      _id: new Types.ObjectId(),
      dni: '12345678',
    });
    delegatesSvc.getAuthorizedContracts.mockResolvedValue([]);
    (svc as any).attestationModel.saveMock.mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: 11000 }),
    );

    const result = await svc.createBulk({
      attestations: [
        {
          dni: '12345678',
          ballotId: ballotId.toString(),
          support: true,
          isJury: false,
        },
      ],
    } as any);

    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('El usuario ya atestigu');
    expect(result.summary).toEqual({ total: 1, successful: 0, failed: 1 });
  });

  it('[SEC-ACC-P0-001][SEC-DEL-P0-005] marca delegado fuera de alcance como no valido para reporte de contrato', async () => {
    const ballotId = new Types.ObjectId();
    const electionId = new Types.ObjectId();

    (svc as any).ballotModel.exists.mockResolvedValue(true);
    (svc as any).ballotModel.findById
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: ballotId, electionId }),
        }),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          _id: ballotId,
          electionId,
          location: { department: 'La Paz', municipality: 'La Paz' },
        }),
      });
    userSvc.findOrCreateByDni.mockResolvedValue({
      _id: new Types.ObjectId(),
      dni: '87654321',
    });
    delegatesSvc.getAuthorizedContracts.mockResolvedValue([
      { clientId: new Types.ObjectId() },
    ]);
    contractsSvc.getClientContract.mockResolvedValue({
      _id: new Types.ObjectId(),
      active: true,
      clientRole: 'GOVERNOR',
      departmentId: new Types.ObjectId(),
      departmentName: 'Santa Cruz',
    });
    (svc as any).attestationModel.saveMock.mockImplementation(async function (this: any) {
      return {
        ...this,
        toObject: () => ({ _id: new Types.ObjectId(), ...this }),
      };
    });

    const result = await svc.createBulk({
      attestations: [
        {
          dni: '87654321',
          ballotId: ballotId.toString(),
          support: true,
          isJury: false,
        },
      ],
    } as any);

    expect(result.errors).toHaveLength(0);
    expect((svc as any).attestationModel).toHaveBeenCalledWith(
      expect.objectContaining({
        isValidForClientReport: false,
        validForContractId: null,
      }),
    );
    expect(result.summary).toEqual({ total: 1, successful: 1, failed: 0 });
  });
});
