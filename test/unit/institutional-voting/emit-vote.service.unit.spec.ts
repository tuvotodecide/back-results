import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('EmitVoteService (unit)', () => {
  let enabledSessionModel: { findOne: jest.Mock; updateOne: jest.Mock };
  let votingOptionModel: { findById: jest.Mock };
  let zkAuthService: { zkRequestCallback: jest.Mock };
  let voteWritterService: { castVote: jest.Mock; addNewVoters: jest.Mock };
  let historyService: { create: jest.Mock };
  let voteReaderService: { isDniInMerkleTree: jest.Mock };
  let issuerService: { getDidsByDnis: jest.Mock; issueCredential: jest.Mock };
  let accessService: { getEventOrThrow: jest.Mock };
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
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    votingOptionModel = {
      findById: jest.fn(),
    };
    zkAuthService = {
      zkRequestCallback: jest.fn(),
    };
    voteWritterService = {
      castVote: jest.fn().mockResolvedValue({ txHash: '0xtxhash', date: new Date().toISOString() }),
      addNewVoters: jest.fn(),
    };
    historyService = {
      create: jest.fn().mockResolvedValue(undefined),
    };
    voteReaderService = {
      isDniInMerkleTree: jest.fn().mockResolvedValue(false),
    };
    issuerService = {
      getDidsByDnis: jest.fn(),
      issueCredential: jest.fn(),
    };
    accessService = {
      getEventOrThrow: jest.fn().mockResolvedValue({ isOpenVoting: false }),
    };

    service = new EmitVoteService(
      enabledSessionModel as any,
      votingOptionModel as any,
      zkAuthService as any,
      voteWritterService as any,
      historyService as any,
      voteReaderService as any,
      issuerService as any,
      accessService as any,
    );
  });

  it('VOT-PRE-P0-002 | getVoteVc devuelve la VC cuando existe una sesión habilitada', async () => {
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

  it('VOT-PRE-P0-002 | getVoteVc lanza NotFoundException cuando no existe sesión habilitada', async () => {
    enabledSessionModel.findOne.mockReturnValue(execResolved(null));

    await expect(service.getVoteVc(eventId, '123456')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('RDV-P0-03-001 getVoteVc devuelve la VC cuando no hay sesión en BD y el DNI está en el árbol de Merkle', async () => {
    enabledSessionModel.findOne.mockReturnValue(execResolved(null));
    voteReaderService.isDniInMerkleTree.mockResolvedValue(true);
    issuerService.getDidsByDnis.mockResolvedValue(['did:example:123']);
    voteWritterService.addNewVoters.mockResolvedValue(['nullifier-1']);
    issuerService.issueCredential.mockResolvedValue({
      '123456': { credentialData: 'vc-new-token' },
    });

    await expect(service.getVoteVc(eventId, '123456')).resolves.toEqual({
      vc: 'vc-new-token',
    });

    expect(voteReaderService.isDniInMerkleTree).toHaveBeenCalledWith(eventId, '123456');
    expect(issuerService.getDidsByDnis).toHaveBeenCalledWith(['123456']);
    expect(voteWritterService.addNewVoters).toHaveBeenCalledWith(1);
    expect(issuerService.issueCredential).toHaveBeenCalledWith(
      ['did:example:123'],
      eventId,
      ['nullifier-1'],
    );
    expect(enabledSessionModel.updateOne).toHaveBeenCalledWith(
      { eventId: new Types.ObjectId(eventId), dni: '123456' },
      { $set: { sessionToken: 'vc-new-token' } },
      { upsert: true },
    );
  });

  it('RDV-P0-05-001 getVoteVc lanza NotFoundException cuando getDidsByDnis no devuelve DIDs', async () => {
    enabledSessionModel.findOne.mockReturnValue(execResolved(null));
    voteReaderService.isDniInMerkleTree.mockResolvedValue(true);
    issuerService.getDidsByDnis.mockResolvedValue([]);

    await expect(service.getVoteVc(eventId, '123456')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(voteWritterService.addNewVoters).not.toHaveBeenCalled();
    expect(issuerService.issueCredential).not.toHaveBeenCalled();
  });

  it('VOT-SEL-P0-002 / VOT-PRE-P0-004 / VOT-CHN-P0-001 | emitVote con optionId=blank extrae eventId/nullifier y emite voto blanco', async () => {
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

  it('VOT-PRE-P0-001 / VOT-CHN-P0-001 | emitVote con opción válida usa el nombre de la opción para escribir on-chain una sola vez', async () => {
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
    expect(voteWritterService.castVote).toHaveBeenCalledTimes(1);
  });

  it('VOT-CHN-P0-003 | emitVote con opción inexistente devuelve NotFoundException sin escribir on-chain', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    votingOptionModel.findById.mockReturnValue(execResolved(null));

    await expect(service.emitVote('missing-option', 'mock-proof')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('VOT-PRE-P0-004 / VOT-CHN-P0-003 | emitVote con proof sin eventId devuelve BadRequestException', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(
      zkResponse([validScope[1]]),
    );

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('VOT-PRE-P0-004 / VOT-CHN-P0-003 | emitVote con proof sin nullifier devuelve BadRequestException', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(
      zkResponse([validScope[0]]),
    );

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });

  it('[MX-07][VOT-SEC-P0-002][UNITARIA] VOT-ERR-P1-003 envuelve el error del writer on-chain mockeado en error controlado sin secretos', async () => {
    const error = new Error('mock writer failure');
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    voteWritterService.castVote.mockRejectedValue(error);

    let thrown: unknown;
    try {
      await service.emitVote('blank', 'mock-proof');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InternalServerErrorException);
    expect((thrown as Error).message).toBe(
      'An error occurred while casting the vote',
    );
    expect(JSON.stringify(thrown)).not.toContain('mock-proof');
    expect(JSON.stringify(thrown)).not.toContain(nullifier);
    expect(JSON.stringify(thrown)).not.toContain('private');
  });

  it('VOT-ERR-P0-001 / VOT-CHN-P0-003 | emitVote con nullifier duplicado retorna BadRequestException controlado', async () => {
    zkAuthService.zkRequestCallback.mockResolvedValue(zkResponse(validScope));
    voteWritterService.castVote.mockRejectedValue(
      new Error('Nullifier already used'),
    );

    await expect(service.emitVote('blank', 'mock-proof')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.emitVote('blank', 'mock-proof')).rejects.toThrow(
      'This vote has already been cast',
    );
  });

  it('VOT-PRE-P0-004 / VOT-ERR-P1-003 | emitVote propaga rechazo de ZK callback y no llama writer', async () => {
    const zkError = new Error('invalid zk proof');
    zkAuthService.zkRequestCallback.mockRejectedValue(zkError);

    await expect(service.emitVote('blank', 'bad-proof')).rejects.toThrow(
      'invalid zk proof',
    );
    expect(voteWritterService.castVote).not.toHaveBeenCalled();
  });
});
