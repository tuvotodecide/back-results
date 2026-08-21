import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateParticipationDto } from '../../dto/participation.dto';
import {
  ComparisonReport,
  ComparisonReportDocument,
} from '../../schemas/comparison-report.schema';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '../../schemas/padron-version.schema';
import {
  Participation,
  ParticipationDocument,
} from '../../schemas/participation.schema';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { VoteReaderService } from '../core/vote-reader.service';

@Injectable()
export class ParticipationService {
  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    @InjectModel(Participation.name)
    private readonly participationModel: Model<ParticipationDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly voteReaderService: VoteReaderService,
  ) {}

  async createParticipation(
    eventId: string,
    dto: CreateParticipationDto,
    idempotencyKey?: string,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    const carnetNorm = normalizeCarnet(dto.carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    if (idempotencyKey) {
      const existingByKey = await this.participationModel
        .findOne({ eventId: event._id, carnetNorm, idempotencyKey })
        .lean();

      if (existingByKey) {
        if (this.hasEquivalentPayload(existingByKey, dto)) {
          return this.reusedParticipation(existingByKey);
        }
        throw new ConflictException('Idempotency-Key ya fue usada con datos incompatibles');
      }
    }

    const status = await this.resolveParticipationStatus(eventId, carnetNorm);
    if (status.status === 'ALREADY_VOTED') {
      if (idempotencyKey) {
        const existingByKey = await this.participationModel
          .findOne({ eventId: event._id, carnetNorm, idempotencyKey })
          .lean();

        if (existingByKey && this.hasEquivalentPayload(existingByKey, dto)) {
          return this.reusedParticipation(existingByKey);
        }
      }
      throw new ConflictException('Ya participaste en este evento');
    }

    if (status.status !== 'CAN_VOTE' && status.status !== 'CREDITS_EMPTY') {
      throw new ForbiddenException({ error: status.status });
    }

    try {
      const created = await this.participationModel.create({
        eventId: event._id,
        carnetNorm,
        idempotencyKey,
        presentialSessionId: dto.presentialSessionId,
        participatedAt: new Date(),
      });

      return {
        statusCode: 201,
        created: true,
        reused: false,
        body: {
          id: String(created._id),
          participated: true,
          participatedAt: created.participatedAt,
        },
      };
    } catch (error: any) {
      if (error?.code === 11000 && idempotencyKey) {
        const existing = await this.participationModel
          .findOne({ eventId: event._id, carnetNorm, idempotencyKey })
          .lean();

        if (existing && this.hasEquivalentPayload(existing, dto)) {
          return this.reusedParticipation(existing);
        }
      }
      if (error?.code === 11000) {
        throw new ConflictException('Ya participaste en este evento');
      }
      throw error;
    }
  }

  private hasEquivalentPayload(
    participation: { presentialSessionId?: Types.ObjectId | string },
    dto: CreateParticipationDto,
  ) {
    return String(participation.presentialSessionId ?? '')
      === String(dto.presentialSessionId ?? '');
  }

  private reusedParticipation(participation: { _id: unknown; participatedAt: Date }) {
    return {
      statusCode: 200,
      created: false,
      reused: true,
      body: {
        id: String(participation._id),
        participated: true,
        participatedAt: participation.participatedAt,
      },
    };
  }

  async checkParticipationStatus(eventId: string, carnet: string) {
    const normalized = normalizeCarnet(carnet);
    if (!normalized) {
      throw new BadRequestException('carnet inválido');
    }

    return this.resolveParticipationStatus(eventId, normalized);
  }

  async checkPublicParticipation(eventId: string, carnet: string) {
    const carnetNorm = normalizeCarnet(carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    const event = await this.accessService.getEventOrThrow(eventId);
    const existing = await this.participationModel
      .findOne({ eventId: event._id, carnetNorm }, { _id: 1 })
      .lean();

    return {
      eventId: String(event._id),
      participated: Boolean(existing),
    };
  }

  async listParticipationHistoryByCarnet(carnet: string) {
    const carnetNorm = normalizeCarnet(carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet inválido');
    }

    const rows = await this.participationModel
      .aggregate([
        { $match: { carnetNorm } },
        { $sort: { participatedAt: -1, _id: -1 } },
        {
          $lookup: {
            from: 'voting_events',
            localField: 'eventId',
            foreignField: '_id',
            as: 'event',
          },
        },
        { $unwind: { path: '$event', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'institutional_tenants',
            localField: 'event.tenantId',
            foreignField: '_id',
            as: 'tenant',
          },
        },
        { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            eventId: 1,
            participatedAt: 1,
            title: '$event.name',
            institutionName: '$tenant.name',
          },
        },
      ])
      .exec();

    return rows.map((row) => ({
      id: String(row._id),
      type: 'vote_participation',
      eventId: String(row.eventId ?? ''),
      title: row.title || 'Votación institucional',
      institutionName: row.institutionName || null,
      participatedAt: row.participatedAt,
    }));
  }

  private async resolveParticipationStatus(eventId: string, carnetNorm: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    let outsideVotingWindow = false;

    if (!['OFFICIALLY_PUBLISHED', 'PUBLISHED', 'RESULTS_PUBLISHED'].includes(event.state)) {
      return { status: 'EVENT_NOT_PUBLISHED', canVote: false, alreadyVoted: false };
    }

    const now = new Date();
    if (!event.votingStart || !event.votingEnd || now < event.votingStart || now > event.votingEnd) {
      outsideVotingWindow = true;
    }

    if (!event.isOpenVoting) {
      const currentVersion = await this.padronVersionModel
        .findOne({ eventId: event._id, isCurrent: true })
        .lean();

      if (!currentVersion) {
        return { status: 'PADRON_NOT_AVAILABLE', canVote: false, alreadyVoted: false };
      }

      const reportOk = await this.comparisonReportModel.exists({
        padronVersionId: currentVersion._id,
        status: 'OK',
      });
      if (!reportOk) {
        return { status: 'ROLL_IN_VALIDATION', canVote: false, alreadyVoted: false };
      }

      const inPadron = await this.padronEntryModel.findOne({
        padronVersionId: currentVersion._id,
        carnetNorm,
      }, { enabled: 1 }).lean();
      if (!inPadron) {
        return { status: 'NOT_IN_ROLL', canVote: false, alreadyVoted: false };
      }

      if (inPadron.enabled === false) {
        return { status: 'VOTER_DISABLED', canVote: false, alreadyVoted: false };
      }
    }

    const existing = await this.participationModel
      .findOne({ eventId: event._id, carnetNorm })
      .lean();

    if (existing) {
      return {
        status: outsideVotingWindow ? 'OUTSIDE_VOTING_WINDOW' : 'ALREADY_VOTED',
        canVote: false,
        alreadyVoted: true,
        participationId: String(existing._id),
        participatedAt: existing.participatedAt,
      };
    }

    if (outsideVotingWindow) {
      return { status: 'OUTSIDE_VOTING_WINDOW', canVote: false, alreadyVoted: false };
    }

    const electionStatus = await this.voteReaderService.getElectionStatus(eventId);
    if (BigInt(electionStatus.creditBalance) <= 0n) {
      return { status: 'CREDITS_EMPTY', canVote: false, alreadyVoted: false };
    }

    return { status: 'CAN_VOTE', canVote: true, alreadyVoted: false };
  }
}
