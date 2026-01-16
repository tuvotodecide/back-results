import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateContractDto {
  @ApiProperty({ description: 'ID del cliente (RoledUser)' })
  @IsMongoId()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'ID de la elección' })
  @IsMongoId()
  @IsNotEmpty()
  electionId: string;

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
  startDate: string;

  @ApiPropertyOptional({ description: 'Fecha de fin del contrato' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class ApproveUserDto {
  @ApiProperty({ description: 'Aprobar (true) o rechazar (false)' })
  @IsBoolean()
  approve: boolean;

  @ApiPropertyOptional({ description: 'Razón del rechazo (si aplica)' })
  @IsString()
  @IsOptional()
  reason?: string;
}

export class CheckCoverageDto {
  @ApiProperty()
  @IsMongoId()
  electionId: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsMongoId()
  @IsOptional()
  municipalityId?: string;
}
