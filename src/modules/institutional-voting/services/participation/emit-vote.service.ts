import { ZkAuthService } from "@/modules/zk-auth/services/zk-auth.service";
import { AuthorizationResponseMessage } from "@iden3/js-iden3-auth/dist/types/types-sdk";
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { EnabledSession, EnabledSessionDocument } from "../../schemas/enabled-session.shcema";
import { Model, Types } from "mongoose";
import { VoteWritterService } from "../core/vote-writter.service";
import { VotingOption, VotingOptionDocument } from "../../schemas/voting-option.schema";
import { HistoryService } from "@/modules/history/services/history.service";
import { HistoryOperationKey, HistoryType } from "@/modules/history/dto/create-history.dto";
import { VoteReaderService } from "../core/vote-reader.service";
import { IssuerService } from "../core/issuer.service";
import { InstitutionalVotingAccessService } from "../core/institutional-voting-access.service";

@Injectable()
export class EmitVoteService {
  constructor(
    @InjectModel(EnabledSession.name)
    private readonly enabledSessionModel: Model<EnabledSessionDocument>,
    @InjectModel(VotingOption.name)
    private readonly votingOptionModel: Model<VotingOptionDocument>,
    private readonly zkAuthService: ZkAuthService,
    private readonly voteWritterService: VoteWritterService,
    private readonly historyService: HistoryService,
    private readonly voteReaderService: VoteReaderService,
    private readonly issuerService: IssuerService,
    private readonly accessService: InstitutionalVotingAccessService,
  ) {}

  async getVoteVc(eventId: string, dni: string): Promise<{ vc: string }> {
    const eventObjectId = new Types.ObjectId(eventId);
    const session = await this.enabledSessionModel.findOne({
      eventId: eventObjectId,
      dni,
    }).exec();
    if (session?.sessionToken) {
      return { vc: session.sessionToken };
    }

    const event = await this.accessService.getEventOrThrow(eventId);
    if (!event.isOpenVoting) {
      const isInVote = await this.voteReaderService.isDniInMerkleTree(eventId, dni);
      if (!isInVote) {
        throw new NotFoundException('No enabled session found for this user and event');
      }
    }

    const dids = await this.issuerService.getDidsByDnis([dni]);
    if (dids.length !== 1) {
      throw new NotFoundException({
        message: 'User not registered in app',
      });
    }

    const nullifiers = await this.voteWritterService.addNewVoters(1);
    const credentialData = await this.issuerService.issueCredential(
      dids,
      eventId,
      nullifiers,
    );

    if (!credentialData[dni]?.credentialData) {
      throw new NotFoundException({
        message: 'Failed to fin user VC',
      });
    }

    await this.enabledSessionModel.updateOne(
      { eventId: eventObjectId, dni },
      { $set: { sessionToken: credentialData[dni].credentialData } },
      { upsert: true },
    );

    return { vc: credentialData[dni].credentialData }
  }
  

  async emitVote(
    optionId: string,
    zkProof: string,
  ): Promise<AuthorizationResponseMessage> {
    const response = await this.zkAuthService.zkRequestCallback('vote', zkProof);

    const eventId = response.body.scope.find((scope) => scope.id === 1)?.vp?.verifiableCredential.credentialSubject.eventId.toString();
    const nullifier = response.body.scope.find((scope) => scope.id === 2)?.vp?.verifiableCredential.credentialSubject.nullifier.toString();
    if (!eventId || !nullifier) {
      throw new BadRequestException('data not found in ZK proof');
    }

    try {
      let receipt: {
        returnData: any;
        txHash: `0x${string}`;
        receipt: any;
        date: string;
      };

      if (optionId === 'blank') {
        receipt = await this.voteWritterService.castVote(eventId, 'BLANK', nullifier);
      } else {
        const option = await this.votingOptionModel.findById(optionId).exec();
        if (!option) {
          throw new NotFoundException('Voting option not found');
        }

        receipt = await this.voteWritterService.castVote(eventId, option.name, nullifier);
      }

      await this.historyService.create({
        txHash: receipt.txHash,
        operationName: HistoryOperationKey.castVote,
        type: HistoryType.AUTOMATED,
        registerDate: receipt.date,
        electionId: eventId
      });
    } catch (error: any) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      if (error?.message?.includes('Nullifier already used')) {
        throw new BadRequestException('This vote has already been cast');
      } else if (error?.message?.includes('TVDCredits: election has no credits')) {
        throw new ConflictException('Current election has no credits');
      } else {
        Logger.error('Error casting vote:', error);
        throw new InternalServerErrorException('An error occurred while casting the vote');
      }
    }

    return response;
  }

  async claimReward(
    recipient: `0x${string}`,
    zkProof: string,
  ) {
    const response = await this.zkAuthService.zkRequestCallback('reward', zkProof);

    const eventId = response.body.scope.find((scope) => scope.id === 1)?.vp?.verifiableCredential.credentialSubject.eventId.toString();
    const nullifier = response.body.scope.find((scope) => scope.id === 2)?.vp?.verifiableCredential.credentialSubject.nullifier.toString();
    if (!eventId || !nullifier) {
      throw new BadRequestException('data not found in ZK proof');
    }

    try {
      await this.voteWritterService.claimVoteReward(eventId, nullifier, recipient)
    } catch (error: any) {
      if (error?.message?.includes('Already rewarded')) {
        throw new BadRequestException('User has already claimed the reward');
      } else if (error?.message?.includes('Insufficient contract balance')) {
        throw new BadRequestException('Insufficient contract balance');
      } else if (error?.message?.includes('User has no voted yet')) {
        throw new BadRequestException('User has no voted yet');
      } else {
        Logger.error('Error casting vote:', error);
        throw new InternalServerErrorException('An error occurred while casting the vote');
      }
    }

    return response;
  }
}
