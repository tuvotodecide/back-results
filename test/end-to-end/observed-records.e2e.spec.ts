import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { getTablesForMunicipality, login, TableInfo } from '../utils/location-helpers';
import { seedLocations } from '../utils/seeds/locationsSeed';
import {
  getBaseTestingModuleImports,
  getBaseTestingModuleProviders,
} from '../utils/test-module';
import { getMockOpenSeaMetadata } from '../utils/testing-data';
import { PartiesSeedInput, seedParties } from '../utils/seeds/partiesSeed';
import { seedElectionConfigWith } from '../utils/seeds/electionsSeed';
import { seedMayors } from '../utils/seeds/participationSeed';
import request from "supertest";
import { BallotService } from '@/modules/ballot/services/ballot.service';
import { AttestationModule } from '@/modules/attestation/attestation.module';
import { BallotModule } from '@/modules/ballot/ballot.module';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { IncentiveCampaignsService } from '@/modules/users/services/incentive-campaigns.service';

const mockZkAuthGuard = {
  canActivate: jest.fn().mockResolvedValue(true),
};

const mockIncentiveCampaignsService = {
  giveIncentive: jest.fn(),
  isAlreadyReceivedError: jest.fn().mockReturnValue(false),
  isUngrantableError: jest.fn().mockReturnValue(false),
};

// Avoid loading the real zk-auth module (pulls ESM deps) during tests
jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => mockZkAuthGuard),
}));

describe('Observed Records End-to-End Tests', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let conn: Connection;
  let appHttpServer: any;

  let activeElectionId: string;
  let ballotService: BallotService;
  let cbbaTables: TableInfo[];

  let mayorTokens = new Map<string, string>();

  const cbbaParties: PartiesSeedInput = {
    codes: ['cbba1', 'cbba2', 'cbba3'],
    assignedLoc: 'Cochabamba',
    locType: 'municipality',
  };
  const userDni = '491852378';

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const mongoUri = mongod.getUri();

    const moduleRef = await Test.createTestingModule({
      imports: [...getBaseTestingModuleImports(mongoUri), AttestationModule, BallotModule],
      providers: [...getBaseTestingModuleProviders()],
    })
      .overrideProvider(IncentiveCampaignsService)
      .useValue(mockIncentiveCampaignsService)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    appHttpServer = app.getHttpServer();
    ballotService = app.get<BallotService>(BallotService);

    await seedLocations(conn);

    const activeElection = await seedElectionConfigWith(conn, 'activeElection');
    activeElectionId = activeElection.insertedId.toString();

    const mayorRes = await seedMayors(conn, activeElection.insertedId);
    for(const [name, mayor] of mayorRes.users) {
      mayorTokens.set(name, await login(appHttpServer, mayor.email, 'secret123'));
    }

    await seedParties(conn, cbbaParties, activeElection.insertedId);

    cbbaTables = await getTablesForMunicipality(conn, 'Cochabamba', 10);
  });

  afterAll(async () => {
    await mongod.stop();
    await app.close();
  });

  it('[ACT-FRM-P0-003] crea acta observada con texto de observacion valido', async () => {
    const table = cbbaTables[0];

    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId1',
        recordId: 'testRecordId1',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
        hasObservation: true,
        observationText: 'Observation for testing',
      }).expect(201);

    expect(ballot.body).toHaveProperty('_id');
    const savedBallot = await conn.collection<Ballot>('ballots').findOne({ _id: new Types.ObjectId(ballot.body._id as string) });

    expect(savedBallot).not.toBeNull();
    expect(savedBallot?.hasObservation).toBe(true);
    expect(savedBallot?.observationText).toBe('Observation for testing');
  });

  it('[ADM-MES-P1-002] conserva acta observada disponible para consulta operativa por mesa', async () => {
    const table = cbbaTables[1];

    // Upload ballot and attestation
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId2',
        recordId: 'testRecordId2',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
        hasObservation: true,
        observationText: 'Observation for testing',
      }).expect(201);

    expect(ballot.body).toHaveProperty('_id');

    const attestation = await request(appHttpServer)
      .post('/api/v1/attestations')
      .send({ attestations: [{
        ballotId: ballot.body._id,
        support: true,
        isJury: false,
        dni: userDni,
      }] }).expect(201);
    
    expect(attestation.body.created).toHaveLength(1);
    expect(attestation.body.errors).toHaveLength(0);

    // Check results
    const res = await request(appHttpServer)
      .get(`/api/v1/client-results/live/by-location`)
      .query({
        electionId: activeElectionId,
        electionType: 'presidential',
      }).auth(mayorTokens.get('Cochabamba')!, { type: 'bearer' })
      .expect(200);
    
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('validVotes', 300);
  });

  it('[ACT-FRM-P0-003] rechaza acta observada sin texto de observacion', async () => {
    const table = cbbaTables[2];

    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId3',
        recordId: 'testRecordId3',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
        hasObservation: true,
      }).expect(400);

    expect(ballot.body).toHaveProperty('message', 'observationText es obligatorio cuando hasObservation=true');
  });

  it('[ACT-FRM-P0-003][EVD-IPF-P0-004] persiste acta observada cuando metadata IPFS contiene observacion valida', async () => {
    const table = cbbaTables[3];
    const mockedData = getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes);

    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue({
      ...mockedData,
      data: {
        ...mockedData.data,
        hasObservation: true,
        observationText: 'Observation for testing 4',
      }
    });

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId4',
        recordId: 'testRecordId4',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
      }).expect(201);

    expect(ballot.body).toHaveProperty('_id');
    const savedBallot = await conn.collection<Ballot>('ballots').findOne({ _id: new Types.ObjectId(ballot.body._id as string) });

    expect(savedBallot).not.toBeNull();
    expect(savedBallot?.hasObservation).toBe(true);
    expect(savedBallot?.observationText).toBe('Observation for testing 4');
  });

  it('[ACT-FRM-P0-003] no marca observacion cuando el texto correyvale no activa hasObservation', async () => {
    const table = cbbaTables[4];

    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId5',
        recordId: 'testRecordId5',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
        observationText: ' Corre y Vale ',
      }).expect(201);

    expect(ballot.body).toHaveProperty('_id');
    const savedBallot = await conn.collection<Ballot>('ballots').findOne({ _id: new Types.ObjectId(ballot.body._id as string) });

    expect(savedBallot).not.toBeNull();
    expect(savedBallot?.hasObservation).toBe(false);
    expect(savedBallot?.observationText).toBeUndefined();
  })

  it('[ACT-FRM-P0-003] rechaza observacion vacia sin persistir acta', async () => {
    const table = cbbaTables[5];

    // Mock IPFS fetching
    jest.spyOn(ballotService, 'fetchFromIpfs' as any).mockResolvedValue(
      getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes)
    );

    const ballot = await request(appHttpServer)
      .post('/api/v1/ballots/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testRecordId6',
        recordId: 'testRecordId6',
        electionId: activeElectionId,
        tableIdIpfs: table.tableCode,
        version: 1,
        hasObservation: true,
        observationText: '   ',
      }).expect(400);

    expect(ballot.body).toHaveProperty('message', 'observationText es obligatorio cuando hasObservation=true');
  });
});