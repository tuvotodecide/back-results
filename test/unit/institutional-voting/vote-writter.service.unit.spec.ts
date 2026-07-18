const mockSendTransaction = jest.fn();
const mockWaitForTransactionReceipt = jest.fn();
const mockGetTransactionReceipt = jest.fn();
const mockGetBlock = jest.fn();
const mockCreateVoteCall = jest.fn();
const mockCastVoteCall = jest.fn();

jest.mock('@/api/params', () => ({
  availableNetworks: {
    'base-sepolia': {
      chain: { id: 84532, name: 'Base Sepolia' },
      bundler: 'https://mock-bundler.local',
      voteContract: '0xVoteContract',
    },
  },
}));

jest.mock('@/api/vote', () => ({
  VoteContractCalls: {
    createVote: (...args: any[]) => mockCreateVoteCall(...args),
    castVote: (...args: any[]) => mockCastVoteCall(...args),
    updateVoteSchedule: jest.fn(),
    addNewVoters: jest.fn(),
  },
}));

jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    getTransactionReceipt: mockGetTransactionReceipt,
    getBlock: mockGetBlock,
  })),
  http: jest.fn((url: string) => ({ url })),
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn((privateKey: string) => ({ privateKey })),
}));

jest.mock('viem/account-abstraction', () => ({
  entryPoint07Address: '0xEntryPoint',
  toCoinbaseSmartAccount: jest.fn(async () => ({ address: '0xSmartAccount' })),
}));

jest.mock('permissionless/clients/pimlico', () => ({
  createPimlicoClient: jest.fn(() => ({ name: 'pimlico-mock' })),
}));

jest.mock('permissionless', () => ({
  createSmartAccountClient: jest.fn(() => ({
    sendTransaction: mockSendTransaction,
  })),
}));

import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';

import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { MerkletreeService } from '@/modules/merkletree/services/merkletree.service';

describe('VoteWritterService (unit)', () => {
  let service: VoteWritterService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreateVoteCall.mockReturnValue({ to: '0xVoteContract', data: '0xcreate' });
    mockCastVoteCall.mockReturnValue({ to: '0xVoteContract', data: '0xcast' });
    mockSendTransaction.mockResolvedValue('0xtx');
    mockWaitForTransactionReceipt.mockResolvedValue({ blockNumber: 123n });
    mockGetBlock.mockResolvedValue({ timestamp: 1_700_000_000n });

    service = new VoteWritterService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'app.blockchain.chain': 'base-sepolia',
          'app.blockchain.privateKey': '0xprivate',
        };
        return values[key];
      }),
    } as unknown as ConfigService,
    {} as unknown as MerkletreeService);
    await service.getAccount();
  });

  it('createVote construye la llamada on-chain esperada y agrega BLANK', async () => {
    const eventId = new Types.ObjectId();
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T12:00:00.000Z');
    const publishAt = new Date('2026-01-01T13:00:00.000Z');

    const nullifiers = await service.createVote(
      {
        _id: eventId,
        name: 'Eleccion prueba',
        votingStart: start,
        votingEnd: end,
        resultsPublishAt: publishAt,
      } as any,
      ['dni-1', 'dni-2'],
      ['Frente Azul'],
    );

    expect(nullifiers).toHaveLength(2);
    expect(mockCreateVoteCall).toHaveBeenCalledWith(
      'base-sepolia',
      eventId.toString(),
      'Eleccion prueba',
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000),
      Math.floor(publishAt.getTime() / 1000),
      expect.arrayContaining(nullifiers),
      ['Frente Azul', 'BLANK'],
    );
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xVoteContract',
      data: '0xcreate',
    });
  });

  it('castVote construye la llamada con eventId, opción y nullifier', async () => {
    await service.castVote('event-1', 'Frente Azul', 'nullifier-1');

    expect(mockCastVoteCall).toHaveBeenCalledWith(
      'base-sepolia',
      'event-1',
      'Frente Azul',
      'nullifier-1',
    );
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xVoteContract',
      data: '0xcast',
    });
  });

  it('propaga errores del cliente/bundler mockeado', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('bundler failed'));

    await expect(
      service.castVote('event-1', 'Frente Azul', 'nullifier-1'),
    ).rejects.toThrow('bundler failed');
  });

  it('usa getTransactionReceipt como fallback cuando waitForTransactionReceipt expira', async () => {
    const timeout = new Error('Timed out while waiting for transaction');
    timeout.name = 'WaitForTransactionReceiptTimeoutError';
    mockWaitForTransactionReceipt.mockRejectedValueOnce(timeout);
    mockGetTransactionReceipt.mockResolvedValueOnce({ blockNumber: 456n });

    await service.castVote('event-2', 'BLANK', 'nullifier-2');

    expect(mockGetTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtx' });
    expect(mockGetBlock).toHaveBeenCalledWith({ blockNumber: 456n });
  });
});
