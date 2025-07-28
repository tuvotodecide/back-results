import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PaginationQueryDto {
  @ApiProperty({ example: 1, description: 'Número de página', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    example: 10,
    description: 'Elementos por página',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiProperty({
    example: 'name',
    description: 'Campo para ordenar',
    required: false,
  })
  @IsOptional()
  @IsString()
  sort?: string = 'name';

  @ApiProperty({
    example: 'asc',
    description: 'Orden ascendente o descendente',
    required: false,
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'asc';
}

export class GeographicQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'Pando',
    description: 'Filtrar por nombre',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    example: 'true',
    description: 'Filtrar por estado activo',
    required: false,
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}

export class LocationQueryDto extends GeographicQueryDto {
  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Filtrar por departamento',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Filtrar por provincia',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  provinceId?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Filtrar por municipio',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  municipalityId?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'Filtrar por asiento electoral',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  electoralSeatId?: string;

  @ApiProperty({
    example: 'Especial',
    description: 'Filtrar por tipo de circunscripción',
    required: false,
  })
  @IsOptional()
  @IsIn(['Especial', 'Uninominal'])
  circunscripcionType?: string;
}
