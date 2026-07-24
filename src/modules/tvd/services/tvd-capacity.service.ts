import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { formatUnits } from 'viem';
import { Model, Types } from 'mongoose';
import {
  PadronEntry,
  PadronEntryDocument,
} from '@/modules/institutional-voting/schemas/padron-entry.schema';
import {
  PadronImportJob,
  PadronImportJobDocument,
} from '@/modules/institutional-voting/schemas/padron-import-job.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '@/modules/institutional-voting/schemas/padron-version.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '@/modules/institutional-voting/schemas/voting-event.schema';
import {
  TvdCapacityReasonCode,
  TvdEstimatedCapacityResponseDto,
  TvdEventCapacityResponseDto,
} from '../dto/tvd-capacity.dto';
import { TvdBlockchainService } from './tvd-blockchain.service';
import { TvdQueryService } from './tvd-query.service';

const TOKENS_PER_PARTICIPANT = '1';
const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

type TvdCapacityRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

type ResolvedTvdBalance = {
  tenantId: string;
  walletAddress: string;
  availableSmallestUnit: bigint;
  availableTokens: string;
  decimals: number;
};

type ResolvedTvdWalletContext = {
  tenantId: string;
  walletAddress: string;
};

type CapacityVotingEvent = VotingEvent & {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
};

type CurrentPadronCapacityState = {
  participantCount: number;
  padronVersionId: string | null;
  reasonCode: TvdCapacityReasonCode;
};

type CapacityCalculation = {
  requiredSmallestUnit: bigint;
  requiredTokens: string;
  missingSmallestUnit: bigint;
  missingTokens: string;
  hasCapacity: boolean;
};

