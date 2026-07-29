import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

const POSITIVE_INTEGER_REGEX = /^[1-9]\d*$/;

export class TvdEstimatedCapacityRequestDto {
  @ApiProperty({
    description:
      'Cantidad estimada de participantes ingresada por el administrador institucional. Es informativa y no reemplaza el conteo real del padrón.',
    example: '100',
  })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Matches(POSITIVE_INTEGER_REGEX, {
    message: 'estimatedParticipants debe ser un entero mayor que cero',
  })
  estimatedParticipants!: string;
}

export class TvdEventCapacityQueryDto {}

export type TvdCapacityReasonCode =
  | 'INSUFFICIENT_TVD_BALANCE'
  | 'PADRON_NOT_FOUND'
  | 'PADRON_NOT_READY'
  | 'PADRON_PROCESSING'
  | 'PADRON_INVALID'
  | 'PADRON_EMPTY'
  | null;

export type TvdPublicationReadiness =
  | 'PUBLICATION_BALANCE_INSUFFICIENT'
  | 'PUBLICATION_PADRON_BLOCKED'
  | 'PUBLICATION_READY';

export type TvdEstimatedCapacityResponseDto = {
  estimatedParticipants: string;
  tokensPerParticipant: string;
  estimatedRequiredTokens: string;
  estimatedRequiredSmallestUnit: string;
  availableTokens: string;
  availableSmallestUnit: string;
  estimatedMissingTokens: string;
  estimatedMissingSmallestUnit: string;
  hasEstimatedCapacity: boolean;
  reasonCode: TvdCapacityReasonCode;
  balanceSource: 'BLOCKCHAIN';
  usableBalanceField: 'liquidBalanceSmallestUnit';
  walletAddress: string;
};

export type TvdEventCapacityResponseDto = {
  eventId: string;
  participantCount: number;
  padronVersionId: string | null;
  tokensPerParticipant: string;
  requiredTokens: string;
  requiredSmallestUnit: string;
  availableTokens: string;
  availableSmallestUnit: string;
  missingTokens: string;
  missingSmallestUnit: string;
  canPublish: boolean;
  reasonCode: TvdCapacityReasonCode;
  publicationReadiness: TvdPublicationReadiness;
  balanceSource: 'BLOCKCHAIN';
  usableBalanceField: 'liquidBalanceSmallestUnit';
  walletAddress: string;
};
