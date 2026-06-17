import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('EmitVoteService (unit)', () => {
  let enabledSessionModel: { findOne: jest.Mock };
  let votingOptionModel: { findById: jest.Mock };
  let zkAuthService: { zkRequestCallback: jest.Mock };
  let voteWritterService: { castVote: jest.Mock };
  let service: EmitVoteService;

  const eventId = new Types.ObjectId().toString();
  const nullifier = 'nullifier-001';

  const zkResponse = (scope: any[]) => ({
    body: { scope },
  } as any);

  const validScope = [
    {
      id: 1,
      vp: {
        verifiableCredential: {
          credentialSubject: { eventId },
        },
      },
    },
    {
      id: 2,
      vp: {
        verifiableCredential: {
          credentialSubject: { nullifier },
        },
      },
    },
  ];

  beforeEach(() => {
    enabledSessionModel = {
      findOne: jest.fn(),
    };
    votingOptionModel = {
      findById: jest.fn(),
    };
    zkAuthService = {
      zkRequestCallback: jest.fn(),
    };
    voteWritterService = {
      castVote: jest.fn().mockResolvedValue(undefined),
    };

    service = new EmitVoteService(
      enabledSessionModel as any,
      votingOptionModel as any,
      zkAuthService as any,
      voteWritterService as any,
    );
  });

  it('getVoteVc devuelve la VC cuando existe una sesión habilitada', async () => {
    enabledSessionModel.findOne.mockReturnValue(
      execResolved({ sessionToken: 'vc-token-123' }),
    );

    await expect(service.getVoteVc(eventId, '123456')).resolves.toEqual({
      vc: 'vc-token-123',
    });
    expect(enabledSessionModel.findOne).toHaveBeenCalledWith({
      eventId: new Types.ObjectId(eventId),
      dni: '123456',
    });
  });

  it('getVoteVc lanza NotFoundException cuando no existe sesión habilitada', async () => {
    enabledSessionModel.findOne.mockReturnValue(execResolved(null));

    await expect(service.getVoteVc(eventId, '123456')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('emitVote con optionId=blank extrae eventId/nullifier y emite voto blanco', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));

    await expect(service.emitVote('blank', 'mock-proof')).resolves.toEqual(
      zkResponse(validScope),
    );

    expect(zkAuthService.zkRequestCallback).toHaveBeenCalledWith('vote', 'mock-proof');
    expect(voteWritterService.castVote).toHaveBeenCalledWith(
      eventId,
      'BLANK',
      nullifier,
    );
    expect(votingOptionModel.findById).not.toHaveBeenCalled();
  });

  it('emitVote con opción válida usa el nombre de la opción para escribir on-chain', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    votingOptionModel.findById.mockReturnValue(
      execResolved({ _id: 'option-id', name: 'Frente Azul' }),
    );

    await service.emitVote('option-id', 'mock-proof');

    expect(votingOptionModel.findById).toHaveBeenCalledWith('option-id');
    expect(voteWritterService.castVote).toHaveBeenCalledWith(
      eventId,
      'Frente Azul',
      nullifier,
    );
  });

  it('emitVote con opción inexistente devuelve NotFoundException', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    votingOptionModel.findById.mockReturnValue(execResolved(null));

    await expect(service.emitVote('missing-option', 'mock-proof')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('emitVote con proof sin eventId devuelve BadRequestException', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(
      zkResponse([validScope[1]]),
    );

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('emitVote con proof sin nullifier devuelve BadRequestException', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(
      zkResponse([validScope[0]]),
    );

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('propaga el error del writer on-chain mockeado', async () => {
    const error = new Error('mock writer failure');
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    voteWritterService.castVote.mockRejectedValue(error);

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toThrow(
      'mock writer failure',
    );
  });
});
