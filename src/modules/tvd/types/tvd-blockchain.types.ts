import { Address, Hash } from 'viem';

export type TvdBlockchainConfig = {
  rpcUrl: string;
  chainId: number;
  tokenContractAddress: Address;
  assignmentContractAddress: Address;
  operatorPrivateKey: `0x${string}`;
  confirmationsRequired: number;
  decimals: number;
};

export type TvdBlockchainValidationResult =
  | { configured: false }
  | {
      configured: true;
      rpcReachable: boolean;
      chainId: number;
      expectedChainId: number;
      chainIdMatches: boolean;
      signerAddress: Address;
      operatorAddress: Address;
      operatorMatches: boolean;
      assignmentTokenAddress: Address;
      expectedTokenAddress: Address;
      tokenAddressMatches: boolean;
      tokenDecimals: number;
      configuredDecimals: number;
      decimalsMatch: boolean;
      signerNativeGasBalance: string;
      signerHasGas: boolean;
      assignmentContractTokenBalance: string;
      assignmentContractTotalAssigned: string;
      assignmentContractAssignableBalance: string;
      assignmentAccountingConsistent: boolean;
    };

export type TvdAssignTokensInput = {
  institutionWallet: string;
  amountSmallestUnit: string;
};

export type TvdAssignTokensResult = {
  txHash: Hash;
  blockNumber: string;
  chainId: number;
  contractAddress: Address;
  operatorAddress: Address;
  institutionWallet: Address;
  amountSmallestUnit: string;
  confirmations: number;
};

export type TvdOperatorContext = {
  chainId: number;
  operatorAddress: Address;
  assignmentContractAddress: Address;
};

export type TvdPreparedAssignTransaction = {
  txHash: Hash;
  nonce: string;
  serializedTransaction: `0x${string}`;
  chainId: number;
  contractAddress: Address;
  operatorAddress: Address;
  institutionWallet: Address;
  amountSmallestUnit: string;
};

export type TvdPrepareAssignTransactionInput = TvdAssignTokensInput & {
  nonce: string;
};

export type TvdTotalBalanceResult = {
  wallet: Address;
  decimals: number;
  liquidBalanceSmallestUnit: string;
  assignedBalanceSmallestUnit: string;
  totalBalanceSmallestUnit: string;
  liquidBalanceFormatted: string;
  assignedBalanceFormatted: string;
  totalBalanceFormatted: string;
  isUnlocked: boolean;
  unlockTime: string;
};

export type TvdUnlockInformation = {
  isUnlocked: boolean;
  unlockTime: string;
};

export type TvdBlockchainClients = {
  publicClient: any;
  walletClient: any;
  account: { address: Address };
};

export const TVD_BLOCKCHAIN_CLIENT_FACTORY = Symbol(
  'TVD_BLOCKCHAIN_CLIENT_FACTORY',
);

export type TvdBlockchainClientFactory = (
  config: TvdBlockchainConfig,
) => TvdBlockchainClients;
