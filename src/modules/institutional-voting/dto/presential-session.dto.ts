import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreatePresentialSessionDto {
  @ApiPropertyOptional({
    description:
      'Identificador lógico del kiosco/estación. Si no se envía, se usa "kiosco-principal".',
    example: 'mesa-1',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'stationId solo admite letras, números, guion y guion bajo',
  })
  stationId?: string;

  @ApiPropertyOptional({
    description:
      'Si es true, regenera el token limitado de acceso kiosco e invalida el anterior.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  regenerateKioskAccessToken?: boolean;

  @ApiPropertyOptional({
    description: 'TTL del QR en segundos mientras está READY.',
    example: 300,
    minimum: 30,
    maximum: 900,
  })
  @IsOptional()
  @Min(30)
  @Max(900)
  readyTtlSeconds?: number;

  @ApiPropertyOptional({
    description: 'TTL en segundos de una sesión ya reclamada antes de expirar por abandono.',
    example: 300,
    minimum: 30,
    maximum: 1800,
  })
  @IsOptional()
  @Min(30)
  @Max(1800)
  claimTtlSeconds?: number;
}

export class ScanPresentialSessionDto {
  @ApiProperty({
    description: 'Token opaco leído desde el QR del kiosco.',
    example: 'pqs.684f9d61f4f4b6b9e8c7f123.6b601f2c...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description: 'Carnet del usuario que escaneó y reclama la sesión presencial.',
    example: '1234567LP',
  })
  @IsString()
  @IsNotEmpty()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'carnet debe ser alfanumerico' })
  carnet: string;
}
