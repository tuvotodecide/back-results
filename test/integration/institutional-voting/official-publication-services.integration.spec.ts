jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: jest.fn().mockImplementation(() => ({
    generateRequest: jest.fn().mockReturnValue({ apiKey: 'mock-api-key', request: {} }),
    zkAuthCallback: jest.fn().mockResolvedValue({}),
    saveApiKey: jest.fn().mockResolvedValue(undefined),
    isApiKeyValid: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.guard', () => ({
  OfficialPublicationMobileZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/institutional-voting/auth/official-publication-mobile-zk-auth.service', () => ({
  OfficialPublicationMobileZkAuthService: jest.fn().mockImplementation(() => ({
    createAuthRequest: jest.fn().mockResolvedValue({
      apiKey: 'mock-official-publication-mobile-api-key',
      request: {},
      expiresAt: '2026-07-28T00:00:00.000Z',
    }),
    callback: jest.fn().mockResolvedValue({}),
    getContextByApiKey: jest.fn().mockResolvedValue(null),
    hashApiKey: jest.fn((apiKey: string) => `mock-hash-${apiKey}`),
  })),
}));

import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { JwtOrApiKeyGuard } from '@/core/guards/jwt-or-api-key.guard';
import { InstitutionalVotingModule } from '@/modules/institutional-voting/institutional-voting.module';
import { IssuerService } from '@/modules/institutional-voting/services/core/issuer.service';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { VoteWritterService } from '@/modules/institutional-voting/services/core/vote-writter.service';
import { EmitVoteService } from '@/modules/institutional-voting/services/participation/emit-vote.service';
import { OfficialPublicationArtifactsService } from '@/modules/institutional-voting/services/publication/official-publication-artifacts.service';
import { OfficialPublicationFinalizationService } from '@/modules/institutional-voting/services/publication/official-publication-finalization.service';
import { OfficialPublicationPreparationService } from '@/modules/institutional-voting/services/publication/official-publication-preparation.service';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { HttpService } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { TestLoggerModule } from '../../utils/module-helpers';

jest.setTimeout(240000);

// Builds a syntactically valid 40-hex-char address (`0x` + 20 repeated bytes) without relying on
// hardcoded/guessed real addresses, so every address used in this test is trivially distinct.
function testAddress(byte: string): `0x${string}` {
  return `0x${byte.repeat(20)}` as `0x${string}`;
}

