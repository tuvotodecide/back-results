import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEthereumAddress,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateInstitutionalAdminApplicationDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @Length(5, 20)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'dni debe ser alfanumerico' })
  dni: string;

  @ApiProperty({ example: 'admin@institucion.bo' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    minLength: 8,
    example: 'ClaveSegura123*',
    description:
      'Requerida solo cuando el backend debe crear una identidad nueva en roled_users. Si la identidad ya existe y solo se solicita acceso institucional, puede omitirse.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 'Colegio de Ingenieros' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  institutionName: string;

  @ApiProperty({ example: '0x1234567890abcdef1234567890abcdef12345678' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsEthereumAddress()
  accountAddress: string;
}
