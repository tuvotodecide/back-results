import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewInstitutionalAdminApplicationDto {
  @ApiPropertyOptional({
    description: 'Razón opcional para rechazo, revocación o reapertura.',
    example: 'Documentación incompleta',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason?: string;
}
