import { ApiProperty } from '@nestjs/swagger';
import { IsEthereumAddress, IsNotEmpty, IsString } from 'class-validator';

export class RegisterUserByDniDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni!: string;
}

export class RewardNewUserQueryDto {
  @ApiProperty({
    description: 'Dirección de wallet a recompensar',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsEthereumAddress()
  recipient!: `0x${string}`;
}

export class UserResponseDto {
  @ApiProperty() _id!: string;
  @ApiProperty() dni!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}
