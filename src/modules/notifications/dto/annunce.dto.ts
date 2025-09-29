import { IsMongoId, IsOptional, IsString } from "class-validator";

export class AnnounceCountDto {
  @IsOptional()
  @IsMongoId()
  locationId?: string;

  @IsOptional()
  @IsString()
  locationCode?: string;

  @IsOptional()
  @IsMongoId()
  tableId?: string;

  @IsOptional()
  @IsString()
  tableCode?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}