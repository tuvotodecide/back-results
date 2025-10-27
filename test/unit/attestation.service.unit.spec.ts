import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';

import { AttestationService } from '@/modules/attestation/services/attestation.service';
import { UsersService } from '@/modules/users/services/users.service';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { Types } from 'mongoose';

const attModel = () => ({
  create: jest.fn(),
  countDocuments: jest.fn(),
  find: jest.fn(),
  aggregate: jest.fn(),
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

const electionCfg = {
  getActiveConfigs: jest.fn().mockResolvedValue([{ id: 'Election1' }]),
  getActiveConfig: jest.fn(),
};
const userSvc = { findOrCreateByDni: jest.fn() };

describe('AttestationService', () => {
  let svc: AttestationService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AttestationService,
        { provide: getModelToken('Attestation'), useValue: attModel() },
        { provide: getModelToken(Ballot.name), useValue: ballotModel() },
        { provide: getModelToken('AttestationCase'), useValue: attCaseModel() },
        { provide: UsersService, useValue: userSvc },
        { provide: ElectionConfigService, useValue: electionCfg },
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
});
