const mockGetVoteResults = jest.fn();
const mockJsonRpcProvider = jest.fn();
const mockContract = jest.fn();

jest.mock('@/api/params', () => ({
  availableNetworks: {
    'base-sepolia': {
      bundler: 'https://mock-rpc.local',
      voteContract: '0xVoteContract',
    },
  },
}));

jest.mock('@/api/contracts/VoteContract', () => ({
  votingContractAbi: [{ type: 'function', name: 'getVoteResults' }],
}));

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: mockJsonRpcProvider,
    Contract: mockContract,
  },
}));

import { ConfigService } from '@nestjs/config';

import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';

describe('VoteReaderService (unit)', () => {
  let service: VoteReaderService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockJsonRpcProvider.mockImplementation((url: string) => ({ url }));
    mockContract.mockImplementation(() => ({
      getVoteResults: mockGetVoteResults,
    }));

    service = new VoteReaderService({
      get: jest.fn((key: string) => {
        if (key === 'app.blockchain.chain') return 'base-sepolia';
        return undefined;
      }),
    } as unknown as ConfigService);
  });

  const eventId = '507f1f77bcf86cd799439011';
  const emptyEventId = '507f1f77bcf86cd799439012';

  it('getResults delega al contrato mockeado y normaliza votos a string', async () => {
    mockGetVoteResults.mockResolvedValue([
      ['Frente Azul', 'BLANK'],
      [10n, { toString: () => '2' }],
    ]);

    await expect(service.getResults(eventId)).resolves.toEqual([
      { option: 'Frente Azul', votes: '10' },
      { option: 'BLANK', votes: '2' },
    ]);
    expect(mockJsonRpcProvider).toHaveBeenCalledWith('https://mock-rpc.local');
    expect(mockContract).toHaveBeenCalledWith(
      '0xVoteContract',
      [{ type: 'function', name: 'getVoteResults' }],
      { url: 'https://mock-rpc.local' },
    );
    expect(mockGetVoteResults).toHaveBeenCalledWith(BigInt('0x' + eventId));
  });

  it('getResults devuelve lista vacía cuando el contrato no retorna opciones', async () => {
    mockGetVoteResults.mockResolvedValue([[], []]);

    await expect(service.getResults(emptyEventId)).resolves.toEqual([]);
  });

  it('propaga errores RPC mockeados', async () => {
    mockGetVoteResults.mockRejectedValue(new Error('rpc failed'));

    await expect(service.getResults(eventId)).rejects.toThrow('rpc failed');
  });
});
