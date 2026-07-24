import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  BaseError,
  decodeErrorResult,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  zeroAddress,
} from 'viem';
import votingContractAbi from '@/abi/voteContract.json';
import {
  TVD_ASSIGNMENT_ABI,
  TVD_ELECTORAL_CREDITS_ABI,
  TVD_TOKEN_ABI,
} from '../contracts/tvd-abis';
import { TvdBlockchainError } from '../errors/tvd-blockchain.error';
import {
  TVD_BLOCKCHAIN_CLIENT_FACTORY,
  TvdAssignTokensInput,
  TvdAssignTokensResult,
  TvdBlockchainClientFactory,
  TvdBlockchainConfig,
  TvdBlockchainValidationResult,
  TvdElectoralCreditsConfig,
  TvdOperatorContext,
  TvdPrepareAssignTransactionInput,
  TvdPreparedAssignTransaction,
  TvdTotalBalanceResult,
  TvdVotePublicationPreflightInput,
  TvdVotePublicationPreflightResult,
  TvdUnlockInformation,
} from '../types/tvd-blockchain.types';
import { TvdReceiptValidatorService } from './tvd-receipt-validator.service';

const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER_REGEX = /^(?:0|[1-9]\d*)$/;
const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ERC20_ERROR_ABI = [
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
] as const;

@Injectable()
export class TvdBlockchainService {
  private readonly logger = new Logger(TvdBlockchainService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly receiptValidator: TvdReceiptValidatorService,
    @Inject(TVD_BLOCKCHAIN_CLIENT_FACTORY)
    private readonly clientFactory: TvdBlockchainClientFactory,
  ) {}

  getAbiSummary() {
    return {
      tokenAbiLoaded: Array.isArray(TVD_TOKEN_ABI) && TVD_TOKEN_ABI.length > 0,
      assignmentAbiLoaded:
        Array.isArray(TVD_ASSIGNMENT_ABI) && TVD_ASSIGNMENT_ABI.length > 0,
      electoralCreditsAbiLoaded:
        Array.isArray(TVD_ELECTORAL_CREDITS_ABI) &&
        TVD_ELECTORAL_CREDITS_ABI.length > 0,
    };
  }

  async validateBlockchainConfiguration(): Promise<TvdBlockchainValidationResult> {
    const config = this.getCompleteConfigOrNull();
    if (!config) return { configured: false };

    const clients = this.createClients(config);
    const chainId = await this.callRpc(
      () => clients.publicClient.getChainId(),
      'TVD_RPC_UNAVAILABLE',
    );
    const operatorAddress = getAddress(
      await this.readAssignmentContract(config, 'operator'),
    );
    const assignmentTokenAddress = getAddress(
      await this.readAssignmentContract(config, 'token'),
    );
    const tokenDecimals = Number(await this.readTokenContract(config, 'decimals'));
    const signerNativeGasBalance = await this.callRpc(
      () => clients.publicClient.getBalance({ address: clients.account.address }),
      'TVD_RPC_UNAVAILABLE',
    );
    const assignmentContractTokenBalance = await this.readTokenContract(
      config,
      'balanceOf',
      [config.assignmentContractAddress],
    );
    const assignmentContractTotalAssigned = await this.readAssignmentContract(
      config,
      'totalAssigned',
    );
    const assignmentAccountingConsistent =
      assignmentContractTotalAssigned <= assignmentContractTokenBalance;
    const assignmentContractAssignableBalance = assignmentAccountingConsistent
      ? assignmentContractTokenBalance - assignmentContractTotalAssigned
      : 0n;

    return {
      configured: true,
      rpcReachable: true,
      chainId,
      expectedChainId: config.chainId,
      chainIdMatches: chainId === config.chainId,
      signerAddress: getAddress(clients.account.address),
      operatorAddress,
      operatorMatches:
        getAddress(clients.account.address) === getAddress(operatorAddress),
      assignmentTokenAddress,
      expectedTokenAddress: config.tokenContractAddress,
      tokenAddressMatches:
        getAddress(assignmentTokenAddress) ===
        getAddress(config.tokenContractAddress),
      tokenDecimals,
      configuredDecimals: config.decimals,
      decimalsMatch: tokenDecimals === config.decimals,
      signerNativeGasBalance: signerNativeGasBalance.toString(),
      signerHasGas: signerNativeGasBalance > 0n,
      assignmentContractTokenBalance: assignmentContractTokenBalance.toString(),
      assignmentContractTotalAssigned: assignmentContractTotalAssigned.toString(),
      assignmentContractAssignableBalance:
        assignmentContractAssignableBalance.toString(),
      assignmentAccountingConsistent,
    };
  }

  async getNetworkChainId() {
    const config = this.getConfigOrThrow();
    return this.callRpc(
      () => this.createClients(config).publicClient.getChainId(),
      'TVD_RPC_UNAVAILABLE',
    );
  }

