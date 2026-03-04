import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateVotingEventDto {
  @ApiProperty()
  @IsMongoId()
  tenantId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
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
