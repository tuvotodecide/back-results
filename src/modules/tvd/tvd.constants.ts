export const tvdCurrencies = ['BOB'] as const;
export type TvdFiatCurrency = typeof tvdCurrencies[number];

export const tokenAccreditationSourceTypes = [
  'QR_PAYMENT',
  'MANUAL_GRANT',
] as const;
export type TokenAccreditationSourceType =
  typeof tokenAccreditationSourceTypes[number];

export const tokenAccreditationStatuses = [
  'PENDING',
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED',
  'NEEDS_REVIEW',
] as const;
export type TokenAccreditationStatus =
  typeof tokenAccreditationStatuses[number];

export const tokenAccreditationFailureCategories = [
  'RETRYABLE',
  'FINAL',
  'AMBIGUOUS',
] as const;
export type TokenAccreditationFailureCategory =
  typeof tokenAccreditationFailureCategories[number];

export const TVD_CONVERSION_ROUNDING_MODE = 'FLOOR' as const;
