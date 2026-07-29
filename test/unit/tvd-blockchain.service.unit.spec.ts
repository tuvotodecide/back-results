const mockToCoinbaseSmartAccount = jest.fn();
const mockCreatePimlicoClient = jest.fn();
const mockCreateSmartAccountClient = jest.fn();

jest.mock('@/api/params', () => ({
  availableNetworks: {
    'base-sepolia': {
      chain: { id: 84532, name: 'Base Sepolia' },
      bundler: 'https://mock-bundler.local',
    },
  },
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn((pk: string) => ({ address: '0x9999999999999999999999999999999999999a', privateKey: pk })),
}));

jest.mock('viem/account-abstraction', () => ({
  entryPoint07Address: '0xEeeeeEeeEeEeeeeeeeeeeeeeeeeeeeeeeeeeEEeE',
  getUserOperationHash: jest.fn(() => '0xuserOpHash'),
  toCoinbaseSmartAccount: (...args: any[]) => mockToCoinbaseSmartAccount(...args),
}));

jest.mock('permissionless/clients/pimlico', () => ({
  createPimlicoClient: (...args: any[]) => mockCreatePimlicoClient(...args),
}));

jest.mock('permissionless', () => ({
  createSmartAccountClient: (...args: any[]) => mockCreateSmartAccountClient(...args),
}));

import {
  TVD_ASSIGNMENT_ABI,
} from '@/modules/tvd/contracts/tvd-abis';
import { TvdBlockchainError } from '@/modules/tvd/errors/tvd-blockchain.error';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdReceiptValidatorService } from '@/modules/tvd/services/tvd-receipt-validator.service';
import { TvdBlockchainClientFactory } from '@/modules/tvd/types/tvd-blockchain.types';
import { Logger } from '@nestjs/common';
import { encodeAbiParameters, encodeEventTopics, getAddress } from 'viem';

const CASE_TYPE_POSITIVE = 'POSITIVO';
const CASE_TYPE_NEGATIVE = 'NEGATIVO';
const LEVEL_UNIT = 'UNITARIO';

