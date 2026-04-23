import { ZkAuthService } from "@/modules/zk-auth/services/zk-auth.service";
import { AuthorizationResponseMessage } from "@iden3/js-iden3-auth/dist/types/types-sdk";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { EnabledSession, EnabledSessionDocument } from "../../schemas/enabled-session.shcema";
import { Model, Types, isValidObjectId } from "mongoose";
import { VoteWritterService } from "../core/vote-writter.service";
import { VotingOption, VotingOptionDocument } from "../../schemas/voting-option.schema";

@Injectable()
export class EmitVoteService {
  constructor(
    @InjectModel(EnabledSession.name)
    private readonly enabledSessionModel: Model<EnabledSessionDocument>,
    @InjectModel(VotingOption.name)
    private readonly votingOptionModel: Model<VotingOptionDocument>,
    private readonly zkAuthService: ZkAuthService,
    private readonly voteWritterService: VoteWritterService,
  ) {}

  async getVoteVc(eventId: string, dni: string): Promise<{ vc: string }> {
    const eventObjectId = new Types.ObjectId(eventId);
    const session = await this.enabledSessionModel.findOne({
      eventId: eventObjectId,
      dni,
    }).exec();
    if (!session) {
      throw new NotFoundException('No enabled session found for this user and event');
    }
    return { vc: session.sessionToken };
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

    const option = await this.votingOptionModel.findById(optionId).exec();
    if (!option) {
      throw new NotFoundException('Voting option not found');
    }

    await this.voteWritterService.castVote(eventId, option.name, nullifier);

    return response;
  }
}
