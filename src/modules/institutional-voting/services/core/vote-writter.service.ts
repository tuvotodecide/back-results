import { availableNetworks } from "@/api/params";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createPublicClient, Hex, http } from "viem";
import { entryPoint07Address, toCoinbaseSmartAccount } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { VotingEventDocument } from "../../schemas/voting-event.schema";
import { VoteContractCalls, VoteContractReads, VoteContractUtils } from "@/api/vote";
import { randomBytes } from 'crypto';
import { buildPoseidon } from 'circomlibjs';
import { MerkletreeService } from '@/modules/merkletree/services/merkletree.service';

export type PreparedVotePublication = {
  secrets: string[];
  ciMerkleTree: { root: bigint; layers: bigint[][] };
  optionsWithBlank: string[];
  callData: {
    to: string;
    value: bigint;
    data: `0x${string}`;
  };
  createVoteArgs: readonly unknown[];
  onChainElectionId: bigint;
};

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
        if (i >= 2) {
          throw error;
        }
        await this.sleep(i * 2 * 1000);
      }
    }

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

  async prepareCreateVote(
    event: VotingEventDocument,
    institutionId: string,
    voters: string[],
    options: string[],
  ): Promise<PreparedVotePublication> {
    const secrets = voters.map(() => {
      // Generate 32 bytes (256 bits)
      const buffer = randomBytes(32);
      // Convert to Hex string
      return '0x' + buffer.toString('hex');  
    });

    const ciHashes = voters.map(voter => 
      this.merkletreeService.stringToFieldElement(voter)
    );

    const ciMerkleTree = await this.merkletreeService.buildMerkleTree(ciHashes);

    // Copy options and add 'BLANK' as an additional option
    const optionsWithBlank = [...options];
    optionsWithBlank.push('BLANK');

    const onChainElectionId = BigInt(`0x${event._id.toString()}`);
    const createVoteArgs = [
      onChainElectionId,
      institutionId,
      event.name,
      this.dateToUnixTimestamp(event.votingStart!),
      this.dateToUnixTimestamp(event.votingEnd!),
      this.dateToUnixTimestamp(event.resultsPublishAt!),
      voters.length,
      ciMerkleTree.root,
      optionsWithBlank,
    ] as const;

    const callData = VoteContractCalls.createVote(
      this.chain,
      event._id.toString(),
      institutionId,
      event.name,
      this.dateToUnixTimestamp(event.votingStart!),
      this.dateToUnixTimestamp(event.votingEnd!),
      this.dateToUnixTimestamp(event.resultsPublishAt!),
      voters.length,
      ciMerkleTree.root,
      optionsWithBlank
    );

    return {
      secrets,
      ciMerkleTree,
      optionsWithBlank,
      callData,
      createVoteArgs,
      onChainElectionId,
    };
  }

  async executePreparedCreateVote(
    event: VotingEventDocument,
    prepared: PreparedVotePublication,
  ) {
    await this.executeOperation(prepared.callData, undefined, undefined);

    await this.persistPreparedMerkleTrees(event, prepared);
    return prepared.secrets;
  }

  async persistPreparedMerkleTrees(
    event: VotingEventDocument,
    prepared: Pick<PreparedVotePublication, 'ciMerkleTree'>,
  ) {
    await this.merkletreeService.createIfMissing(event._id, prepared.ciMerkleTree.layers);
  }

  async createVote(event: VotingEventDocument, institutionId: string, voters: string[], options: string[]) {
    const prepared = await this.prepareCreateVote(event, institutionId, voters, options);
    return this.executePreparedCreateVote(event, prepared);
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

  async castVote(
    eventId: string,
    optionId: string,
    secret: string,
  ) {
    const voteNullfier = await VoteContractUtils.getVoteHash(eventId, secret);
    const expectedVoteId = VoteContractUtils.idToHex(eventId);
    const callData = VoteContractCalls.castVote(
      this.chain,
      eventId,
      optionId,
      voteNullfier,
    );

    await this.executeOperation(
      callData,
      async (chainId, eventName, fromBlock) => {
        const events = await VoteContractReads.getVotedEvents(chainId, fromBlock);
        const matchingEvent = (Array.isArray(events) ? events : []).find((event: any) => {
          if (String(event?.eventName || eventName) !== eventName) {
            return false;
          }
          if (event?.args?.voteId === undefined || event?.args?.voteId === null) {
            return false;
          }
          return BigInt(event.args.voteId) === expectedVoteId;
        });

        if (!matchingEvent) {
          throw new Error(`Expected Voted event for vote ${eventId} was not found`);
        }

        return matchingEvent;
      },
      'Voted',
    );
  }

  async disableVote(eventId: string) {
    const callData = VoteContractCalls.disableVote(
      this.chain,
      eventId
    );
    await this.executeOperation(callData, undefined, undefined);
  }

  async addNewVoters(count: number) {
    const newNullifiers = Array.from({ length: count }, () => {
      const buffer = randomBytes(32);
      return '0x' + buffer.toString('hex');  
    });

    return newNullifiers;
  }

  async claimVoteReward(eventId: string, secret: string, recipient: Hex) {
    const voteHash = await VoteContractUtils.getVoteHash(eventId, secret);
    const hasVoted = await VoteContractReads.getHashVoted(this.chain, eventId, voteHash);

    if(!hasVoted) {
      throw new Error('User has no voted yet');
    }

    const rewardHash = await VoteContractUtils.getRewardHash(eventId, secret);
    const callData = VoteContractCalls.claimVoteReward(
      this.chain,
      eventId,
      rewardHash,
      recipient
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
