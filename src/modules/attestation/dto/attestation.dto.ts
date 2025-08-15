import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransformObjectId } from '@/core/transforms/objectid.transform';
import { Types } from 'mongoose';

export class CreateAttestationItemDto {
  @ApiProperty({
    description: 'ID del ballot/acta',
    example: '507f1f77bcf86cd799439011',
  })
  @IsNotEmpty()
  @TransformObjectId()
  ballotId: Types.ObjectId | string;

  @ApiProperty({
    description: 'Apoya (true) o rechaza (false) el acta',
    example: true,
  })
  @IsBoolean()
  support: boolean;
  @ApiProperty({
    description: 'true = jurado, false = usuario',
    example: false,
  })
  @IsBoolean()
  isJury: boolean;

  @ApiProperty({
    description: 'DNI del usuario que atestigua',
    example: '12345678',
  })
  @IsString()
  @IsNotEmpty()
  dni: string;
}

export class CreateAttestationBulkDto {
  @ApiProperty({
    description: 'Array de attestations a crear',
    type: [CreateAttestationItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAttestationItemDto)
  attestations: CreateAttestationItemDto[];
}

export class AttestationResponseDto {
  @ApiProperty()
  _id: string;

  @ApiProperty()
  support: boolean;

  @ApiProperty()
  ballotId: string;

  @ApiProperty({ description: 'true = jurado, false = usuario' })
  isJury: boolean;

  @ApiProperty({ description: 'DNI del usuario' }) dni: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class BulkAttestationResponseDto {
  @ApiProperty({
    description: 'Attestations creadas exitosamente',
    type: [AttestationResponseDto],
  })
  created: AttestationResponseDto[];

  @ApiProperty({
    description: 'Errores durante la creación',
    example: [],
  })
  errors: Array<{
    index: number;
    error: string;
    data: CreateAttestationItemDto;
  }>;

  @ApiProperty({
    description: 'Resumen de la operación',
  })
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

export class AttestationStatsDto {
  @ApiProperty({
    description: 'ID del ballot',
  })
  ballotId: string;

  @ApiProperty({
    description: 'Total de attestations',
  })
  totalAttestations: number;

  @ApiProperty({
    description: 'Attestations de apoyo',
  })
  supportCount: number;

  @ApiProperty({
    description: 'Attestations en contra',
  })
  againstCount: number;

  @ApiProperty({
    description: 'Porcentaje de apoyo',
  })
  supportPercentage: number;
}
