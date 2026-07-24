import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  tokenAccreditationSourceTypes,
  tokenAccreditationStatuses,
  TokenAccreditationSourceType,
  TokenAccreditationStatus,
} from '../tvd.constants';
import {
  TvdAdminOperationStatus,
  TvdAdminOperationType,
} from '../types/tvd-admin-operations.types';

export class TvdAccreditationListQueryDto {
  @IsOptional()
  @IsEnum(tokenAccreditationStatuses)
  status?: TokenAccreditationStatus;

  @IsOptional()
  @IsEnum(tokenAccreditationSourceTypes)
  sourceType?: TokenAccreditationSourceType;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class TvdAdminAccreditationListQueryDto extends TvdAccreditationListQueryDto {
  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @IsMongoId()
  assignmentId?: string;
}

export class TvdAdminInstitutionListQueryDto {
  @IsOptional()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class TvdAdminOperationsQueryDto {
  @IsOptional()
  @IsMongoId()
  tenantId?: string;

  @IsOptional()
  @IsEnum(TvdAdminOperationStatus)
  status?: TvdAdminOperationStatus;

  @IsOptional()
  @IsEnum(TvdAdminOperationType)
  operationType?: TvdAdminOperationType;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
