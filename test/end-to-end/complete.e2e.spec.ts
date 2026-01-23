import appConfig from "@/config/app.config";
import { AttestationModule } from "@/modules/attestation/attestation.module";
import { BallotModule } from "@/modules/ballot/ballot.module";
import { BallotService } from "@/modules/ballot/services/ballot.service";
import { ContractsModule } from "@/modules/contracts/contracts.module";
import { GeographicModule } from "@/modules/geographic/geographic.module";
import { CacheModule } from "@nestjs/cache-manager";
import { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { getConnectionToken, MongooseModule } from "@nestjs/mongoose";
import { Test } from "@nestjs/testing";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Connection } from "mongoose";
import { TestLoggerModule } from "../utils/module-helpers";
import { seedElectionConfigWith } from "../utils/seeds/electionsSeed";
import { seedLocations } from "../utils/seeds/locationsSeed";
import { ContractWithId, DelegateWithId, RoledUserWithId, seedGovernors, seedMayors, seedRandomDelegates } from "../utils/seeds/participationSeed";
import { seedParties } from "../utils/seeds/partiesSeed";
import { seedAdmin } from "../utils/seeds/usersSeed";
import { getTablesForDepartment, getTablesForMunicipality, login, TableInfo } from "../utils/location-helpers";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "@/core/guards/jwt-auth.guard";
import { APP_GUARD } from "@nestjs/core";
import request from "supertest";
import { getMockOpenSeaMetadata } from "../utils/testing-data";

var mockZkAuthGuard = {
  canActivate: jest.fn().mockResolvedValue(true),
};

// Avoid loading the real zk-auth module (pulls ESM deps) during tests
jest.mock("@/modules/zk-auth/zk-auth.module", () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => mockZkAuthGuard),
}));