  getConfiguredSignerAddress() {
    const config = this.getConfigOrThrow();
    return getAddress(this.createClients(config).account.address);
  }

  getOperatorContext(): TvdOperatorContext {
    const config = this.getConfigOrThrow();
    return {
      chainId: config.chainId,
      operatorAddress: getAddress(this.createClients(config).account.address),
      assignmentContractAddress: config.assignmentContractAddress,
    };
  }

  async getElectoralCreditsSummary() {
    const config = this.getElectoralCreditsConfigOrThrow();
    const [chainId, tokenAddress, tvdPerCredit, proxyAuthorizedForCredits] =
      await Promise.all([
        this.callRpc(
          () => this.createClients(config).publicClient.getChainId(),
          'TVD_RPC_UNAVAILABLE',
        ),
        this.readElectoralCreditsContract(config, 'token'),
        this.readElectoralCreditsContract(config, 'tvdPerCredit'),
        this.readElectoralCreditsContract(config, 'authorizedOperators', [
          config.voteManagerAddress,
        ]),
      ]);

    return {
      chainId,
      expectedChainId: config.chainId,
      creditsContractAddress: config.electoralCreditsAddress,
      proxyAddress: config.voteManagerAddress,
      implementationAddress: config.voteManagerImplementationAddress,
      tokenAddress: getAddress(tokenAddress),
      expectedTokenAddress: config.tokenContractAddress,
      tvdPerCredit: tvdPerCredit.toString(),
      spenderAddress: config.electoralCreditsAddress,
      proxyAuthorizedForCredits: Boolean(proxyAuthorizedForCredits),
    };
  }

  async getTvdAllowance(owner: string, spender?: string) {
    const config = this.getElectoralCreditsConfigOrThrow();
    const ownerAddress = this.parseWallet(owner);
    const spenderAddress = spender
      ? this.parseWallet(spender)
      : config.electoralCreditsAddress;
    this.assertCreditsSpender(config, spenderAddress);
    const allowance = await this.readTokenContract(config, 'allowance', [
      ownerAddress,
      spenderAddress,
    ]);
    return allowance.toString();
  }

