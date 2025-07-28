import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsMongoId,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMunicipalityDto {
  @ApiProperty({ example: 'Cobija', description: 'Nombre del municipio' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID de la provincia',
  })
  @IsMongoId()
  provinceId: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateMunicipalityDto {
  @ApiProperty({
    example: 'Cobija',
    description: 'Nombre del municipio',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID de la provincia',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  provinceId?: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
