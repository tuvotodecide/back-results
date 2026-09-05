const mockSendTransaction = jest.fn();
const mockWaitForTransactionReceipt = jest.fn();
const mockGetTransactionReceipt = jest.fn();
const mockGetBlock = jest.fn();
const mockCreateVoteCall = jest.fn();
const mockCastVoteCall = jest.fn();
const mockGetVoteHash = jest.fn();
const mockLiquidateCall = jest.fn();

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
  VoteContractUtils: {
    idToHex: (value: string) => BigInt(`0x${value}`),
    getVoteHash: (...args: any[]) => mockGetVoteHash(...args),
  },
  VoteContractReads: {},
}));

// Evita cargar @/api/account (y con el permissionless/accounts) al importar el servicio.
jest.mock('@/api/electoralCredits', () => ({
  CreditsContractCalls: {
    liquidate: (...args: any[]) => mockLiquidateCall(...args),
    tvdPerCredit: jest.fn(),
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
  let merkletreeService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCreateVoteCall.mockReturnValue({ to: '0xVoteContract', data: '0xcreate' });
    mockCastVoteCall.mockReturnValue({ to: '0xVoteContract', data: '0xcast' });
    mockSendTransaction.mockResolvedValue('0xtx');
    mockWaitForTransactionReceipt.mockResolvedValue({ blockNumber: 123n, status: 'success' });
    mockGetBlock.mockResolvedValue({ timestamp: 1_700_000_000n });
    mockGetVoteHash.mockResolvedValue(999n);
    mockLiquidateCall.mockReturnValue({
      to: '0xElectoralCredits',
      value: 0n,
      data: '0xliquidate',
    });

    merkletreeService = {
      stringToFieldElement: jest.fn((value: string) =>
        value === 'dni-1' ? 11n : 22n,
      ),
      buildMerkleTree: jest
        .fn()
        .mockResolvedValueOnce({ root: 111n, layers: [['ci']] }),
      create: jest.fn().mockResolvedValue(undefined),
      createIfMissing: jest.fn().mockResolvedValue({ created: true }),
    };

    service = new VoteWritterService(
      {
        get: jest.fn((key: string) => {
          const values: Record<string, string> = {
            'app.blockchain.chain': 'base-sepolia',
            'app.blockchain.privateKey': '0xprivate',
            'app.contracts.electoralCredits.address': '0xElectoralCredits',
          };
          return values[key];
        }),
      } as unknown as ConfigService,
      merkletreeService as unknown as MerkletreeService,
    );
    await service.getAccount();
  });

  it('createVote construye la llamada on-chain esperada con institutionId real y agrega BLANK', async () => {
    const eventId = new Types.ObjectId();
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T12:00:00.000Z');
    const publishAt = new Date('2026-01-01T13:00:00.000Z');

    const institutionId = '64f000000000000000000010';

    const nullifiers = await service.createVote(
      {
        _id: eventId,
        name: 'Eleccion prueba',
        votingStart: start,
        votingEnd: end,
        resultsPublishAt: publishAt,
      } as any,
      institutionId,
      ['dni-1', 'dni-2'],
      ['Frente Azul'],
    );

    expect(nullifiers).toHaveLength(2);
    expect(mockCreateVoteCall).toHaveBeenCalledWith(
      'base-sepolia',
      eventId.toString(),
      institutionId,
      'Eleccion prueba',
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000),
      Math.floor(publishAt.getTime() / 1000),
      2,
      111n,
      ['Frente Azul', 'BLANK'],
    );
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xVoteContract',
      data: '0xcreate',
    });
    expect(merkletreeService.createIfMissing).toHaveBeenCalledWith(eventId, [['ci']]);
  });

  it('VOT-CHN-P0-001 / VOT-CHN-P0-002 | castVote construye payload y espera receipt exitoso', async () => {
    await service.castVote('123abc', 'Frente Azul', 'secret-1');

    expect(mockGetVoteHash).toHaveBeenCalledWith('123abc', 'secret-1');
    expect(mockCastVoteCall).toHaveBeenCalledWith(
      'base-sepolia',
      '123abc',
      'Frente Azul',
      999n,
    );
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xVoteContract',
      data: '0xcast',
    });
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xtx',
      timeout: 900000,
      pollingInterval: 2000,
    });
  });

  it('VOT-ERR-P1-003 | propaga errores del cliente/bundler mockeado sin confirmar voto', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('bundler failed'));

    await expect(
      service.castVote('123abc', 'Frente Azul', 'secret-1'),
    ).rejects.toThrow('bundler failed');
  });

  it('VOT-CHN-P0-002 | usa getTransactionReceipt como fallback cuando waitForTransactionReceipt expira', async () => {
    const timeout = new Error('Timed out while waiting for transaction');
    timeout.name = 'WaitForTransactionReceiptTimeoutError';
    mockWaitForTransactionReceipt.mockRejectedValueOnce(timeout);
    mockGetTransactionReceipt.mockResolvedValueOnce({ blockNumber: 456n, status: 'success' });

    await service.castVote('123abc', 'BLANK', 'secret-2');

    expect(mockGetTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtx' });
    expect(mockGetBlock).toHaveBeenCalledWith({ blockNumber: 456n });
  });

  it('VOT-CHN-P0-002 | rechaza receipt revertido', async () => {
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      blockNumber: 123n,
      status: 'reverted',
    });

    await expect(
      service.castVote('123abc', 'Frente Azul', 'secret-1'),
    ).rejects.toThrow('Transaction 0xtx reverted');
  });

  it('liquidateVote usa el contrato de creditos configurado y espera el receipt', async () => {
    await service.liquidateVote('123abc');

    expect(mockLiquidateCall).toHaveBeenCalledWith(
      '0xElectoralCredits',
      '123abc',
    );
    expect(mockSendTransaction).toHaveBeenCalledWith({
      to: '0xElectoralCredits',
      value: 0n,
      data: '0xliquidate',
    });
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xtx',
      timeout: 900000,
      pollingInterval: 2000,
    });
  });

  it('liquidateVote propaga un receipt revertido sin declarar la liquidacion', async () => {
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      blockNumber: 123n,
      status: 'reverted',
    });

    await expect(service.liquidateVote('123abc')).rejects.toThrow(
      'Transaction 0xtx reverted',
    );
  });
});