  async validateVotePublicationPreflight(
    input: TvdVotePublicationPreflightInput,
  ): Promise<TvdVotePublicationPreflightResult> {
    const config = this.getElectoralCreditsConfigOrThrow();
    const clients = this.createClients(config);
    const institutionWallet = this.parseWallet(input.institutionWallet);
    const requiredCredits = this.parsePositiveBigInt(
      input.requiredCredits,
      'TVD_INVALID_AMOUNT',
    );
    const [chainId, implementationAddress, tokenAddress, tvdPerCredit] =
      await Promise.all([
        this.callRpc(
          () => clients.publicClient.getChainId(),
          'TVD_RPC_UNAVAILABLE',
        ),
        this.readProxyImplementation(config),
        this.readElectoralCreditsContract(config, 'token'),
        this.readElectoralCreditsContract(config, 'tvdPerCredit'),
      ]);

    if (chainId !== config.chainId) {
      throw new TvdBlockchainError('TVD_CHAIN_MISMATCH');
    }
    if (getAddress(tokenAddress) !== config.tokenContractAddress) {
      throw new TvdBlockchainError('TVD_CREDITS_TOKEN_MISMATCH');
    }
    if (
      getAddress(implementationAddress) !==
      config.voteManagerImplementationAddress
    ) {
      throw new TvdBlockchainError(
        'TVD_VOTE_MANAGER_IMPLEMENTATION_MISMATCH',
      );
    }
    this.assertCreditsSpender(config, config.electoralCreditsAddress);

    const [
      proxyAuthorizedForCredits,
      institutionAdminAddress,
      institutionAuthorizedOnChain,
      assignedBalance,
      liquidBalance,
      assignmentCreditsContract,
    ] = await Promise.all([
      this.readElectoralCreditsContract(config, 'authorizedOperators', [
        config.voteManagerAddress,
      ]),
      this.readVoteManagerInstitutionContract(config, 'getInstitutionAdmin', [
        input.institutionId,
      ]),
      this.readVoteManagerInstitutionContract(config, 'isAuthorizedAddress', [
        input.institutionId,
        institutionWallet,
      ]),
      this.readAssignmentContract(config, 'assignedBalance', [
        institutionWallet,
      ]),
      this.readTokenContract(config, 'balanceOf', [institutionWallet]),
      this.readAssignmentContract(config, 'creditsContract'),
    ]);

    if (!Boolean(proxyAuthorizedForCredits)) {
      throw new TvdBlockchainError('TVD_CREDITS_OPERATOR_NOT_AUTHORIZED');
    }
    if (getAddress(institutionAdminAddress) === zeroAddress) {
      throw new TvdBlockchainError('TVD_INSTITUTION_NOT_REGISTERED');
    }
    const adminMatchesWallet =
      getAddress(institutionAdminAddress) === institutionWallet;
    if (!Boolean(institutionAuthorizedOnChain) && !adminMatchesWallet) {
      throw new TvdBlockchainError('TVD_WALLET_NOT_AUTHORIZED');
    }

    const requiredTvd = requiredCredits * BigInt(tvdPerCredit);
    const vestingCovers = assignedBalance >= requiredTvd;
    if (
      vestingCovers &&
      getAddress(assignmentCreditsContract) !== config.electoralCreditsAddress
    ) {
      throw new TvdBlockchainError('TVD_CREDITS_SOURCE_CONFIG_MISMATCH');
    }
    const tvdSource = vestingCovers ? 'VESTING' as const : 'WALLET' as const;
    const walletDebitRequired = tvdSource === 'WALLET' ? requiredTvd : 0n;
    const hasCapacity = tvdSource === 'VESTING' || liquidBalance >= walletDebitRequired;
    if (!hasCapacity) {
      throw new TvdBlockchainError('TVD_CREDITS_INSUFFICIENT_CAPACITY');
    }

    const allowance = walletDebitRequired > 0n
      ? await this.readTokenContract(config, 'allowance', [
          institutionWallet,
          config.electoralCreditsAddress,
        ])
      : 0n;
    const hasRequiredAllowance = allowance >= walletDebitRequired;

    const electionExistsOnChain = await this.voteExistsOnChain(
      config,
      input.onChainElectionId,
    );
    if (electionExistsOnChain) {
      throw new TvdBlockchainError('TVD_VOTE_ALREADY_EXISTS');
    }

    if (hasRequiredAllowance) {
      await this.simulateCreateVotePreflight(clients, config, {
        institutionWallet,
        institutionId: input.institutionId,
        onChainElectionId: input.onChainElectionId,
        createVoteArgs: input.createVoteArgs,
      });
    }

    return {
      chainId,
      proxyAddress: config.voteManagerAddress,
      implementationAddress,
      creditsContractAddress: config.electoralCreditsAddress,
      tokenAddress: getAddress(tokenAddress),
      spenderAddress: config.electoralCreditsAddress,
      institutionWallet,
      institutionAdminAddress: getAddress(institutionAdminAddress),
      tvdPerCredit: tvdPerCredit.toString(),
      requiredCredits: requiredCredits.toString(),
      requiredTvd: requiredTvd.toString(),
      tvdSource,
      assignedBalanceSmallestUnit: assignedBalance.toString(),
      liquidBalanceSmallestUnit: liquidBalance.toString(),
      allowanceSmallestUnit: allowance.toString(),
      walletDebitRequiredSmallestUnit: walletDebitRequired.toString(),
      hasCapacity,
      hasRequiredAllowance,
      proxyAuthorizedForCredits: Boolean(proxyAuthorizedForCredits),
      institutionAuthorizedOnChain:
        Boolean(institutionAuthorizedOnChain) || adminMatchesWallet,
      electionExistsOnChain,
      simulated: hasRequiredAllowance,
    };
  }

  async getOperatorAddress() {
    const config = this.getConfigOrThrow();
    return getAddress(await this.readAssignmentContract(config, 'operator'));
  }

  async getAssignmentOwnerAddress() {
    const config = this.getConfigOrThrow();
    return getAddress(await this.readAssignmentContract(config, 'owner'));
  }

  async getTokenAddressFromAssignmentContract() {
    const config = this.getConfigOrThrow();
    return getAddress(await this.readAssignmentContract(config, 'token'));
  }

  async getTokenDecimals() {
    const config = this.getConfigOrThrow();
    return Number(await this.readTokenContract(config, 'decimals'));
  }

  async getTokenSymbol() {
    const config = this.getConfigOrThrow();
    return String(await this.readTokenContract(config, 'symbol'));
  }

  async getNativeGasBalance() {
    const config = this.getConfigOrThrow();
    const clients = this.createClients(config);
    const balance = await this.callRpc(
      () => clients.publicClient.getBalance({ address: clients.account.address }),
      'TVD_RPC_UNAVAILABLE',
    );
    return balance.toString();
  }

  async getTokenContractBalance() {
    const config = this.getConfigOrThrow();
    const balance = await this.readTokenContract(config, 'balanceOf', [
      config.assignmentContractAddress,
    ]);
    return balance.toString();
  }

  async getPendingNonce(operatorAddress?: string) {
    const config = this.getConfigOrThrow();
    const clients = this.createClients(config);
    const address = operatorAddress
      ? this.parseWallet(operatorAddress)
      : getAddress(clients.account.address);
    const nonce = await this.callRpc(
      () =>
        clients.publicClient.getTransactionCount({
          address,
          blockTag: 'pending',
        }),
      'TVD_RPC_UNAVAILABLE',
    );
    return String(nonce);
  }

