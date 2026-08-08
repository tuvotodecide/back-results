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
    })
      .overrideProvider(IncentiveCampaignsService)
      .useValue(mockIncentiveCampaignsService)
      .compile();

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

  it('[ATE-AUT-P0-004][ATE-SEL-P1-004][REC-DUP-P0-003] crea hoja de trabajo para DNI mesa y eleccion autorizados', async () => {
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

  it('[EVD-IPF-P0-004][SEC-FIL-P0-003] rechaza URI IPFS invalida con error seguro', async () => {
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

  it('[EVD-IPF-P0-004] rechaza metadata IPFS sin datos validos', async () => {
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

  it('[EVD-IPF-P0-004][SEC-FIL-P0-003] rechaza fallo de gateway IPFS sin persistir hoja', async () => {
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

  it('[ATE-AUT-P0-005] rechaza hoja de trabajo sin x-api-key vigente', async () => {
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

  it('[ATE-SEL-P1-004] devuelve hoja registrada para DNI mesa y eleccion', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[0].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('UPLOADED');
    expect(response.body.tableCode).toBe(cbbaTables[0].tableCode);
    expect(response.body.tableNumber).toBe(cbbaTables[0].tableNumber);
    expect(response.body.ipfsUri).toBe('https://ipfs.io/ipfs/testworksheet1');
  });

  it('[ATE-SEL-P1-004][ACT-FRM-P1-004] devuelve detalle de hoja con imagen y votos comparables', async () => {
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

  it('[SEC-DNI-P0-002] responde NOT_FOUND para DNI sin hoja sin enumerar datos ajenos', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/000000/by-table/${cbbaTables[0].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('NOT_FOUND');
  });

  it('[ATE-SEL-P1-004] responde NOT_FOUND para mesa incorrecta sin filtrar hoja', async () => {
    const response = await request(appHttpServer)
      .get(`/api/v1/worksheets/${userDni}/by-table/${cbbaTables[1].tableCode}`)
      .query({ electionId: activeElectionId })
      .expect(200);

    expect(response.body.status).toBe('NOT_FOUND');
  });

  it('[ATE-SEL-P1-004] responde NOT_FOUND para eleccion inexistente sin filtrar hoja', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MATCH al comparar hoja y acta equivalentes', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MISMATCH con nombres de partidos diferentes', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MISMATCH cuando el acta tiene un partido adicional', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MISMATCH cuando falta un partido del acta', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MISMATCH con totales distintos', async () => {
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

    it('[ACT-FRM-P1-004] devuelve MISMATCH con votos por partido distintos', async () => {
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

    it('[ACT-FRM-P1-004] devuelve NOT_FOUND al comparar hoja inexistente', async () => {
      const response = await request(appHttpServer)
        .post('/api/v1/worksheets/compare')
        .send({
          ...body,
          tableCode: cbbaTables[3].tableCode,
          votes: mockedData.data.votes,
        }).expect(201);

      expect(response.body.status).toBe('NOT_FOUND');
    });

    it('[ACT-FRM-P1-004][REC-QUE-P0-001] devuelve NOT_AVAILABLE para hoja fallida recuperable', async () => {
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

  it('[REC-DUP-P0-003] devuelve conflicto al subir la misma hoja de trabajo', async () => {
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

  it('[REC-DUP-P0-003] rechaza reintento de hoja ya subida', async () => {
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

  it('[REC-QUE-P0-002] rechaza reintento de hoja inexistente sin crear duplicado', async () => {
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

  it('[REC-QUE-P0-002][REC-PAR-P0-006] reintenta hoja fallida desde checkpoint sin duplicar evidencia', async () => {
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
