import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUrl,
  IsOptional,
  IsEnum,
  IsNumber,
  Min,
} from 'class-validator';

export class CreateBallotFromIpfsDto {
  @ApiProperty({
    description: 'URI de IPFS donde está almacenada la metadata del acta',
    example: 'https://ipfs.io/ipfs/QmXxx...',
  })
  @IsUrl()
  @IsNotEmpty()
  ipfsUri: string;

  @ApiProperty({
    description: 'ID del NFT en IPFS',
    required: false,
  })
  @IsOptional()
  @IsString()
  recordId: string;

  @ApiProperty({
    description: 'ID de la mesa en IPFS',
    required: false,
  })
  @IsString()
  @IsOptional()
  tableIdIpfs: string;

  @ApiProperty({
    description: 'Versión del acta',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  version?: number;
}

// Interfaces para el formato OpenSea
export interface OpenSeaAttribute {
  trait_type?: string;
  value?: any;
  display_type?: string;
}

export interface OpenSeaMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<OpenSeaAttribute>;
  _technical?: any;
  data: BallotDataFromIpfs;
}

// Interface para los votos por partido
export interface PartyVoteData {
  partyId: string;
  votes: number;
}

// Interface para cada categoría de votación
export interface VotingCategoryData {
  validVotes: number;
  nullVotes: number;
  blankVotes: number;
  partyVotes: PartyVoteData[];
  totalVotes?: number; // Calculado
}

// Interface actualizada para la estructura completa de votos desde IPFS
export interface VotesDataFromIpfs {
  parties: VotingCategoryData; // Votos para presidentes
  deputies: VotingCategoryData; // Votos para diputados
}

// Interface principal actualizada para los datos del ballot desde IPFS
export interface BallotDataFromIpfs {
  tableCode: string;
  tableNumber: string;
  locationId: string;
  votes: VotesDataFromIpfs;
  image: string;
}

export class BallotQueryDto {
  @ApiProperty({
    description: 'Filtrar por estado',
    example: 'processed',
    required: false,
    enum: ['pending', 'processed', 'synced', 'error'],
  })
  @IsOptional()
  @IsEnum(['pending', 'processed', 'synced', 'error'])
  status?: string;

  @ApiProperty({
    description: 'Filtrar por departamento',
    example: 'La Paz',
    required: false,
  })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiProperty({
    description: 'Filtrar por provincia',
    example: 'Murillo',
    required: false,
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiProperty({
    description: 'Filtrar por municipio',
    example: 'La Paz',
    required: false,
  })
  @IsOptional()
  @IsString()
  municipality?: string;

  @ApiProperty({
    description: 'Filtrar por tipo de circunscripción',
    example: 'Uninominal',
    required: false,
    enum: ['Especial', 'Uninominal'],
  })
  @IsOptional()
  @IsEnum(['Especial', 'Uninominal'])
  circunscripcionType?: string;

  @ApiProperty({
    description: 'Número de página',
    example: 1,
    required: false,
  })
  @IsOptional()
  page?: number;

  @ApiProperty({
    description: 'Elementos por página',
    example: 10,
    required: false,
  })
  @IsOptional()
  limit?: number;
}

export class BallotStatsDto {
  totalTables: number;
  processedTables: number;
  pendingTables: number;
  syncedTables: number;
  errorTables: number;
  completionPercentage: number;
}

// Geolocation DTOs
export class LocationByCoordinatesDto {
  @ApiProperty({
    description: 'Latitud del usuario',
    example: -16.5,
  })
  @IsNotEmpty()
  @IsNumber()
  latitude: number;

  @ApiProperty({
    description: 'Longitud del usuario',
    example: -68.15,
  })
  @IsNotEmpty()
  @IsNumber()
  longitude: number;

  @ApiProperty({
    description: 'Radio máximo de búsqueda en metros',
    example: 5000,
    required: false,
    default: 5000,
  })
  @IsOptional()
  @IsNumber()
  maxDistance?: number;
}

export class NearbyLocationResponseDto {
  location: {
    _id: string;
    name: string;
    address: string;
    district: string;
    zone: string;
    distance: number;
    coordinates: {
      latitude: number;
      longitude: number;
    };
  };
  ballots: any[];
  stats: {
    totalTables: number;
    processedTables: number;
    completionPercentage: number;
  };
}
