import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AcceptInstitutionalAdminInvitationDto {
  @IsString()
  @MinLength(16)
  token!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;
}
