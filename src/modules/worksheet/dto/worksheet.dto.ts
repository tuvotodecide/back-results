import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorksheetStatus } from '../schemas/worksheet.schema';

export class WorksheetPartyVoteDto {
  @ApiProperty({ example: 'party-001' })
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @ApiProperty({ example: 120 })
  @IsNumber()
  @Min(0)
  votes: number;
}

export class WorksheetVotingCategoryDto {
  @ApiProperty({ example: 260 })
  @IsNumber()
  @Min(0)
  validVotes: number;

  @ApiProperty({ example: 4 })
  @IsNumber()
  @Min(0)
  nullVotes: number;

  @ApiProperty({ example: 7 })
  @IsNumber()
  @Min(0)
  blankVotes: number;

  @ApiProperty({ type: [WorksheetPartyVoteDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorksheetPartyVoteDto)
  partyVotes: WorksheetPartyVoteDto[];

  @ApiPropertyOptional({ example: 271 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalVotes?: number;
}

export class WorksheetVotesDto {
  @ApiPropertyOptional({ type: WorksheetVotingCategoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorksheetVotingCategoryDto)
  parties?: WorksheetVotingCategoryDto;

  @ApiPropertyOptional({ type: WorksheetVotingCategoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorksheetVotingCategoryDto)
  deputies?: WorksheetVotingCategoryDto;
}

export class CreateWorksheetFromIpfsDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: 'https://ipfs.io/ipfs/QmXxx...' })
  @IsUrl()
  @IsNotEmpty()
  ipfsUri: string;

  @ApiProperty({ example: '674f8a2b3c4d5e6f7a8b9c0d' })
  @IsString()
  @IsNotEmpty()
  electionId: string;

  @ApiPropertyOptional({
    description:
      'Se usa como fallback para marcar fallida si IPFS no responde y no se puede extraer tableCode.',
    example: '1234',
  })
  @IsOptional()
  @IsString()
  tableCode?: string;

  @ApiPropertyOptional({ example: '45' })
  @IsOptional()
  @IsString()
  tableNumber?: string;

  @ApiPropertyOptional({ example: '674f8a2b3c4d5e6f7a8b9c0e' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ example: 'https://gateway.pinata.cloud/ipfs/QmImg...' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({ type: WorksheetVotesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WorksheetVotesDto)
  votes?: WorksheetVotesDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableIdIpfs?: string;

  @ApiPropertyOptional({
    description: 'Link de referencia del NFT (explorer o metadata URL).',
    example: 'https://testnet.basescan.org/token/0x123/1',
  })
  @IsOptional()
  @IsString()
  nftLink?: string;
}

export class RetryWorksheetFromIpfsDto extends CreateWorksheetFromIpfsDto {
  @ApiProperty({
    description: 'tableCode existente de la hoja fallida a reintentar',
    example: '1234',
  })
  @IsString()
  @IsNotEmpty()
  declare tableCode: string;
}

export class CompareWorksheetDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: '674f8a2b3c4d5e6f7a8b9c0d' })
  @IsString()
  @IsNotEmpty()
  electionId: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @IsNotEmpty()
  tableCode: string;

  @ApiProperty({ type: WorksheetVotesDto })
  @ValidateNested()
  @Type(() => WorksheetVotesDto)
  votes: WorksheetVotesDto;
}

export enum WorksheetCompareStatus {
  MATCH = 'MATCH',
  MISMATCH = 'MISMATCH',
  NOT_FOUND = 'NOT_FOUND',
  NOT_AVAILABLE = 'NOT_AVAILABLE',
}

export class WorksheetDiffDto {
  @ApiProperty({ example: 'parties.partyVotes.party-001' })
  field: string;

  @ApiProperty({ example: 120, nullable: true })
  worksheetValue: number | null;

  @ApiProperty({ example: 121, nullable: true })
  ballotValue: number | null;
}

export class CompareWorksheetResponseDto {
  @ApiProperty({ enum: WorksheetCompareStatus })
  @IsEnum(WorksheetCompareStatus)
  status: WorksheetCompareStatus;

  @ApiPropertyOptional({ enum: WorksheetStatus })
  @IsOptional()
  @IsEnum(WorksheetStatus)
  worksheetStatus?: WorksheetStatus;

  @ApiProperty({ type: [WorksheetDiffDto], default: [] })
  differences: WorksheetDiffDto[];
}

export class WorksheetStatusResponseDto {
  @ApiProperty({ example: '66f3e9d0b6f7f36d4e2d7f11' })
  id: string;

  @ApiProperty({ enum: WorksheetStatus })
  status: WorksheetStatus;

  @ApiProperty({ example: '1234' })
  tableCode: string;

  @ApiPropertyOptional({ example: '45' })
  tableNumber?: string;

  @ApiPropertyOptional({ example: 'https://ipfs.io/ipfs/QmXxx...' })
  ipfsUri?: string;

  @ApiPropertyOptional({
    example: 'https://testnet.basescan.org/token/0x123/1',
  })
  nftLink?: string;

  @ApiPropertyOptional({ example: 'Error al obtener datos de IPFS' })
  errorMessage?: string;
}
