import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({ ZkAuthService: class ZkAuthService {} }));

import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';

const exec = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });

describe('MX-07 mobile vote focal integration coverage', () => {
  const eventId = new Types.ObjectId().toString();
  const proof = { body: { scope: [
    { id: 1, vp: { verifiableCredential: { credentialSubject: { eventId } } } },
    { id: 2, vp: { verifiableCredential: { credentialSubject: { nullifier: 'n-1' } } } },
  ] } };
  let writer: { castVote: jest.Mock };
  let service: EmitVoteService;

  beforeEach(() => {
    writer = { castVote: jest.fn().mockResolvedValue({ receipt: { status: 'success' }, event: { eventName: 'Voted', args: { voteId: BigInt(`0x${eventId}`) } } }) };
    service = new EmitVoteService(
      { findOne: jest.fn() } as never,
      { findById: jest.fn().mockReturnValue(exec({ name: 'Opción válida' })) } as never,
      { zkRequestCallback: jest.fn().mockResolvedValue(proof) } as never,
      writer as never,
      { create: jest.fn().mockResolvedValue(undefined) } as never,
      { isDniInMerkleTree: jest.fn() } as never,
      { getDidsByDnis: jest.fn(), issueCredential: jest.fn() } as never,
      { getEventOrThrow: jest.fn().mockResolvedValue({ isOpenVoting: false }) } as never,
    );
  });

  it('[MX-07][VOT-CHN-P0-001][INTEGRACION] integra proof, repositorio de opción y gateway writer con los tres argumentos', async () => {
    await service.emitVote('option-id', 'proof-controlled');
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'Opción válida', 'n-1');
  });

  it('[MX-07][VOT-CHN-P0-002][INTEGRACION] conserva resultado confirmado solo con receipt success y evento Voted compatible', async () => {
    await expect(service.emitVote('blank', 'proof-controlled')).resolves.toEqual(proof);
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'BLANK', 'n-1');
    expect(writer.castVote.mock.results[0].value).resolves.toMatchObject({ receipt: { status: 'success' }, event: { eventName: 'Voted' } });
  });

  it('[MX-07][VOT-ERR-P0-002][INTEGRACION] conserva una operación enviada para reconciliarla sin segundo castVote', async () => {
    writer.castVote.mockResolvedValueOnce({ receipt: { status: 'pending' }, event: null, transactionHash: '0xcontrolled' });

    await service.emitVote('blank', 'proof-controlled');

    expect(writer.castVote).toHaveBeenCalledTimes(1);
    expect(writer.castVote).toHaveBeenCalledWith(eventId, 'BLANK', 'n-1');
  });
});
