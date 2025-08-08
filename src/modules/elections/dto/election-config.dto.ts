/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { TimezoneUtil } from '@/utils/timezone.util';

export class CreateElectionConfigDto {
  @ApiProperty({
    description: 'Nombre de la configuración electoral',
    example: 'Elecciones Generales 2025',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Fecha y hora de inicio (hora Bolivia)',
    example: '2025-08-07T20:25',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  votingStartDate: string;

  @ApiProperty({
    description: 'Fecha y hora de fin (hora Bolivia)',
    example: '2025-08-07T20:30',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  votingEndDate: string;

  @ApiProperty({
    description: 'Fecha y hora para resultados (hora Bolivia)',
    example: '2025-08-07T20:35',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  resultsStartDate: string;

  @ApiProperty({
    description: 'Permitir modificaciones fuera del horario',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  allowDataModification?: boolean;
}

export class UpdateElectionConfigDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    if (!value) return value;
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  votingStartDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    if (!value) return value;
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  votingEndDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => {
    if (!value) return value;
    const utcDate = TimezoneUtil.boliviaToUTC(value);
    return utcDate.toISOString();
  })
  resultsStartDate?: string;

  @IsOptional()
  @IsBoolean()
  allowDataModification?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ElectionConfigResponseDto {
  id: string;
  name: string;
  votingStartDate: Date; // UTC en BD
  votingEndDate: Date; // UTC en BD
  resultsStartDate: Date; // UTC en BD
  // Campos Bolivia para el frontend
  votingStartDateBolivia: string;
  votingEndDateBolivia: string;
  resultsStartDateBolivia: string;
  isActive: boolean;
  allowDataModification: boolean;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ElectionStatusResponseDto {
  isVotingPeriod: boolean;
  isResultsPeriod: boolean;
  hasActiveConfig: boolean;
  currentTime: Date; // UTC
  currentTimeBolivia: string; // Bolivia
  config?: ElectionConfigResponseDto;
}