describe('High scale participation tests', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let ballotService: BallotService;

  let conn: Connection;
  let appHttpServer: any;
  let activeElectionId: string;

  let adminToken: string;

  let mayors: Map<string, RoledUserWithId>;
  let governors: Map<string, RoledUserWithId>;
  let mayorTokens = new Map<string, string>();
  let governorTokens = new Map<string, string>();
  let mayorContracts: ContractWithId[];
  let governorContracts: ContractWithId[];

  const parties = ['party1', 'party2', 'party3'];

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongoUri),
        CacheModule.register({ isGlobal: true }),
        JwtModule.registerAsync({
          global: true,
          useFactory: (configService: ConfigService) => ({
            secret: configService.get('app.jwt.secret'),
            signOptions: {
              expiresIn: configService.get('app.jwt.expirationTime'),
            },
          }),
          inject: [ConfigService],
        }),
        TestLoggerModule,
        AttestationModule,
        GeographicModule,
        ContractsModule,
        BallotModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    ballotService = app.get(BallotService);
    conn = moduleRef.get<Connection>(getConnectionToken());
    appHttpServer = app.getHttpServer();

    await seedLocations(conn);

    const adminUser = await seedAdmin(conn);
    if (!adminUser) throw new Error('Admin user not seeded properly');

    const activeElection = await seedElectionConfigWith(conn, 'activeElection');
    activeElectionId = activeElection.insertedId.toString();

    const mayorRes = await seedMayors(conn, activeElection.insertedId);
    mayors = mayorRes.users;
    mayorContracts = mayorRes.contracts;
    for(const [name, mayor] of mayors) {
      mayorTokens.set(name, await login(appHttpServer, mayor.email, 'secret123'));
    }

    const governorRes = await seedGovernors(conn, activeElection.insertedId);
    governors = governorRes.users;
    governorContracts = governorRes.contracts;
    for(const [name, governor] of governors) {
      governorTokens.set(name, await login(appHttpServer, governor.email, 'secret123'));
    }

    await seedParties(conn, parties, activeElection.insertedId);

    adminToken = await login(appHttpServer, adminUser.email, 'secret123');
  });

  afterEach(async () => {
    // Clear ballots after each test
    await conn.collection('users').deleteMany({});
    await conn.collection('delegates').deleteMany({});
    await conn.collection('ballots').deleteMany({});
    await conn.collection('attestations').deleteMany({});
  })

  afterAll(async () => {
    await mongod.stop();
    await app.close();
  });

  const uploadAttestation = async (recordId: string, delegate: DelegateWithId, version: number, table: TableInfo) => {
    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, parties)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/' + recordId + 'ballot',
        recordId,
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version,
      }).expect(201);

    expect(ballot.body).toHaveProperty('_id');
    
    const attestation = await request(appHttpServer)
      .post('/api/v1/attestations')
      .send({ attestations: [{
        ballotId: ballot.body._id,
        support: true,
        isJury: false,
        dni: delegate.dni
      }] }).expect(201);
    
    expect(attestation.body.created).toHaveLength(1);
    expect(attestation.body.errors).toHaveLength(0);

    return ballot.body._id;
  };

  const checkLiveResults = async (validVotes: number, token: string) => {
    const res = await request(appHttpServer)
      .get(`/api/v1/client-results/live/by-location`)
      .query({
        electionId: activeElectionId,
        electionType: 'presidential',
      }).auth(token, { type: 'bearer' })
      .expect(200);
    
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('validVotes', validVotes);
  };

  const checkPartipation = async (activeDelegates: number, dnis: string[], token: string) => {
    const res = await request(appHttpServer)
      .get(`/api/v1/client-reports/delegate-activity`)
      .query({
        electionId: activeElectionId,
      }).auth(token, { type: 'bearer' })
      .expect(200);

    expect(res.body).toHaveProperty('activeDelegates', activeDelegates);

    for (const dni of dnis) {
      const delegateReport = res.body.data.find((d: any) => d.dni === dni);
      expect(delegateReport).toBeDefined();
      expect(delegateReport.totalAttestations).toBeGreaterThan(0);
    }

    return res.body;
  };

  it('P11: 3 mayors, should handle right results and participation restrictions', async () => {
    // Seed delegates
    const cbbaDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [mayorContracts[0]._id.toString()],
      adminToken,
      10
    );
    
    const caracolloDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [mayorContracts[1]._id.toString()],
      adminToken,
      10
    );

    const aiquileDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [mayorContracts[2]._id.toString()],
      adminToken,
      10
    );

    const cbbaTables = await getTablesForMunicipality(conn, 'Cochabamba', 20);
    const caracolloTables = await getTablesForMunicipality(conn, 'Caracollo', 20);
    const aiquileTables = await getTablesForMunicipality(conn, 'Aiquile', 20);

    for (let i = 0; i < 20; i+=2) {
      await uploadAttestation(`cbba-record-${i}`, cbbaDelegates[i/2], 1, cbbaTables[i]);
      await uploadAttestation(`cbba-record-${i+1}`, cbbaDelegates[i/2], 1, cbbaTables[i+1]);

      await uploadAttestation(`caracollo-record-${i}`, caracolloDelegates[i/2], 1, caracolloTables[i]);
      await uploadAttestation(`caracollo-record-${i+1}`, caracolloDelegates[i/2], 1, caracolloTables[i+1]);

      await uploadAttestation(`aiquile-record-${i}`, aiquileDelegates[i/2], 1, aiquileTables[i]);
      await uploadAttestation(`aiquile-record-${i+1}`, aiquileDelegates[i/2], 1, aiquileTables[i+1]);
    }

    await checkPartipation(10, cbbaDelegates.map(d => d.dni), mayorTokens.get('Cochabamba')!);
    await checkPartipation(10, caracolloDelegates.map(d => d.dni), mayorTokens.get('Caracollo')!);
    await checkPartipation(10, aiquileDelegates.map(d => d.dni), mayorTokens.get('Aiquile')!);

    await checkLiveResults(3000, mayorTokens.get('Cochabamba')!);
    await checkLiveResults(3000, mayorTokens.get('Caracollo')!);
    await checkLiveResults(3000, mayorTokens.get('Aiquile')!);
  });

  it('P11: 2 governors, should handle right results and participation restrictions', async () => {
    // Seed delegates
    const laPazDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [governorContracts[0]._id.toString()],
      adminToken,
      10
    );
    
    const generalDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [governorContracts[0]._id.toString(), governorContracts[1]._id.toString()],
      adminToken,
      10
    );

    const santaCruzDelegates = await seedRandomDelegates(
      conn,
      appHttpServer,
      [governorContracts[1]._id.toString()],
      adminToken,
      10
    );

    const laPazTables = await getTablesForDepartment(conn, 'La Paz', 30);
    const santaCruzTables = await getTablesForDepartment(conn, 'Santa Cruz', 30);

    for (let i = 0; i < 20; i+=2) {
      await uploadAttestation(`lapaz-record-${i}`, laPazDelegates[i/2], 1, laPazTables[i]);
      await uploadAttestation(`lapaz-record-${i+1}`, laPazDelegates[i/2], 1, laPazTables[i+1]);

      await uploadAttestation(`santacruz-record-${i}`, santaCruzDelegates[i/2], 1, santaCruzTables[i]);
      await uploadAttestation(`santacruz-record-${i+1}`, santaCruzDelegates[i/2], 1, santaCruzTables[i+1]);
    }

    for (let i = 0; i < 10; i++) {
      await uploadAttestation(`lapaz-record-g${i}`, generalDelegates[i], 1, laPazTables[i + 20]);
      await uploadAttestation(`santacruz-record-g${i}`, generalDelegates[i], 1, santaCruzTables[i + 20]);
    }

    // Check La Paz participation count La Paz delegates + general delegates
    const laPazParticipation = await checkPartipation(20, laPazDelegates.map(d => d.dni), governorTokens.get('La Paz')!);
    // Check Santa Cruz participation count Santa Cruz delegates + general delegates
    const santaCruzParticipation = await checkPartipation(20, santaCruzDelegates.map(d => d.dni), governorTokens.get('Santa Cruz')!);

    await checkLiveResults(4500, governorTokens.get('La Paz')!);
    await checkLiveResults(4500, governorTokens.get('Santa Cruz')!);

    // Check Santa Cruz delegates did not participate in La Paz
    for (const delegate of laPazDelegates) {
      expect(santaCruzParticipation.data.find(d => d.dni === delegate.dni)).toBeUndefined();
    }

    // Check La Paz delegates did not participate in Santa Cruz
    for (const delegate of santaCruzDelegates) {
      expect(laPazParticipation.data.find(d => d.dni === delegate.dni)).toBeUndefined();
    }
  });
})