import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const HASH_32_BYTES_REGEX = /^0x[a-fA-F0-9]{64}$/;

export enum OfficialPublicationRejectReasonCode {
  USER_REJECTED = 'USER_REJECTED',
  USER_CANCELLED = 'USER_CANCELLED',
  REQUEST_REPLACED = 'REQUEST_REPLACED',
}

export class OfficialPublicationClaimDto {
  @ApiProperty({
    description: 'Identificador local estable del dispositivo que reclama la solicitud.',
    maxLength: 128,
  })
  @IsString()
  @MaxLength(128)
  @Matches(/\S/, { message: 'deviceId no puede estar vacio' })
  deviceId!: string;
}

export class OfficialPublicationSigningDto extends OfficialPublicationClaimDto {}

export class OfficialPublicationRejectDto extends OfficialPublicationClaimDto {
  @ApiProperty({
    enum: OfficialPublicationRejectReasonCode,
    description: 'Motivo seguro de rechazo seleccionado por la app.',
  })
  @IsEnum(OfficialPublicationRejectReasonCode)
  reasonCode!: OfficialPublicationRejectReasonCode;
}

export class OfficialPublicationSubmissionDto extends OfficialPublicationClaimDto {
  @ApiProperty({
    description: 'Hash de UserOperation enviado por la app.',
    example: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  })
  @IsString()
  @Matches(HASH_32_BYTES_REGEX, {
    message: 'userOpHash debe ser un hash hexadecimal de 32 bytes',
  })
  userOpHash!: string;

  @ApiPropertyOptional({
    description: 'Hash de transaccion, si el proveedor lo entrega durante el envio.',
    example: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  })
  @IsOptional()
  @IsString()
  @Matches(HASH_32_BYTES_REGEX, {
    message: 'txHash debe ser un hash hexadecimal de 32 bytes',
  })
  txHash?: string;
}

export class OfficialPublicationCancelDto {
  @ApiPropertyOptional({
    enum: OfficialPublicationRejectReasonCode,
    description: 'Motivo seguro opcional de cancelacion administrativa.',
  })
  @IsOptional()
  @IsEnum(OfficialPublicationRejectReasonCode)
  reasonCode?: OfficialPublicationRejectReasonCode;
}

export class OfficialPublicationRequestSummaryDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  votersCount!: string;

  @ApiProperty()
  requiredCredits!: string;

  @ApiProperty()
  requiredTvd!: string;

  @ApiProperty()
  tvdPerCredit!: string;

  @ApiProperty()
  signerWallet!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OfficialPublicationAdminResponseDto {
  @ApiPropertyOptional()
  created?: boolean;

  @ApiProperty({ type: OfficialPublicationRequestSummaryDto, nullable: true })
  request!: OfficialPublicationRequestSummaryDto | null;
}

export class OfficialPublicationMobileSummaryResponseDto extends OfficialPublicationRequestSummaryDto {
  @ApiProperty()
  eventName!: string;

  @ApiProperty()
  institutionName!: string;

  @ApiPropertyOptional()
  votingStart?: string | null;

  @ApiPropertyOptional()
  votingEnd?: string | null;

  @ApiPropertyOptional()
  resultsPublishAt?: string | null;

  @ApiPropertyOptional()
  publicationDeadline?: string | null;

  @ApiProperty()
  canPublish!: boolean;

  @ApiPropertyOptional()
  blockingReason?: string | null;

  @ApiProperty()
  chainId!: number;

  @ApiPropertyOptional()
  userOpHash?: string | null;

  @ApiPropertyOptional()
  txHash?: string | null;
}

export class OfficialPublicationMobileClaimResponseDto {
  @ApiProperty()
  requestId!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  claimExpiresAt!: string;

  @ApiProperty()
  execution!: {
    executionMode?: string;
    chainId: number;
    smartAccountAddress?: string;
    targetAddress: string;
    value: string;
    callData: string;
    callDataHash: string;
    callsHash?: string;
    spenderAddress?: string;
    calls?: Array<{
      target: string;
      value: string;
      callData: string;
      purpose: 'TVD_APPROVAL' | 'CREATE_VOTE';
    }>;
    onChainElectionId: string;
    walletDebitRequired?: string;
    allowanceBefore?: string;
  };

  @ApiProperty()
  economicSummary!: {
    votersCount: string;
    requiredCredits: string;
    requiredTvd: string;
    tvdPerCredit: string;
  };
}
