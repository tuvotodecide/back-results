import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CircunscripcionDto {
  @ApiProperty({ example: 4, description: 'Número de circunscripción' })
  @IsNumber()
  number: number;

  @ApiProperty({
    example: 'Especial',
    description: 'Tipo de circunscripción',
    enum: ['Especial', 'Uninominal'],
  })
  @IsEnum(['Especial', 'Uninominal'])
  type: string;

  @ApiProperty({
    example: 'Especial Indígena-Tarija',
    description: 'Nombre de la circunscripción',
  })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CoordinatesDto {
  @ApiProperty({ example: -21.357303, description: 'Latitud' })
  @IsNumber()
  latitude: number;

  @ApiProperty({ example: -63.87766, description: 'Longitud' })
  @IsNumber()
  longitude: number;
}

export class CreateElectoralLocationDto {
  @ApiProperty({ example: '4144', description: 'FID del sistema original' })
  @IsString()
  @IsNotEmpty()
  fid: string;

  @ApiProperty({ example: '25527', description: 'Código del recinto' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    example: 'U.E. Alto Ipaguazu',
    description: 'Nombre del recinto',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del asiento electoral',
  })
  @IsMongoId()
  electoralSeatId: string;

  @ApiProperty({
    example: 'Alto Ipaguazu',
    description: 'Dirección del recinto',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'DISTRITO 6', description: 'Distrito electoral' })
  @IsString()
  @IsNotEmpty()
  district: string;

  @ApiProperty({ example: 'Zona 5286', description: 'Zona electoral' })
  @IsString()
  @IsNotEmpty()
  zone: string;

  @ApiProperty({
    type: CircunscripcionDto,
    description: 'Información de circunscripción',
  })
  @ValidateNested()
  @Type(() => CircunscripcionDto)
  circunscripcion: CircunscripcionDto;

  @ApiProperty({ type: CoordinatesDto, description: 'Coordenadas geográficas' })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateElectoralLocationDto {
  @ApiProperty({
    example: '4144',
    description: 'FID del sistema original',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fid?: string;

  @ApiProperty({
    example: '25527',
    description: 'Código del recinto',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @ApiProperty({
    example: 'U.E. Alto Ipaguazu',
    description: 'Nombre del recinto',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del asiento electoral',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  electoralSeatId?: string;

  @ApiProperty({
    example: 'Alto Ipaguazu',
    description: 'Dirección del recinto',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;

  @ApiProperty({
    example: 'DISTRITO 6',
    description: 'Distrito electoral',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  district?: string;

  @ApiProperty({
    example: 'Zona 5286',
    description: 'Zona electoral',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  zone?: string;

  @ApiProperty({
    type: CircunscripcionDto,
    description: 'Información de circunscripción',
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CircunscripcionDto)
  circunscripcion?: CircunscripcionDto;

  @ApiProperty({
    type: CoordinatesDto,
    description: 'Coordenadas geográficas',
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
