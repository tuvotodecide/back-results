/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';

// DTOs para respuestas
export class PartyResultDto {
  @ApiProperty({ example: 'MAS-IPSP' })
  partyId: string;

  @ApiProperty({ example: 150000 })
  totalVotes: number;

  @ApiProperty({ example: '45.50' })
  percentage: string;

  @ApiProperty({
    example: 9,
    description: 'Número de departamentos con cobertura',
  })
  departmentsCovered?: number;

  @ApiProperty({ example: 250, description: 'Número de mesas procesadas' })
  tablesProcessed?: number;
}

export class VoteSummaryDto {
  @ApiProperty({ example: 250000 })
  validVotes: number;

  @ApiProperty({ example: 5000 })
  nullVotes: number;

  @ApiProperty({ example: 3000 })
  blankVotes: number;

  @ApiProperty({ example: 258000 })
  totalVotes: number;

  @ApiProperty({ example: 500, required: false })
  tablesProcessed?: number;
}

export class QuickCountResponseDto {
  @ApiProperty({ type: [PartyResultDto] })
  results: PartyResultDto[];

  @ApiProperty({ type: VoteSummaryDto })
  summary: VoteSummaryDto;

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

// DTOs para queries
export class LocationFilterDto {
  @ApiProperty({ required: false, example: 'La Paz' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({ required: false, example: 'Murillo' })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiProperty({ required: false, example: 'La Paz' })
  @IsOptional()
  @IsString()
  municipality?: string;

  @ApiProperty({ required: false, example: 'Achachicala' })
  @IsOptional()
  @IsString()
  electoralSeat?: string;

  @ApiProperty({
    required: false,
    example: 'U.E Achachicala',
    description: 'Nombre del recinto electoral',
  })
  @IsOptional()
  @IsString()
  electoralLocation?: string;

  @ApiProperty({ required: false, example: '12345' })
  @IsOptional()
  @IsString()
  tableCode?: string;
}

export class ElectionTypeFilterDto extends LocationFilterDto {
  @ApiProperty({
    enum: ['presidential', 'deputies'],
    example: 'presidential',
    description: 'Tipo de elección',
  })
  @IsEnum(['presidential', 'deputies'])
  electionType: 'presidential' | 'deputies';
}

export class CircunscripcionFilterDto extends ElectionTypeFilterDto {
  @ApiProperty({
    required: false,
    enum: ['Uninominal', 'Especial'],
    example: 'Uninominal',
  })
  @IsOptional()
  @IsEnum(['Uninominal', 'Especial'])
  circunscripcionType?: 'Uninominal' | 'Especial';

  @ApiProperty({ required: false, example: 24 })
  @IsOptional()
  @IsNumber()
  circunscripcionNumber?: number;
}

// Respuesta para resultados por ubicación
export class LocationResultsResponseDto {
  @ApiProperty({ type: LocationFilterDto })
  filters: any;

  @ApiProperty({ type: [PartyResultDto] })
  results: PartyResultDto[];

  @ApiProperty({ type: VoteSummaryDto })
  summary: VoteSummaryDto;

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

// DTOs para progreso de registro
export class RegistrationProgressDto {
  @ApiProperty({ example: 35000 })
  totalTables: number;

  @ApiProperty({ example: 25000 })
  registeredBallots: number;

  @ApiProperty({ example: '71.43' })
  percentage: string;

  @ApiProperty({ example: 10000 })
  pending: number;
}

export class ProgressByStatusDto {
  @ApiProperty({ example: 0 })
  pending: number;

  @ApiProperty({ example: 24000 })
  processed: number;

  @ApiProperty({ example: 1000 })
  synced: number;

  @ApiProperty({ example: 0 })
  error: number;
}

export class RegistrationProgressResponseDto {
  @ApiProperty({ type: RegistrationProgressDto })
  progress: RegistrationProgressDto;

  @ApiProperty({ type: ProgressByStatusDto })
  byStatus: ProgressByStatusDto;

  @ApiProperty({ type: LocationFilterDto, required: false })
  filters?: LocationFilterDto;

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

// DTOs para resultados por circunscripción
export class CircunscripcionResultDto {
  @ApiProperty({ example: 24 })
  number: number;

  @ApiProperty({ example: 'Uninominal' })
  type: string;

  @ApiProperty({ example: 'Circunscripción 24' })
  name: string;

  @ApiProperty({ type: [PartyResultDto] })
  results: PartyResultDto[];

  @ApiProperty({ type: VoteSummaryDto })
  summary: VoteSummaryDto;
}

export class CircunscripcionResponseDto {
  @ApiProperty({ type: CircunscripcionFilterDto })
  filters: any;

  @ApiProperty({ type: [CircunscripcionResultDto] })
  circunscripciones: CircunscripcionResultDto[];

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

// DTO para comparación histórica
export class HistoricalComparisonDto {
  @ApiProperty({ example: 'MAS-IPSP' })
  partyId: string;

  @ApiProperty({ example: 150000 })
  currentVotes: number;

  @ApiProperty({ example: '45.50' })
  currentPercentage: string;

  @ApiProperty({ example: 140000, required: false })
  previousVotes?: number;

  @ApiProperty({ example: '42.30', required: false })
  previousPercentage?: string;

  @ApiProperty({ example: '+3.20', required: false })
  percentageChange?: string;
}

// DTO para mapa de calor
export class HeatMapDataDto {
  @ApiProperty({ example: 'La Paz' })
  location: string;

  @ApiProperty({ example: 'department' })
  locationType: 'department' | 'municipality' | 'province';

  @ApiProperty({ example: 75000 })
  totalVotes: number;

  @ApiProperty({ example: 45.5 })
  participationRate: number;

  @ApiProperty({
    type: 'object',
    example: { 'MAS-IPSP': 45.5, CC: 30.2, CREEMOS: 15.3 },
    additionalProperties: { type: 'number' },
  })
  partyPercentages: Record<string, number>;
}

export class HeatMapResponseDto {
  @ApiProperty({ type: [HeatMapDataDto] })
  data: HeatMapDataDto[];

  @ApiProperty({ example: 'presidential' })
  electionType: string;

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

// DTOs para estadísticas del sistema
export class DepartmentCoverageDto {
  @ApiProperty({ example: 'La Paz' })
  department: string;

  @ApiProperty({ example: 5000 })
  ballotCount: number;

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}

export class RecentActivityDto {
  @ApiProperty({ example: '2025-01-24 10:00' })
  hour: string;

  @ApiProperty({ example: 150 })
  count: number;
}

export class SystemSummaryDto {
  @ApiProperty({ example: 25000 })
  totalBallots: number;

  @ApiProperty({
    type: 'object',
    example: { pending: 0, processed: 24000, synced: 1000, error: 0 },
    additionalProperties: { type: 'number' },
  })
  byStatus: Record<string, number>;

  @ApiProperty({ example: 9 })
  departmentsCovered: number;
}

export class SystemStatisticsResponseDto {
  @ApiProperty({ type: SystemSummaryDto })
  summary: SystemSummaryDto;

  @ApiProperty({ type: [DepartmentCoverageDto] })
  departmentCoverage: DepartmentCoverageDto[];

  @ApiProperty({ type: [RecentActivityDto] })
  recentActivity: RecentActivityDto[];

  @ApiProperty({ example: '2025-01-24T10:30:00Z' })
  lastUpdate: Date;
}
