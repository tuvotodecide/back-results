export const OFFICIAL_PUBLICATION_MOBILE_AUTH_PURPOSE = 'OFFICIAL_PUBLICATION' as const;

export type OfficialPublicationMobileAuthPurpose =
  typeof OFFICIAL_PUBLICATION_MOBILE_AUTH_PURPOSE;

export type OfficialPublicationMobileAuthContext = {
  apiKeyHash: string;
  requestId: string;
  eventId: string;
  did: string;
  dni: string;
  subjectId: string;
  smartAccountAddress: string;
  issuedAt: string;
  expiresAt: string;
  purpose: OfficialPublicationMobileAuthPurpose;
};

export type OfficialPublicationMobileRequestUser = {
  sub: string;
  dni: string;
  smartAccountAddress: string;
  requestId: string;
  authType: 'OFFICIAL_PUBLICATION_MOBILE_ZK';
};