const token = getAddress('0x1111111111111111111111111111111111111111');
const assignment = getAddress('0x2222222222222222222222222222222222222222');
const operator = getAddress('0x3333333333333333333333333333333333333333');
const voteManager = getAddress('0x7B57eE9103fc46eD6794329C36D2919293F0Fabb');
const implementation = getAddress('0xb9ebfaca95ca68f774084dde30c7e6eb8e7eeea9');
const credits = getAddress('0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40');
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
    'app.blockchain.chain': 'base-sepolia',
    'app.blockchain.privateKey': privateKey,
    'app.tvd.rpcUrl': 'http://mock-rpc.local',
    'app.tvd.chainId': '84532',
    'app.tvd.tokenContractAddress': token,
    'app.tvd.assignmentContractAddress': assignment,
    'app.tvd.operatorPrivateKey': privateKey,
    'app.tvd.confirmationsRequired': '3',
    'app.tvd.decimals': '2',
    'app.contracts.voteManager.address': voteManager,
    'app.contracts.voteManager.implementationAddress': implementation,
    'app.contracts.electoralCredits.address': credits,
    ...(overrides.config ?? {}),
  };
  const state = {
    chainId: 84532,
    operator,
    accountAddress: operator,
    operatorRole: '0xoperatorrole0000000000000000000000000000000000000000000000000',
    signerHasOperatorRole: true,
    assignmentToken: token,
    assignmentCreditsContract: credits,
    decimals: 2,
    gas: 1n,
    contractTokenBalance: 5000n,
    liquidBalance: 1500n,
    assignedBalance: 500n,
    totalAssigned: 1000n,
    creditsToken: token,
    tvdPerCredit: 1000000000000000000n,
    proxyAuthorizedForCredits: true,
    institutionAdminAddress: institution,
    institutionAuthorizedOnChain: true,
    allowance: 100000000000000000000n,
    voteExistsOnChain: false,
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
  mockToCoinbaseSmartAccount.mockImplementation(async () => ({
    address: state.accountAddress,
    entryPoint: { address: '0xEeeeeEeeEeEeeeeeeeeeeeeeeeeeeeeeeeeeEEeE', version: '0.7' },
    signUserOperation: jest.fn().mockResolvedValue('0xsignature'),
  }));
  mockCreatePimlicoClient.mockImplementation(() => ({}));
  mockCreateSmartAccountClient.mockImplementation(() => ({
    prepareUserOperation: jest.fn(),
    sendUserOperation: jest.fn(),
    waitForUserOperationReceipt: jest.fn(),
  }));
  const readContract = jest.fn(async (input: any) => {
    if (input.address === token && input.functionName === 'decimals') {
      return state.decimals;
    }
    if (input.address === token && input.functionName === 'balanceOf') {
      return input.args?.[0] === assignment
        ? state.contractTokenBalance
        : state.liquidBalance;
    }
    if (input.address === token && input.functionName === 'allowance') {
      return state.allowance;
    }
    if (input.address === credits && input.functionName === 'token') {
      return state.creditsToken;
    }
    if (input.address === credits && input.functionName === 'tvdPerCredit') {
      return state.tvdPerCredit;
    }
    if (input.address === credits && input.functionName === 'authorizedOperators') {
      return state.proxyAuthorizedForCredits;
    }
    if (input.address === voteManager && input.functionName === 'getInstitutionAdmin') {
      return state.institutionAdminAddress;
    }
    if (input.address === voteManager && input.functionName === 'isAuthorizedAddress') {
      return state.institutionAuthorizedOnChain;
    }
    if (input.address === voteManager && input.functionName === 'getVoteInfo') {
      if (state.voteExistsOnChain) {
        return { id: input.args?.[0], name: 'Eleccion existente' };
      }
      throw new Error('Vote does not exist');
    }
    if (input.address === assignment && input.functionName === 'OPERATOR_ROLE') {
      return state.operatorRole;
    }
    if (input.address === assignment && input.functionName === 'hasRole') {
      return state.signerHasOperatorRole;
    }
    if (input.address === assignment && input.functionName === 'token') {
      return state.assignmentToken;
    }
    if (input.address === assignment && input.functionName === 'creditsContract') {
      return state.assignmentCreditsContract;
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
    getStorageAt: jest.fn(async () => `0x${'0'.repeat(24)}${implementation.slice(2).toLowerCase()}`),
    simulateContract: jest.fn(async () => ({ request: {} })),
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
        electoralCreditsAbiLoaded: true,
      });
    });

    it('P-UNIT-003/P-UNIT-004/P-UNIT-005/P-UNIT-006/P-UNIT-007/P-UNIT-008 | POSITIVO | UNITARIO | valida configuracion y contratos', async () => {
      const { service } = createHarness();

      const result = await service.validateBlockchainConfiguration();

      expect(result).toMatchObject({
        configured: true,
        rpcReachable: true,
        chainIdMatches: true,
        signerHasOperatorRole: true,
        tokenAddressMatches: true,
        decimalsMatch: true,
        assignmentContractTokenBalance: '5000',
        assignmentContractAssignableBalance: '5000',
      });
      await expect(service.getNetworkChainId()).resolves.toBe(84532);
      await expect(service.getTokenAddressFromAssignmentContract()).resolves.toBe(token);
      await expect(service.getTokenDecimals()).resolves.toBe(2);
    });

    it('P-UNIT-018/P-UNIT-019/P-UNIT-020 | POSITIVO | UNITARIO | lee contrato de creditos, operador autorizado y tvdPerCredit', async () => {
      const { service } = createHarness();

      await expect(service.getElectoralCreditsSummary()).resolves.toMatchObject({
        chainId: 84532,
        creditsContractAddress: credits,
        proxyAddress: voteManager,
        implementationAddress: implementation,
        tokenAddress: token,
        tvdPerCredit: '1000000000000000000',
        spenderAddress: credits,
        proxyAuthorizedForCredits: true,
      });
    });

    it('P-UNIT-021 | POSITIVO | UNITARIO | consulta allowance usando TVDCredits como spender', async () => {
      const { service, publicClient } = createHarness();

      await expect(service.getTvdAllowance(institution)).resolves.toBe(
        '100000000000000000000',
      );
      expect(publicClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: token,
          functionName: 'allowance',
          args: [institution, credits],
        }),
      );
    });

    it('P-UNIT-022 | POSITIVO | UNITARIO | preflight calcula creditos y TVD con bigint sin enviar transaccion', async () => {
      const { service, publicClient, walletClient } = createHarness({
        state: {
          assignedBalance: 500000000000000000n,
          liquidBalance: 3000000000000000000n,
        },
      });

      const result = await service.validateVotePublicationPreflight({
        institutionWallet: institution,
        institutionId: '64f000000000000000000010',
        onChainElectionId: 1n,
        requiredCredits: 3n,
        createVoteArgs: [
          1n,
          '64f000000000000000000010',
          'Eleccion 2026',
          1n,
          2n,
          3n,
          10n,
          20n,
          3n,
          ['Frente Azul', 'BLANK'],
        ],
      });

      expect(result).toMatchObject({
        requiredCredits: '3',
        requiredTvd: '3000000000000000000',
        walletDebitRequiredSmallestUnit: '3000000000000000000',
        spenderAddress: credits,
        simulated: true,
      });
      expect(publicClient.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({
          account: institution,
          address: voteManager,
          functionName: 'createVote',
        }),
      );
      expect(walletClient.writeContract).not.toHaveBeenCalled();
    });

    it('P-UNIT-009/P-UNIT-010/P-UNIT-011 | POSITIVO | UNITARIO | consulta balances y suma exacta', async () => {
      const { service } = createHarness();

      await expect(service.getLiquidBalance(institution)).resolves.toBe('1500');

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

    it('N-UNIT-004 | NEGATIVO | UNITARIO | private key invalida', async () => {
      const { service } = createHarness({
        config: { 'app.tvd.operatorPrivateKey': 'not-a-private-key' },
      });

      await expect(service.getConfiguredSignerAddress()).rejects.toMatchObject({
        code: 'TVD_OPERATOR_PRIVATE_KEY_INVALID',
      });
    });

    it('N-UNIT-023 | NEGATIVO | UNITARIO | rechaza usar TVDToken como spender', async () => {
      const { service } = createHarness();

      await expect(service.getTvdAllowance(institution, token)).rejects.toMatchObject({
        code: 'TVD_CREDITS_SPENDER_INVALID',
      });
    });

    it('N-UNIT-024 | POSITIVO | UNITARIO | preflight reporta allowance insuficiente para preparar batch', async () => {
      const { service } = createHarness({
        state: {
          assignedBalance: 0n,
          liquidBalance: 3000000000000000000n,
          allowance: 1n,
        },
      });

      const result = await service.validateVotePublicationPreflight({
        institutionWallet: institution,
        institutionId: '64f000000000000000000010',
        onChainElectionId: 1n,
        requiredCredits: 2n,
        createVoteArgs: [],
      });

      expect(result).toMatchObject({
        hasRequiredAllowance: false,
        walletDebitRequiredSmallestUnit: '2000000000000000000',
        simulated: false,
      });
    });

    it('N-UNIT-024B | POSITIVO | UNITARIO | preflight usa vesting completo sin exigir allowance', async () => {
      const { service, publicClient } = createHarness({
        state: {
          assignedBalance: 3000000000000000000n,
          liquidBalance: 0n,
          allowance: 0n,
        },
      });

      const result = await service.validateVotePublicationPreflight({
        institutionWallet: institution,
        institutionId: '6a5aff0b38579e74c35e0fe1',
        onChainElectionId: 1n,
        requiredCredits: 1n,
        createVoteArgs: [],
      });

      expect(result).toMatchObject({
        tvdSource: 'VESTING',
        hasRequiredAllowance: true,
        walletDebitRequiredSmallestUnit: '0',
        simulated: true,
      });
      expect(publicClient.simulateContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'createVote',
          account: institution,
        }),
      );
    });

    it('N-UNIT-024C | NEGATIVO | UNITARIO | preflight bloquea vesting conectado a otro TVDCredits', async () => {
      const { service, publicClient } = createHarness({
        state: {
          assignedBalance: 3000000000000000000n,
          liquidBalance: 0n,
          allowance: 0n,
          assignmentCreditsContract: getAddress('0x18AD6Ba62Bb1Fc912F1B7A75E48667cB9AE1A711'),
        },
      });

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '6a5aff0b38579e74c35e0fe1',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [],
        }),
      ).rejects.toMatchObject({
        code: 'TVD_CREDITS_SOURCE_CONFIG_MISMATCH',
      });
      expect(publicClient.simulateContract).not.toHaveBeenCalled();
    });

    it('N-UNIT-025 | NEGATIVO | UNITARIO | preflight rechaza proxy no autorizado en creditos', async () => {
      const { service } = createHarness({
        state: { proxyAuthorizedForCredits: false },
      });

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '64f000000000000000000010',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [],
        }),
      ).rejects.toMatchObject({ code: 'TVD_CREDITS_OPERATOR_NOT_AUTHORIZED' });
    });

    it('N-UNIT-026 | NEGATIVO | UNITARIO | preflight rechaza wallet no autorizada', async () => {
      const { service } = createHarness({
        state: {
          institutionAdminAddress: getAddress('0x5555555555555555555555555555555555555555'),
          institutionAuthorizedOnChain: false,
        },
      });

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '64f000000000000000000010',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [],
        }),
      ).rejects.toMatchObject({ code: 'TVD_WALLET_NOT_AUTHORIZED' });
    });

    it('N-UNIT-026B | NEGATIVO | UNITARIO | preflight mapea institucion inexistente on-chain', async () => {
      const { service, publicClient } = createHarness();
      publicClient.readContract.mockImplementation(async (input: any) => {
        if (
          input.address === voteManager &&
          input.functionName === 'getInstitutionAdmin'
        ) {
          const error = new Error('execution reverted: Institution does not exist');
          (error as any).shortMessage =
            'The contract function "getInstitutionAdmin" reverted with the following reason:\nInstitution does not exist';
          throw error;
        }
        if (input.address === token && input.functionName === 'balanceOf') {
          return input.args?.[0] === assignment
            ? 5000n
            : 1500n;
        }
        if (input.address === token && input.functionName === 'allowance') return 100000000000000000000n;
        if (input.address === credits && input.functionName === 'token') return token;
        if (input.address === credits && input.functionName === 'tvdPerCredit') return 1000000000000000000n;
        if (input.address === credits && input.functionName === 'authorizedOperators') return true;
        if (input.address === voteManager && input.functionName === 'isAuthorizedAddress') return true;
        if (input.address === assignment && input.functionName === 'assignedBalance') return 500n;
        if (input.address === voteManager && input.functionName === 'getVoteInfo') {
          throw new Error('Vote does not exist');
        }
        throw new Error('unexpected readContract');
      });

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '6a5aff0b38579e74c35e0fe1',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [],
        }),
      ).rejects.toMatchObject({ code: 'TVD_INSTITUTION_NOT_REGISTERED' });
    });

    it('N-UNIT-027 | NEGATIVO | UNITARIO | preflight rechaza votacion existente on-chain', async () => {
      const { service } = createHarness({
        state: {
          assignedBalance: 1000000000000000000n,
          liquidBalance: 1000000000000000000n,
          voteExistsOnChain: true,
        },
      });

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '64f000000000000000000010',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [],
        }),
      ).rejects.toMatchObject({ code: 'TVD_VOTE_ALREADY_EXISTS' });
    });

    it('N-UNIT-027B | NEGATIVO | UNITARIO | conserva revert tecnico seguro de simulacion createVote', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const { service, publicClient, walletClient } = createHarness({
        state: {
          assignedBalance: 1000000000000000000n,
          liquidBalance: 1000000000000000000n,
          allowance: 1000000000000000000n,
          institutionAuthorizedOnChain: false,
        },
      });
      const revertError = new Error(
        'The contract function "createVote" reverted with the following signature:\n0xfb8f41b2',
      );
      (revertError as any).name = 'ContractFunctionExecutionError';
      (revertError as any).shortMessage =
        'The contract function "createVote" reverted with the following signature:\n0xfb8f41b2';
      (revertError as any).data =
        '0xfb8f41b2000000000000000000000000bb4ea03105e2d883ab234d95f10dc7cc5000bb4000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000de0b6b3a7640000';
      publicClient.simulateContract.mockRejectedValueOnce(revertError);

      await expect(
        service.validateVotePublicationPreflight({
          institutionWallet: institution,
          institutionId: '6a5aff0b38579e74c35e0fe1',
          onChainElectionId: 1n,
          requiredCredits: 1n,
          createVoteArgs: [
            1n,
            '6a5aff0b38579e74c35e0fe1',
            'Eleccion 2026',
            1n,
            2n,
            3n,
            1n,
            10n,
            20n,
            ['Frente Azul', 'BLANK'],
          ],
        }),
      ).rejects.toMatchObject({ code: 'TVD_ALLOWANCE_INSUFFICIENT' });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'tvd_create_vote_preflight_reverted',
          contract: voteManager,
          functionName: 'createVote',
          institutionId: '6a5aff0b38579e74c35e0fe1',
          institutionWallet: institution,
          onChainElectionId: '1',
          customErrorName: 'ERC20InsufficientAllowance',
          argsCount: 10,
        }),
      );
      expect(walletClient.writeContract).not.toHaveBeenCalled();
      warnSpy.mockRestore();
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
