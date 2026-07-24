import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TvdQuotesService } from '@/modules/tvd/services/tvd-quotes.service';
import { TvdConversionService } from '@/modules/tvd/services/tvd-conversion.service';
import { TvdExchangeRatesService } from '@/modules/tvd/services/tvd-exchange-rates.service';

function createService(options?: {
  bobPerToken?: string;
  version?: number;
  decimals?: string;
  rateError?: Error;
}) {
  const exchangeRates = {
    resolveActiveRateAt: jest.fn(async () => {
      if (options?.rateError) throw options.rateError;
      return {
        bobPerToken: options?.bobPerToken ?? '2.5',
        version: options?.version ?? 7,
      };
    }),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.tvd.decimals') return options?.decimals ?? '18';
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new TvdQuotesService(
    exchangeRates as unknown as TvdExchangeRatesService,
    new TvdConversionService(),
    configService,
  );

  return { service, exchangeRates };
}

describe('TvdQuotesService institutional quote', () => {
  it('returns an exact read-only quote without accepting TVD from frontend', async () => {
    const { service, exchangeRates } = createService();

    const quote = await service.createInstitutionalQuote({
      amount: '10.50',
      currency: 'BOB',
    });

    expect(exchangeRates.resolveActiveRateAt).toHaveBeenCalledWith(
      expect.any(Date),
      'BOB',
    );
    expect(quote).toEqual(
      expect.objectContaining({
        fiatAmount: '10.50',
        fiatAmountMinor: '1050',
        fiatCurrency: 'BOB',
        estimatedTvd: '4.2',
        estimatedTvdSmallestUnit: '4200000000000000000',
        bobPerToken: '2.5',
        exchangeRateVersion: 7,
      }),
    );
    expect(quote).not.toHaveProperty('validUntil');
    expect(quote).not.toHaveProperty('requestedTvd');
  });

  it.each(['', '   ', '0', '-1', '10.123', 'abc'])(
    'rejects invalid BOB amount "%s"',
    async (amount) => {
      const { service, exchangeRates } = createService();

      await expect(
        service.createInstitutionalQuote({ amount, currency: 'BOB' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(exchangeRates.resolveActiveRateAt).not.toHaveBeenCalled();
    },
  );

  it('rejects currencies outside the institutional QR scope', async () => {
    const { service, exchangeRates } = createService();

    await expect(
      service.createInstitutionalQuote({
        amount: '10.50',
        currency: 'USD' as never,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(exchangeRates.resolveActiveRateAt).not.toHaveBeenCalled();
  });

  it('surfaces a missing active rate as a recoverable backend validation error', async () => {
    const { service, exchangeRates } = createService({
      rateError: new BadRequestException('No existe tasa TVD activa vigente'),
    });

    await expect(
      service.createInstitutionalQuote({ amount: '10.50', currency: 'BOB' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(exchangeRates.resolveActiveRateAt).toHaveBeenCalledTimes(1);
  });
});
