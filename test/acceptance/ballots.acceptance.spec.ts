import {
  INestApplication,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import request from 'supertest';

import { ElectionsModule } from '../../src/modules/elections/elections.module';
import { BallotController } from '../../src/modules/ballot/controllers/ballot.controller';
import { BallotService } from '../../src/modules/ballot/services/ballot.service';
import {
  Ballot,
  BallotSchema,
} from '../../src/modules/ballot/schemas/ballot.schema';
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../../src/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocationService } from '../../src/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '../../src/modules/geographic/services/electoral-table.service';
import { PoliticalPartyService as PoliticalPartyServiceClass } from '../../src/modules/political/services/political-party.service';
import {
  ElectoralLocation,
  ElectoralLocationSchema,
} from '../../src/modules/geographic/schemas/electoral-location.schema';

import { InMemoryMongo } from '../utils/mongo';
const VALID_OID = '64b000000000000000000001';
const OTHER_OID = '64b000000000000000000099';
// Dependent mock services (Geographic + Parties)
class ElectoralLocationServiceMock {
  public shouldThrowFindOne = false;
  async findOne(id: string) {
    if (this.shouldThrowFindOne) throw new NotFoundException('no existe');
    return { _id: id };
  }
  async findOneWithHierarchy(id: string) {
    // Usado por createFromIpfs a getLocationDetails()
    return {
      _id: id,
      name: 'U.E. Demo',
      address: 'Calle Falsa 123',
      district: 'D1',
      zone: 'Z1',
      circunscripcion: { number: 24, type: 'Uninominal', name: 'C24' },
      electoralSeat: { name: 'Achachicala' },
      municipality: { name: 'La Paz' },
      province: { name: 'Murillo' },
      department: { name: 'La Paz' },
    };
  }
  async findNearestLocation() {
    return null;
  }
}
class ElectoralTableServiceMock {
  public mismatch = false;
  async findByTableCode(tableCode: string) {
    if (this.mismatch) {
      return { tableCode, electoralLocationId: OTHER_OID };
    }
    return { tableCode, electoralLocationId: VALID_OID };
  }
  async countTotal() {
    return 100;
  }
  async countByLocation() {
    return 10;
  }
}
class PoliticalPartyServiceMock {
  public enabled = true;
  async validatePartyIds(ids: string[], electionId?: string) {
    return this.enabled;
  }
}

