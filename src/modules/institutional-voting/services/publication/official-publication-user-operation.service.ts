import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http } from 'viem';
import { availableNetworks } from '@/api/params';

export type OfficialPublicationUserOperation = {
  sender: string;
  callData: string;
  nonce?: string;
};

export type OfficialPublicationUserOperationLookup = {
  userOperation: OfficialPublicationUserOperation;
  entryPoint?: string | null;
  transactionHash?: string | null;
  blockNumber?: string | null;
};

export type OfficialPublicationUserOperationReceipt = {
  userOpHash: string;
  sender?: string | null;
  entryPoint?: string | null;
  success: boolean;
  txHash: string;
  receipt: {
    transactionHash: string;
    status: string | number | bigint;
    blockNumber: string | number | bigint;
    logs: Array<{
      address: string;
      topics: string[];
      data: string;
    }>;
  };
};

@Injectable()
export class OfficialPublicationUserOperationService {
  private readonly chainKey: string;
  private readonly bundlerUrl: string;
  private readonly rpcUrl: string;
  private readonly publicClient: any;

  constructor(private readonly configService: ConfigService) {
    this.chainKey = this.configService.get<string>('app.blockchain.chain') || 'base-sepolia';
    const network = availableNetworks[this.chainKey];
    this.bundlerUrl = network?.bundler || '';
    this.rpcUrl = this.configService.get<string>('app.tvd.rpcUrl') || '';
    this.publicClient = network
      ? createPublicClient({
          chain: network.chain,
          transport: http(this.rpcUrl || this.bundlerUrl || undefined),
        })
      : null;
  }

  async getUserOperationByHash(
    userOpHash: string,
  ): Promise<OfficialPublicationUserOperationLookup | null> {
    return this.requestBundler('eth_getUserOperationByHash', [userOpHash]);
  }

  async getUserOperationReceipt(
    userOpHash: string,
  ): Promise<OfficialPublicationUserOperationReceipt | null> {
    return this.requestBundler('eth_getUserOperationReceipt', [userOpHash]);
  }

  async getTransactionReceipt(txHash: string) {
    if (this.publicClient) {
      return this.publicClient.getTransactionReceipt({ hash: txHash });
    }
    return this.requestBundler('eth_getTransactionReceipt', [txHash]);
  }

  async getBlockNumber(): Promise<bigint> {
    if (this.publicClient) {
      return this.publicClient.getBlockNumber();
    }
    const block = await this.requestBundler('eth_blockNumber', []);
    return BigInt(block);
  }

  private async requestBundler(method: string, params: unknown[]) {
    if (!this.bundlerUrl) {
      throw new Error('OFFICIAL_PUBLICATION_BUNDLER_NOT_CONFIGURED');
    }
    const response = await fetch(this.bundlerUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(payload.error?.message || `RPC ${method} failed`);
    }
    return payload?.result ?? null;
  }
}
