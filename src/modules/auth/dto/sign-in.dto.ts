import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";
import { UserRole, userRoles } from "../schemas/roledUser.schema";

export class SignInDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8, example: 'secret123' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class SignInResponseDto {
  @ApiProperty() accessToken: string;
  @ApiProperty({ enum: userRoles }) role: UserRole;
  @ApiProperty() active: boolean;
}

export class ProfileResponseDto {
  @ApiProperty() sub: string;
  @ApiProperty() dni: string;
  @ApiProperty({ enum: userRoles }) role: UserRole;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional() votingDepartmentId: string;
  @ApiPropertyOptional() votingMunicipalityId: string;
  @ApiProperty({ description: 'Timestamp: fecha de emisión' }) iat: number;
  @ApiProperty({ description: 'Timestamp: fecha de expiración' }) exp: number;
}