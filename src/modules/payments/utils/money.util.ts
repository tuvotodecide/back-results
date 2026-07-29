import { BadRequestException } from '@nestjs/common';

const DECIMAL_AMOUNT_REGEX = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const MINOR_UNITS_REGEX = /^(?:0|[1-9]\d*)$/;
const RED_ENLACE_BIG_DECIMAL_10_2_MAX_MINOR = 9_999_999_999n;

export function parseBobAmountToMinor(amount: string | number): string {
  const normalized = String(amount ?? '');
  if (normalized !== normalized.trim()) {
    throw new BadRequestException('Monto invalido');
  }
  if (!DECIMAL_AMOUNT_REGEX.test(normalized)) {
    throw new BadRequestException('Monto invalido');
  }

  const [whole, decimals = ''] = normalized.split('.');
  const minor = `${whole}${decimals.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const value = minor || '0';
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new BadRequestException('Monto debe ser positivo');
  }
  if (parsed > RED_ENLACE_BIG_DECIMAL_10_2_MAX_MINOR) {
    throw new BadRequestException('Monto fuera de limites permitidos');
  }
  return value;
}

export function minorToDecimal(amountMinor: string): string {
  const rawInput = String(amountMinor ?? '');
  if (!MINOR_UNITS_REGEX.test(rawInput)) {
    throw new BadRequestException('Monto invalido');
  }
  const raw = rawInput.replace(/^0+(?=\d)/, '');
  const padded = raw.padStart(3, '0');
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const cents = padded.slice(-2);
  return `${whole}.${cents}`;
}

export function minorToRedEnlaceDecimal(amountMinor: string): string {
  const raw = String(amountMinor ?? '');
  if (!MINOR_UNITS_REGEX.test(raw)) {
    throw new BadRequestException('Monto invalido');
  }
  const normalized = raw.replace(/^0+(?=\d)/, '') || '0';
  const parsed = BigInt(normalized);
  if (parsed <= 0n) {
    throw new BadRequestException('Monto debe ser positivo');
  }
  if (parsed > RED_ENLACE_BIG_DECIMAL_10_2_MAX_MINOR) {
    throw new BadRequestException('Monto fuera de limites permitidos');
  }
  return minorToDecimal(normalized);
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
