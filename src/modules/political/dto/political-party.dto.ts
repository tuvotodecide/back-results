import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsHexColor,
  IsUrl,
} from 'class-validator';

export class CreatePoliticalPartyDto {
  @ApiProperty({
    description: 'Identificador único del partido',
    example: 'Libre',
  })
  @IsString()
  @IsNotEmpty()
  partyId: string;

  @ApiProperty({
    description: 'Nombre completo del partido',
    example: 'Alianza Libre',
  })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    description: 'Siglas o nombre corto del partido',
    example: 'MAS',
  })
  @IsString()
  @IsNotEmpty()
  shortName: string;

  @ApiProperty({
    description: 'URL del logo del partido',
    example: 'https://example.com/logo-libre.png',
    required: false,
  })
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiProperty({
    description: 'Color hexadecimal principal legacy del partido. Si se envía colors[], se deriva desde colors[0].',
    example: '#2196F3',
    required: false,
  })
  @IsOptional()
  @IsHexColor()
  color?: string;

  @ApiProperty({
    description: 'Paleta de colores del partido. El primer color se toma como principal.',
    example: ['#2196F3', '#FFFFFF'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsHexColor({ each: true })
  colors?: string[];

  @ApiProperty({
    description: 'Estado activo del partido',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdatePoliticalPartyDto extends PartialType(
  CreatePoliticalPartyDto,
) {}

export class PoliticalPartyQueryDto {
  @ApiProperty({
    description: 'Filtrar por estado activo',
    example: 'true',
    required: false,
  })
  @IsOptional()
  active?: string;

  @ApiProperty({
    description: 'Término de búsqueda',
    example: 'MAS',
    required: false,
  })
  @IsOptional()
  search?: string;
}