  async validateAssignReadiness(input: TvdAssignTokensInput) {
    const institutionWallet = this.parseWallet(input.institutionWallet);
    const amount = this.parseAmountSmallestUnit(input.amountSmallestUnit);
    const validation = await this.validateBlockchainConfiguration();

    if (!validation.configured) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    if (!validation.chainIdMatches) {
      throw new TvdBlockchainError('TVD_CHAIN_MISMATCH');
    }
    if (!validation.operatorMatches) {
      throw new TvdBlockchainError('TVD_OPERATOR_MISMATCH');
    }
    if (!validation.tokenAddressMatches) {
      throw new TvdBlockchainError('TVD_TOKEN_ADDRESS_MISMATCH');
    }
    if (!validation.decimalsMatch) {
      throw new TvdBlockchainError('TVD_DECIMALS_MISMATCH');
    }
    if (!validation.signerHasGas) {
      throw new TvdBlockchainError('TVD_INSUFFICIENT_GAS');
    }
    if (
      !validation.assignmentAccountingConsistent ||
      BigInt(validation.assignmentContractAssignableBalance) < amount
    ) {
      throw new TvdBlockchainError('TVD_INSUFFICIENT_CONTRACT_BALANCE');
    }

    return {
      institutionWallet,
      amountSmallestUnit: amount.toString(),
      chainId: validation.chainId,
      operatorAddress: validation.signerAddress,
      contractAddress: this.getConfigOrThrow().assignmentContractAddress,
    };
  }

  async prepareSignedAssignTransaction(
    input: TvdPrepareAssignTransactionInput,
  ): Promise<TvdPreparedAssignTransaction> {
    const config = this.getConfigOrThrow();
    const readiness = await this.validateAssignReadiness(input);
    const nonce = this.parseNonce(input.nonce);
    const amount = BigInt(readiness.amountSmallestUnit);
    const clients = this.createClients(config);
    const data = encodeFunctionData({
      abi: TVD_ASSIGNMENT_ABI,
      functionName: 'assign',
      args: [readiness.institutionWallet, amount],
    });
    const request = await this.callRpc(
      () =>
        clients.walletClient.prepareTransactionRequest
          ? clients.walletClient.prepareTransactionRequest({
              account: clients.account,
              chain: null,
              to: config.assignmentContractAddress,
              data,
              nonce: Number(nonce),
              value: 0n,
            })
          : {
              account: clients.account,
              to: config.assignmentContractAddress,
              data,
              nonce: Number(nonce),
              value: 0n,
            },
      'TVD_RPC_UNAVAILABLE',
    );
    const account = clients.account as any;
    const serializedTransaction = await this.callRpc(
      () =>
        account.signTransaction
          ? account.signTransaction(request)
          : clients.walletClient.signTransaction({
              account: clients.account,
              ...request,
            }),
      'TVD_ASSIGN_REVERTED',
    ) as `0x${string}`;
    const txHash = keccak256(serializedTransaction);

    return {
      txHash,
      nonce: nonce.toString(),
      serializedTransaction,
      chainId: config.chainId,
      contractAddress: config.assignmentContractAddress,
      operatorAddress: getAddress(clients.account.address),
      institutionWallet: readiness.institutionWallet,
      amountSmallestUnit: amount.toString(),
    };
  }

  async broadcastSignedTransaction(serializedTransaction: `0x${string}`) {
    const config = this.getConfigOrThrow();
    const txHash = keccak256(serializedTransaction);
    try {
      const clients = this.createClients(config);
      const broadcastHash = await clients.walletClient.sendRawTransaction({
        serializedTransaction,
      });
      return { txHash: broadcastHash ?? txHash, alreadyKnown: false };
    } catch (error: any) {
      const message = String(error?.shortMessage ?? error?.message ?? '').toLowerCase();
      if (
        message.includes('already known') ||
        message.includes('already imported') ||
        message.includes('known transaction')
      ) {
        return { txHash, alreadyKnown: true };
      }
      throw new TvdBlockchainError('TVD_RPC_UNAVAILABLE', error);
    }
  }

  async validateSubmittedAssignReceipt(input: {
    receipt: any;
    expectedInstitutionWallet: string;
    expectedAmountSmallestUnit: string;
    expectedOperatorAddress?: string | null;
  }) {
    const config = this.getConfigOrThrow();
    const clients = this.createClients(config);
    const currentBlockNumber = await this.callRpc(
      () => clients.publicClient.getBlockNumber(),
      'TVD_RPC_UNAVAILABLE',
    );
    return this.receiptValidator.validateAssignReceipt({
      receipt: input.receipt,
      expectedChainId: config.chainId,
      actualChainId: config.chainId,
      expectedContractAddress: config.assignmentContractAddress,
      expectedOperatorAddress: input.expectedOperatorAddress
        ? getAddress(input.expectedOperatorAddress)
        : getAddress(clients.account.address),
      expectedInstitutionWallet: this.parseWallet(input.expectedInstitutionWallet),
      expectedAmountSmallestUnit: this.parseAmountSmallestUnit(
        input.expectedAmountSmallestUnit,
      ).toString(),
      confirmationsRequired: config.confirmationsRequired,
      currentBlockNumber,
    });
  }

