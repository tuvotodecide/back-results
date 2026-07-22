import { Address, createPublicClient, getContract, Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  availableNetworks,
  FACTORY_ADDRESS as RAW_FACTORY_ADDRESS,
  sponsorshipPolicyId,
} from './params';
import { entryPoint07Address, toCoinbaseSmartAccount } from 'viem/account-abstraction';
import { toSimpleSmartAccount } from 'permissionless/accounts';

import walletAbi from './contracts/SimpleAccount.json';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createSmartAccountClient } from 'permissionless';

const RECEIPT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const RECEIPT_POLL_INTERVAL_MS = 2000;
const CHAIN_KEY = (
  process.env.CHAINA) as keyof typeof availableNetworks;

function getFactoryAddress(): Address {
  const factoryAddress = RAW_FACTORY_ADDRESS || process.env.FACTORY;
  if (!factoryAddress) {
    throw new Error('FACTORY_ADDRESS no está configurado');
  }
  return factoryAddress as Address;
}

export function getReadAccountContract(chain, address) {
  const client = createPublicClient({
    chain: availableNetworks[chain].chain,
    transport: http(),
  });

  return getContract({
    address,
    abi: walletAbi,
    client: { public: client },
  });
}

export async function getAccount(privateKey, address, chain) {
  const owner = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({
    chain: availableNetworks[chain].chain,
    transport: http(),
  });

  const account = await toSimpleSmartAccount({
    client: publicClient,
    address,
    factoryAddress: getFactoryAddress(),
    owner,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  return { account, publicClient };
}

async function getCoinbaseAccount(privateKey: Hex, chain: string) {
  const {chain: chainConfig, bundler} = availableNetworks[chain];

  const publicClient = createPublicClient({
    chain: chainConfig,
    transport: http(bundler),
  });

  const account = await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [privateKeyToAccount(privateKey)],
    version: '1.1',
  });

  const pimlicoClient = createPimlicoClient({
    chain: chainConfig,
    transport: http(bundler),
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: chainConfig,
    bundlerTransport: http(bundler),
    paymaster: pimlicoClient,
  });

  return { publicClient, smartAccountClient }
}

export async function executeOperation(
  privateKey,
  address,
  chainId,
  callData,
  waitEvent?,  
  eventName?,  
) {
  const { account, publicClient } = await getAccount(
    privateKey,
    address,
    chainId,
  );
  const { chain, bundler } = availableNetworks[chainId];

  const pimlicoClient = createPimlicoClient({
    chain,
    transport: http(bundler),
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  });

  const arbitrumParams = chainId.startsWith('arbitrum')
    ? {
        paymasterContext: { sponsorshipPolicyId },
        userOperation: {
          estimateFeesPerGas: async () => {
            return (await pimlicoClient.getUserOperationGasPrice()).standard;
          },
        },
      }
    : {};

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(bundler),
    paymaster: pimlicoClient,
    ...arbitrumParams,
  });

  const txHash = await smartAccountClient.sendTransaction(callData);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });

  let returnData;
  if (waitEvent && eventName) {
    returnData = await waitEvent(chainId, eventName, receipt.blockNumber);
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });
  const date = new Date(Number(block.timestamp) * 1000);
  return { returnData, receipt, date: date.toLocaleString() };
}

export async function executeCoinbaseOp(
  privateKey: Hex,
  chain: string,
  callData: any,
  waitEvent: ((chainId: string, eventName: string, fromBlock: number) => Promise<any>) | undefined,
  eventName: string | undefined,
) {
  const { publicClient, smartAccountClient } = await getCoinbaseAccount(privateKey, chain);

  const txHash = await smartAccountClient.sendTransaction(callData);
  const receipt = await waitForReceiptWithFallback(publicClient, txHash);

  let returnData: any;
  if (waitEvent && eventName) {
    returnData = await waitEvent(chain, eventName, receipt.blockNumber);
  }

  let block: any;
  for (let i = 0; i < 3; i++) {
    try {
      block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      break;
    } catch (error) {
      if (i >= 2) {
        throw error;
      }
      await sleep(i * 2 * 1000);
    }
  }

  const date = new Date(Number(block.timestamp) * 1000);
  return {returnData, receipt, txHash, date: date.toLocaleString()};
}

async function waitForReceiptWithFallback(publicClient: any, txHash: `0x${string}`) {
  try {
    return await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: RECEIPT_WAIT_TIMEOUT_MS,
      pollingInterval: RECEIPT_POLL_INTERVAL_MS,
    });
  } catch (error) {
    if (!isReceiptTimeoutError(error)) {
      throw error;
    }

    try {
      return await publicClient.getTransactionReceipt({ hash: txHash });
    } catch {
      const timeoutError = new Error(
        `Timed out while waiting for transaction receipt for ${txHash}`,
      );
      timeoutError.name = 'WaitForTransactionReceiptTimeoutError';
      timeoutError.cause = error;
      throw timeoutError;
    }
  }
};

function isReceiptTimeoutError(error: any) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    name.includes('waitfortransactionreceipttimeouterror') ||
    message.includes('waitfortransactionreceipttimeouterror') ||
    message.includes('timed out while waiting for transaction')
  );
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function isWallet(address) {
  const client = createPublicClient({
    chain: availableNetworks[CHAIN_KEY].chain,
    transport: http(),
  });

  const wallet = getContract({
    address,
    abi: walletAbi,
    client: { public: client },
  });

  try {
    const response = await wallet.read.isThisASimpleAccountContract();
    return response;
  } catch (error) {
    return false;
  }
}

// Fetch user attestations from API
export async function fetchUserAttestations(userId) {
  const API_BASE_URL = 'http://192.168.1.16:3000/api/v1';

  try {
    const response = await fetch(
      `${API_BASE_URL}/user/${userId}/attestations`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    return {
      success: true,
      data: data,
    };
  } catch (error:any) {
    return {
      success: false,
      message: (error.message || 'Error al cargar los atestiguamientos')
    };
  }
}
