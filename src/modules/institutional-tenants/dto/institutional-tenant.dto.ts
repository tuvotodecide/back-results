import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsMongoId, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateInstitutionalTenantDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignTenantAdminDto {
  @ApiProperty()
  @IsMongoId()
  userId: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTenantAdminStatusDto {
  @ApiProperty()
  @IsBoolean()
  active: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class TransferTenantPrimaryDto {
  @ApiProperty()
  @IsMongoId()
  assignmentId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RegularizeTenantAdminWalletDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9-]{5,20}$/)
  dni: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountAddress: string;
}

export class InstitutionalTenantListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
