import { TVD_ASSIGNMENT_ABI } from '@/modules/tvd/contracts/tvd-abis';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdReceiptValidatorService } from '@/modules/tvd/services/tvd-receipt-validator.service';
import { TvdBlockchainClientFactory } from '@/modules/tvd/types/tvd-blockchain.types';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_UNIT = 'UNITARIO';

const token = getAddress('0x1111111111111111111111111111111111111111');
const assignment = getAddress('0x2222222222222222222222222222222222222222');
const operator = getAddress('0x3333333333333333333333333333333333333333');
const institution = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const privateKey = `0x${'1'.repeat(64)}`;
const txHash = `0x${'9'.repeat(64)}`;

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

function createHarness(overrides: Record<string, any> = {}) {
  const config = {
    'app.tvd.rpcUrl': 'http://mock-rpc.local',
    'app.tvd.chainId': '84532',
    'app.tvd.tokenContractAddress': token,
    'app.tvd.assignmentContractAddress': assignment,
    'app.tvd.operatorPrivateKey': privateKey,
    'app.tvd.confirmationsRequired': '3',
    'app.tvd.decimals': '2',
    ...(overrides.config ?? {}),
  };
  const state = {
    chainId: 84532,
    operator,
    accountAddress: operator,
    assignmentToken: token,
    decimals: 2,
    gas: 1n,
    contractTokenBalance: 5000n,
    liquidBalance: 1500n,
    assignedBalance: 500n,
    totalAssigned: 1000n,
    isUnlocked: false,
    unlockTime: 999n,
    currentBlockNumber: 105n,
    receipt: {
      transactionHash: txHash,
      status: 'success',
      to: assignment,
      from: operator,
      blockNumber: 100n,
      logs: [tokensAssignedLog()],
    },
    ...(overrides.state ?? {}),
  };
  const readContract = jest.fn(async (input: any) => {
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
    if (input.address === assignment && input.functionName === 'owner') {
      return getAddress('0x4444444444444444444444444444444444444444');
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
    throw new Error('unexpected readContract');
  });
  const publicClient = {
    getChainId: jest.fn(async () => state.chainId),
    getBalance: jest.fn(async () => state.gas),
    readContract,
    waitForTransactionReceipt: jest.fn(async () => state.receipt),
    getTransactionReceipt: jest.fn(async () => state.receipt),
    getBlockNumber: jest.fn(async () => state.currentBlockNumber),
  };
  const walletClient = {
    writeContract: jest.fn(async () => txHash),
  };
  const factory: jest.MockedFunction<TvdBlockchainClientFactory> = jest.fn(
    (_config) => ({
      publicClient,
      walletClient,
      account: { address: state.accountAddress },
    }),
  );
  const service = new TvdBlockchainService(
    { get: jest.fn((key: string) => config[key]) } as any,
    new TvdReceiptValidatorService(),
    factory,
  );

  return { service, publicClient, walletClient, factory, state, config };
}

describe('TVD blockchain service', () => {
  describe('POSITIVOS', () => {
    it('P-UNIT-001/P-UNIT-002 | POSITIVO | UNITARIO | carga ABI del token y asignacion', () => {
      const { service } = createHarness();

      expect(service.getAbiSummary()).toEqual({
        tokenAbiLoaded: true,
        assignmentAbiLoaded: true,
      });
    });

    it('P-UNIT-003/P-UNIT-004/P-UNIT-005/P-UNIT-006/P-UNIT-007/P-UNIT-008 | POSITIVO | UNITARIO | valida configuracion y contratos', async () => {
      const { service } = createHarness();

      const result = await service.validateBlockchainConfiguration();

      expect(result).toMatchObject({
        configured: true,
        rpcReachable: true,
        chainIdMatches: true,
        operatorMatches: true,
        tokenAddressMatches: true,
        decimalsMatch: true,
        signerHasGas: true,
        assignmentContractTokenBalance: '5000',
        assignmentContractTotalAssigned: '1000',
        assignmentContractAssignableBalance: '4000',
        assignmentAccountingConsistent: true,
      });
      await expect(service.getNetworkChainId()).resolves.toBe(84532);
      await expect(service.getOperatorAddress()).resolves.toBe(operator);
      await expect(service.getTokenAddressFromAssignmentContract()).resolves.toBe(token);
      await expect(service.getTokenDecimals()).resolves.toBe(2);
    });

    it('P-UNIT-009/P-UNIT-010/P-UNIT-011 | POSITIVO | UNITARIO | consulta balances y suma exacta', async () => {
      const { service } = createHarness();

      await expect(service.getLiquidBalance(institution)).resolves.toBe('1500');
      await expect(service.getAssignedBalance(institution)).resolves.toBe('500');

      const total = await service.getTotalBalance(institution);
      expect(total).toMatchObject({
        wallet: institution,
        decimals: 2,
        liquidBalanceSmallestUnit: '1500',
        assignedBalanceSmallestUnit: '500',
        totalBalanceSmallestUnit: '2000',
        liquidBalanceFormatted: '15',
        assignedBalanceFormatted: '5',
        totalBalanceFormatted: '20',
        isUnlocked: false,
        unlockTime: '999',
      });
    });

    it('P-UNIT-012/P-UNIT-013/P-UNIT-014/P-UNIT-015/P-UNIT-016/P-UNIT-017 | POSITIVO | UNITARIO | ejecuta assign y retorna resultado sanitizado', async () => {
      const { service, walletClient } = createHarness();

      const result = await service.assignTokens({
        institutionWallet: institution,
        amountSmallestUnit: '1000',
      });

      expect(walletClient.writeContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: assignment,
          functionName: 'assign',
          args: [institution, 1000n],
        }),
      );
      expect(result).toEqual({
        txHash,
        blockNumber: '100',
        chainId: 84532,
        contractAddress: assignment,
        operatorAddress: operator,
        institutionWallet: institution,
        amountSmallestUnit: '1000',
        confirmations: 6,
      });
      expect(JSON.stringify(result)).not.toContain(privateKey);
    });
  });

  describe('NEGATIVOS', () => {
    it('N-UNIT-001 | NEGATIVO | UNITARIO | configuracion incompleta no llama RPC', async () => {
      const { service, factory } = createHarness({
        config: { 'app.tvd.rpcUrl': '' },
      });

      await expect(service.validateBlockchainConfiguration()).resolves.toEqual({
        configured: false,
      });
      expect(factory).not.toHaveBeenCalled();
    });

    it('N-UNIT-002/N-UNIT-022 | NEGATIVO | UNITARIO | error RPC sanitizado', async () => {
      const { service, publicClient } = createHarness();
      publicClient.getChainId.mockRejectedValueOnce(
        new Error(`rpc failed ${privateKey}`),
      );

      let caught: unknown;
      try {
        await service.validateBlockchainConfiguration();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: 'TVD_RPC_UNAVAILABLE',
        message: 'Servicio blockchain TVD no disponible',
      });
      expect(JSON.stringify(caught)).not.toContain(privateKey);
      expect(caught).not.toHaveProperty('cause');
    });

    it.each([
      [
        'N-UNIT-003',
        'chain incorrecta',
        { state: { chainId: 1 } },
        'TVD_CHAIN_MISMATCH',
      ],
      [
        'N-UNIT-005',
        'signer distinto de operator',
        {
          state: {
            accountAddress: getAddress('0x5555555555555555555555555555555555555555'),
          },
        },
        'TVD_OPERATOR_MISMATCH',
      ],
      [
        'N-UNIT-006',
        'direccion de token incorrecta',
        {
          state: {
            assignmentToken: getAddress('0x6666666666666666666666666666666666666666'),
          },
        },
        'TVD_TOKEN_ADDRESS_MISMATCH',
      ],
      [
        'N-UNIT-007',
        'decimals diferente',
        { state: { decimals: 3 } },
        'TVD_DECIMALS_MISMATCH',
      ],
      [
        'N-UNIT-013',
        'gas insuficiente',
        { state: { gas: 0n } },
        'TVD_INSUFFICIENT_GAS',
      ],
      [
        'N-UNIT-014',
        'tokens insuficientes en contrato',
        { state: { contractTokenBalance: 999n } },
        'TVD_INSUFFICIENT_CONTRACT_BALANCE',
      ],
      [
        'N-UNIT-014B',
        'tokens insuficientes por totalAssigned',
        { state: { contractTokenBalance: 5000n, totalAssigned: 4501n } },
        'TVD_INSUFFICIENT_CONTRACT_BALANCE',
      ],
      [
        'N-UNIT-014C',
        'contabilidad inconsistente totalAssigned mayor al balance',
        { state: { contractTokenBalance: 5000n, totalAssigned: 5001n } },
        'TVD_INSUFFICIENT_CONTRACT_BALANCE',
      ],
    ])('%s | NEGATIVO | UNITARIO | %s', async (_id, _scenario, override, code) => {
      const { service } = createHarness(override as any);

      await expect(
        service.assignTokens({
          institutionWallet: institution,
          amountSmallestUnit: '1000',
        }),
      ).rejects.toMatchObject({ code });
    });

    it('N-UNIT-004 | NEGATIVO | UNITARIO | private key invalida', () => {
      const { service } = createHarness({
        config: { 'app.tvd.operatorPrivateKey': 'not-a-private-key' },
      });

      expect(() => service.getConfiguredSignerAddress()).toThrow(
        expect.objectContaining({ code: 'TVD_OPERATOR_PRIVATE_KEY_INVALID' }),
      );
    });

    it.each([
      ['N-UNIT-008', 'wallet invalida', '0x123', '1000', 'TVD_INVALID_WALLET'],
      [
        'N-UNIT-009',
        'zero address',
        '0x0000000000000000000000000000000000000000',
        '1000',
        'TVD_INVALID_WALLET',
      ],
      ['N-UNIT-010', 'monto cero', institution, '0', 'TVD_INVALID_AMOUNT'],
      ['N-UNIT-011', 'monto negativo', institution, '-1', 'TVD_INVALID_AMOUNT'],
      ['N-UNIT-012', 'monto decimal', institution, '1.5', 'TVD_INVALID_AMOUNT'],
    ])(
      '%s | NEGATIVO | UNITARIO | %s',
      async (_id, _scenario, wallet, amount, code) => {
        const { service } = createHarness();

        await expect(
          service.assignTokens({
            institutionWallet: wallet,
            amountSmallestUnit: amount,
          }),
        ).rejects.toMatchObject({ code });
      },
    );

    it('N-UNIT-015 | NEGATIVO | UNITARIO | assign revertido', async () => {
      const { service, walletClient } = createHarness();
      walletClient.writeContract.mockRejectedValueOnce(new Error('execution reverted'));

      await expect(
        service.assignTokens({
          institutionWallet: institution,
          amountSmallestUnit: '1000',
        }),
      ).rejects.toMatchObject({ code: 'TVD_ASSIGN_REVERTED' });
    });
  });

  it('documenta metadata minima de casos', () => {
    expect({
      type: CASE_TYPE_POSITIVE,
      level: LEVEL_UNIT,
      negativeType: CASE_TYPE_NEGATIVE,
    }).toEqual(
      expect.objectContaining({
        type: 'POSITIVO',
        level: 'UNITARIO',
        negativeType: 'NEGATIVO',
      }),
    );
  });
});
