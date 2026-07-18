import { BadRequestException, Injectable } from '@nestjs/common';
import { TVD_CONVERSION_ROUNDING_MODE } from '../tvd.constants';

const POSITIVE_INTEGER_REGEX = /^(?:0|[1-9]\d*)$/;
const POSITIVE_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export type ConvertBobMinorToTvdInput = {
  amountMinor: string;
  bobPerToken: string;
  tokenDecimals: number;
};

export type ConvertBobMinorToTvdResult = {
  fiatAmountMinor: string;
  bobPerToken: string;
  tokenAmount: string;
  tokenAmountSmallestUnit: string;
  roundingMode: typeof TVD_CONVERSION_ROUNDING_MODE;
};

@Injectable()
export class TvdConversionService {
  /**
   * Formula:
   * floor((amountMinor / 100 BOB) / bobPerToken * 10^tokenDecimals)
   *
   * Rounding is intentionally FLOOR to avoid over-accrediting TVD.
   */
  convertBobMinorToTvd(
    input: ConvertBobMinorToTvdInput,
  ): ConvertBobMinorToTvdResult {
    const amountMinor = this.parsePositiveInteger(input.amountMinor, 'amountMinor');
    const rate = this.parsePositiveDecimal(input.bobPerToken, 'bobPerToken');
    const tokenDecimals = this.parseTokenDecimals(input.tokenDecimals);

    const tokenScale = 10n ** BigInt(tokenDecimals);
    const smallestUnit =
      (amountMinor * rate.scale * tokenScale) / (100n * rate.units);

    if (smallestUnit <= 0n) {
      throw new BadRequestException('La conversion produce cero TVD');
    }

    return {
      fiatAmountMinor: amountMinor.toString(),
      bobPerToken: rate.normalized,
      tokenAmount: this.formatUnits(smallestUnit, tokenDecimals),
      tokenAmountSmallestUnit: smallestUnit.toString(),
      roundingMode: TVD_CONVERSION_ROUNDING_MODE,
    };
  }

  assertPositiveDecimal(value: string, fieldName: string): string {
    return this.parsePositiveDecimal(value, fieldName).normalized;
  }

  assertPositiveInteger(value: string, fieldName: string): string {
    return this.parsePositiveInteger(value, fieldName).toString();
  }

  private parsePositiveInteger(value: string, fieldName: string): bigint {
    const normalized = String(value ?? '').trim();
    if (!POSITIVE_INTEGER_REGEX.test(normalized)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }
    const parsed = BigInt(normalized);
    if (parsed <= 0n) {
      throw new BadRequestException(`${fieldName} debe ser positivo`);
    }
    return parsed;
  }

  private parsePositiveDecimal(value: string, fieldName: string) {
    const normalized = this.normalizeDecimal(value);
    if (!POSITIVE_DECIMAL_REGEX.test(normalized)) {
      throw new BadRequestException(`${fieldName} invalido`);
    }

    const [whole, fraction = ''] = normalized.split('.');
    const scale = 10n ** BigInt(fraction.length);
    const units = BigInt(`${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0');
    if (units <= 0n) {
      throw new BadRequestException(`${fieldName} debe ser positivo`);
    }

    return { normalized, units, scale };
  }

  private normalizeDecimal(value: string) {
    const raw = String(value ?? '').trim();
    if (!raw) return raw;
    const [wholeRaw, fractionRaw] = raw.split('.');
    const whole = (wholeRaw || '0').replace(/^0+(?=\d)/, '') || '0';
    if (fractionRaw === undefined) return whole;
    const fraction = fractionRaw.replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  }

  private parseTokenDecimals(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 36) {
      throw new BadRequestException('TVD_DECIMALS invalido');
    }
    return value;
  }

  private formatUnits(value: bigint, decimals: number) {
    if (decimals === 0) return value.toString();

    const raw = value.toString().padStart(decimals + 1, '0');
    const whole = raw.slice(0, -decimals).replace(/^0+(?=\d)/, '') || '0';
    const fraction = raw.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  }
}
