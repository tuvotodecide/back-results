import { TVD_ASSIGNMENT_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdReceiptValidatorService } from '@/modules/tvd/services/tvd-receipt-validator.service';
import {
  TVD_BLOCKCHAIN_CLIENT_FACTORY,
  TvdBlockchainClientFactory,
} from '@/modules/tvd/types/tvd-blockchain.types';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';

const token = getAddress('0x1111111111111111111111111111111111111111');
const assignment = getAddress('0x2222222222222222222222222222222222222222');
const operator = getAddress('0x3333333333333333333333333333333333333333');
const institution = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const txHash = `0x${'8'.repeat(64)}`;

function tokensAssignedLog(wallet = institution, amount = '1000', address = assignment) {
  return {
    address,
    topics: encodeEventTopics({
      abi: TVD_ASSIGNMENT_ABI,
      eventName: 'TokensAssigned',
      args: { institution: wallet },
    }),
    data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(amount)]),
  };
}

describe('TVD blockchain isolated integration with mocks', () => {
  let moduleRef: TestingModule;
  let service: TvdBlockchainService;
  let publicClient: any;
  let walletClient: any;
  let state: Record<string, any>;

  beforeEach(async () => {
    state = {
      chainId: 84532,
      operator,
      accountAddress: operator,
      assignmentToken: token,
      decimals: 2,
      gas: 10n,
      contractTokenBalance: 5000n,
      totalAssigned: 1000n,
      liquidBalance: 2000n,
      assignedBalance: 3000n,
      isUnlocked: false,
      unlockTime: 123456n,
      currentBlockNumber: 105n,
      receipt: {
        transactionHash: txHash,
        status: 'success',
        to: assignment,
        from: operator,
        blockNumber: 100n,
        logs: [tokensAssignedLog()],
      },
    };

    publicClient = {
      getChainId: jest.fn(async () => state.chainId),
      getBalance: jest.fn(async () => state.gas),
      readContract: jest.fn(async (input: any) => {
        if (input.address === token && input.functionName === 'decimals') {
          return state.decimals;
        }
        if (input.address === token && input.functionName === 'balanceOf') {
          return input.args?.[0] === assignment
            ? state.contractTokenBalance
            : state.liquidBalance;
        }
        if (input.address === assignment && input.functionName === 'operator') {
          return state.operator;
        }
        if (input.address === assignment && input.functionName === 'token') {
          return state.assignmentToken;
        }
        if (input.address === assignment && input.functionName === 'assignedBalance') {
          return state.assignedBalance;
        }
        if (input.address === assignment && input.functionName === 'totalAssigned') {
          return state.totalAssigned;
        }
        if (input.address === assignment && input.functionName === 'isUnlocked') {
          return state.isUnlocked;
        }
        if (input.address === assignment && input.functionName === 'unlockTime') {
          return state.unlockTime;
        }
        throw new Error('unexpected call');
      }),
      waitForTransactionReceipt: jest.fn(async () => state.receipt),
      getTransactionReceipt: jest.fn(async () => state.receipt),
      getBlockNumber: jest.fn(async () => state.currentBlockNumber),
    };
    walletClient = {
      writeContract: jest.fn(async () => txHash),
    };

    const factory: TvdBlockchainClientFactory = jest.fn(() => ({
      publicClient,
      walletClient,
      account: { address: state.accountAddress },
    }));

    moduleRef = await Test.createTestingModule({
      providers: [
        TvdBlockchainService,
        TvdReceiptValidatorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values = {
                'app.tvd.rpcUrl': 'http://mock-rpc.local',
                'app.tvd.chainId': '84532',
                'app.tvd.tokenContractAddress': token,
                'app.tvd.assignmentContractAddress': assignment,
                'app.tvd.operatorPrivateKey': `0x${'1'.repeat(64)}`,
                'app.tvd.confirmationsRequired': '3',
                'app.tvd.decimals': '2',
              };
              return values[key];
            }),
          },
        },
        { provide: TVD_BLOCKCHAIN_CLIENT_FACTORY, useValue: factory },
      ],
    }).compile();

    service = moduleRef.get(TvdBlockchainService);
  });

  afterEach(async () => {
    await moduleRef?.close();
  });

  describe('POSITIVOS', () => {
    it('P-INT-001 | POSITIVO | INTEGRACION | valida configuracion completa', async () => {
      await expect(service.validateBlockchainConfiguration()).resolves.toMatchObject({
        configured: true,
        chainIdMatches: true,
        operatorMatches: true,
        tokenAddressMatches: true,
        decimalsMatch: true,
        signerHasGas: true,
      });
    });

    it('P-INT-002 | POSITIVO | INTEGRACION | ejecuta flujo completo simulado de assign', async () => {
      const result = await service.assignTokens({
        institutionWallet: institution,
        amountSmallestUnit: '1000',
      });

      expect(walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'assign',
          args: [institution, 1000n],
        }),
      );
      expect(result).toMatchObject({
        txHash,
        blockNumber: '100',
        chainId: 84532,
        contractAddress: assignment,
        operatorAddress: operator,
        institutionWallet: institution,
        amountSmallestUnit: '1000',
        confirmations: 6,
      });
    });

    it('P-INT-003 | POSITIVO | INTEGRACION | consulta balances completos', async () => {
      await expect(service.getTotalBalance(institution)).resolves.toMatchObject({
        liquidBalanceSmallestUnit: '2000',
        assignedBalanceSmallestUnit: '3000',
        totalBalanceSmallestUnit: '5000',
        liquidBalanceFormatted: '20',
        assignedBalanceFormatted: '30',
        totalBalanceFormatted: '50',
        isUnlocked: false,
        unlockTime: '123456',
      });
    });
  });

  describe('NEGATIVOS', () => {
    it('N-INT-004 | NEGATIVO | INTEGRACION | rechaza mismatch de decimals', async () => {
      state.decimals = 6;

      await expect(
        service.assignTokens({
          institutionWallet: institution,
          amountSmallestUnit: '1000',
        }),
      ).rejects.toMatchObject({ code: 'TVD_DECIMALS_MISMATCH' });
    });

    it('N-INT-005 | NEGATIVO | INTEGRACION | rechaza operador incorrecto', async () => {
      state.operator = getAddress('0x5555555555555555555555555555555555555555');

      await expect(
        service.assignTokens({
          institutionWallet: institution,
          amountSmallestUnit: '1000',
        }),
      ).rejects.toMatchObject({ code: 'TVD_OPERATOR_MISMATCH' });
    });

    it('N-INT-006 | NEGATIVO | INTEGRACION | rechaza receipt invalido', async () => {
      state.receipt = {
        ...state.receipt,
        logs: [],
      };

      await expect(
        service.assignTokens({
          institutionWallet: institution,
          amountSmallestUnit: '1000',
        }),
      ).rejects.toMatchObject({ code: 'TVD_EVENT_NOT_FOUND' });
    });
  });
});
