import appConfig from "@/config/app.config";
import { AttestationModule } from "@/modules/attestation/attestation.module";
import { BallotModule } from "@/modules/ballot/ballot.module";
import { BallotService } from "@/modules/ballot/services/ballot.service";
import { ContractsModule } from "@/modules/contracts/contracts.module";
import { GeographicModule } from "@/modules/geographic/geographic.module";
import { ConfigModule } from "@nestjs/config";
import { getConnectionToken, MongooseModule } from "@nestjs/mongoose";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Connection, Types } from "mongoose";
import { TestLoggerModule } from "../utils/module-helpers";
import { seedLocations } from "../utils/seeds/locationsSeed";
import { seedAdmin, seedContracts, seedUsers } from "../utils/seeds/usersSeed";
import { seedElectionConfigWith } from "../utils/seeds/electionsSeed";
import { seedDelegates } from "../utils/seeds/delegatesSeed";
import { CacheModule } from '@nestjs/cache-manager';
import { Delegate } from "@/modules/contracts/schemas/delegate.schema";
import { INestApplication } from "@nestjs/common";
import { getMockOpenSeaMetadata } from "../utils/testing-data";
import { PartiesSeedInput, seedParties } from "../utils/seeds/partiesSeed";
import { ElectoralTable } from "@/modules/geographic/schemas/electoral-table.schema";
import { Department } from "@/modules/geographic/schemas/department.schema";
import { Province } from "@/modules/geographic/schemas/province.schema";
import { login } from "../utils/location-helpers";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "@/core/guards/jwt-auth.guard";

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

type DelegateWithId = Delegate & { _id: Types.ObjectId };

