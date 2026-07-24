import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  minorToDecimal,
  parseBobAmountToMinor,
} from '@/modules/payments/utils/money.util';
import {
  TvdInstitutionalQuoteResponseDto,
  TvdMyQuoteQueryDto,
} from '../dto/tvd-quote.dto';
import { TvdFiatCurrency } from '../tvd.constants';
import { TvdConversionService } from './tvd-conversion.service';
import { TvdExchangeRatesService } from './tvd-exchange-rates.service';

export type TvdPaymentQuoteSnapshot = {
  fiatAmountMinor: string;
  fiatCurrency: TvdFiatCurrency;
  bobPerToken: string;
  exchangeRateVersion: number;
  tokenAmount: string;
  tokenAmountSmallestUnit?: string | null;
  quotedAt: Date;
};

@Injectable()
export class TvdQuotesService {
  constructor(
    private readonly exchangeRates: TvdExchangeRatesService,
    private readonly conversion: TvdConversionService,
    private readonly configService: ConfigService,
  ) {}

  async createPaymentQuoteSnapshot(input: {
    amountMinor: string;
    currency: TvdFiatCurrency;
    quotedAt?: Date;
  }): Promise<TvdPaymentQuoteSnapshot> {
    if (input.currency !== 'BOB') {
      throw new BadRequestException('currency debe ser BOB');
    }

    const quotedAt = input.quotedAt ?? new Date();
    const rate = await this.exchangeRates.resolveActiveRateAt(quotedAt, 'BOB');
    const conversion = this.conversion.convertBobMinorToTvd({
      amountMinor: input.amountMinor,
      bobPerToken: rate.bobPerToken,
      tokenDecimals: this.getConfiguredTokenDecimals(),
    });

    return {
      fiatAmountMinor: conversion.fiatAmountMinor,
      fiatCurrency: 'BOB',
      bobPerToken: conversion.bobPerToken,
      exchangeRateVersion: rate.version,
      tokenAmount: conversion.tokenAmount,
      tokenAmountSmallestUnit: conversion.tokenAmountSmallestUnit,
      quotedAt,
    };
  }

  async createInstitutionalQuote(
    input: TvdMyQuoteQueryDto,
  ): Promise<TvdInstitutionalQuoteResponseDto> {
    const amountMinor = parseBobAmountToMinor(input.amount);
    const snapshot = await this.createPaymentQuoteSnapshot({
      amountMinor,
      currency: input.currency,
    });

    return {
      fiatAmount: minorToDecimal(snapshot.fiatAmountMinor),
      fiatAmountMinor: snapshot.fiatAmountMinor,
      fiatCurrency: snapshot.fiatCurrency,
      estimatedTvd: snapshot.tokenAmount,
      estimatedTvdSmallestUnit: snapshot.tokenAmountSmallestUnit ?? null,
      bobPerToken: snapshot.bobPerToken,
      exchangeRateVersion: snapshot.exchangeRateVersion,
      quotedAt: snapshot.quotedAt.toISOString(),
    };
  }

  private getConfiguredTokenDecimals() {
    const raw = this.configService.get<string>('app.tvd.decimals');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      throw new BadRequestException(
        'TVD_DECIMALS debe configurarse provisionalmente hasta validar decimals() on-chain',
      );
    }
    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
      throw new BadRequestException('TVD_DECIMALS invalido');
    }
    return decimals;
  }
}
