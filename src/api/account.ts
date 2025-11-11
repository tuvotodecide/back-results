import { Address, createPublicClient, getContract, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  availableNetworks,
  FACTORY_ADDRESS as RAW_FACTORY_ADDRESS,
  sponsorshipPolicyId,
} from './params';
import { entryPoint07Address } from 'viem/account-abstraction';
import { toSimpleSmartAccount } from 'permissionless/accounts';

import walletAbi from './contracts/SimpleAccount.json';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createSmartAccountClient } from 'permissionless';

if (!RAW_FACTORY_ADDRESS) {
  throw new Error('FACTORY_ADDRESS no está configurado');
}
const FACTORY_ADDR = RAW_FACTORY_ADDRESS as Address;
const CHAIN_KEY = (
  process.env.CHAINA ) as keyof typeof availableNetworks;

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
    factoryAddress: FACTORY_ADDR,
    owner,
    entryPoint: { address: entryPoint07Address, version: '0.7' },
  });

  return { account, publicClient };
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
  } catch (error) {
    return {
      success: false,
      message: error.message || 'Error al cargar los atestiguamientos',
    };
  }
}
