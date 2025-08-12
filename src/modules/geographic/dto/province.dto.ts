import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsMongoId,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TransformObjectId } from '@/core/transforms/objectid.transform';
import { Types } from 'mongoose';

export class CreateProvinceDto {
  @ApiProperty({
    example: 'Nicolás Suárez',
    description: 'Nombre de la provincia',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del departamento',
  })
  @IsMongoId()
  @TransformObjectId()
  departmentId: Types.ObjectId;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateProvinceDto {
  @ApiProperty({
    example: 'Nicolás Suárez',
    description: 'Nombre de la provincia',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del departamento',
    required: false,
  })
  @IsOptional()
  @IsMongoId()
  departmentId?: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
