const mockGetVoteResults = jest.fn();
const mockGetVoteInfo = jest.fn();
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
import { Types } from 'mongoose';

import { VoteReaderService } from '@/modules/institutional-voting/services/core/vote-reader.service';
import { MerkletreeService } from '@/modules/merkletree/services/merkletree.service';

describe('VoteReaderService (unit)', () => {
  let service: VoteReaderService;
  let merkletreeService: jest.Mocked<Pick<MerkletreeService, 'isValueInTree'>>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockJsonRpcProvider.mockImplementation((url: string) => ({ url }));
    mockContract.mockImplementation(() => ({
      getVoteResults: mockGetVoteResults,
      getVoteInfo: mockGetVoteInfo,
    }));

    merkletreeService = {
      isValueInTree: jest.fn(),
    };

    service = new VoteReaderService(
      {
        get: jest.fn((key: string) => {
          if (key === 'app.blockchain.chain') return 'base-sepolia';
          return undefined;
        }),
      } as unknown as ConfigService,
      merkletreeService as unknown as MerkletreeService,
    );
  });

  const eventId = '507f1f77bcf86cd799439011';
  const emptyEventId = '507f1f77bcf86cd799439012';

  describe('getResults', () => {
    it('delega al contrato mockeado y normaliza votos a string', async () => {
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

    it('devuelve lista vacía cuando el contrato no retorna opciones', async () => {
      mockGetVoteResults.mockResolvedValue([[], []]);

      await expect(service.getResults(emptyEventId)).resolves.toEqual([]);
    });

    it('propaga errores RPC mockeados', async () => {
      mockGetVoteResults.mockRejectedValue(new Error('rpc failed'));

      await expect(service.getResults(eventId)).rejects.toThrow('rpc failed');
    });
  });

  describe('isDniInMerkleTree', () => {
    const dni = '12345678';

    it('delega en merkletreeService con la raíz obtenida del contrato', async () => {
      const voteMerkleRoot = 42n;
      mockGetVoteInfo.mockResolvedValue([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        voteMerkleRoot,
      ]);
      merkletreeService.isValueInTree.mockResolvedValue(true);

      await expect(service.isDniInMerkleTree(eventId, dni)).resolves.toBe(true);

      expect(mockGetVoteInfo).toHaveBeenCalledWith(BigInt('0x' + eventId));
      expect(merkletreeService.isValueInTree).toHaveBeenCalledWith(
        new Types.ObjectId(eventId),
        dni,
        voteMerkleRoot,
      );
    });

    it('retorna false cuando merkletreeService indica que el dni no está en el árbol', async () => {
      mockGetVoteInfo.mockResolvedValue([undefined, undefined, undefined, undefined, undefined, 42n]);
      merkletreeService.isValueInTree.mockResolvedValue(false);

      await expect(service.isDniInMerkleTree(eventId, dni)).resolves.toBe(false);
    });

    it('propaga errores del merkletreeService', async () => {
      mockGetVoteInfo.mockResolvedValue([undefined, undefined, undefined, undefined, undefined, 42n]);
      merkletreeService.isValueInTree.mockRejectedValue(new Error('merkle lookup failed'));

      await expect(service.isDniInMerkleTree(eventId, dni)).rejects.toThrow('merkle lookup failed');
    });
  });
});
