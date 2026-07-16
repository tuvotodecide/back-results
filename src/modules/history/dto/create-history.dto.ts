import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsMongoId, IsNotEmpty, IsOptional, IsString } from "class-validator";

export enum HistoryType {
  MULTISIG = 'multisig',
  OWNER = 'owner',
}

export class CreateHistoryDto {
  @ApiProperty({ example: '0x2415236' })
  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @ApiProperty({ example: 'setTvdPerVote, setBurn, pauseRewards, setCoreBlockDuration, ...' })
  @IsString()
  @IsNotEmpty()
  operationKey!: string;

  @ApiProperty({ example: 'Cambiar monto TVD por voto' })
  @IsString()
  @IsNotEmpty()
  operationName!: string;

  @ApiProperty({ example: 'Ajuste de precio 2' })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  description?: string;

  @ApiProperty({ enum: HistoryType, example: HistoryType.MULTISIG })
  @IsEnum(HistoryType)
  type!: HistoryType;
  
  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' })
  @IsDateString()
  registerDate!: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d1', required: false })
  @IsOptional()
  @IsMongoId()
  roledUserId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', required: false })
  @IsOptional()
  @IsMongoId()
  institutionId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', required: false })
  @IsOptional()
  @IsMongoId()
  electionId?: string;
}
