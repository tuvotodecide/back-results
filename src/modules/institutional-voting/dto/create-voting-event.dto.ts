import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateVotingEventDto {
  @ApiProperty()
  @IsMongoId()
  tenantId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  objective!: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isReferendum?: boolean;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isOpenVoting?: boolean;

  @ApiProperty({ required: false, description: 'Requerido cuando isOpenVoting es true.' })
  @ValidateIf((dto) => dto.isOpenVoting === true)
  @IsInt()
  @Min(1)
  maxOpenVoters?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  votingStart?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  votingEnd?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  resultsPublishAt?: string;
}
