import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class SnapshotOptionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  optionName: string;

  @ApiProperty()
  @IsNumber()
  votes: number;

  @ApiProperty()
  @IsNumber()
  percentage: number;
}

class SnapshotRoleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  roleName: string;

  @ApiProperty()
  @IsNumber()
  total: number;

  @ApiProperty({ type: [SnapshotOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SnapshotOptionDto)
  ranking: SnapshotOptionDto[];

  @ApiProperty({ type: [SnapshotOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SnapshotOptionDto)
  winners: SnapshotOptionDto[];
}

export class UpsertEventResultsSnapshotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  blockNumber?: string;

  @ApiProperty({ type: [SnapshotRoleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SnapshotRoleDto)
  roles: SnapshotRoleDto[];
}
