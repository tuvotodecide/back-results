import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CreateInstitutionalAdminApplicationDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: 'admin@institucion.bo' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Juan Perez' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Colegio de Ingenieros' })
  @IsString()
  @IsNotEmpty()
  institutionName: string;
}
