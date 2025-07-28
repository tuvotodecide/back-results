import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
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
    description: 'Color hexadecimal del partido',
    example: '#2196F3',
  })
  @IsHexColor()
  color: string;

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
