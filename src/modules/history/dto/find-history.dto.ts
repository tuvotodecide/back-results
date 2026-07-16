import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { HistoryType } from './create-history.dto';

export class FindHistoryDto {
  @ApiProperty({ example: 1, description: 'Número de página', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ example: 10, description: 'Elementos por página', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiProperty({ example: '0x2415236', description: 'Filtrar por hash de transacción', required: false })
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiProperty({ example: 'setTvdPerVote', description: 'Filtrar por clave de operación', required: false })
  @IsOptional()
  @IsString()
  operationKey?: string;

  @ApiProperty({ example: 'Cambiar monto TVD por voto', description: 'Filtrar por nombre de operación', required: false })
  @IsOptional()
  @IsString()
  operationName?: string;

  @ApiProperty({ enum: HistoryType, description: 'Filtrar por tipo', required: false })
  @IsOptional()
  @IsEnum(HistoryType)
  type?: HistoryType;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d1', description: 'Filtrar por usuario con rol', required: false })
  @IsOptional()
  @IsMongoId()
  roledUserId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', description: 'Filtrar por institución', required: false })
  @IsOptional()
  @IsMongoId()
  institutionId?: string;

  @ApiProperty({ example: '64f1a2b3c4d5e6f7a8b9c0d2', description: 'Filtrar por elección', required: false })
  @IsOptional()
  @IsMongoId()
  electionId?: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z', description: 'Fecha de registro desde', required: false })
  @IsOptional()
  @IsDateString()
  registerDateFrom?: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z', description: 'Fecha de registro hasta', required: false })
  @IsOptional()
  @IsDateString()
  registerDateTo?: string;
}
