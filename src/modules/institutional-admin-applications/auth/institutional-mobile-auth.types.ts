export const INSTITUTIONAL_MOBILE_AUTH_PURPOSE = 'INSTITUTIONAL_AUTHORIZATION' as const;
export const INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE =
  'INSTITUTIONAL_INVITATION' as const;

export type InstitutionalMobileAuthContext = {
  apiKeyHash: string;
  applicationId: string;
  tenantId: string;
  signerUserId: string;
  did: string;
  dni: string;
  smartAccountAddress: string;
  issuedAt: string;
  expiresAt: string;
  purpose: typeof INSTITUTIONAL_MOBILE_AUTH_PURPOSE;
};

export type InstitutionalMobileRequestUser = {
  sub: string;
  dni: string;
  smartAccountAddress: string;
  applicationId: string;
  authType: 'INSTITUTIONAL_MOBILE_ZK';
};

export type InstitutionalInvitationMobileAuthContext = {
  apiKeyHash: string;
  invitationId: string;
  invitedUserId: string;
  tenantId: string;
  did: string;
  dni: string;
  smartAccountAddress: string;
  issuedAt: string;
  expiresAt: string;
  purpose: typeof INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE;
};

export type InstitutionalInvitationMobileRequestUser = {
  sub: string;
  dni: string;
  smartAccountAddress: string;
  invitationId: string;
  authType: 'INSTITUTIONAL_INVITATION_MOBILE_ZK';
};
