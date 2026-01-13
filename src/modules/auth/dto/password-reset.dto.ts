import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
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
