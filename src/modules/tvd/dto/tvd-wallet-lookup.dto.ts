import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class TvdAdminWalletLookupQueryDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @IsNotEmpty()
  accountAddress!: string;
}

export type TvdWalletIdentityStatus =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_INVALID_RESPONSE';

export type TvdWalletAssociationStatus =
  | 'ASSOCIATED'
  | 'UNASSOCIATED'
  | 'DISABLED'
  | 'INCOMPATIBLE'
  | 'INCONSISTENT';

export type TvdWalletLookupReasonCode =
  | 'WALLET_AVAILABLE'
  | 'WALLET_NOT_REGISTERED'
  | 'WALLET_ASSOCIATED'
  | 'WALLET_DISABLED'
  | 'WALLET_INCOMPATIBLE'
  | 'WALLET_INCONSISTENT'
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_INVALID_RESPONSE';

export type TvdWalletLookupInstitutionSummary = {
  tenantId: string;
  tenantName: string;
  tenantActive: boolean;
  assignmentId: string;
  userId: string;
  institutionalRole: string | null;
  assignmentStatus: string | null;
  assignmentActive: boolean;
  userActive: boolean | null;
  walletStatus: 'MISSING' | 'VERIFIED';
  walletVerifiedAt: Date | string | null;
  walletVerificationSource: string | null;
};

export type TvdWalletLookupResponseDto = {
  accountAddress: string;
  registeredInIdentity: boolean;
  identityStatus: TvdWalletIdentityStatus;
  associationStatus: TvdWalletAssociationStatus;
  canUse: boolean;
  reasonCode: TvdWalletLookupReasonCode;
  associations: TvdWalletLookupInstitutionSummary[];
};
