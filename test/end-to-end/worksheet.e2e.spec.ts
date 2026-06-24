import { WorksheetService } from '@/modules/worksheet/services/worksheet.service';
import { WorksheetModule } from '@/modules/worksheet/worksheet.module';
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
import { AuthModule } from '@/modules/auth/auth.module';
import { Worksheet } from '@/modules/worksheet/schemas/worksheet.schema';
import { CompareWorksheetDto, WorksheetVotesDto } from '@/modules/worksheet/dto/worksheet.dto';
import { OpenSeaMetadata } from '@/modules/ballot/dto/ballot.dto';
import { BadRequestException } from '@nestjs/common';

const mockZkAuthGuard = {
  canActivate: jest.fn().mockResolvedValue(true),
};

// Avoid loading the real zk-auth module (pulls ESM deps) during tests
jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => mockZkAuthGuard),
}));

describe('Worksheet End-to-End Tests', () => {
  let mongod: MongoMemoryServer;
  let app: INestApplication;
  let conn: Connection;
  let appHttpServer: any;

  let activeElectionId: string;
  let pastElectionId: string;
  let worksheetService: WorksheetService;
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
      imports: [...getBaseTestingModuleImports(mongoUri), AuthModule, WorksheetModule],
      providers: [...getBaseTestingModuleProviders()],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    appHttpServer = app.getHttpServer();
    worksheetService = app.get<WorksheetService>(WorksheetService);

    await seedLocations(conn);

    const activeElection = await seedElectionConfigWith(conn, 'activeElection');
    const pastElection = await seedElectionConfigWith(conn, 'inactiveElection');
    activeElectionId = activeElection.insertedId.toString();
    pastElectionId = pastElection.insertedId.toString();

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

  const mockWorksheet = async (table: TableInfo) => {
    const mockedData = getMockOpenSeaMetadata(table.tableCode, table.tableNumber, table.electoralLocationId, cbbaParties.codes);

    // Mock IPFS fetching
    jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockResolvedValue(
      mockedData,
    );

    return mockedData;
  }

  const uploadWorksheet = async (table: TableInfo, worksheetId: string) => {
    const mockedData = await mockWorksheet(table);

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: `https://ipfs.io/ipfs/${worksheetId}`,
        dni: userDni,
        electionId: activeElectionId,
      }).expect(201);

    expect(response.body).toHaveProperty('_id');

    return mockedData;
  }

  it('HT1: should create a worksheet', async () => {
    const currentTable = cbbaTables[0];
    mockWorksheet(currentTable);

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet1',
        dni: userDni,
        electionId: activeElectionId,
      }).expect(201);

    expect(response.body).toHaveProperty('_id');
    const worksheet = await conn.collection<Worksheet>('worksheets').findOne({ _id: new Types.ObjectId(response.body._id as string) });
    expect(worksheet).not.toBeNull();

    expect(worksheet?.dni).toBe(userDni);
    expect(worksheet?.electionId.toString()).toBe(activeElectionId);
    expect(worksheet?.tableCode).toBe(currentTable.tableCode);
    expect(worksheet?.votes?.parties?.totalVotes).toBe(157);
  });

  it('HT2-A: should return 400 for invalid IPFS URI', async () => {
    jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockRestore();
    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet2',
        dni: userDni,
        electionId: activeElectionId,
      }).expect(400);

    expect(response.body).toHaveProperty('message', 'Error al obtener datos de IPFS');
  });

  it('HT2-B: should return 400 for IPFS URI with bad data', async () => {
    jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockRestore();
    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/QmcBY5EJ4w4SsYHKSMSSkJFzEax6wqb4d4xm3u4wdaivLH',
        dni: userDni,
        electionId: activeElectionId,
      }).expect(400);

    expect(response.body).toHaveProperty('message', 'Error al obtener datos de IPFS');
  });

  it('HT2-C: should return 400 for IPFS timeout/error mock', async () => {
    jest
      .spyOn(worksheetService, 'fetchFromIpfs' as any)
      .mockRejectedValue(
        new BadRequestException('Error al obtener datos de IPFS'),
      );

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/timeoutworksheet',
        dni: userDni,
        electionId: activeElectionId,
        tableCode: cbbaTables[6].tableCode,
        tableNumber: cbbaTables[6].tableNumber,
        locationId: cbbaTables[6].electoralLocationId,
      })
      .expect(400);

    expect(response.body).toHaveProperty('message', 'Error al obtener datos de IPFS');
  });

  it('HT3: should return 403 for non zk-authorized users', async () => {
    const table = cbbaTables[1];
    mockWorksheet(table);

    // Make the ZK auth guard to reject the request
    mockZkAuthGuard.canActivate.mockResolvedValue(false);

    await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet3',
        dni: userDni,
        electionId: activeElectionId,
      }).expect(403);

    // Restore the guard for other tests
    mockZkAuthGuard.canActivate.mockResolvedValue(true);
  });

  it('HT4: should return the registered worksheet', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[0].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('UPLOADED');
    expect(response.body.tableCode).toBe(cbbaTables[0].tableCode);
    expect(response.body.tableNumber).toBe(cbbaTables[0].tableNumber);
    expect(response.body.ipfsUri).toBe('https://ipfs.io/ipfs/testworksheet1');
  });

  it('HT4-B: should return worksheet detail with image and votes', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[0].tableCode}/detail`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('UPLOADED');
    expect(response.body.tableCode).toBe(cbbaTables[0].tableCode);
    expect(response.body.tableNumber).toBe(cbbaTables[0].tableNumber);
    expect(response.body.image).toBeDefined();
    expect(response.body.votes).toBeDefined();
    expect(response.body.votes.parties.totalVotes).toBe(157);
  });

  it('HT5-A: should return NOT_FOUND if no worksheet found for not registered dni', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/000000/by-table/${cbbaTables[0].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('NOT_FOUND');
  });

  it('HT5-B: should return NOT_FOUND if no worksheet found for wrong table code', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[1].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('NOT_FOUND');
  });

  it('HT5-C: should return NOT_FOUND if no worksheet found for non-existent election id', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[0].tableCode}`)
      .query({ electionId: pastElectionId })
      .expect(200);

    expect(response.body.status).toBe('NOT_FOUND');
  });

  describe('Compare Worksheet', () => {
    let compareTable: TableInfo;
    let mockedData: OpenSeaMetadata;
    let body: CompareWorksheetDto;

    beforeAll(async () => {
      compareTable = cbbaTables[2];
      mockedData = await uploadWorksheet(compareTable, 'testworksheetToCompare');
      body = {
        dni: userDni,
        electionId: activeElectionId,
        tableCode: compareTable.tableCode,
        votes: {}
      }
    });

    it('HT6: should return MATCH on match compare worksheet with provided votes', async () => {
      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes: mockedData.data.votes, // Use the same votes to ensure a match
        }).expect(201);

      expect(response.body.status).toBe('MATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(0);
    });

    it('HT7-A: should return MISMATCH on compare worksheet with different party names', async () => {
      const votes: WorksheetVotesDto = {
        parties: {
          ...mockedData.data.votes.parties!,
          partyVotes: [
            { partyId: 'laPaz-1', votes: 50 },
            { partyId: 'laPaz-2', votes: 50 },
            { partyId: 'laPaz-3', votes: 50 },
          ]
        }
      }

      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes, // Use the modified votes
        }).expect(201);

      expect(response.body.status).toBe('MISMATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(6);
    });

    it('HT7-B: should return MISMATCH on compare worksheet with 1 party more', async () => {
      const votes: WorksheetVotesDto = {
        parties: {
          ...mockedData.data.votes.parties!,
          partyVotes: [
            ...mockedData.data.votes.parties!.partyVotes,
            { partyId: 'laPaz-1', votes: 50 },
          ]
        }
      }

      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes, // Use the modified votes
        }).expect(201);
      
      expect(response.body.status).toBe('MISMATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(1);
    });

    it('HT7-C: should return MISMATCH on compare worksheet with 1 party less', async () => {
      const votes: WorksheetVotesDto = {
        parties: {
          ...mockedData.data.votes.parties!,
          partyVotes: [
            mockedData.data.votes.parties!.partyVotes[0],
            mockedData.data.votes.parties!.partyVotes[1],
          ]
        }
      }

      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes, // Use the modified votes
        }).expect(201);
      
      expect(response.body.status).toBe('MISMATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(1);
    });

    it('HT7-D: should return MISMATCH on compare worksheet with different totals', async () => {
      const votes: WorksheetVotesDto = {
        parties: {
          totalVotes: mockedData.data.votes.parties!.totalVotes! + 3,
          validVotes: mockedData.data.votes.parties!.validVotes + 1,
          nullVotes: mockedData.data.votes.parties!.nullVotes + 1,
          blankVotes: mockedData.data.votes.parties!.blankVotes + 1,
          partyVotes: mockedData.data.votes.parties!.partyVotes,
        }
      }

      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes, // Use the modified votes
        }).expect(201);
      
      expect(response.body.status).toBe('MISMATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(4);
    });

    it('HT7-E: should return MISMATCH on compare worksheet with different party votes', async () => {
      const votes: WorksheetVotesDto = {
        parties: {
          ...mockedData.data.votes.parties!,
          partyVotes: mockedData.data.votes.parties!.partyVotes.map((pv) => ({
            partyId: pv.partyId,
            votes: pv.votes + 10, // Change the votes for each party to create a mismatch
          }))
        }
      }

      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          votes, // Use the modified votes
        }).expect(201);
      
      expect(response.body.status).toBe('MISMATCH');
      expect(response.body.worksheetStatus).toBe('UPLOADED');
      expect(response.body.differences).toHaveLength(3);
    });

    it('HT8: should return NOT_FOUND on compare not existing worksheet', async () => {
      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          tableCode: cbbaTables[3].tableCode,
          votes: mockedData.data.votes,
        }).expect(201);

      expect(response.body.status).toBe('NOT_FOUND');
    });

    it('HT9: should return NOT_AVAILABLE on failed worksheet', async () => {
      const failedTable = cbbaTables[4];

      // Upload a failed worksheet (simulate IPFS fetch failure)
      jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockRestore();
      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/from-ipfs')
        .send({
          ipfsUri: 'https://ipfs.io/ipfs/failedworksheet1',
          dni: userDni,
          electionId: activeElectionId,
          tableCode: failedTable.tableCode,
          tableNumber: failedTable.tableNumber,
          locationId: failedTable.electoralLocationId,
          image: 'https://gateway.pinata.cloud/ipfs/failedworksheet1image',
          votes: mockedData.data.votes,
          recordId: 'recordId1',
          tableIdIpfs: 'tableIdIpfs1',
          nftLink: 'https://nft.example.com/failedworksheet1',
        }).expect(400);

      expect(response.body).toHaveProperty('message', 'Error al obtener datos de IPFS');
      
      // Try to compare the failed worksheet
      const compareResponse = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          tableCode: failedTable.tableCode,
          votes: mockedData.data.votes,
        }).expect(201);

      expect(compareResponse.body.status).toBe('NOT_AVAILABLE');
      expect(compareResponse.body.worksheetStatus).toBe('FAILED');
    });
  });

  it('HT10: should return 409 on try to upload the same worksheet', async () => {
    const currentTable = cbbaTables[0];
    mockWorksheet(currentTable);

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet1',
        dni: userDni,
        electionId: activeElectionId,
      }).expect(409);

    expect(response.body).toHaveProperty('message', 'La hoja de trabajo ya fue subida para esta mesa y elección'); 
  });

  it('HT12: should return 400 on retry an uploaded worksheet', async () => {
    const currentTable = cbbaTables[0];
    mockWorksheet(currentTable);

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/retry')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet1',
        dni: userDni,
        electionId: activeElectionId,
        tableCode: currentTable.tableCode,
      }).expect(400);

    expect(response.body).toHaveProperty('message', 'Solo se puede reintentar una hoja en estado FAILED'); 
  });

  it('HT13: should return 404 on retry a non-existing worksheet', async () => {
    const currentTable = cbbaTables[5];
    mockWorksheet(currentTable);

    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/retry')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/testworksheet5',
        dni: userDni,
        electionId: activeElectionId,
        tableCode: currentTable.tableCode,
      }).expect(404);

    expect(response.body).toHaveProperty('message', 'No existe hoja de trabajo fallida para reintentar'); 
  });

  it('HT14: should return 201 on retry a failed worksheet', async () => {
    const failedTable = cbbaTables[5];
    const mockedData = getMockOpenSeaMetadata(failedTable.tableCode, failedTable.tableNumber, failedTable.electoralLocationId, cbbaParties.codes);

    // Upload a failed worksheet (simulate IPFS fetch failure)
    jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockRestore();
    const response = await request(appHttpServer)
      .post('/api/v1/worksheets/from-ipfs')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/failedworksheet5',
        dni: userDni,
        electionId: activeElectionId,
        tableCode: failedTable.tableCode,
        tableNumber: failedTable.tableNumber,
        locationId: failedTable.electoralLocationId,
        image: 'https://gateway.pinata.cloud/ipfs/failedworksheet5image',
        votes: mockedData.data.votes,
        recordId: 'recordId5',
        tableIdIpfs: 'tableIdIpfs5',
        nftLink: 'https://nft.example.com/failedworksheet5',
      }).expect(400);

    expect(response.body).toHaveProperty('message', 'Error al obtener datos de IPFS');

    // Set ipfs fetch to return valid data for the retry
    jest.spyOn(worksheetService, 'fetchFromIpfs' as any).mockResolvedValue(mockedData);
    
    // Retry the failed worksheet
    const retryResponse = await request(appHttpServer)
      .post('/api/v1/worksheets/retry')
      .send({
        ipfsUri: 'https://ipfs.io/ipfs/failedworksheet5',
        dni: userDni,
        electionId: activeElectionId,
        tableCode: failedTable.tableCode,
      }).expect(201);

    expect(retryResponse.body).toHaveProperty('_id');
    const worksheet = await conn.collection<Worksheet>('worksheets').findOne({ _id: new Types.ObjectId(retryResponse.body._id as string) });
    expect(worksheet).not.toBeNull();
    expect(worksheet?.status).toBe('UPLOADED');
    expect(worksheet?.errorMessage).toBeUndefined();
  });
});
