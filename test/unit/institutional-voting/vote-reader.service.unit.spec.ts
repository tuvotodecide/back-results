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

  it('getResults delega al contrato mockeado y normaliza votos a string', async () => {
    mockGetVoteResults.mockResolvedValue([
      ['Frente Azul', 'BLANK'],
      [10n, { toString: () => '2' }],
    ]);

    await expect(service.getResults('event-1')).resolves.toEqual([
      { option: 'Frente Azul', votes: '10' },
      { option: 'BLANK', votes: '2' },
    ]);
    expect(mockJsonRpcProvider).toHaveBeenCalledWith('https://mock-rpc.local');
    expect(mockContract).toHaveBeenCalledWith(
      '0xVoteContract',
      [{ type: 'function', name: 'getVoteResults' }],
      { url: 'https://mock-rpc.local' },
    );
    expect(mockGetVoteResults).toHaveBeenCalledWith('event-1');
  });

  it('getResults devuelve lista vacía cuando el contrato no retorna opciones', async () => {
    mockGetVoteResults.mockResolvedValue([[], []]);

    await expect(service.getResults('event-empty')).resolves.toEqual([]);
  });

  it('propaga errores RPC mockeados', async () => {
    mockGetVoteResults.mockRejectedValue(new Error('rpc failed'));

    await expect(service.getResults('event-1')).rejects.toThrow('rpc failed');
  });
});
