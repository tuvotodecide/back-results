import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePadronStagingEntryDto {
  @ApiProperty({ description: 'CI del empadronado' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ci!: string;

  @ApiPropertyOptional({ description: 'Indica si está habilitado', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePadronStagingEntryDto {
  @ApiPropertyOptional({ description: 'CI del empadronado' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  ci?: string;

  @ApiPropertyOptional({ description: 'Indica si está habilitado' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;
}
