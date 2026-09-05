import { ConflictException } from '@nestjs/common';
import { deflateSync } from 'node:zlib';
import { Types } from 'mongoose';
import { getAddress } from 'viem';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

jest.mock('@/api/electoralCredits', () => ({
  CreditsContractCalls: {
    liquidate: jest.fn(),
    tvdPerCredit: jest.fn(async () => 10n ** 18n),
  },
}));

import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { TvdCapacityService } from '@/modules/tvd/services/tvd-capacity.service';
import { ParticipationAnalyticsService } from '@/modules/institutional-voting/services/participation/participation-analytics.service';
import { ParticipationService } from '@/modules/institutional-voting/services/participation/participation.service';
import { OfficialPublicationPreparationService } from '@/modules/institutional-voting/services/publication/official-publication-preparation.service';

const wallet = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

const crcTable = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** PNG 1x1 RGB válido: el reporte exige una captura real del modal de analíticas. */
function createPngDataUrl() {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 69, 145, 81]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('MX-EA2 | Votaciones abiertas sin padron (unit)', () => {
  // ---------------------------------------------------------------------------
  // EA2-05 | Publicar votación abierta
  // ---------------------------------------------------------------------------

  describe('EA2-05 | prepareCreateVote de una votación abierta', () => {
    const merkletreeService = {
      buildMerkleTree: jest.fn(),
      stringToFieldElement: jest.fn((value: string) => BigInt(`0x${Buffer.from(value).toString('hex')}`)),
    };

    /**
     * VoteWritterService abre conexiones RPC en su constructor, así que se instancia por
     * prototipo: prepareCreateVote solo necesita la cadena y el servicio de merkletree.
     */
    function buildWriter() {
      return Object.assign(Object.create(VoteWritterService.prototype), {
        chain: 'base-sepolia',
        merkletreeService,
      }) as VoteWritterService;
    }

    function buildEvent(extra: Record<string, unknown> = {}) {
      return {
        _id: new Types.ObjectId(),
        name: 'Eleccion abierta',
        votingStart: new Date('2026-09-01T10:00:00.000Z'),
        votingEnd: new Date('2026-09-01T18:00:00.000Z'),
        resultsPublishAt: new Date('2026-09-01T20:00:00.000Z'),
        ...extra,
      } as any;
    }

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('EA2-05-004 envía 0 como root del merkle tree al contrato y no construye el árbol', async () => {
      const writer = buildWriter();
      const event = buildEvent({ isOpenVoting: true, maxOpenVoters: 300 });

      const prepared = await writer.prepareCreateVote(event, 'institution-1', [], ['Lista Unica']);

      expect(prepared.ciMerkleTree.root).toBe(0n);
      expect(prepared.ciMerkleTree.layers).toEqual([]);
      expect(merkletreeService.buildMerkleTree).not.toHaveBeenCalled();
      // Argumento 7 (índice 7) de createVote: enabledVotersMkRoot.
      expect(prepared.createVoteArgs[7]).toBe(0n);
    });

    it('EA2-05-005 envía maxOpenVoters como cantidad de votantes habilitados', async () => {
      const writer = buildWriter();
      const event = buildEvent({ isOpenVoting: true, maxOpenVoters: 300 });

      const prepared = await writer.prepareCreateVote(event, 'institution-1', [], ['Lista Unica']);

      // Argumento 6 (índice 6) de createVote: enabledVotersCount.
      expect(prepared.createVoteArgs[6]).toBe(300);
      expect(prepared.optionsWithBlank).toEqual(['Lista Unica', 'BLANK']);
    });

    it('EA2-05-006 una votación cerrada sigue construyendo el merkle tree del padrón', async () => {
      const writer = buildWriter();
      const event = buildEvent({ isOpenVoting: false });
      merkletreeService.buildMerkleTree.mockResolvedValue({ root: 42n, layers: [[1n, 2n]] });

      const prepared = await writer.prepareCreateVote(
        event,
        'institution-1',
        ['10001', '20002'],
        ['Lista Unica'],
      );

      expect(merkletreeService.buildMerkleTree).toHaveBeenCalledTimes(1);
      expect(prepared.ciMerkleTree.root).toBe(42n);
      expect(prepared.createVoteArgs[6]).toBe(2);
      expect(prepared.createVoteArgs[7]).toBe(42n);
    });
  });

  describe('EA2-05 | Solicitud de publicación oficial de una votación abierta', () => {
    const eventId = new Types.ObjectId();
    const tenantId = new Types.ObjectId();
    const applicationId = new Types.ObjectId();
    const requesterId = new Types.ObjectId();
    const requester = { sub: String(requesterId), role: 'INSTITUTIONAL_ADMIN' };

    const preparedVote = {
      secrets: [],
      ciMerkleTree: { root: 0n, layers: [] },
      optionsWithBlank: ['A', 'B', 'BLANK'],
      callData: { to: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523', value: 0n, data: '0x1234' },
      createVoteArgs: ['args'],
      onChainElectionId: 123n,
    };

    function setup(eventOverrides: Record<string, unknown>) {
      const event = {
        _id: eventId,
        tenantId,
        state: 'READY_FOR_REVIEW',
        name: 'Votacion abierta',
        objective: 'Objetivo',
        votingStart: new Date('2026-08-01T12:00:00.000Z'),
        votingEnd: new Date('2026-08-02T12:00:00.000Z'),
        resultsPublishAt: new Date('2026-08-03T12:00:00.000Z'),
        publishDeadline: new Date('2026-08-01T11:00:00.000Z'),
        ...eventOverrides,
      } as any;

      const deps = {
        votingEventModel: {},
        votingOptionModel: {
          find: jest.fn(() => ({ lean: jest.fn(async () => [{ name: 'A' }, { name: 'B' }]) })),
        },
        padronVersionModel: {
          findOne: jest.fn(() => ({ lean: jest.fn(async () => ({ _id: new Types.ObjectId() })) })),
        },
        accessService: {
          getEventOrThrow: jest.fn(async () => event),
          assertTenantWriteAccess: jest.fn(async () => undefined),
          resolveOfficialPublicationInstitution: jest.fn(async () => ({
            institutionId: String(applicationId),
            applicationId: String(applicationId),
            assignmentId: String(new Types.ObjectId()),
            accountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            signerUserId: String(requesterId),
            smartAccountAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          })),
        },
        padronService: { materializeActiveDraftVersion: jest.fn(async () => undefined) },
        padronUsersService: {
          getUnresolverPadronUsersFomEvent: jest.fn(async () => [{ dni: '1001' }, { dni: '1002' }]),
        },
        issuerService: { getDidsByDnis: jest.fn(async () => []) },
        voteWritterService: {
          prepareCreateVote: jest.fn(async () => preparedVote),
          executePreparedCreateVote: jest.fn(),
        },
        tvdBlockchainService: {
          validateVotePublicationPreflight: jest.fn(async () => ({
            chainId: 84532,
            proxyAddress: '0x36D4b585d0A05D12B7fa3A4cAD7f7C28e920C523',
            implementationAddress: '0x24638b4A7fcbF4fC1B971F17Fcd2bae77777D3eF',
            creditsContractAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
            tokenAddress: '0x0156D96BAbC74139a5cdb2cf2C90FDA1F6B53562',
            spenderAddress: '0xbb4ea03105e2d883ab234d95f10dc7cc5000bb40',
            tvdPerCredit: '1000000000000000000',
            requiredCredits: '300',
            requiredTvd: '300000000000000000000',
            simulated: true,
          })),
        },
        requestService: {
          getActiveRequestByEventId: jest.fn(async () => null),
          createOrGetActiveRequest: jest.fn(async () => ({
            request: { requestId: 'request-1', status: 'PREPARING', _id: new Types.ObjectId() },
            created: true,
          })),
          attachPreparedArtifact: jest.fn(async () => ({ requestId: 'request-1' })),
          markPrepared: jest.fn(async () => ({ requestId: 'request-1', status: 'PENDING_APPROVAL' })),
          markFailedRetryable: jest.fn(async () => undefined),
        },
        artifactsService: { saveArtifact: jest.fn(async () => ({ _id: new Types.ObjectId() })) },
      };

      const service = new OfficialPublicationPreparationService(
        deps.votingEventModel as never,
        deps.votingOptionModel as never,
        deps.padronVersionModel as never,
        deps.accessService as never,
        deps.padronService as never,
        deps.padronUsersService as never,
        deps.issuerService as never,
        deps.voteWritterService as never,
        deps.tvdBlockchainService as never,
        deps.requestService as never,
        deps.artifactsService as never,
      );

      return { service, deps };
    }

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('EA2-05-007 marca la solicitud como abierta y usa maxOpenVoters como enabledVotersCount', async () => {
      const { service, deps } = setup({ isOpenVoting: true, maxOpenVoters: 300 });

      await service.prepareOfficialPublication(String(eventId), requester);

      expect(deps.requestService.createOrGetActiveRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          isOpenVoting: true,
          enabledVotersCount: 300,
          padronVersionId: null,
          creditsRequired: '300',
        }),
      );
    });

    it('EA2-05-008 no consulta el padrón al preparar una votación abierta', async () => {
      const { service, deps } = setup({ isOpenVoting: true, maxOpenVoters: 300 });

      await service.prepareOfficialPublication(String(eventId), requester);

      expect(deps.padronService.materializeActiveDraftVersion).not.toHaveBeenCalled();
      expect(deps.padronVersionModel.findOne).not.toHaveBeenCalled();
      expect(deps.padronUsersService.getUnresolverPadronUsersFomEvent).not.toHaveBeenCalled();
      expect(deps.voteWritterService.prepareCreateVote).toHaveBeenCalledWith(
        expect.objectContaining({ isOpenVoting: true }),
        String(applicationId),
        [],
        ['A', 'B'],
      );
    });

    it('EA2-05-009 reserva los créditos on-chain según el límite de votantes', async () => {
      const { service, deps } = setup({ isOpenVoting: true, maxOpenVoters: 300 });

      await service.prepareOfficialPublication(String(eventId), requester);

      expect(deps.tvdBlockchainService.validateVotePublicationPreflight).toHaveBeenCalledWith(
        expect.objectContaining({ requiredCredits: 300n }),
      );
    });

    it('EA2-05-010 guarda el artefacto con maxOpenVoters como votersCount', async () => {
      const { service, deps } = setup({ isOpenVoting: true, maxOpenVoters: 300 });

      await service.prepareOfficialPublication(String(eventId), requester);

      expect(deps.artifactsService.saveArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ voters: [], votersCount: 300 }),
      );
    });

    it('EA2-05-011 una votación cerrada sigue registrando el padrón y su conteo real', async () => {
      const { service, deps } = setup({ isOpenVoting: false });

      await service.prepareOfficialPublication(String(eventId), requester);

      expect(deps.requestService.createOrGetActiveRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          isOpenVoting: false,
          enabledVotersCount: 2,
          padronVersionId: expect.anything(),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-07 | Estadísticas y capacidad TVD sin padrón
  // ---------------------------------------------------------------------------

  describe('EA2-07 | Capacidad TVD calculada con el límite de votantes', () => {
    function buildCapacityHarness(event: Record<string, unknown>) {
      const tenantId = new Types.ObjectId();
      const votingEventModel = {
        findById: jest.fn(() => ({
          lean: jest.fn(async () => ({ _id: new Types.ObjectId(), tenantId, ...event })),
        })),
      };
      const padronVersionModel = { findOne: jest.fn(() => ({ lean: jest.fn(async () => null) })) };
      const padronEntryModel = { countDocuments: jest.fn(async () => 0) };
      const padronImportJobModel = {
        findOne: jest.fn(() => ({ sort: jest.fn(() => ({ lean: jest.fn(async () => null) })) })),
      };
      const tvdQueries = {
        resolveMyInstitutionalWallet: jest.fn(async () => ({
          tenantId: String(tenantId),
          assignmentId: new Types.ObjectId().toHexString(),
          userId: new Types.ObjectId().toHexString(),
          wallet,
          walletNormalized: wallet.toLowerCase(),
        })),
      };
      const blockchain = {
        chain: '84532',
        getLiquidBalance: jest.fn(async () => '500000000000000000000'), // 500 TVD
        getTokenDecimals: jest.fn(async () => 18),
      };
      const configService = {
        get: jest.fn(() => getAddress('0xcccccccccccccccccccccccccccccccccccccccc')),
      };

      const service = new TvdCapacityService(
        configService as never,
        votingEventModel as never,
        padronVersionModel as never,
        padronEntryModel as never,
        padronImportJobModel as never,
        tvdQueries as never,
        blockchain as never,
      );

      return { service, padronVersionModel, padronEntryModel };
    }

    const requester = { sub: new Types.ObjectId().toHexString(), role: 'ADMIN', active: true } as never;

    it('EA2-07-006 calcula la capacidad con maxOpenVoters y sin consultar el padrón', async () => {
      const { service, padronVersionModel, padronEntryModel } = buildCapacityHarness({
        state: 'READY_FOR_REVIEW',
        isOpenVoting: true,
        maxOpenVoters: 300,
      });

      const capacity = await service.getEventCapacity(new Types.ObjectId().toHexString(), requester);

      expect(capacity).toMatchObject({
        participantCount: 300,
        padronVersionId: null,
        requiredTokens: '300',
        availableTokens: '500',
        missingTokens: '0',
        canPublish: true,
        reasonCode: null,
      });
      expect(padronVersionModel.findOne).not.toHaveBeenCalled();
      expect(padronEntryModel.countDocuments).not.toHaveBeenCalled();
    });

    it('EA2-07-007 reporta saldo insuficiente cuando el límite de votantes supera el balance', async () => {
      const { service } = buildCapacityHarness({
        state: 'READY_FOR_REVIEW',
        isOpenVoting: true,
        maxOpenVoters: 800,
      });

      const capacity = await service.getEventCapacity(new Types.ObjectId().toHexString(), requester);

      expect(capacity).toMatchObject({
        participantCount: 800,
        requiredTokens: '800',
        missingTokens: '300',
        canPublish: false,
        reasonCode: 'INSUFFICIENT_TVD_BALANCE',
      });
    });

    it('EA2-07-008 marca PADRON_EMPTY cuando la votación abierta no tiene límite de votantes', async () => {
      const { service } = buildCapacityHarness({
        state: 'READY_FOR_REVIEW',
        isOpenVoting: true,
        maxOpenVoters: 0,
      });

      const capacity = await service.getEventCapacity(new Types.ObjectId().toHexString(), requester);

      expect(capacity).toMatchObject({
        participantCount: 0,
        canPublish: false,
        reasonCode: 'PADRON_EMPTY',
      });
    });
  });

  describe('EA2-07 | Reporte PDF de participación sin padrón', () => {
    it('EA2-07-009 el PDF incluye a todos los usuarios registrados activos', async () => {
      const eventId = new Types.ObjectId();
      const users = [
        { _id: new Types.ObjectId(), dni: '10001' },
        { _id: new Types.ObjectId(), dni: '20002' },
      ];

      const userModel = {
        find: jest.fn(() => ({
          sort: jest.fn(() => ({ lean: jest.fn(async () => users) })),
        })),
      };
      const padronVersionModel = { findOne: jest.fn() };
      const padronEntryModel = { find: jest.fn() };
      const participationModel = {
        find: jest.fn(() => ({ lean: jest.fn(async () => [{ carnetNorm: '10001' }]) })),
      };
      const tenantModel = {
        findById: jest.fn(() => ({ lean: jest.fn(async () => ({ name: 'Institucion EA2' })) })),
      };
      const accessService = {
        getEventOrThrow: jest.fn(async () => ({
          _id: eventId,
          tenantId: new Types.ObjectId(),
          name: 'Eleccion abierta',
          state: 'PUBLISHED',
          isOpenVoting: true,
          maxOpenVoters: 300,
        })),
        assertTenantWriteAccess: jest.fn(async () => undefined),
      };
      const reportPdfService = { buildPdf: jest.fn(() => Buffer.from('%PDF-1.4')) };

      const service = new ParticipationAnalyticsService(
        padronVersionModel as never,
        padronEntryModel as never,
        participationModel as never,
        tenantModel as never,
        userModel as never,
        accessService as never,
        reportPdfService as never,
      );

      const result = await service.downloadParticipationReport(String(eventId), {}, {
        modalScreenshot: createPngDataUrl(),
      });

      expect(result.mimeType).toBe('application/pdf');
      // El padrón no se consulta: la fuente de verdad son los usuarios registrados.
      expect(padronVersionModel.findOne).not.toHaveBeenCalled();
      expect(padronEntryModel.find).not.toHaveBeenCalled();

      const [reportData] = reportPdfService.buildPdf.mock.calls[0] as any[];
      expect(reportData.totalEnabled).toBe(2);
      expect(reportData.totalParticipated).toBe(1);
      expect(reportData.participants.map((row: any) => row.carnetNorm)).toEqual(['10001']);
      expect(reportData.pending.map((row: any) => row.carnetNorm)).toEqual(['20002']);
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-08 | Visualización de la votación en la app (estado que la app consume)
  // ---------------------------------------------------------------------------

  describe('EA2-08 | Estado de participación según el saldo de la elección', () => {
    const eventId = new Types.ObjectId();

    function buildParticipationService(creditBalance: string) {
      const voteReaderService = {
        getElectionStatus: jest.fn().mockResolvedValue({ creditBalance }),
      };
      const participationModel = {
        findOne: jest.fn(() => ({ lean: jest.fn(async () => null) })),
      };
      const accessService = {
        getEventOrThrow: jest.fn(async () => ({
          _id: eventId,
          state: 'PUBLISHED',
          isOpenVoting: true,
          votingStart: new Date(Date.now() - 60_000),
          votingEnd: new Date(Date.now() + 60_000),
        })),
      };

      const service = new ParticipationService(
        { findOne: jest.fn() } as never,
        { findOne: jest.fn() } as never,
        { exists: jest.fn() } as never,
        participationModel as never,
        accessService as never,
        voteReaderService as never,
      );

      return { service, voteReaderService };
    }

    it('EA2-08-001 permite votar mientras la elección conserva créditos', async () => {
      const { service, voteReaderService } = buildParticipationService('5');

      const status = await service.checkParticipationStatus(String(eventId), '10001');

      expect(status).toMatchObject({ status: 'CAN_VOTE', canVote: true, alreadyVoted: false });
      expect(voteReaderService.getElectionStatus).toHaveBeenCalledWith(String(eventId));
    });

    it('EA2-08-002 devuelve CREDITS_EMPTY cuando se agotan los tokens de respaldo', async () => {
      const { service } = buildParticipationService('0');

      const status = await service.checkParticipationStatus(String(eventId), '10001');

      expect(status).toMatchObject({
        status: 'CREDITS_EMPTY',
        canVote: false,
        alreadyVoted: false,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // EA2-09 | Dos usuarios votan al mismo tiempo cuando solo queda saldo para uno
  // ---------------------------------------------------------------------------

  describe('EA2-09 | Créditos agotados al emitir el voto', () => {
    const eventId = new Types.ObjectId().toString();
    const nullifier = 'nullifier-ea2';

    const validScope = [
      { id: 1, vp: { verifiableCredential: { credentialSubject: { eventId } } } },
      { id: 2, vp: { verifiableCredential: { credentialSubject: { nullifier } } } },
    ];

    function buildEmitService(castVote: jest.Mock) {
      return new EmitVoteService(
        { findOne: jest.fn(), updateOne: jest.fn() } as never,
        { findById: jest.fn() } as never,
        { zkRequestCallback: jest.fn().mockResolvedValue({ body: { scope: validScope } }) } as never,
        { castVote, addNewVoters: jest.fn() } as never,
        { create: jest.fn().mockResolvedValue(undefined) } as never,
        { isDniInMerkleTree: jest.fn() } as never,
        { getDidsByDnis: jest.fn(), issueCredential: jest.fn() } as never,
        { getEventOrThrow: jest.fn().mockResolvedValue({ isOpenVoting: true }) } as never,
      );
    }

    it('EA2-09-001 devuelve 409 cuando el contrato rechaza el voto por falta de créditos', async () => {
      const castVote = jest
        .fn()
        .mockRejectedValue(new Error('execution reverted: TVDCredits: election has no credits'));
      const service = buildEmitService(castVote);

      const thrown = await service.emitVote('blank', 'mock-proof').catch((error) => error);

      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getStatus()).toBe(409);
    });

    it('EA2-09-002 responde con el mensaje "Current election has no credits"', async () => {
      const castVote = jest
        .fn()
        .mockRejectedValue(new Error('TVDCredits: election has no credits'));
      const service = buildEmitService(castVote);

      await expect(service.emitVote('blank', 'mock-proof')).rejects.toThrow(
        'Current election has no credits',
      );
    });
  });
});
