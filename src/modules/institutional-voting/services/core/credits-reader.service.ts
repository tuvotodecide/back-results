import contractAbi from "@/abi/electoralCredits.json";
import { availableNetworks } from "@/api/params";
import { VoteContractUtils } from "@/api/vote";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ethers } from "ethers";

@Injectable()
export class CreditsReaderService {
  private readonly chain: string;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly contract: ethers.Contract;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.chain = this.configService.get<string>('app.blockchain.chain')!;
    const contractAddress = this.configService.get<string>('app.contracts.electoralCredits.address')!;
    const { bundler } = availableNetworks[this.chain];

    this.provider = new ethers.JsonRpcProvider(bundler);
    this.contract = new ethers.Contract(
      contractAddress,
      contractAbi,
      this.provider,
    );
  }

  async getElection(voteEventId: string) {
    const electionData = await this.contract.getElection(VoteContractUtils.idToHex(voteEventId));

    return {
      institution: electionData.institution as string,
      creditBalance: electionData.creditBalance.toString(),
      lockedTVD: electionData.lockedTVD.toString(),
      pendingTVD: electionData.pendingTVD.toString(),
      startCreditBalance: electionData.startCreditBalance.toString(),
      startLockedTVD: electionData.startLockedTVD.toString(),
      liquidated: electionData.liquidated as boolean,
      burnedTVD: electionData.burnedTVD.toString(),
      consumedTVD: electionData.consumedTVD.toString(),
      refundedTVD: electionData.refundedTVD.toString(),
    };
  }
}