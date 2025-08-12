import { TransformObjectId } from '@/core/transforms/objectid.transform';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsMongoId,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { Types } from 'mongoose';

export class CreateElectoralTableDto {
  @ApiProperty({
    description: 'Número de la mesa electoral',
    example: '1',
  })
  @IsString()
  @IsNotEmpty()
  tableNumber: string;

  @ApiProperty({
    description: 'Código único de la mesa electoral',
    example: 'ABC123',
  })
  @IsString()
  @IsNotEmpty()
  tableCode: string;

  @ApiProperty({
    description: 'ID del recinto electoral al que pertenece la mesa',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  @TransformObjectId()
  electoralLocationId: Types.ObjectId;

  @ApiProperty({
    description: 'Estado activo de la mesa',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateElectoralTableDto {
  @ApiProperty({
    description: 'Número de la mesa electoral',
    example: '1',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  tableNumber?: string;

  @ApiProperty({
    description: 'Código único de la mesa electoral',
    example: 'ABC123',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  tableCode?: string;

  @ApiProperty({
    description: 'ID del recinto electoral al que pertenece la mesa',
    example: '507f1f77bcf86cd799439011',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  @TransformObjectId()
  electoralLocationId?: Types.ObjectId;

  @ApiProperty({
    description: 'Estado activo de la mesa',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ElectoralTableQueryDto {
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

  @ApiProperty({
    description: 'Campo para ordenar',
    example: 'tableNumber',
    required: false,
  })
  @IsOptional()
  sort?: string;

  @ApiProperty({
    description: 'Orden ascendente o descendente',
    example: 'asc',
    required: false,
  })
  @IsOptional()
  order?: 'asc' | 'desc';

  @ApiProperty({
    description: 'Término de búsqueda',
    example: 'mesa',
    required: false,
  })
  @IsOptional()
  search?: string;

  @ApiProperty({
    description: 'Filtrar por estado activo',
    example: 'true',
    required: false,
  })
  @IsOptional()
  active?: string;

  @ApiProperty({
    description: 'Filtrar por ID de recinto electoral',
    example: '507f1f77bcf86cd799439011',
    required: false,
  })
  @IsOptional()
  electoralLocationId?: string;
}
