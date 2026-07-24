import { Transform } from 'class-transformer';
import { IsEnum, IsString, Matches } from 'class-validator';
import { TvdFiatCurrency, tvdCurrencies } from '../tvd.constants';

const BOB_AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export class TvdMyQuoteQueryDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @Matches(BOB_AMOUNT_REGEX)
  amount: string;

  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .toUpperCase(),
  )
  @IsEnum(tvdCurrencies)
  currency: TvdFiatCurrency;
}

export type TvdInstitutionalQuoteResponseDto = {
  fiatAmount: string;
  fiatAmountMinor: string;
  fiatCurrency: TvdFiatCurrency;
  estimatedTvd: string;
  estimatedTvdSmallestUnit: string | null;
  bobPerToken: string;
  exchangeRateVersion: number;
  quotedAt: string;
};
