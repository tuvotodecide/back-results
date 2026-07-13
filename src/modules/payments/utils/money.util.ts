import { BadRequestException } from '@nestjs/common';

const DECIMAL_AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function parseBobAmountToMinor(amount: string): string {
  const normalized = String(amount ?? '').trim();
  if (!DECIMAL_AMOUNT_REGEX.test(normalized)) {
    throw new BadRequestException('Monto invalido');
  }

  const [whole, decimals = ''] = normalized.split('.');
  const minor = `${whole}${decimals.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const value = minor || '0';
  if (BigInt(value) <= 0n) {
    throw new BadRequestException('Monto debe ser positivo');
  }
  return value;
}

export function minorToDecimal(amountMinor: string): string {
  const raw = String(amountMinor ?? '0').replace(/^0+(?=\d)/, '');
  const padded = raw.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const cents = padded.slice(-2);
  return `${whole}.${cents}`;
}

export function assertMinorWithinBounds(
  amountMinor: string,
  minMinor: string,
  maxMinor: string,
) {
  const amount = BigInt(amountMinor);
  if (amount < BigInt(minMinor) || amount > BigInt(maxMinor)) {
    throw new BadRequestException('Monto fuera de limites permitidos');
  }
}
