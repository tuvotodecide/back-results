import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationFinalizationService } from '@/modules/institutional-voting/services/publication/official-publication-finalization.service';

describe('OfficialPublicationFinalizationService', () => {
  const eventId = new Types.ObjectId();
  const requestBase = {
    requestId: 'request-1',
    eventId,
    institutionId: 'institution-1',
    snapshotHash: 'snapshot-1',
    enabledVotersCount: 2,
    status: 'CHAIN_CONFIRMED',
    version: 3,
    txHash: '0xtx',
    signerWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chainId: 84532,
    finalizationProgress: {},
  } as any;
  const preparedVote = {
    secrets: ['0x01', '0x02'],
    ciMerkleTree: { root: 1n, layers: [[1n]] },
    voteMerkleTree: { root: 2n, layers: [[2n]] },
    optionsWithBlank: ['A', 'BLANK'],
    callData: { to: '0xproxy', value: 0n, data: '0x1234' },
    createVoteArgs: [],
    onChainElectionId: 123n,
  };
  const payload = {
    voters: ['1001', '1002'],
    dids: [
      { dni: '1001', did: 'did:1' },
      { dni: '1002', did: 'did:2' },
    ],
    preparedVote: {} as any,
  };

  function setup(overrides: Record<string, any> = {}) {
    const request = { ...requestBase, ...(overrides.request ?? {}) };
    const deps = {
      votingEventModel: {
        findById: jest.fn().mockResolvedValue({ _id: eventId }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      enabledSessionModel: {
        bulkWrite: jest.fn().mockResolvedValue({}),
      },
      requestService: {
        getRequestById: jest.fn().mockResolvedValue(request),
        startFinalization: jest.fn().mockImplementation(async () => {
          request.status = 'FINALIZING';
          return request;
        }),
        retryFinalization: jest.fn().mockImplementation(async () => {
          request.status = 'FINALIZING';
          request.resumeFromStatus = null;
          return request;
        }),
        markProgress: jest.fn().mockImplementation(async (_requestId, key) => {
          request.finalizationProgress = {
            ...request.finalizationProgress,
            [key]: new Date('2026-07-22T12:00:00.000Z'),
          };
          return request;
        }),
        markCompleted: jest.fn().mockResolvedValue({ ...request, status: 'COMPLETED' }),
        markFailedRetryable: jest.fn().mockResolvedValue({ ...request, status: 'FAILED_RETRYABLE' }),
        markNeedsReview: jest.fn().mockResolvedValue({ ...request, status: 'NEEDS_REVIEW' }),
      },
      artifactsService: {
        loadArtifactPayload: jest.fn().mockResolvedValue({
          artifact: {
            eventId,
            institutionId: 'institution-1',
            snapshotHash: 'snapshot-1',
            votersCount: 2,
          },
          payload,
        }),
        deserializePreparedVote: jest.fn().mockReturnValue(preparedVote),
        saveCredentialData: jest.fn().mockResolvedValue({}),
      },
      voteWritterService: {
        persistPreparedMerkleTrees: jest.fn().mockResolvedValue(undefined),
        executePreparedCreateVote: jest.fn(),
      },
      issuerService: {
        issueCredential: jest.fn().mockResolvedValue({
          '1001': { credentialData: 'cred-1' },
          '1002': { credentialData: 'cred-2' },
        }),
      },
    };
    const service = new OfficialPublicationFinalizationService(
      deps.votingEventModel as any,
      deps.enabledSessionModel as any,
      deps.requestService as any,
      deps.artifactsService as any,
      deps.voteWritterService as any,
      deps.issuerService as any,
    );
    return { service, deps, request };
  }

  it('finaliza desde CHAIN_CONFIRMED usando artefactos preparados sin blockchain', async () => {
    const { service, deps } = setup();

    const result = await service.finalizeOfficialPublication('request-1', 'worker');

    expect(result.request.status).toBe('COMPLETED');
    expect(deps.requestService.startFinalization).toHaveBeenCalledWith('request-1', 'worker');
    expect(deps.voteWritterService.persistPreparedMerkleTrees).toHaveBeenCalledWith(
      expect.objectContaining({ _id: eventId }),
      preparedVote,
    );
    expect(deps.issuerService.issueCredential).toHaveBeenCalledWith(
      payload.dids,
      String(eventId),
      ['0x01', '0x02'],
    );
    expect(deps.enabledSessionModel.bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { eventId, dni: '1001' },
            upsert: true,
          }),
        }),
      ]),
      { ordered: false },
    );
    expect(deps.votingEventModel.updateOne).toHaveBeenCalledWith(
      { _id: eventId },
      expect.objectContaining({
        $set: expect.objectContaining({
          state: 'OFFICIALLY_PUBLISHED',
          canEditStructure: false,
          publicationConfirmed: true,
          officialPublishedAt: expect.any(Date),
          officialPublicationTxHash: '0xtx',
          officialPublicationWallet: requestBase.signerWallet,
          officialPublicationChainId: String(requestBase.chainId),
        }),
      }),
    );
    expect(deps.voteWritterService.executePreparedCreateVote).not.toHaveBeenCalled();
  });

  it('repeticion sobre COMPLETED es exito idempotente sin efectos locales', async () => {
    const { service, deps } = setup({ request: { status: 'COMPLETED' } });

    const result = await service.finalizeOfficialPublication('request-1', 'worker');

    expect(result.reused).toBe(true);
    expect(deps.artifactsService.loadArtifactPayload).not.toHaveBeenCalled();
    expect(deps.votingEventModel.updateOne).not.toHaveBeenCalled();
  });

  it('rechaza estados anteriores a CHAIN_CONFIRMED', async () => {
    const { service } = setup({ request: { status: 'PENDING_APPROVAL' } });

    await expect(
      service.finalizeOfficialPublication('request-1', 'worker'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reanuda desde FAILED_RETRYABLE de finalizacion', async () => {
    const { service, deps } = setup({
      request: { status: 'FAILED_RETRYABLE', resumeFromStatus: 'FINALIZING' },
    });

    await service.finalizeOfficialPublication('request-1', 'worker');

    expect(deps.requestService.retryFinalization).toHaveBeenCalledWith(
      'request-1',
      'worker',
    );
  });

  it('reanuda despues de credenciales usando credentialData preparado sin reemitir', async () => {
    const { service, deps } = setup();
    deps.artifactsService.loadArtifactPayload.mockResolvedValue({
      artifact: {
        eventId,
        institutionId: 'institution-1',
        snapshotHash: 'snapshot-1',
        votersCount: 2,
      },
      payload: {
        ...payload,
        credentialData: {
          '1001': { credentialData: 'cred-1' },
          '1002': { credentialData: 'cred-2' },
        },
      },
    });

    await service.finalizeOfficialPublication('request-1', 'worker');

    expect(deps.issuerService.issueCredential).not.toHaveBeenCalled();
    expect(deps.enabledSessionModel.bulkWrite).toHaveBeenCalled();
  });

  it('no reemite credenciales cuando la emision previa quedo ambigua', async () => {
    const { service, deps } = setup({
      request: {
        finalizationProgress: {
          treesPersistedAt: new Date('2026-07-22T12:00:00.000Z'),
          credentialsIssuingAt: new Date('2026-07-22T12:01:00.000Z'),
        },
      },
    });

    const result = await service.finalizeOfficialPublication('request-1', 'worker');

    expect(result).toMatchObject({ completed: false, needsReview: true });
    expect(deps.issuerService.issueCredential).not.toHaveBeenCalled();
    expect(deps.requestService.markNeedsReview).toHaveBeenCalledWith(
      'request-1',
      'worker',
      'OFFICIAL_PUBLICATION_CREDENTIALS_AMBIGUOUS',
      'La emision de credenciales quedo ambigua y requiere revision antes de reintentar',
      'FINALIZING',
    );
  });

  it('fallo local posterior a chain conserva solicitud recuperable', async () => {
    const { service, deps } = setup();
    deps.votingEventModel.updateOne.mockRejectedValueOnce(new Error('mongo down'));

    await expect(
      service.finalizeOfficialPublication('request-1', 'worker'),
    ).rejects.toThrow('mongo down');
    expect(deps.requestService.markFailedRetryable).toHaveBeenCalledWith(
      'request-1',
      'worker',
      'OFFICIAL_PUBLICATION_FINALIZATION_FAILED',
      'La publicacion fue confirmada en blockchain y requiere reintentar la finalizacion local',
      'FINALIZING',
      undefined,
      'FINALIZATION',
    );
  });
});
