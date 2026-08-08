import { votingContractAbi } from "@/api/contracts/VoteContract";
import { availableNetworks } from "@/api/params";
import { VoteContractUtils } from "@/api/vote";
import { MerkletreeService } from "@/modules/merkletree/services/merkletree.service";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";
import { Types } from "mongoose";

@Injectable()
export class VoteReaderService {
  private readonly chain: string;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly vote: ethers.Contract;

  constructor(
    private readonly configService: ConfigService,
    private readonly merkletreeService: MerkletreeService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    const { voteContract, bundler } = availableNetworks[this.chain];

    this.provider = new ethers.JsonRpcProvider(bundler);
    this.vote = new ethers.Contract(
      voteContract,
      votingContractAbi,
      this.provider,
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

  async isDniInMerkleTree(eventId: string, dni: string): Promise<boolean> {
    const voteMerkleRoot = (await this.vote.getVoteInfo(VoteContractUtils.idToHex(eventId)))[5];
    return this.merkletreeService.isValueInTree(new Types.ObjectId(eventId), dni, BigInt(voteMerkleRoot));
  }
}