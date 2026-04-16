import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export enum PasswordResetContext {
  VOTACION = 'votacion',
  RESULTADOS = 'resultados',
}

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    enum: PasswordResetContext,
    description:
      'Contexto desde donde se solicitó la recuperación para construir el enlace correcto.',
  })
  @IsOptional()
  @IsEnum(PasswordResetContext)
  context?: PasswordResetContext;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '6e5b6b6db65a4cf1a8cbe1d750ef98b3' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ minLength: 8, example: 'newSecret123' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Mensaje' })
  message: string;
}