  async getLiquidBalance(wallet: string) {
    const config = this.getConfigOrThrow();
    const address = this.parseWallet(wallet);
    const balance = await this.readTokenContract(config, 'balanceOf', [address]);
    return balance.toString();
  }

  async getAssignedBalance(wallet: string) {
    const config = this.getConfigOrThrow();
    const address = this.parseWallet(wallet);
    const balance = await this.readAssignmentContract(config, 'assignedBalance', [
      address,
    ]);
    return balance.toString();
  }

  async getTotalAssigned() {
    const config = this.getConfigOrThrow();
    const totalAssigned = await this.readAssignmentContract(config, 'totalAssigned');
    return totalAssigned.toString();
  }

  async getTotalBalance(wallet: string): Promise<TvdTotalBalanceResult> {
    const config = this.getConfigOrThrow();
    const address = this.parseWallet(wallet);
    const [liquidBalance, assignedBalance, unlockInfo] = await Promise.all([
      this.readTokenContract(config, 'balanceOf', [address]),
      this.readAssignmentContract(config, 'assignedBalance', [address]),
      this.getUnlockInformation(),
    ]);
    const totalBalance = liquidBalance + assignedBalance;

    return {
      wallet: address,
      decimals: config.decimals,
      liquidBalanceSmallestUnit: liquidBalance.toString(),
      assignedBalanceSmallestUnit: assignedBalance.toString(),
      totalBalanceSmallestUnit: totalBalance.toString(),
      liquidBalanceFormatted: formatUnits(liquidBalance, config.decimals),
      assignedBalanceFormatted: formatUnits(assignedBalance, config.decimals),
      totalBalanceFormatted: formatUnits(totalBalance, config.decimals),
      isUnlocked: unlockInfo.isUnlocked,
      unlockTime: unlockInfo.unlockTime,
    };
  }

  async getUnlockInformation(): Promise<TvdUnlockInformation> {
    const config = this.getConfigOrThrow();
    const [isUnlocked, unlockTime] = await Promise.all([
      this.readAssignmentContract(config, 'isUnlocked'),
      this.readAssignmentContract(config, 'unlockTime'),
    ]);

    return {
      isUnlocked: Boolean(isUnlocked),
      unlockTime: unlockTime.toString(),
    };
  }