@Injectable()
export class TvdCapacityService {
  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(PadronImportJob.name)
    private readonly padronImportJobModel: Model<PadronImportJobDocument>,
    private readonly tvdQueries: TvdQueryService,
    private readonly blockchain: TvdBlockchainService,
  ) {}

  async estimateCapacity(
    estimatedParticipantsInput: string,
    requester: TvdCapacityRequester,
  ): Promise<TvdEstimatedCapacityResponseDto> {
    const estimatedParticipants = this.parsePositiveInteger(
      estimatedParticipantsInput,
      'estimatedParticipants',
    );
    const balance = await this.resolveCurrentWalletBalance(requester);
    const calculation = this.calculateCapacity(estimatedParticipants, balance);

    return {
      estimatedParticipants: estimatedParticipants.toString(),
      tokensPerParticipant: TOKENS_PER_PARTICIPANT,
      estimatedRequiredTokens: calculation.requiredTokens,
      estimatedRequiredSmallestUnit: calculation.requiredSmallestUnit.toString(),
      availableTokens: balance.availableTokens,
      availableSmallestUnit: balance.availableSmallestUnit.toString(),
      estimatedMissingTokens: calculation.missingTokens,
      estimatedMissingSmallestUnit: calculation.missingSmallestUnit.toString(),
      hasEstimatedCapacity: calculation.hasCapacity,
      reasonCode: calculation.hasCapacity ? null : 'INSUFFICIENT_TVD_BALANCE',
      balanceSource: 'BLOCKCHAIN',
      usableBalanceField: 'totalBalanceSmallestUnit',
      walletAddress: balance.walletAddress,
    };
  }

  async getEventCapacity(
    eventId: string,
    requester: TvdCapacityRequester,
  ): Promise<TvdEventCapacityResponseDto> {
    const event = await this.findEventOrThrow(eventId);
    const walletContext = await this.resolveCurrentWalletContext(requester);
    if (String(event.tenantId) !== walletContext.tenantId) {
      throw new NotFoundException({
        code: 'TVD_CAPACITY_EVENT_NOT_FOUND',
        message: 'Evento no encontrado',
      });
    }

    const balance = await this.readCurrentWalletBalance(walletContext);
    const padronState = await this.resolveCurrentPadronState(event);
    const calculation = this.calculateCapacity(
      BigInt(padronState.participantCount),
      balance,
    );
    const reasonCode = this.resolveDefinitiveReasonCode(
      padronState.reasonCode,
      calculation,
    );

    return {
      eventId: String(event._id),
      participantCount: padronState.participantCount,
      padronVersionId: padronState.padronVersionId,
      tokensPerParticipant: TOKENS_PER_PARTICIPANT,
      requiredTokens: calculation.requiredTokens,
      requiredSmallestUnit: calculation.requiredSmallestUnit.toString(),
      availableTokens: balance.availableTokens,
      availableSmallestUnit: balance.availableSmallestUnit.toString(),
      missingTokens: calculation.missingTokens,
      missingSmallestUnit: calculation.missingSmallestUnit.toString(),
      canPublish: reasonCode === null,
      reasonCode,
      balanceSource: 'BLOCKCHAIN',
      usableBalanceField: 'totalBalanceSmallestUnit',
      walletAddress: balance.walletAddress,
    };
  }

  private async findEventOrThrow(eventId: string) {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new BadRequestException({
        code: 'TVD_CAPACITY_EVENT_ID_INVALID',
        message: 'eventId invalido',
      });
    }
    const event = await this.votingEventModel
      .findById(eventId)
      .lean<CapacityVotingEvent | null>();
    if (!event) {
      throw new NotFoundException({
        code: 'TVD_CAPACITY_EVENT_NOT_FOUND',
        message: 'Evento no encontrado',
      });
    }
    return event;
  }

  private async resolveCurrentWalletBalance(
    requester: TvdCapacityRequester,
  ): Promise<ResolvedTvdBalance> {
    return this.readCurrentWalletBalance(
      await this.resolveCurrentWalletContext(requester),
    );
  }

  private async resolveCurrentWalletContext(
    requester: TvdCapacityRequester,
  ): Promise<ResolvedTvdWalletContext> {
    const walletContext = await this.tvdQueries.resolveMyInstitutionalWallet(
      requester,
    );

    return {
      tenantId: walletContext.tenantId,
      walletAddress: walletContext.wallet,
    };
  }

  private async readCurrentWalletBalance(
    walletContext: ResolvedTvdWalletContext,
  ): Promise<ResolvedTvdBalance> {
    try {
      const balance = await this.blockchain.getTotalBalance(
        walletContext.walletAddress,
      );
      const decimals = this.parseDecimals(balance.decimals);
      const availableSmallestUnit = this.parseNonNegativeInteger(
        balance.totalBalanceSmallestUnit,
        'totalBalanceSmallestUnit',
      );

      return {
        tenantId: walletContext.tenantId,
        walletAddress: walletContext.walletAddress,
        availableSmallestUnit,
        availableTokens: formatUnits(availableSmallestUnit, decimals),
        decimals,
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
        message: 'Saldo TVD temporalmente no disponible',
        errorCode: this.sanitizeTvdErrorCode(error),
      });
    }
  }

  private async resolveCurrentPadronState(
    event: CapacityVotingEvent,
  ): Promise<CurrentPadronCapacityState> {
    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    if (!currentVersion) {
      const activeDraft = await this.padronImportJobModel
        .findOne({ eventId: event._id, isActiveDraft: true })
        .sort({ createdAt: -1, _id: -1 })
        .lean();
      return {
        participantCount: 0,
        padronVersionId: null,
        reasonCode:
          activeDraft?.status === 'PROCESSING'
            ? 'PADRON_PROCESSING'
            : 'PADRON_NOT_FOUND',
      };
    }

    if (Number(currentVersion.totals?.invalidCount ?? 0) > 0) {
      return {
        participantCount: 0,
        padronVersionId: String(currentVersion._id),
        reasonCode: 'PADRON_INVALID',
      };
    }

    if (Number(currentVersion.totals?.validCount ?? 0) <= 0) {
      return {
        participantCount: 0,
        padronVersionId: String(currentVersion._id),
        reasonCode: 'PADRON_EMPTY',
      };
    }

    const participantCount = await this.padronEntryModel.countDocuments({
      padronVersionId: currentVersion._id,
      enabled: true,
    });

    return {
      participantCount,
      padronVersionId: String(currentVersion._id),
      reasonCode: participantCount > 0 ? null : 'PADRON_EMPTY',
    };
  }

  private calculateCapacity(
    participantCount: bigint,
    balance: ResolvedTvdBalance,
  ): CapacityCalculation {
    const tokenScale = 10n ** BigInt(balance.decimals);
    const requiredSmallestUnit = participantCount * tokenScale;
    const missingSmallestUnit =
      balance.availableSmallestUnit >= requiredSmallestUnit
        ? 0n
        : requiredSmallestUnit - balance.availableSmallestUnit;

    return {
      requiredSmallestUnit,
      requiredTokens: formatUnits(requiredSmallestUnit, balance.decimals),
      missingSmallestUnit,
      missingTokens: formatUnits(missingSmallestUnit, balance.decimals),
      hasCapacity: missingSmallestUnit === 0n,
    };
  }

  private resolveDefinitiveReasonCode(
    padronReasonCode: TvdCapacityReasonCode,
    calculation: CapacityCalculation,
  ): TvdCapacityReasonCode {
    if (padronReasonCode) return padronReasonCode;
    return calculation.hasCapacity ? null : 'INSUFFICIENT_TVD_BALANCE';
  }

  private parsePositiveInteger(value: string, fieldName: string) {
    const normalized = String(value ?? '').trim();
    if (!POSITIVE_INTEGER_REGEX.test(normalized)) {
      throw new BadRequestException({
        code: 'TVD_CAPACITY_INVALID_PARTICIPANTS',
        message: `${fieldName} debe ser un entero mayor que cero`,
      });
    }
    return BigInt(normalized);
  }

  private parseNonNegativeInteger(value: string, fieldName: string) {
    const normalized = String(value ?? '').trim();
    if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
      throw new Error(`${fieldName} invalido`);
    }
    return BigInt(normalized);
  }

  private parseDecimals(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 36) {
      throw new Error('TVD_DECIMALS invalido');
    }
    return value;
  }

  private sanitizeTvdErrorCode(error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
    ) {
      return error.code;
    }
    return 'TVD_BALANCE_READ_FAILED';
  }
}
