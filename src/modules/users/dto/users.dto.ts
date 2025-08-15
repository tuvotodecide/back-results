import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterUserByDniDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;
}

export class UserResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() dni: string;
  @ApiProperty() active: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
