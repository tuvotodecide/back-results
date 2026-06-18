const mockEncodeFunctionData = jest.fn();
const mockExecuteOperation = jest.fn();

jest.mock('viem', () => ({
  encodeFunctionData: (...args: any[]) => mockEncodeFunctionData(...args),
}));

jest.mock('@/api/account', () => ({
  executeOperation: (...args: any[]) => mockExecuteOperation(...args),
}));

jest.mock('@/api/params', () => ({
  availableNetworks: {
    'base-sepolia': {
      chain: { id: 84532 },
      participationNft: '0xParticipationNft',
    },
  },
}));

jest.mock('@/abi/participation.json', () => [
  { type: 'function', name: 'safeMint' },
]);

import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { UsersService } from '@/modules/users/services/users.service';

describe('UsersService attestParticipationNft (unit)', () => {
  let userModel: any;
  let electoralTableModel: any;
  let electoralLocationModel: any;
  let configService: any;
  let service: UsersService;

  const userId = new Types.ObjectId('650000000000000000000001');

  beforeEach(() => {
    jest.clearAllMocks();
    mockEncodeFunctionData.mockReturnValue('0xcalldata');
    mockExecuteOperation.mockResolvedValue({
      receipt: { transactionHash: '0xtxhash' },
    });

    userModel = {
      findOneAndUpdate: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
      findById: jest.fn(),
    };
    electoralTableModel = {};
    electoralLocationModel = {};
    configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'app.blockchain.participationPrivateKey': '0xprivate',
          'app.blockchain.operationChainKey': 'base-sepolia',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    userModel.findOneAndUpdate.mockReturnValue({
      orFail: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: userId, dni: '123456' }),
      }),
    });

    service = new UsersService(
      userModel,
      electoralTableModel,
      electoralLocationModel,
      configService,
    );
  });

  it('attestParticipationNft arma calldata, ejecuta operacion y persiste certificado', async () => {
    await expect(
      service.attestParticipationNft(' 123-456 ', {
        account: '0x1234567890abcdef1234567890abcdef12345678',
        imageUrl: 'ipfs://image',
        electionId: 'election-1',
        ipfsUri: 'ipfs://metadata',
        actaImageUrl: 'ipfs://acta',
      }),
    ).resolves.toEqual({
      userId: userId.toString(),
      dni: '123456',
      imageUrl: 'ipfs://image',
      txHash: '0xtxhash',
      chainId: 84532,
      contractAddress: '0xParticipationNft',
      electionId: 'election-1',
      ipfsUri: 'ipfs://metadata',
      actaImageUrl: 'ipfs://acta',
    });

    expect(mockEncodeFunctionData).toHaveBeenCalledWith({
      abi: [{ type: 'function', name: 'safeMint' }],
      functionName: 'safeMint',
      args: ['0x1234567890abcdef1234567890abcdef12345678', 'ipfs://image'],
    });
    expect(mockExecuteOperation).toHaveBeenCalledWith(
      '0xprivate',
      undefined,
      'base-sepolia',
      {
        to: '0xParticipationNft',
        value: 0n,
        data: '0xcalldata',
      },
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      {
        $push: {
          participationCertificates: expect.objectContaining({
            imageUrl: 'ipfs://image',
            txHash: '0xtxhash',
            chainId: 84532,
            contractAddress: '0xParticipationNft',
            electionId: 'election-1',
            createdAt: expect.any(Date),
          }),
        },
      },
    );
  });

  it('attestParticipationNft rechaza DNI vacío sin llamar wallet', async () => {
    await expect(
      service.attestParticipationNft('', {
        account: '0x1234567890abcdef1234567890abcdef12345678',
        imageUrl: 'ipfs://image',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('attestParticipationNft falla de forma controlada si falta private key o red', async () => {
    configService.get = jest.fn((key: string) => {
      if (key === 'app.blockchain.operationChainKey') return 'base-sepolia';
      return undefined;
    });

    await expect(
      service.attestParticipationNft('123456', {
        account: '0x1234567890abcdef1234567890abcdef12345678',
        imageUrl: 'ipfs://image',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(mockExecuteOperation).not.toHaveBeenCalled();
  });

  it('attestParticipationNft propaga error de smart account mockeado sin persistir certificado', async () => {
    mockExecuteOperation.mockRejectedValueOnce(new Error('smart account failed'));

    await expect(
      service.attestParticipationNft('123456', {
        account: '0x1234567890abcdef1234567890abcdef12345678',
        imageUrl: 'ipfs://image',
      }),
    ).rejects.toThrow('smart account failed');

    expect(userModel.updateOne).not.toHaveBeenCalled();
  });
});
