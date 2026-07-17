import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  accountAddress: string;
}
