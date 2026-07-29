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

export type TvdElectoralCreditsConfig = TvdBlockchainConfig & {
  electoralCreditsAddress: Address;
  voteManagerAddress: Address;
  voteManagerImplementationAddress: Address;
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
      signerHasOperatorRole: boolean;
      assignmentTokenAddress: Address;
      expectedTokenAddress: Address;
      tokenAddressMatches: boolean;
      tokenDecimals: number;
      configuredDecimals: number;
      decimalsMatch: boolean;
      assignmentContractTokenBalance: string;
      assignmentContractAssignableBalance: string;
    };

export type TvdAssignTokensInput = {
  institutionWallet: string;
  amountSmallestUnit: string;
};

export type TvdOperatorContext = {
  chainId: number;
  operatorAddress: Address;
  assignmentContractAddress: Address;
};

export type TvdPreparedAssignTransaction = {
  userOpHash: Hash;
  nonce: string;
  serializedTransaction: string;
  chainId: number;
  contractAddress: Address;
  operatorAddress: Address;
  institutionWallet: Address;
  amountSmallestUnit: string;
};

export type TvdBroadcastAssignTransactionResult = {
  txHash: Hash;
  userOpHash: Hash;
  alreadyKnown: boolean;
};

export type TvdPrepareAssignTransactionInput = TvdAssignTokensInput;

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

export type TvdVotePublicationPreflightInput = {
  institutionWallet: string;
  institutionId: string;
  onChainElectionId: bigint;
  requiredCredits: bigint;
  createVoteArgs: readonly unknown[];
};

export type TvdVotePublicationPreflightResult = {
  chainId: number;
  proxyAddress: Address;
  implementationAddress: Address;
  creditsContractAddress: Address;
  tokenAddress: Address;
  spenderAddress: Address;
  institutionWallet: Address;
  institutionAdminAddress: Address;
  tvdPerCredit: string;
  maxTokenPerElection: string;
  requiredCredits: string;
  requiredTvd: string;
  tvdSource: 'VESTING' | 'INCENTIVES' | 'WALLET';
  assignedBalanceSmallestUnit: string;
  liquidBalanceSmallestUnit: string;
  allowanceSmallestUnit: string;
  walletDebitRequiredSmallestUnit: string;
  hasCapacity: boolean;
  hasRequiredAllowance: boolean;
  proxyAuthorizedForCredits: boolean;
  institutionAuthorizedOnChain: boolean;
  electionExistsOnChain: boolean;
  simulated: boolean;
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
