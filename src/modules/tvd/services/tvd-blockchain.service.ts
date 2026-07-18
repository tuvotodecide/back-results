import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  zeroAddress,
} from 'viem';
import { TVD_ASSIGNMENT_ABI, TVD_TOKEN_ABI } from '../contracts/tvd-abis';
import { TvdBlockchainError } from '../errors/tvd-blockchain.error';
import {
  TVD_BLOCKCHAIN_CLIENT_FACTORY,
  TvdAssignTokensInput,
  TvdAssignTokensResult,
  TvdBlockchainClientFactory,
  TvdBlockchainConfig,
  TvdBlockchainValidationResult,
  TvdOperatorContext,
  TvdPrepareAssignTransactionInput,
  TvdPreparedAssignTransaction,
  TvdTotalBalanceResult,
  TvdUnlockInformation,
} from '../types/tvd-blockchain.types';
import { TvdReceiptValidatorService } from './tvd-receipt-validator.service';

const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;
const NON_NEGATIVE_INTEGER_REGEX = /^(?:0|[1-9]\d*)$/;

@Injectable()
export class TvdBlockchainService {
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
      | 'TVD_RECEIPT_NOT_FOUND',
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new TvdBlockchainError(errorCode, error);
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

  private getConfigValue(key: string) {
    return String(this.configService.get<string>(key) ?? '').trim();
  }

  private parseAddress(value: string, fieldName: string) {
    if (!isAddress(value) || getAddress(value) === zeroAddress) {
      throw new TvdBlockchainError(
        fieldName === 'TVD_TOKEN_CONTRACT_ADDRESS' ||
          fieldName === 'TVD_ASSIGNMENT_CONTRACT_ADDRESS'
          ? 'TVD_CONFIG_INCOMPLETE'
          : 'TVD_INVALID_WALLET',
      );
    }
    return getAddress(value);
  }

  private parseWallet(value: string) {
    const wallet = String(value ?? '').trim();
    if (!isAddress(wallet) || getAddress(wallet) === zeroAddress) {
      throw new TvdBlockchainError('TVD_INVALID_WALLET');
    }
    return getAddress(wallet);
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
