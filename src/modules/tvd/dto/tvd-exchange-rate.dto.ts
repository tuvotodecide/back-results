import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTvdExchangeRateDto {
  @IsIn(['BOB'])
  fiatCurrency!: 'BOB';

  @IsString()
  @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/, {
    message: 'bobPerToken must be a positive decimal string',
  })
  bobPerToken!: string;

  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsISO8601()
  validUntil?: string | null;

  @IsString()
  @MinLength(8)
  @MaxLength(240)
  reason!: string;
}

export class ListTvdExchangeRatesQueryDto {
  @IsOptional()
  @IsIn(['BOB'])
  currency?: 'BOB';

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  current?: string;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  page?: string;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  limit?: string;
}
