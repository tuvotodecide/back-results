import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
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

  @ApiProperty({ minLength: 8, example: 'ClaveSegura123*' })
  @IsString()
  @MinLength(8)
  password: string;

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
}
