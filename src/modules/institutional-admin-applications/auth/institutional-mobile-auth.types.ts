export const INSTITUTIONAL_MOBILE_AUTH_PURPOSE = 'INSTITUTIONAL_AUTHORIZATION' as const;
export const INSTITUTIONAL_INVITATION_MOBILE_AUTH_PURPOSE =
  'INSTITUTIONAL_INVITATION' as const;
export const INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION =
  'INSTITUTIONAL_INVITATION_REGISTRATION_CONTINUATION' as const;

export type InstitutionalInvitationRegistrationContinuation = {
  purpose: 'D3_ADMIN_REGISTRATION';
  invitationId: string;
  tenantId: string;
  dni: string;
  smartAccountAddress: string;
  did: string;
  mobileAuthContextHash: string;
  issuedAt: string;
  expiresAt: string;
  usedAt?: string;
  state?: 'AVAILABLE' | 'CLAIMED' | 'COMPLETED';
};

export type InstitutionalInvitationRegistrationContinuationClaim = {
  claimId: string;
  continuation: InstitutionalInvitationRegistrationContinuation;
};

export interface InstitutionalInvitationRegistrationContinuationService {
  issueInvitationRegistrationContinuation(mobileAuthContextHash: string): Promise<{
    continuationCode: string;
    expiresAt: string;
  }>;
  getInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
  ): Promise<InstitutionalInvitationRegistrationContinuation>;
  claimInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
  ): Promise<InstitutionalInvitationRegistrationContinuationClaim>;
  completeInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
    claimId: string,
    applicationId: string,
    session?: unknown,
  ): Promise<void>;
  releaseInvitationRegistrationContinuation(
    continuationCode: string,
    invitationId: string,
    claimId: string,
  ): Promise<void>;
}

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
  /** Hash interno de la sesión ZK; nunca se expone al cliente web. */
  mobileAuthContextHash: string;
  authType: 'INSTITUTIONAL_INVITATION_MOBILE_ZK';
};