  async assignTokens(input: TvdAssignTokensInput): Promise<TvdAssignTokensResult> {
    const config = this.getConfigOrThrow();
    const institutionWallet = this.parseWallet(input.institutionWallet);
    const amount = this.parseAmountSmallestUnit(input.amountSmallestUnit);
    const validation = await this.validateBlockchainConfiguration();

    if (!validation.configured) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    if (!validation.chainIdMatches) {
      throw new TvdBlockchainError('TVD_CHAIN_MISMATCH');
    }
    if (!validation.operatorMatches) {
      throw new TvdBlockchainError('TVD_OPERATOR_MISMATCH');
    }
    if (!validation.tokenAddressMatches) {
      throw new TvdBlockchainError('TVD_TOKEN_ADDRESS_MISMATCH');
    }
    if (!validation.decimalsMatch) {
      throw new TvdBlockchainError('TVD_DECIMALS_MISMATCH');
    }
    if (!validation.signerHasGas) {
      throw new TvdBlockchainError('TVD_INSUFFICIENT_GAS');
    }
    if (
      !validation.assignmentAccountingConsistent ||
      BigInt(validation.assignmentContractAssignableBalance) < amount
    ) {
      throw new TvdBlockchainError('TVD_INSUFFICIENT_CONTRACT_BALANCE');
    }

    const clients = this.createClients(config);
    const txHash = await this.callRpc(
      () =>
        clients.walletClient.writeContract({
          account: clients.account,
          address: config.assignmentContractAddress,
          abi: TVD_ASSIGNMENT_ABI,
          functionName: 'assign',
          args: [institutionWallet, amount],
        }),
      'TVD_ASSIGN_REVERTED',
    );
    const receipt = await this.callRpc(
      () =>
        clients.publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: config.confirmationsRequired,
        }),
      'TVD_RECEIPT_NOT_FOUND',
    );
    const currentBlockNumber = await this.callRpc(
      () => clients.publicClient.getBlockNumber(),
      'TVD_RPC_UNAVAILABLE',
    );
    const receiptValidation = this.receiptValidator.validateAssignReceipt({
      receipt,
      expectedChainId: config.chainId,
      actualChainId: validation.chainId,
      expectedContractAddress: config.assignmentContractAddress,
      expectedOperatorAddress: validation.signerAddress,
      expectedInstitutionWallet: institutionWallet,
      expectedAmountSmallestUnit: amount.toString(),
      confirmationsRequired: config.confirmationsRequired,
      currentBlockNumber,
    });

    return {
      txHash,
      blockNumber: receiptValidation.blockNumber,
      chainId: config.chainId,
      contractAddress: config.assignmentContractAddress,
      operatorAddress: validation.signerAddress,
      institutionWallet,
      amountSmallestUnit: amount.toString(),
      confirmations: receiptValidation.confirmations,
    };
  }

  async getTransactionReceipt(txHash: string) {
    const config = this.getConfigOrThrow();
    const receipt = await this.callRpc(
      () => this.createClients(config).publicClient.getTransactionReceipt({ hash: txHash }),
      'TVD_RECEIPT_NOT_FOUND',
    );
    if (!receipt) {
      throw new TvdBlockchainError('TVD_RECEIPT_NOT_FOUND');
    }
    return receipt;
  }

  private async readTokenContract(
    config: TvdBlockchainConfig,
    functionName: string,
    args: unknown[] = [],
  ) {
    return this.callRpc(
      () =>
        this.createClients(config).publicClient.readContract({
          address: config.tokenContractAddress,
          abi: TVD_TOKEN_ABI,
          functionName,
          args,
        }),
      'TVD_RPC_UNAVAILABLE',
    );
  }

  private async readAssignmentContract(
    config: TvdBlockchainConfig,
    functionName: string,
    args: unknown[] = [],
  ) {
    return this.callRpc(
      () =>
        this.createClients(config).publicClient.readContract({
          address: config.assignmentContractAddress,
          abi: TVD_ASSIGNMENT_ABI,
          functionName,
          args,
        }),
      'TVD_RPC_UNAVAILABLE',
    );
  }

  private async readElectoralCreditsContract(
    config: TvdElectoralCreditsConfig,
    functionName: string,
    args: unknown[] = [],
  ) {
    return this.callRpc(
      () =>
        this.createClients(config).publicClient.readContract({
          address: config.electoralCreditsAddress,
          abi: TVD_ELECTORAL_CREDITS_ABI,
          functionName,
          args,
        }),
      'TVD_RPC_UNAVAILABLE',
    );
  }

  private async readVoteManagerContract(
    config: TvdElectoralCreditsConfig,
    functionName: string,
    args: unknown[] = [],
  ) {
    return this.callRpc(
      () =>
        this.createClients(config).publicClient.readContract({
          address: config.voteManagerAddress,
          abi: votingContractAbi,
          functionName,
          args,
        }),
      'TVD_RPC_UNAVAILABLE',
    );
  }

  private async readVoteManagerInstitutionContract(
    config: TvdElectoralCreditsConfig,
    functionName: string,
    args: unknown[] = [],
  ) {
    try {
      return await this.createClients(config).publicClient.readContract({
        address: config.voteManagerAddress,
        abi: votingContractAbi,
        functionName,
        args,
      });
    } catch (error) {
      if (this.isInstitutionMissingError(error)) {
        throw new TvdBlockchainError('TVD_INSTITUTION_NOT_REGISTERED', error);
      }
      throw new TvdBlockchainError('TVD_RPC_UNAVAILABLE', error);
    }
  }

  private async readProxyImplementation(config: TvdElectoralCreditsConfig) {
    const raw = await this.callRpc(
      () =>
        this.createClients(config).publicClient.getStorageAt({
          address: config.voteManagerAddress,
          slot: EIP1967_IMPLEMENTATION_SLOT,
        }),
      'TVD_RPC_UNAVAILABLE',
    );
    const value = String(raw ?? '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new TvdBlockchainError('TVD_VOTE_MANAGER_CONFIG_INCOMPLETE');
    }
    return getAddress(`0x${value.slice(-40)}`);
  }

  private async voteExistsOnChain(
    config: TvdElectoralCreditsConfig,
    onChainElectionId: bigint,
  ) {
    try {
      await this.readVoteManagerContract(config, 'getVoteInfo', [
        onChainElectionId,
      ]);
      return true;
    } catch (error) {
      return false;
    }
  }

  private createClients(config: TvdBlockchainConfig) {
    try {
      return this.clientFactory(config);
    } catch (error) {
      throw new TvdBlockchainError('TVD_OPERATOR_PRIVATE_KEY_INVALID', error);
    }
  }

  private async callRpc<T>(
    operation: () => Promise<T> | T,
    errorCode:
      | 'TVD_RPC_UNAVAILABLE'
      | 'TVD_ASSIGN_REVERTED'
      | 'TVD_RECEIPT_NOT_FOUND'
      | 'TVD_CREATE_VOTE_PREFLIGHT_REVERTED',
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new TvdBlockchainError(errorCode, error);
    }
  }

  private async simulateCreateVotePreflight(
    clients: ReturnType<TvdBlockchainService['createClients']>,
    config: TvdElectoralCreditsConfig,
    input: {
      institutionWallet: Address;
      institutionId: string;
      onChainElectionId: bigint | number | string;
      createVoteArgs: readonly unknown[];
    },
  ) {
    try {
      await clients.publicClient.simulateContract({
        account: input.institutionWallet,
        address: config.voteManagerAddress,
        abi: votingContractAbi,
        functionName: 'createVote',
        args: input.createVoteArgs,
      });
    } catch (error) {
      const revert = this.extractContractRevert(error);
      this.logger.warn({
        event: 'tvd_create_vote_preflight_reverted',
        contract: config.voteManagerAddress,
        functionName: 'createVote',
        institutionId: input.institutionId,
        institutionWallet: input.institutionWallet,
        onChainElectionId: String(input.onChainElectionId),
        revertReason: revert.revertReason,
        customErrorName: revert.customErrorName,
        errorName: revert.errorName,
        causeName: revert.causeName,
        argsCount: input.createVoteArgs.length,
      });
      throw new TvdBlockchainError(
        revert.customErrorName === 'ERC20InsufficientAllowance'
          ? 'TVD_ALLOWANCE_INSUFFICIENT'
          : 'TVD_CREATE_VOTE_PREFLIGHT_REVERTED',
        error,
      );
    }
  }

  private extractContractRevert(error: unknown) {
    const direct = error as any;
    const reverted = error instanceof BaseError
      ? error.walk((cause) =>
          (cause as { name?: string }).name === 'ContractFunctionRevertedError',
        ) as any
      : undefined;
    const cause = direct?.cause;
    const data = this.findErrorData(error);
    const decoded = this.decodeKnownError(data);
    return {
      errorName: direct?.name ?? null,
      causeName: reverted?.name ?? cause?.name ?? null,
      revertReason:
        reverted?.reason ??
        cause?.reason ??
        direct?.reason ??
        direct?.shortMessage ??
        null,
      customErrorName:
        decoded?.errorName ??
        reverted?.data?.errorName ??
        cause?.data?.errorName ??
        direct?.data?.errorName ??
        reverted?.errorName ??
        null,
    };
  }

  private findErrorData(error: unknown): `0x${string}` | undefined {
    const visit = (value: any): `0x${string}` | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      if (typeof value.data === 'string' && value.data.startsWith('0x')) {
        return value.data as `0x${string}`;
      }
      return visit(value.cause) ?? visit(value.details);
    };
    return visit(error);
  }

  private decodeKnownError(data?: `0x${string}`) {
    if (!data) return null;
    try {
      return decodeErrorResult({
        abi: ERC20_ERROR_ABI,
        data,
      });
    } catch {
      return null;
    }
  }

  private getConfigOrThrow() {
    const config = this.getCompleteConfigOrNull();
    if (!config) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    return config;
  }

  private getCompleteConfigOrNull(): TvdBlockchainConfig | null {
    const raw = {
      rpcUrl: this.getConfigValue('app.tvd.rpcUrl'),
      chainId: this.getConfigValue('app.tvd.chainId'),
      tokenContractAddress: this.getConfigValue('app.tvd.tokenContractAddress'),
      assignmentContractAddress: this.getConfigValue(
        'app.tvd.assignmentContractAddress',
      ),
      operatorPrivateKey: this.getConfigValue('app.tvd.operatorPrivateKey'),
      confirmationsRequired: this.getConfigValue(
        'app.tvd.confirmationsRequired',
      ),
      decimals: this.getConfigValue('app.tvd.decimals'),
    };

    if (Object.values(raw).some((value) => !value)) {
      return null;
    }

    return {
      rpcUrl: raw.rpcUrl,
      chainId: this.parsePositiveNumber(raw.chainId, 'TVD_CHAIN_ID'),
      tokenContractAddress: this.parseAddress(
        raw.tokenContractAddress,
        'TVD_TOKEN_CONTRACT_ADDRESS',
      ),
      assignmentContractAddress: this.parseAddress(
        raw.assignmentContractAddress,
        'TVD_ASSIGNMENT_CONTRACT_ADDRESS',
      ),
      operatorPrivateKey: this.parsePrivateKey(raw.operatorPrivateKey),
      confirmationsRequired: this.parseNonNegativeNumber(
        raw.confirmationsRequired,
        'TVD_CONFIRMATIONS_REQUIRED',
      ),
      decimals: this.parseTokenDecimals(raw.decimals),
    };
  }

  private getElectoralCreditsConfigOrThrow(): TvdElectoralCreditsConfig {
    const baseConfig = this.getConfigOrThrow();
    const electoralCreditsAddress = this.getConfigValue(
      'app.contracts.electoralCredits.address',
    );
    const voteManagerAddress = this.getConfigValue(
      'app.contracts.voteManager.address',
    );
    const voteManagerImplementationAddress = this.getConfigValue(
      'app.contracts.voteManager.implementationAddress',
    );

    if (
      !electoralCreditsAddress ||
      !voteManagerAddress ||
      !voteManagerImplementationAddress
    ) {
      throw new TvdBlockchainError('TVD_CREDITS_CONFIG_INCOMPLETE');
    }

    return {
      ...baseConfig,
      electoralCreditsAddress: this.parseAddress(
        electoralCreditsAddress,
        'TVD_ELECTORAL_CREDITS_ADDRESS',
      ),
      voteManagerAddress: this.parseAddress(
        voteManagerAddress,
        'TVD_VOTE_MANAGER_ADDRESS',
      ),
      voteManagerImplementationAddress: this.parseAddress(
        voteManagerImplementationAddress,
        'TVD_VOTE_MANAGER_IMPLEMENTATION_ADDRESS',
      ),
    };
  }

  private getConfigValue(key: string) {
    return String(this.configService.get<string>(key) ?? '').trim();
  }

  private parseAddress(value: string, fieldName: string) {
    if (!isAddress(value) || getAddress(value) === zeroAddress) {
      throw new TvdBlockchainError(
        fieldName === 'TVD_TOKEN_CONTRACT_ADDRESS' ||
          fieldName === 'TVD_ASSIGNMENT_CONTRACT_ADDRESS'
          ? 'TVD_CONFIG_INCOMPLETE'
          : fieldName === 'TVD_ELECTORAL_CREDITS_ADDRESS' ||
              fieldName === 'TVD_VOTE_MANAGER_ADDRESS' ||
              fieldName === 'TVD_VOTE_MANAGER_IMPLEMENTATION_ADDRESS'
            ? 'TVD_CREDITS_CONFIG_INCOMPLETE'
          : 'TVD_INVALID_WALLET',
      );
    }
    return getAddress(value);
  }

  private assertCreditsSpender(
    config: TvdElectoralCreditsConfig,
    spenderAddress: Address,
  ) {
    if (getAddress(spenderAddress) === config.tokenContractAddress) {
      throw new TvdBlockchainError('TVD_CREDITS_SPENDER_INVALID');
    }
    if (getAddress(spenderAddress) !== config.electoralCreditsAddress) {
      throw new TvdBlockchainError('TVD_CREDITS_SPENDER_INVALID');
    }
  }

  private parsePositiveBigInt(
    value: bigint,
    code: 'TVD_INVALID_AMOUNT',
  ) {
    if (value <= 0n) {
      throw new TvdBlockchainError(code);
    }
    return value;
  }

  private parseWallet(value: string) {
    const wallet = String(value ?? '').trim();
    if (!isAddress(wallet) || getAddress(wallet) === zeroAddress) {
      throw new TvdBlockchainError('TVD_INVALID_WALLET');
    }
    return getAddress(wallet);
  }

  private isInstitutionMissingError(error: unknown) {
    const text = [
      error instanceof Error ? error.message : '',
      typeof (error as { shortMessage?: unknown })?.shortMessage === 'string'
        ? (error as { shortMessage: string }).shortMessage
        : '',
      typeof (error as { details?: unknown })?.details === 'string'
        ? (error as { details: string }).details
        : '',
    ].join('\n');
    return /institution does not exist/i.test(text);
  }

  private parseAmountSmallestUnit(value: string) {
    const amount = String(value ?? '').trim();
    if (!POSITIVE_INTEGER_REGEX.test(amount)) {
      throw new TvdBlockchainError('TVD_INVALID_AMOUNT');
    }
    return BigInt(amount);
  }

  private parseNonce(value: string) {
    const nonce = String(value ?? '').trim();
    if (!NON_NEGATIVE_INTEGER_REGEX.test(nonce)) {
      throw new TvdBlockchainError('TVD_INVALID_AMOUNT');
    }
    return BigInt(nonce);
  }

  private parsePrivateKey(value: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new TvdBlockchainError('TVD_OPERATOR_PRIVATE_KEY_INVALID');
    }
    return value as `0x${string}`;
  }

  private parsePositiveNumber(value: string, _fieldName: string) {
    if (!POSITIVE_INTEGER_REGEX.test(value)) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    return Number(value);
  }

  private parseNonNegativeNumber(value: string, _fieldName: string) {
    if (!NON_NEGATIVE_INTEGER_REGEX.test(value)) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    return Number(value);
  }

  private parseTokenDecimals(value: string) {
    if (!NON_NEGATIVE_INTEGER_REGEX.test(value)) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    const decimals = Number(value);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new TvdBlockchainError('TVD_CONFIG_INCOMPLETE');
    }
    return decimals;
  }
}
