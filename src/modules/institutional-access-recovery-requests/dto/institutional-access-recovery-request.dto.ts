import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const phonePattern = /^[0-9+\-\s()]{6,32}$/;

export class CreateInstitutionalAccessRecoveryRequestDto {
  @ApiProperty()
  @IsMongoId()
  institutionId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(160)
  fullName: string;

  @ApiProperty()
  @IsString()
  @Matches(phonePattern)
  phoneNumber: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(180)
  newEmail: string;

  @ApiProperty()
  @IsString()
  @Matches(phonePattern)
  supervisorPhoneNumber: string;
}

export class ResolveInstitutionalAccessRecoveryRequestDto {
  @ApiProperty()
  @IsMongoId()
  targetUserId: string;

  @ApiProperty()
  @IsMongoId()
  targetAssignmentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RejectInstitutionalAccessRecoveryRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
