import { availableNetworks } from "@/api/params";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, getContract, Hex, http } from "viem";
import { entryPoint07Address, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import contractAbi from "@/abi/incentiveCampaigns.json";
import { IncentiveCampaignCalls } from "@/api/incentiveCampaigns";

@Injectable()
export class IncentiveCampaignsService {
  private readonly chain: string;
  private readonly pk: string;
  private readonly contractAddress: Hex;
  private smartAccountClient?: SmartAccountClient = undefined;
  private publicClient: any = undefined;
  private readContract: any = undefined;
  private readonly RECEIPT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
  private readonly RECEIPT_POLL_INTERVAL_MS = 2000;
  
  constructor(
    private readonly configService: ConfigService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    this.pk = this.configService.get<string>('app.blockchain.privateKey')!;
    this.contractAddress = this.configService.get<string>('app.contracts.incentiveCampaigns.address')! as Hex;
    this.getAccount();
    this.getReadContract();
  }

  async getAccount() {
    const privateKey = this.pk;
    const {chain: chainConfig, bundler} = availableNetworks[this.chain];

    this.publicClient = createPublicClient({
      chain: chainConfig,
      transport: http(bundler),
    });

    const account = await toCoinbaseSmartAccount({
      client: this.publicClient,
      owners: [privateKeyToAccount(privateKey as `0x${string}`)],
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

    this.smartAccountClient = createSmartAccountClient({
      account,
      chain: chainConfig,
      bundlerTransport: http(bundler),
      paymaster: pimlicoClient,
    });
  }

  async getReadContract() {
    const { bundler, chain } = availableNetworks[this.chain];
  
    const publicClient = createPublicClient({
      chain,
      transport: http(bundler),
    });
  
    this.readContract = getContract({
      address: this.contractAddress,
      abi: contractAbi,
      client: {public: publicClient},
    });
  }

  async executeOperation(
    callData: any,
    waitEvent: ((chainId: string, eventName: string, fromBlock: number) => Promise<any>) | undefined,
    eventName: string | undefined,
  ) {
    if (!this.smartAccountClient) {
      throw new Error('SmartAccountClient not initialized, call getAccount() first.');
    }

    const txHash = await this.smartAccountClient.sendTransaction(callData);
    const receipt = await this.waitForReceiptWithFallback(txHash);
    if (String(receipt?.status || '').toLowerCase() === 'reverted') {
      throw new Error(`Transaction ${txHash} reverted`);
    }

    let returnData: any;
    if (waitEvent && eventName) {
      returnData = await waitEvent(this.chain, eventName, receipt.blockNumber);
    }

    let block: any;
    for (let i = 0; i < 3; i++) {
      try {
        block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });
        break;
      } catch (error) {
        console.log('Fail get block in index: ' + i);
        if (i >= 2) {
          throw error;
        }
        await this.sleep(i * 2 * 1000);
      }
    }

    const date = new Date(Number(block.timestamp) * 1000);
    return {returnData, txHash, receipt, date: date.toISOString()};
  }

  async waitForReceiptWithFallback(txHash: `0x${string}`) {
    try {
      return await this.publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: this.RECEIPT_WAIT_TIMEOUT_MS,
        pollingInterval: this.RECEIPT_POLL_INTERVAL_MS,
      });
    } catch (error) {
      if (!this.isReceiptTimeoutError(error)) {
        throw error;
      }

      try {
        return await this.publicClient.getTransactionReceipt({ hash: txHash });
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

  sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  isReceiptTimeoutError(error: any) {
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    return (
      name.includes('waitfortransactionreceipttimeouterror') ||
      message.includes('waitfortransactionreceipttimeouterror') ||
      message.includes('timed out while waiting for transaction')
    );
  };

  dateToUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  async giveIncentive(recipient: Hex) {
    const callData = IncentiveCampaignCalls.giveIncentive(
      this.contractAddress,
      recipient
    );

    return this.executeOperation(callData, undefined, undefined);
  }

  isAlreadyReceivedError(error: any) {
    return error.message?.includes('TVDIncentive: already received');
  }

  isUngrantableError(error: any) {
    return error.message?.includes('TVDIncentive: campaign has been refunded')
      || error.message?.includes('TVDIncentive: campaign is paused')
      || error.message?.includes('TVDIncentive: campaign grant window is not active')
      || error.message?.includes('TVDIncentive: max wallets reached');
  }
}