describe('Publicación oficial | prepare + finalize (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let preparationService: OfficialPublicationPreparationService;
  let finalizationService: OfficialPublicationFinalizationService;
  let artifactsService: OfficialPublicationArtifactsService;
  let padronUsersService: PadronUsersService;
  let issuerService: IssuerService;
  let httpService: HttpService;
  let voteWritterServiceMock: { prepareCreateVote: jest.Mock; persistPreparedMerkleTrees: jest.Mock };
  let tvdBlockchainServiceMock: { validateVotePublicationPreflight: jest.Mock };

  beforeAll(async () => {
    process.env.OFFICIAL_PUBLICATION_ARTIFACT_ENCRYPTION_KEY =
      'test-official-publication-artifact-encryption-key';

    const firebaseAdminMock = {
      messaging: jest.fn(() => ({
        send: jest.fn().mockResolvedValue('mock-message-id'),
      })),
    };

    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    voteWritterServiceMock = {
      prepareCreateVote: jest.fn(),
      persistPreparedMerkleTrees: jest.fn().mockResolvedValue(undefined),
    };
    tvdBlockchainServiceMock = {
      validateVotePublicationPreflight: jest.fn(),
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        CacheModule.register({ isGlobal: true }),
        TestLoggerModule,
        InstitutionalVotingModule,
      ],
    })
      .overrideProvider('FIREBASE_ADMIN')
      .useValue(firebaseAdminMock)
      .overrideProvider(VoteWritterService)
      .useValue(voteWritterServiceMock)
      .overrideProvider(TvdBlockchainService)
      .useValue(tvdBlockchainServiceMock)
      // Not exercised by prepare/finalize; only overridden because it otherwise pulls in the
      // (jest.mock-stubbed) ZkAuthService, which isn't provided since ZkAuthModule is mocked out.
      .overrideProvider(EmitVoteService)
      .useValue({ getVoteVc: jest.fn(), emitVote: jest.fn() })
      // HistoryController (pulled in transitively via HistoryModule) is @UseGuards(JwtOrApiKeyGuard);
      // the real guard needs JwtService, which isn't wired up since we never call HTTP routes here.
      .overrideGuard(JwtOrApiKeyGuard)
      .useValue({ canActivate: () => true })
      // Same reasoning: institutional-voting-admin.controller's getTvdCapacity is @UseGuards(JwtAuthGuard).
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    preparationService = moduleRef.get(OfficialPublicationPreparationService);
    finalizationService = moduleRef.get(OfficialPublicationFinalizationService);
    artifactsService = moduleRef.get(OfficialPublicationArtifactsService);
    padronUsersService = moduleRef.get(PadronUsersService);
    issuerService = moduleRef.get(IssuerService);
    httpService = moduleRef.get(HttpService);
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    'RDV-P0-02-001 emite credenciales solo para los convocados con DID resuelto: 5 convocados, 3 con DID -> issueCredential solo crea 3 credenciales',
    async () => {
      const tenantId = new Types.ObjectId();
      const requesterId = new Types.ObjectId();
      const applicationId = new Types.ObjectId();
      const wallet = testAddress('11');

      await conn.collection('institutional_tenants').insertOne({
        _id: tenantId,
        name: 'Tenant Publicacion Oficial',
        nameNorm: 'tenant publicacion oficial',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await conn.collection('institutional_admin_applications').insertOne({
        _id: applicationId,
        tenantId,
        userId: requesterId,
        institutionName: 'Institucion Publicacion Oficial',
        institutionNameNorm: 'institucion publicacion oficial',
        dni: 'APP-1',
        email: 'official-publication-app@example.com',
        passwordHash: 'hash',
        name: 'Administrador de aplicacion',
        accountAddress: wallet,
        status: 'APPROVED',
        stableInstitutionId: 'institution-test-1',
        chainStatus: 'CONFIRMED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await conn.collection('tenant_admin_assignments').insertOne({
        tenantId,
        userId: requesterId,
        applicationId,
        accountAddress: wallet,
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const now = Date.now();
      const votingStart = new Date(now + 48 * 60 * 60 * 1000);
      const votingEnd = new Date(now + 50 * 60 * 60 * 1000);
      const resultsPublishAt = new Date(now + 52 * 60 * 60 * 1000);
      const publishDeadline = new Date(now + 24 * 60 * 60 * 1000);

      const eventInsert = await conn.collection('voting_events').insertOne({
        tenantId,
        name: 'Evento publicacion oficial',
        objective: 'Objetivo de prueba para publicacion oficial',
        isReferendum: false,
        state: 'READY_FOR_REVIEW',
        votingStart,
        votingEnd,
        resultsPublishAt,
        publishDeadline,
        publicEligibilityEnabled: true,
        publicationConfirmed: false,
        allowPostPublicationPadronEnable: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const eventId = eventInsert.insertedId;

      await conn.collection('voting_options').insertOne({
        eventId,
        tenantId,
        name: 'Opcion Unica',
        normalizedName: 'opcion unica',
        color: '#000000',
        colors: ['#000000'],
        candidates: [],
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await conn.collection('padron_versions').insertOne({
        eventId,
        tenantId,
        createdBy: requesterId,
        fileDigest: 'digest-test',
        totals: { validCount: 5, duplicateCount: 0, invalidCount: 0 },
        isCurrent: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Escenario: 5 usuarios convocados, pero el servicio de identidad solo resuelve DID para 3.
      const convocatedUsers = ['10001', '10002', '10003', '10004', '10005'];
      const usersWithDid = convocatedUsers.slice(0, 3);
      const usersWithoutDid = convocatedUsers.slice(3);

      jest
        .spyOn(padronUsersService, 'getUnresolverPadronUsersFomEvent')
        .mockResolvedValue(convocatedUsers.map((dni) => ({ dni, enabled: true })));

      const didsForThreeUsers = usersWithDid.map((dni) => ({ dni, did: `did:example:${dni}` }));
      jest.spyOn(issuerService, 'getDidsByDnis').mockResolvedValue(didsForThreeUsers);

      const postSpy = jest
        .spyOn(httpService.axiosRef, 'post')
        .mockImplementation(async (_url: any, body: any) => ({
          data: { id: `credential-vc-${body?.credentialSubject?.id}` },
        }));

      const preparedVoteMock = {
        secrets: convocatedUsers.map((_, index) => `0x${String(index + 1).padStart(64, '0')}`),
        ciMerkleTree: { root: 123456789n, layers: [[1n, 2n], [3n]] },
        optionsWithBlank: ['Opcion Unica', 'BLANK'],
        callData: { to: testAddress('22'), value: 0n, data: '0xabcdef' as `0x${string}` },
        createVoteArgs: [] as const,
        onChainElectionId: BigInt(`0x${eventId.toString()}`),
      };
      voteWritterServiceMock.prepareCreateVote.mockResolvedValue(preparedVoteMock);

      tvdBlockchainServiceMock.validateVotePublicationPreflight.mockResolvedValue({
        chainId: 84532,
        proxyAddress: testAddress('33'),
        implementationAddress: testAddress('44'),
        tokenAddress: testAddress('55'),
        spenderAddress: testAddress('66'),
        requiredTvd: '5000000000000000000',
        tvdPerCredit: '1000000000000000000',
        allowanceSmallestUnit: '0',
        walletDebitRequiredSmallestUnit: '0',
      });

      const requester = { sub: requesterId.toString(), role: 'ADMIN' };

      // --- prepareOfficialPublication -------------------------------------------------
      const prepared = await preparationService.prepareOfficialPublication(
        eventId.toString(),
        requester,
      );
      expect(prepared.reused).toBe(false);
      expect(prepared.request.status).toBe('PENDING_APPROVAL');
      const requestId = prepared.request.requestId;

      const { payload: preparedPayload } = await artifactsService.loadArtifactPayload(requestId);
      expect(preparedPayload.voters).toEqual(convocatedUsers);
      expect(preparedPayload.dids).toEqual(didsForThreeUsers);
      expect(preparedPayload.credentialData).toBeUndefined();

      // Fuera del alcance de este test: simula la confirmación en blockchain (firma móvil +
      // reconciliación) llevando la solicitud directamente a CHAIN_CONFIRMED para poder finalizar.
      await conn.collection('official_publication_requests').updateOne(
        { requestId },
        {
          $set: {
            status: 'CHAIN_CONFIRMED',
            txHash: `0x${'9'.repeat(64)}`,
            chainConfirmedAt: new Date(),
            lastCheckedAt: new Date(),
            nextRetryAt: null,
          },
        },
      );

      // --- finalizeOfficialPublication -------------------------------------------------
      const finalizeResult = await finalizationService.finalizeOfficialPublication(
        requestId,
        requester.sub,
      );
      expect(finalizeResult.completed).toBe(true);
      expect(finalizeResult.request.status).toBe('COMPLETED');

      // issueCredential solo debe golpear la API externa una vez por cada DID resuelto (3), no 5.
      expect(postSpy).toHaveBeenCalledTimes(3);

      const { payload: finalPayload } = await artifactsService.loadArtifactPayload(requestId);
      const credentialData = finalPayload.credentialData ?? {};
      expect(Object.keys(credentialData).sort()).toEqual([...usersWithDid].sort());
      usersWithoutDid.forEach((dni) => {
        expect(credentialData[dni]).toBeUndefined();
      });
      usersWithDid.forEach((dni) => {
        expect(credentialData[dni]?.credentialData).toEqual(expect.any(String));
      });

      // enabled_sessions se crea para los 5 convocados, pero solo los 3 con credencial
      // terminan con un sessionToken persistido.
      const sessions = await conn.collection('enabled_sessions').find({ eventId }).toArray();
      expect(sessions).toHaveLength(5);
      const sessionTokenByDni = new Map(sessions.map((session) => [session.dni, session.sessionToken]));
      usersWithDid.forEach((dni) => {
        expect(sessionTokenByDni.get(dni)).toEqual(expect.any(String));
      });
      usersWithoutDid.forEach((dni) => {
        expect(sessionTokenByDni.get(dni)).toBeFalsy();
      });

      const updatedEvent = await conn.collection('voting_events').findOne({ _id: eventId });
      expect(updatedEvent?.state).toBe('OFFICIALLY_PUBLISHED');
    },
  );
});
