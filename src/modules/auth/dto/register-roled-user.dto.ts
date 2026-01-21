import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole, userRoles } from '../schemas/roledUser.schema';

export class RegisterRoledUserDto {
  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  dni: string;

  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ minLength: 8, example: 'secret123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: '6794f4c6aa52f60011d54cd9' })
  @IsMongoId()
  @IsOptional()
  votingDepartmentId?: string;

  @ApiPropertyOptional({ example: '6794f4c6aa52f60011d54cea' })
  @IsMongoId()
  @IsOptional()
  votingMunicipalityId?: string;
}

export class RoledUserResponseDto {
  @ApiProperty() _id: string;
  @ApiProperty() dni: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: userRoles }) role: UserRole;
  @ApiProperty() active: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiPropertyOptional() votingDepartmentId?: string;
  @ApiPropertyOptional() votingMunicipalityId?: string;
}
