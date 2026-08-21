import { votingContractAbi } from "@/api/contracts/VoteContract";
import { availableNetworks } from "@/api/params";
import { VoteContractUtils } from "@/api/vote";
import { MerkletreeService } from "@/modules/merkletree/services/merkletree.service";
import { TVD_ELECTORAL_CREDITS_ABI } from "@/modules/tvd/contracts/tvd-abis";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { Types } from "mongoose";

@Injectable()
export class VoteReaderService {
  private readonly chain: string;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly vote: ethers.Contract;
  private readonly electoralCredits: ethers.Contract;

  constructor(
    private readonly configService: ConfigService,
    private readonly merkletreeService: MerkletreeService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    const electoralCreditsAddr = this.configService.get<string>('app.contracts.electoralCredits.address')!;
    const { voteContract, bundler } = availableNetworks[this.chain];

    this.provider = new ethers.JsonRpcProvider(bundler);
    this.vote = new ethers.Contract(
      voteContract,
      votingContractAbi,
      this.provider,
    );
    this.electoralCredits = new ethers.Contract(
      electoralCreditsAddr,
      TVD_ELECTORAL_CREDITS_ABI,
      this.provider
    );
  }

  async getResults(voteEventId: string) {
    const rawResults = await this.vote.getVoteResults(VoteContractUtils.idToHex(voteEventId));
    const [ options, votes ] = rawResults;

    const results = options.map((option: string, index: number) => ({
      option,
      votes: votes[index].toString(),
    }));

    return results;
  }

  async getElectionStatus(voteEventId: string) {
    const rawResults = await this.electoralCredits.getElection(VoteContractUtils.idToHex(voteEventId));
    return {
      institution: rawResults.institution,
      creditBalance: rawResults.creditBalance.toString(),
      lockedTVD: rawResults.lockedTVD.toString(),
      pendingTVD: rawResults.pendingTVD.toString(),
      startCreditBalance: rawResults.startCreditBalance.toString(),
      startLockedTVD: rawResults.startLockedTVD.toString(),
      liquidated: rawResults.liquidated,
      burnedTVD: rawResults.burnedTVD.toString(),
      consumedTVD: rawResults.consumedTVD.toString(),
      refundedTVD: rawResults.refundedTVD.toString(),
    };
  }

  async isDniInMerkleTree(eventId: string, dni: string): Promise<boolean> {
    const voteMerkleRoot = (await this.vote.getVoteInfo(VoteContractUtils.idToHex(eventId)))[5];
    return this.merkletreeService.isValueInTree(new Types.ObjectId(eventId), dni, BigInt(voteMerkleRoot));
  }
}