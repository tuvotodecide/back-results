import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVotingEventDto {
  @ApiProperty()
  @IsMongoId()
  tenantId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(1000)
  objective: string;

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