describe('Delegates pariticipation end-to-end tests', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let ballotService: BallotService;

  let conn: Connection;
  let appHttpServer: any;
  let users: Map<string, any>;
  let laPazToken: string;
  let activeElectionId: string;

  let delegates: DelegateWithId[];
  const parties: PartiesSeedInput = {
    codes: ['party1', 'party2', 'party3'],
    assignedLoc: 'La Paz',
    locType: 'department',
  };

  const cbbaParties: PartiesSeedInput = {
    codes: ['cbba1', 'cbba2', 'cbba3'],
    assignedLoc: 'Cochabamba',
    locType: 'municipality',
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongoUri),
        CacheModule.register({ isGlobal: true }),
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

    users = await seedUsers(conn);
    const adminUser = await seedAdmin(conn);
    if (!adminUser) throw new Error('Admin user not seeded properly');

    const activeElection = await seedElectionConfigWith(conn, 'activeElection');
    activeElectionId = activeElection.insertedId.toString();

    await seedParties(conn, parties, activeElection.insertedId);
    await seedParties(conn, cbbaParties, activeElection.insertedId);

    const contracts = await seedContracts(conn, users, 'activeElection');
    delegates = await seedDelegates(conn, contracts.insertedIds[0], adminUser._id);

    const governorLaPaz = users.get('governorLaPaz');
    laPazToken = await login(appHttpServer, governorLaPaz.email, 'secret123');
  });

  afterAll(async () => {
    await mongod.stop();
    await app.close();
  });

  describe('Participation in single table', () => {
    let locationId: string;
    let tableCode: string;
    let tableNumber: string;

    beforeAll(async () => {
      locationId = (await conn.collection('electoral_locations').findOne({ address: 'Quispillamayu' }))!._id.toString();
      const table = await conn.collection<ElectoralTable>('electoral_tables').findOne({ electoralLocationId: new Types.ObjectId(locationId) });
      tableCode = table!.tableCode;
      tableNumber = table!.tableNumber;

      const mockIpfs = getMockOpenSeaMetadata(tableCode, tableNumber, locationId, parties.codes);

      // Mock IPFS fetching
      jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
        mockIpfs
      );
    });

    afterEach(async () => {
      await conn.collection('ballots').deleteMany({});
      await conn.collection('attestations').deleteMany({});
    });

    const uploadAttestation = async (recordId: string, delegate: DelegateWithId, version: number, tableCod: string = tableCode) => {
      const ballot = await request(appHttpServer)
        .post('/api/v1/ballots/from-ipfs')
        .send({
          ipfsUri: 'https://ipfs.io/ipfs/' + recordId + 'ballot',
          recordId,
          electionId: activeElectionId,
          tableIdIpfs: tableCod,
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

    const attestRecord = async (ballotId: string, attesterDni: string) => {
      const attestation = await request(appHttpServer)
        .post('/api/v1/attestations')
        .send({ attestations: [{
          ballotId: ballotId,
          support: true,
          isJury: false,
          dni: attesterDni
        }] }).expect(201);
      
      expect(attestation.body.created).toHaveLength(1);
      expect(attestation.body.errors).toHaveLength(0);
    };

    const checkLiveResults = async (validVotes: number, token: string = laPazToken) => {
      const res = await request(appHttpServer)
        .get(`/api/v1/client-results/live/by-location`)
        .query({
          electionId: activeElectionId,
          electionType: 'presidential',
        }).auth(token, { type: 'bearer' })
				.expect(200);
      
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toHaveProperty('validVotes', validVotes);
    }

    const checkPartipation = async (activeDelegates: number, dnis: string[], token: string = laPazToken) => {
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
    };

    it('P1: 1 record, 1 delegate, should create participation successfully', async () => {
      await uploadAttestation('recordA', delegates[0], 1);
      await checkLiveResults(150);
      await checkPartipation(1, [delegates[0].dni]);
    });

    it('P2: 1 record, 2 delegates, should create participation successfully', async () => {
      const ballotId = await uploadAttestation('recordA', delegates[0], 1);
      await attestRecord(ballotId, delegates[1].dni);
      await checkLiveResults(150);
      await checkPartipation(2, [delegates[0].dni, delegates[1].dni]);
    });

    it('P3: 2 records, 3 delegates, should not count on live results', async () => {
      await uploadAttestation('recordA', delegates[0], 1);
      await uploadAttestation('recordB', delegates[1], 2);

      await checkLiveResults(0);
      await checkPartipation(2, [delegates[0].dni, delegates[1].dni]);
    });

    it('P4: 1 record, 2 delegates, 1 user, should ignore non-delegate paritcipations', async () => {
      const ballotId = await uploadAttestation('recordA', delegates[0], 1);
      await attestRecord(ballotId, delegates[1].dni);

      // Non-delegate user attestation
      await attestRecord(ballotId, '10');
      await checkLiveResults(150);
      await checkPartipation(2, [delegates[0].dni, delegates[1].dni]);
    });

    it('P9: should return unauthorized on get particiation report without auth token', async () => {
      await request(appHttpServer)
        .get(`/api/v1/client-reports/delegate-activity`)
        .query({
          electionId: activeElectionId,
        })
        .expect(401);
    });

    it('P10: uploading on external table, should not count on participation', async () => {
      // Use a different table by changing the mocked IPFS data, location from Cochabamba municipality
      const otherLocationId = (await conn.collection('electoral_locations').findOne({ name: 'Colegio San Antonio De Pucara' }))!._id.toString();
      const otherTable = await conn.collection<ElectoralTable>('electoral_tables').findOne({ electoralLocationId: new Types.ObjectId(otherLocationId) });
      const otherTableCode = otherTable!.tableCode;
      const otherTableNumber = otherTable!.tableNumber;

      // Mock IPFS fetching
      jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
        getMockOpenSeaMetadata(otherTableCode, otherTableNumber, otherLocationId, cbbaParties.codes)
      );

      await uploadAttestation('recordA', delegates[0], 1, otherTableCode);
      
      // login as Cbba mayor
      const mayorCbba = users.get('mayorCbba');
      const cbbaToken = await login(appHttpServer, mayorCbba.email, 'secret123');

      // Check live results in Cochabamba - should count
      await checkLiveResults(150, cbbaToken);

      // Should not count on La Paz or Cbba delegate participation
      await checkPartipation(0, [], laPazToken);
      await checkPartipation(0, [], cbbaToken);

      // after: restore original mock
      jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
        getMockOpenSeaMetadata(tableCode, tableNumber, locationId, parties.codes)
      );
    });

    // it('P11: should count delegate participation even when report flags are missing', async () => {
    //   await uploadAttestation('recordA', delegates[0], 1);

    //   await conn.collection('attestations').updateMany(
    //     {},
    //     {
    //       $set: {
    //         isValidForClientReport: false,
    //         validForContractId: null,
    //       },
    //     },
    //   );

    //   await checkPartipation(1, [delegates[0].dni]);
    // });
  });

  describe('Filters availability', () => {
    it('P7: with La Paz governor, should get La Paz provinces and municipipalities', async () => {
      const department = await conn.collection<Department>('departments').findOne({ name: 'La Paz' });
      if (!department) throw new Error('Department La Paz not found in DB');

      const res = await request(appHttpServer)
        .get(`/api/v1/geographic/provinces`)
        .query({ departmentId: department._id.toString() })
        .auth(laPazToken, { type: 'bearer' })
        .expect(200);
            
      expect(res.body.data.length).toBeGreaterThan(1);

      const municipalitiesRes = await request(appHttpServer)
        .get(`/api/v1/geographic/municipalities`)
        .query({ departmentId: department._id.toString(), provinceId: res.body.data[0]._id })
        .auth(laPazToken, { type: 'bearer' })
        .expect(200);

      expect(municipalitiesRes.body.data.length).toBeGreaterThan(1);
    });

    it('P8: with La Paz governor, should deny access to Cochabamba provinces', async () => {
      const department = await conn.collection<Department>('departments').findOne({ name: 'Cochabamba' });
      if (!department) throw new Error('Department Cochabamba not found in DB');

      const province = await conn.collection<Province>('provinces').findOne({ departmentId: department._id });
      if (!province) throw new Error('Province not found in DB');

      await request(appHttpServer)
        .get(`/api/v1/geographic/provinces`)
        .query({ departmentId: department._id.toString() })
        .auth(laPazToken, { type: 'bearer' })
        .expect(403);

      await request(appHttpServer)
        .get(`/api/v1/geographic/municipalities`)
        .query({ departmentId: department._id.toString(), provinceId: province._id.toString() })
        .auth(laPazToken, { type: 'bearer' })
        .expect(403);
    });
  });
});
