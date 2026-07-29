import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OfficialPublicationPreparationService } from '@/modules/institutional-voting/services/publication/official-publication-preparation.service';

describe('OfficialPublicationPreparationService', () => {
  const eventId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const applicationId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const requesterId = new Types.ObjectId();
  const padronVersionId = new Types.ObjectId();
  const requester = { sub: String(requesterId), role: 'INSTITUTIONAL_ADMIN' };
  const event = {
    _id: eventId,
    tenantId,
    state: 'READY_FOR_REVIEW',
    name: 'Votacion oficial',
    objective: 'Objetivo',
    votingStart: new Date('2026-08-01T12:00:00.000Z'),
    votingEnd: new Date('2026-08-02T12:00:00.000Z'),
    resultsPublishAt: new Date('2026-08-03T12:00:00.000Z'),
    publishDeadline: new Date('2026-08-01T11:00:00.000Z'),
  } as any;

  const preparedVote = {
    secrets: ['0x01', '0x02'],
    ciMerkleTree: { root: 111n, layers: [[1n], [111n]] },
    voteMerkleTree: { root: 222n, layers: [[2n], [222n]] },
    optionsWithBlank: ['A', 'B', 'BLANK'],
    callData: {
      to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
      value: 0n,
      data: '0x1234',
    },
    createVoteArgs: ['args'],
    onChainElectionId: 123n,
  };

  function setup(overrides: Record<string, any> = {}) {
    const active = overrides.active ?? null;
    const request = {
      requestId: 'request-1',
      status: 'PREPARING',
      _id: new Types.ObjectId(),
    };
    const deps = {
      votingEventModel: {},
      votingOptionModel: {
        find: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ name: 'A' }, { name: 'B' }]),
        }),
      },
      padronVersionModel: {
        findOne: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ _id: padronVersionId }),
        }),
      },
      accessService: {
        getEventOrThrow: jest.fn().mockResolvedValue(event),
        assertTenantWriteAccess: jest.fn().mockResolvedValue(undefined),
        resolveOfficialPublicationInstitution: jest.fn().mockResolvedValue({
          institutionId: String(applicationId),
          applicationId: String(applicationId),
          assignmentId: String(assignmentId),
          accountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          signerUserId: String(requesterId),
          smartAccountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        }),
      },
      padronService: {
        removeUnregisteredStagingEntriesForOfficialPublication: jest.fn().mockResolvedValue({ removedCount: 0 }),
        materializeActiveDraftVersion: jest.fn().mockResolvedValue(undefined),
      },
      padronUsersService: {
        getPadronUsersFromEvent: jest
          .fn()
          .mockResolvedValue([{ dni: '1001' }, { dni: '1002' }]),
      },
      issuerService: {
        getDidsByDnis: jest.fn().mockResolvedValue([
          { dni: '1001', did: 'did:1' },
          { dni: '1002', did: 'did:2' },
        ]),
      },
      voteWritterService: {
        prepareCreateVote: jest.fn().mockResolvedValue(preparedVote),
        executePreparedCreateVote: jest.fn(),
      },
      tvdBlockchainService: {
        validateVotePublicationPreflight: jest.fn().mockResolvedValue({
          chainId: 84532,
          proxyAddress: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
          implementationAddress: '0x24638b4A7fcbF4fC1B971F17Fcd2bae77777D3eF',
          creditsContractAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
          tokenAddress: '0x0156D96BAbC74139a5cdb2cf2C90FDA1F6B53562',
          spenderAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
          tvdPerCredit: '1000000000000000000',
          requiredCredits: '2',
          requiredTvd: '2000000000000000000',
          simulated: true,
        }),
      },
      requestService: {
        getActiveRequestByEventId: jest.fn().mockResolvedValue(active),
        createOrGetActiveRequest: jest.fn().mockResolvedValue({ request, created: true }),
        attachPreparedArtifact: jest.fn().mockResolvedValue(request),
        markPrepared: jest.fn().mockResolvedValue({ ...request, status: 'PENDING_APPROVAL' }),
        markFailedRetryable: jest.fn().mockResolvedValue(undefined),
      },
      artifactsService: {
        saveArtifact: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      },
    };
    const service = new OfficialPublicationPreparationService(
      deps.votingEventModel as any,
      deps.votingOptionModel as any,
      deps.padronVersionModel as any,
      deps.accessService as any,
      deps.padronService as any,
      deps.padronUsersService as any,
      deps.issuerService as any,
      deps.voteWritterService as any,
      deps.tvdBlockchainService as any,
      deps.requestService as any,
      deps.artifactsService as any,
    );
    return { service, deps, request };
  }

  it('prepara una solicitud, congela convotatedUsers y no ejecuta blockchain', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
    const { service, deps } = setup();

    const result = await service.prepareOfficialPublication(String(eventId), requester);

    expect(result.request.status).toBe('PENDING_APPROVAL');
    expect(deps.padronUsersService.getPadronUsersFromEvent).toHaveBeenCalledTimes(1);
    expect(deps.voteWritterService.prepareCreateVote).toHaveBeenCalledWith(
      event,
      String(applicationId),
      ['1001', '1002'],
      ['A', 'B'],
    );
    expect(deps.tvdBlockchainService.validateVotePublicationPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: String(applicationId),
        requiredCredits: 2n,
        createVoteArgs: preparedVote.createVoteArgs,
      }),
    );
    expect(deps.requestService.createOrGetActiveRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        institutionId: String(applicationId),
        enabledVotersCount: 2,
        creditsRequired: '2',
        tvdRequired: '2000000000000000000',
        tvdPerCredit: '1000000000000000000',
        approveRequired: true,
        allowanceBefore: '0',
        walletDebitRequired: '2000000000000000000',
        executionMode: 'BATCH',
        callsCount: 2,
        spender: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
        signerUserId: String(requesterId),
        smartAccountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        entryPointVersion: '0.6',
      }),
    );
    expect(deps.artifactsService.saveArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        voters: ['1001', '1002'],
        dids: expect.any(Array),
        preparedVote,
      }),
    );
    expect(deps.voteWritterService.executePreparedCreateVote).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('repeticion devuelve la solicitud activa sin regenerar artefactos', async () => {
    const active = { requestId: 'existing', status: 'PENDING_APPROVAL' };
    const { service, deps } = setup({ active });

    const result = await service.prepareOfficialPublication(String(eventId), requester);

    expect(result.request).toBe(active);
    expect(deps.padronUsersService.getPadronUsersFromEvent).not.toHaveBeenCalled();
    expect(deps.voteWritterService.prepareCreateVote).not.toHaveBeenCalled();
  });

  it('falla sin votantes y no crea solicitud colgada', async () => {
    const { service, deps } = setup();
    deps.padronUsersService.getPadronUsersFromEvent.mockResolvedValueOnce([]);

    await expect(
      service.prepareOfficialPublication(String(eventId), requester),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(deps.requestService.createOrGetActiveRequest).not.toHaveBeenCalled();
  });

  it('falla de cifrado conserva codigo especifico y etapa de artifact', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
    const { service, deps, request } = setup();
    const error = new Error('OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING') as any;
    error.code = 'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING';
    deps.artifactsService.saveArtifact.mockRejectedValueOnce(error);

    await expect(
      service.prepareOfficialPublication(String(eventId), requester),
    ).rejects.toBe(error);

    expect(deps.requestService.markFailedRetryable).toHaveBeenCalledWith(
      request.requestId,
      String(requesterId),
      'OFFICIAL_PUBLICATION_ARTIFACT_KEY_MISSING',
      'No se pudo completar la preparacion de la publicacion oficial',
      'PREPARING',
      new Date('2026-07-22T12:00:00.000Z'),
      'ARTIFACT_ENCRYPTION',
    );
    jest.useRealTimers();
  });

  it('calcula callDataHash canonico y sensible a to, value y data', () => {
    const { service } = setup();
    const base = {
      to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
      value: 0n,
      data: '0x1234',
    };

    const hash = service.buildCanonicalCallDataHash(base);

    expect(service.buildCanonicalCallDataHash({ ...base })).toBe(hash);
    expect(
      service.buildCanonicalCallDataHash({
        ...base,
        to: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
      }),
    ).not.toBe(hash);
    expect(service.buildCanonicalCallDataHash({ ...base, value: 1n })).not.toBe(hash);
    expect(service.buildCanonicalCallDataHash({ ...base, data: '0x1235' })).not.toBe(hash);
    expect(() =>
      service.buildCanonicalCallDataHash({ ...base, data: 'not-hex' }),
    ).toThrow(BadRequestException);
  });
});
