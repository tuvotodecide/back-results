import { IsDateString, IsIn, IsMongoId, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { institutionalAuditActions } from '../schemas/institutional-audit-event.schema';

export class InstitutionalAuditQueryDto {
  @IsOptional()
  @IsIn(institutionalAuditActions)
  action?: string;

  @IsOptional()
  @IsMongoId()
  actorUserId?: string;

  @IsOptional()
  @IsMongoId()
  targetUserId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  correlationId?: string;
}
