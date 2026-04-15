import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewInstitutionalAdminApplicationDto {
  @ApiPropertyOptional({
    description: 'Razón opcional para rechazo, revocación o reapertura.',
    example: 'Documentación incompleta',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
