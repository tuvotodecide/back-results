import {
  OFFICIAL_PUBLICATION_ACTIVE_STATUSES,
  OFFICIAL_PUBLICATION_REQUEST_STATUSES,
  OFFICIAL_PUBLICATION_TERMINAL_STATUSES,
  OfficialPublicationRequest,
  OfficialPublicationRequestSchema,
} from '@/modules/institutional-voting/schemas/official-publication-request.schema';

describe('OfficialPublicationRequestSchema', () => {
  it('declara la coleccion y todos los estados requeridos', () => {
    expect(OfficialPublicationRequest.name).toBe('OfficialPublicationRequest');
    expect(OFFICIAL_PUBLICATION_REQUEST_STATUSES).toEqual([
      'PREPARING',
      'PENDING_APPROVAL',
      'CLAIMED',
      'SIGNING',
      'SUBMITTED',
      'CHAIN_PENDING',
      'CHAIN_CONFIRMED',
      'FINALIZING',
      'COMPLETED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'FAILED_RETRYABLE',
      'FAILED_FINAL',
      'NEEDS_REVIEW',
    ]);
    expect(OFFICIAL_PUBLICATION_TERMINAL_STATUSES).toEqual([
      'COMPLETED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'FAILED_FINAL',
    ]);
    expect(OFFICIAL_PUBLICATION_ACTIVE_STATUSES).toContain('NEEDS_REVIEW');
    expect(OFFICIAL_PUBLICATION_ACTIVE_STATUSES).not.toContain('COMPLETED');
  });

  it('define campos persistentes requeridos para continuar tras reinicio', () => {
    const paths = OfficialPublicationRequestSchema.paths;

    [
      'requestId',
      'eventId',
      'activeKey',
      'tenantId',
      'institutionId',
      'applicationId',
      'requestedByUserId',
      'assignmentId',
      'signerWallet',
      'chainId',
      'onChainElectionId',
      'status',
      'version',
      'expiresAt',
      'callData',
      'callDataHash',
      'snapshotHash',
      'preparedArtifactId',
      'proxyAddress',
      'implementationAddress',
      'abiVersion',
      'padronVersionId',
      'enabledVotersCount',
      'optionsHash',
      'merkleRoots',
      'nullifiersRef',
      'creditsRequired',
      'tvdRequired',
      'tvdPerCredit',
      'tokenSource',
      'spender',
      'userOpHash',
      'txHash',
      'confirmationBlock',
      'confirmations',
      'errorCode',
      'safeMessage',
      'resumeFromStatus',
      'lockedBy',
      'lockedUntil',
      'finalizationProgress',
      'statusHistory',
    ].forEach((path) => expect(paths[path]).toBeDefined());
  });

  it('define indices para solicitud activa, userOpHash, txHash, expiracion y locks', () => {
    const indexes = OfficialPublicationRequestSchema.indexes();

    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { activeKey: 1 },
          expect.objectContaining({
            unique: true,
            name: 'unique_active_official_publication_request_key',
          }),
        ],
        [
          { eventId: 1, status: 1 },
          expect.objectContaining({
            unique: true,
            name: 'unique_active_official_publication_request_per_event',
            partialFilterExpression: {
              status: { $in: OFFICIAL_PUBLICATION_ACTIVE_STATUSES },
            },
          }),
        ],
        [
          { userOpHash: 1 },
          expect.objectContaining({
            unique: true,
            name: 'unique_official_publication_user_op_hash',
          }),
        ],
        [
          { txHash: 1 },
          expect.objectContaining({
            unique: true,
            name: 'unique_official_publication_tx_hash',
          }),
        ],
        [{ expiresAt: 1, status: 1 }, expect.any(Object)],
        [{ lockedUntil: 1, status: 1 }, expect.any(Object)],
      ]),
    );
  });
});