describe('Aceptación: Ballots', () => {
  let app: INestApplication;
  const mongo = new InMemoryMongo();
  const baseUrl = '/api/v1/ballots';

  const locMock = new ElectoralLocationServiceMock();
  const tblMock = new ElectoralTableServiceMock();
  const partyMock = new PoliticalPartyServiceMock();

  const createElection = async (payload: {
    name: string;
    votingStartDate: string;
    votingEndDate: string;
    resultsStartDate: string;
    allowDataModification?: boolean;
    type?: any;
    round?: 1 | 2;
  }) => {
    const { body, status } = await request(app.getHttpServer())
      .post(`/api/v1/elections/config`)
      .send(payload);
    expect([200, 201]).toContain(status);
    return body;
  };

  const mockFetchWith = (json: any) => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      text: async () => JSON.stringify(json),
    });
  };

  beforeAll(async () => {
    await mongo.start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRootAsync({
          useFactory: async () => ({ uri: mongo.uri }),
        }),
        MongooseModule.forFeature([
          { name: Ballot.name, schema: BallotSchema },
          { name: ElectoralTable.name, schema: ElectoralTableSchema },
          { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
        ]),
        ElectionsModule,
      ],
      controllers: [BallotController],
      providers: [
        BallotService,
        { provide: ElectoralLocationService, useValue: locMock },
        { provide: ElectoralTableService, useValue: tblMock },
        { provide: PoliticalPartyServiceClass, useValue: partyMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await mongo.stop();
    (global as any).fetch = undefined;
  });

  beforeEach(async () => {
    await mongo.clear();
    locMock.shouldThrowFindOne = false;
    tblMock.mismatch = false;
    partyMock.enabled = true;
    (global as any).fetch = undefined;
  });

  const validIpfs = (over: Partial<any> = {}) => ({
    image: 'ipfs://image-cid',
    data: {
      tableCode: 'T-001',
      tableNumber: '1',
      locationId: VALID_OID,
      votes: {
        parties: {
          validVotes: 10,
          nullVotes: 1,
          blankVotes: 2,
          partyVotes: [
            { partyId: 'A', votes: 4 },
            { partyId: 'B', votes: 6 },
          ],
        },
      },
      ...over,
    },
  });

  it('OK a 201 cuando datos son válidos y dentro de horario (VotingPeriodGuard)', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 1,
    });

    partyMock.enabled = true;
    tblMock.mismatch = false;
    locMock.shouldThrowFindOne = false;

    mockFetchWith(validIpfs());

    const res = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid-demo' });

    expect([200, 201]).toContain(res.status);
    expect(res.body === true || res.text === 'true').toBe(true);
  });

  it('400 cuando falta "data" en metadata', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    mockFetchWith({ image: 'ipfs://img' });

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain('no se encontro campo data');
  });

  it('400 cuando falta "image" en metadata', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    mockFetchWith({ data: validIpfs().data });
    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain('no se encontro campo image');
  });

  it('400 cuando la suma de partyVotes != validVotes (presidentes)', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    const bad = validIpfs({
      votes: {
        parties: {
          validVotes: 10,
          nullVotes: 0,
          blankVotes: 0,
          partyVotes: [
            { partyId: 'A', votes: 3 },
            { partyId: 'B', votes: 3 },
          ],
        },
      },
    });
    mockFetchWith(bad);

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain('no coincide con votos válidos');
  });

  it('400 cuando TABLE_NOT_FOUND_OR_MISMATCH', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    tblMock.mismatch = true;
    mockFetchWith(validIpfs());

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain('TABLE_NOT_FOUND_OR_MISMATCH');
  });

  it('400 cuando locationId inexistente', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    locMock.shouldThrowFindOne = true;
    mockFetchWith(validIpfs());

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain(
      'El recinto electoral especificado no existe',
    );
  });

  it('400 cuando votes vacío (sin parties ni deputies)', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    const bad = validIpfs({ votes: {} });
    mockFetchWith(bad);

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain(
      'Debe enviar al menos una categoría de votos',
    );
  });

  it('400 cuando partyIds no habilitados para la elección', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    partyMock.enabled = false; // fuerza error de validación
    mockFetchWith(validIpfs());

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid' });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain(
      'IDs de partido inválidos o inactivos',
    );
  });

  it('Crea versión 1 y luego versión 2 automáticamente para la misma mesa', async () => {
    const now = new Date();
    const elec = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    partyMock.enabled = true;
    tblMock.mismatch = false;
    locMock.shouldThrowFindOne = false;

    mockFetchWith(validIpfs()); // v1

    const CID_V0_A = 'Qm' + 'a'.repeat(44);
    const CID_V0_B = 'Qm' + 'b'.repeat(44);
    const r1 = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs?electionId=${elec.id}`)
      .send({ ipfsUri: `ipfs://${CID_V0_A}` });
    expect([200, 201]).toContain(r1.status);
    expect(r1.body.version).toBe(1);

    mockFetchWith(validIpfs()); // v2
    const r2 = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs?electionId=${elec.id}`)
      .send({ ipfsUri: `ipfs://${CID_V0_B}` });
    expect([200, 201]).toContain(r2.status);
    expect(r2.body.version).toBe(2);

    // /versions/:tableCode ordenado desc
    const ver = await request(app.getHttpServer()).get(
      `${baseUrl}/versions/T-001?electionId=${elec.id}`,
    );
    expect(ver.status).toBe(200);
    expect(Array.isArray(ver.body)).toBe(true);
    expect(ver.body.length).toBeGreaterThanOrEqual(2);
    expect(ver.body[0].version).toBe(2);
    expect(ver.body[1].version).toBe(1);
  });
});
