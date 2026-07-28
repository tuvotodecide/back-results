import { votingContractAbi } from "@/api/contracts/VoteContract";
import { availableNetworks } from "@/api/params";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";

@Injectable()
export class VoteReaderService {
  private readonly chain: string;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly vote: ethers.Contract;

  constructor(
    private readonly configService: ConfigService,
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
    const rawResults = await this.vote.getVoteResults(BigInt('0x' + voteEventId));
    const [ options, votes ] = rawResults;

    const results = options.map((option: string, index: number) => ({
      option,
      votes: votes[index].toString(),
    }));

    return results;
  }
}