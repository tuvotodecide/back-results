import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateContractDto {
  @ApiProperty({ description: 'ID del cliente (RoledUser)' })
  @IsMongoId()
  @IsNotEmpty()
  clientId!: string;

  @ApiProperty({ description: 'ID de la elección' })
  @IsMongoId()
  @IsNotEmpty()
  electionId!: string;

  @ApiPropertyOptional({ description: 'ID del departamento (para Gobernadores)' })
  @IsMongoId()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'ID del municipio (para Alcaldes)' })
  @IsMongoId()
  @IsOptional()
  municipalityId?: string;

  @ApiProperty({ description: 'Fecha de inicio del contrato' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ description: 'Fecha de fin del contrato' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class ApproveUserDto {
  @ApiProperty({ description: 'Aprobar (true) o rechazar (false)' })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional({ description: 'Razón del rechazo (si aplica)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsString()
  @IsOptional()
  reason?: string;
}

export class TerritorialAccessQueryDto {
  @ApiPropertyOptional({
    enum: [
      'NONE',
      'PENDING_EMAIL_VERIFICATION',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'REVOKED',
    ],
  })
  @IsOptional()
  @IsIn([
    'NONE',
    'PENDING_EMAIL_VERIFICATION',
    'PENDING_APPROVAL',
    'APPROVED',
    'REJECTED',
    'REVOKED',
  ])
  status?: string;
}

export class ReviewTerritorialAccessDto {
  @ApiPropertyOptional({ description: 'Razón opcional para rechazo o revocación' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class CheckCoverageDto {
  @ApiProperty()
  @IsMongoId()
  electionId!: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  municipalityId?: string;
}

export class CheckAttestationAvailabilityDto {
  @ApiProperty({ description: 'Latitud del usuario', example: -16.5 })
  latitude!: number;

  @ApiProperty({ description: 'Longitud del usuario', example: -68.15 })
  longitude!: number;

  @ApiProperty({ 
    description: 'Distancia máxima en metros', 
    example: 10000,
    required: false 
  })
  maxDistance?: number;
}
