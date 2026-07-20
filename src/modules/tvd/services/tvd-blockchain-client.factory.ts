import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { TvdBlockchainClientFactory } from '../types/tvd-blockchain.types';

export const createViemTvdBlockchainClients: TvdBlockchainClientFactory = (
  config,
) => {
  const account = privateKeyToAccount(config.operatorPrivateKey);
  const transport = http(config.rpcUrl);

  return {
    account,
    publicClient: createPublicClient({ transport }),
    walletClient: createWalletClient({
      account,
      transport,
    }),
  };
};
