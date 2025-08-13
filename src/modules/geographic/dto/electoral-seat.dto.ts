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

export class CreateElectoralSeatDto {
  @ApiProperty({ example: '4116', description: 'ID de localización original' })
  @IsString()
  @IsNotEmpty()
  idLoc: string;

  @ApiProperty({
    example: 'Alto Ipaguazu',
    description: 'Nombre del asiento electoral',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del municipio',
  })
  @IsNotEmpty()
  @TransformObjectId()
  municipalityId: Types.ObjectId;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateElectoralSeatDto {
  @ApiProperty({
    example: '4116',
    description: 'ID de localización original',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idLoc?: string;

  @ApiProperty({
    example: 'Alto Ipaguazu',
    description: 'Nombre del asiento electoral',
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiProperty({
    example: '507f1f77bcf86cd799439011',
    description: 'ID del municipio',
    required: false,
  })
  @IsOptional()
  @TransformObjectId()
  municipalityId?: string;

  @ApiProperty({ example: true, description: 'Estado activo', required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
