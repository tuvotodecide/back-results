import { availableNetworks } from "@/api/params";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, http } from "viem";
import { entryPoint07Address, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { VotingEventDocument } from "../../schemas/voting-event.schema";
import { VoteContractCalls } from "@/api/vote";
import { randomBytes } from 'crypto';
import { buildPoseidon } from 'circomlibjs';
import { MerkletreeService } from '@/modules/merkletree/services/merkletree.service';

@Injectable()
export class VoteWritterService {
  private readonly chain: string;
  private readonly pk: string;
  private smartAccountClient?: SmartAccountClient = undefined;
  private publicClient: any = undefined;
  private readonly RECEIPT_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
  private readonly RECEIPT_POLL_INTERVAL_MS = 2000;
  
  constructor(
    private readonly configService: ConfigService,
    private readonly merkletreeService: MerkletreeService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    this.pk = this.configService.get<string>('app.blockchain.privateKey')!;
    this.getAccount();
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

    let returnData: any;
    if (waitEvent && eventName) {
      returnData = await waitEvent(this.chain, eventName, receipt.blockNumber);
    }

    const block = await this.publicClient.getBlock({blockNumber: receipt.blockNumber});
    const date = new Date(Number(block.timestamp) * 1000);
    return {returnData, receipt, date: date.toLocaleString()};
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

  async createVote(event: VotingEventDocument, voters: string[], options: string[]) {
    const secrets = voters.map(() => {
      // Generate 32 bytes (256 bits)
      const buffer = randomBytes(32);
      // Convert to Hex string
      return '0x' + buffer.toString('hex');  
    });

    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    const ciHashes = voters.map(voter => 
      this.merkletreeService.stringToFieldElement(voter)
    )

    const voteHashes = secrets.map((secret, index) => {
      const secretInt = BigInt(secret);
      return F.toObject(poseidon([secretInt, ciHashes[index]])) as bigint;
    });

    const ciMerkleTree = await this.merkletreeService.buildMerkleTree(ciHashes);
    const voteMerkleTree = await this.merkletreeService.buildMerkleTree(voteHashes);

    // Copy options and add 'BLANK' as an additional option
    const optionsWithBlank = [...options];
    optionsWithBlank.push('BLANK');

    const callData = VoteContractCalls.createVote(
      this.chain,
      event._id.toString(),
      '',
      event.name,
      this.dateToUnixTimestamp(event.votingStart!),
      this.dateToUnixTimestamp(event.votingEnd!),
      this.dateToUnixTimestamp(event.resultsPublishAt!),
      voters.length,
      ciMerkleTree.root,
      voteMerkleTree.root,
      optionsWithBlank
    );

    await this.executeOperation(callData, undefined, undefined);

    await this.merkletreeService.create(event._id, 'ci', ciMerkleTree.layers);
    await this.merkletreeService.create(event._id, 'vote', voteMerkleTree.layers);
    return secrets;
  }

  async updateVoteSchedule(eventId: string, start: Date, end: Date, publishAt: Date) {
    const callData = VoteContractCalls.updateVoteSchedule(
      this.chain,
      eventId,
      this.dateToUnixTimestamp(start),
      this.dateToUnixTimestamp(end),
      this.dateToUnixTimestamp(publishAt)
    );

    await this.executeOperation(callData, undefined, undefined);
  }

  async castVote(eventId: string, optionId: string, nullifier: string) {
    const callData = VoteContractCalls.castVote(
      this.chain,
      eventId,
      optionId,
      nullifier
    );

    await this.executeOperation(callData, undefined, undefined);
  }

  async addNewVoters(eventId: string, count: number) {
    const newNullifiers = Array.from({ length: count }, () => {
      const uint32 = new Uint32Array(1);
      crypto.getRandomValues(uint32);
      return uint32[0].toString();
    });

    const callData = VoteContractCalls.addNewVoters(
      this.chain,
      eventId,
      newNullifiers
    );
    await this.executeOperation(callData, undefined, undefined);
    return newNullifiers;
  }

  async disableVote(eventId: string) {
    const callData = VoteContractCalls.disableVote(
      this.chain,
      eventId
    );
    await this.executeOperation(callData, undefined, undefined);
  }

  // Builds a fixed-depth Poseidon Merkle tree matching MerkleProof(levels) in
  // VoteRewardClaim.circom: leaf = voteHash directly (no extra leaf hash),
  async buildMerkleTree(leaves: bigint[] | number[], levels = 20) {
    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const hash2 = (a: bigint, b: bigint) => F.toObject(poseidon([a, b])) as bigint;

    const capacity = 1 << levels;
    if (leaves.length > capacity) {
      throw new Error(`depth ${levels} supports at most ${capacity} leaves`);
    }

    // Pad with zero leaves so every level is a complete binary tree.
    const layer0 = leaves
      .map((l: bigint | number) => BigInt(l))
      .concat(Array(capacity - leaves.length).fill(0n));

    const layers = [layer0];
    for (let level = 0; level < levels; level++) {
      const cur = layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(hash2(cur[i], cur[i + 1])); // hash(left, right)
      }
      layers.push(next);
    }

    const root = layers[levels][0];
    return root;
  }
}
