export const INSTITUTIONAL_MOBILE_AUTH_PURPOSE = 'INSTITUTIONAL_AUTHORIZATION' as const;

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
