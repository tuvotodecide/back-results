import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TransformObjectId } from '@/core/transforms/objectid.transform';
import { Types } from 'mongoose';

export class CircunscripcionDto {
  @ApiProperty({ example: 4 })
  @IsNumber()
  @Type(() => Number)
  number: number;

  @ApiProperty({ example: 'Uninominal', enum: ['Especial', 'Uninominal'] })
  @IsString()
  @IsNotEmpty()
  type: 'Especial' | 'Uninominal';

  @ApiProperty({ example: 'Cuadragésimo Segunda-Tarija' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CoordinatesDto {
  @ApiProperty({ example: -17.368894 })
  @IsNumber()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -66.125185 })
  @IsNumber()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class CreateElectoralLocationDto {
  @ApiProperty({ example: '4144' }) @IsString() @IsNotEmpty() fid: string;
  @ApiProperty({ example: '25527' }) @IsString() @IsNotEmpty() code: string;
  @ApiProperty({ example: 'U.E. Alto Ipaguazu' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @TransformObjectId()
  electoralSeatId: Types.ObjectId;

  @ApiProperty({ example: 'Alto Ipaguazu' })
  @IsString()
  @IsNotEmpty()
  address: string;
  @ApiProperty({ example: 'DISTRITO 6' })
  @IsString()
  @IsNotEmpty()
  district: string;
  @ApiProperty({ example: 'Zona 5286' }) @IsString() @IsNotEmpty() zone: string;

  @ApiProperty({ type: CircunscripcionDto })
  @ValidateNested()
  @Type(() => CircunscripcionDto)
  circunscripcion: CircunscripcionDto;

  @ApiProperty({ type: CoordinatesDto })
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @ApiProperty({ example: true, required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateElectoralLocationDto {
  @IsOptional() @IsString() fid?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;

  @IsOptional() @TransformObjectId() electoralSeatId?: Types.ObjectId;

  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() zone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CircunscripcionDto)
  circunscripcion?: CircunscripcionDto;

  // Si envías coordinates en update, deben venir AMBOS números
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @IsOptional() @IsBoolean() active?: boolean;
}
