import { getAddress, isAddress, zeroAddress } from 'viem';

export type TenantWalletStatus = 'MISSING' | 'VERIFIED';

export type TenantWalletVerificationFields = {
  accountAddress?: string | null;
  accountAddressNormalized?: string | null;
  walletVerifiedAt?: Date | string | null;
  walletVerificationSource?: string | null;
};

export type TenantWalletVerificationState = {
  accountAddress: string | null;
  accountAddressNormalized: string | null;
  hasWallet: boolean;
  isWalletValid: boolean;
  isWalletVerified: boolean;
  requiresWalletUpdate: boolean;
  walletStatus: TenantWalletStatus;
};

export function normalizeTenantWalletAddress(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw || !isAddress(raw)) {
    return null;
  }
  const checksumAddress = getAddress(raw);
  if (checksumAddress === zeroAddress) {
    return null;
  }
  return checksumAddress;
}

export function getTenantWalletVerificationState(
  fields: TenantWalletVerificationFields,
): TenantWalletVerificationState {
  const rawAccountAddress = fields.accountAddress?.trim() || null;
  const accountAddress = normalizeTenantWalletAddress(fields.accountAddress);
  const accountAddressNormalized = fields.accountAddressNormalized?.trim().toLowerCase() || null;
  const hasWallet = Boolean(rawAccountAddress);
  const isWalletValid = Boolean(accountAddress);
  const hasNormalizedAddress =
    isWalletValid && accountAddressNormalized === accountAddress?.toLowerCase();
  const hasVerificationMetadata =
    Boolean(fields.walletVerifiedAt) && Boolean(fields.walletVerificationSource?.trim());
  const isWalletVerified = isWalletValid && hasNormalizedAddress && hasVerificationMetadata;

  return {
    accountAddress,
    accountAddressNormalized,
    hasWallet,
    isWalletValid,
    isWalletVerified,
    requiresWalletUpdate: !isWalletVerified,
    walletStatus: isWalletVerified ? 'VERIFIED' : 'MISSING',
  };
}
