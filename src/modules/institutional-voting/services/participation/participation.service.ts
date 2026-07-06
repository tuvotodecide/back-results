import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
        return {
          statusCode: 200,
          body: {
            id: String(existingByKey._id),
            participated: true,
            participatedAt: existingByKey.participatedAt,
          },
        };
      }
    }

    const status = await this.resolveParticipationStatus(eventId, carnetNorm);
    if (status.status === 'ALREADY_VOTED') {
      throw new ConflictException('Ya participaste en este evento');
    }
    if (status.status !== 'CAN_VOTE') {
      throw new ForbiddenException({ error: status.status });
    }

    try {
      const created = await this.participationModel.create({
        eventId: event._id,
        carnetNorm,
        idempotencyKey,
        participatedAt: new Date(),
      });

      return {
        statusCode: 201,
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

        if (existing) {
          return {
            statusCode: 200,
            body: {
              id: String(existing._id),
              participated: true,
              participatedAt: existing.participatedAt,
            },
          };
        }
      }
      if (error?.code === 11000) {
        throw new ConflictException('Ya participaste en este evento');
      }
      throw error;
    }
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

    return {
      status: outsideVotingWindow ? 'OUTSIDE_VOTING_WINDOW' : 'CAN_VOTE',
      canVote: !outsideVotingWindow,
      alreadyVoted: false,
    };
  }
}
