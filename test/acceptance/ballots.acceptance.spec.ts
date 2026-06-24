import {
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import request from 'supertest';

jest.mock('@/modules/zk-auth/zk-auth.module', () => ({
  ZkAuthModule: class {},
}));

jest.mock('@/core/guards/zk-auth.guard', () => ({
  ZkAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@/core/guards/admin-only.guard', () => ({
  AdminOnlyGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('@/core/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockResolvedValue(true),
  })),
}));

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
import { TableCodeValidationService } from '../../src/modules/table-code-validation/services/table-code-validation.service';
import { LoggerService } from '../../src/core/services/logger.service';
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
    // Used by createFromIpfs getLocationDetails()
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
  async validatePartyIdsForElection(
    electionId: string,
    ids: string[],
    departmentId?: string,
    municipalityId?: string,
  ) {
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
  const tableCodeValidationMock = {
    ensurePending: jest.fn().mockResolvedValue(undefined),
  };
  const loggerMock = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  };

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
        {
          provide: TableCodeValidationService,
          useValue: tableCodeValidationMock,
        },
        { provide: LoggerService, useValue: loggerMock },
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
    const election = await createElection({
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
      .send({ ipfsUri: 'ipfs://cid-demo', electionId: election.id });

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

  it('validate-ballot-data no rechaza por TABLE_NOT_FOUND_OR_MISMATCH en el contrato actual', async () => {
    const now = new Date();
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    tblMock.mismatch = true;
    mockFetchWith(validIpfs());

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid', electionId: election.id });

    expect([200, 201]).toContain(r.status);
    expect(r.body === true || r.text === 'true').toBe(true);
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
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    partyMock.enabled = false; // fuerza error de validación
    mockFetchWith(validIpfs());

    const r = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid', electionId: election.id });

    expect(r.status).toBe(400);
    expect(String(r.body.message)).toContain(
      'Uno o más partidos no están habilitados para esta elección',
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
      .post(`${baseUrl}/from-ipfs`)
      .send({ ipfsUri: `ipfs://${CID_V0_A}`, electionId: elec.id });
    expect([200, 201]).toContain(r1.status);
    expect(r1.body.version).toBe(1);

    mockFetchWith(validIpfs()); // v2
    const r2 = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs`)
      .send({ ipfsUri: `ipfs://${CID_V0_B}`, electionId: elec.id });
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

  it('from-ipfs retorna 400 cuando no puede extraer CID de la URI', async () => {
    const now = new Date();
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    mockFetchWith(validIpfs());

    const res = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs`)
      .send({ ipfsUri: 'not-a-cid', electionId: election.id });

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('No se pudo extraer CID');
  });

  it('from-ipfs retorna 400 cuando IPFS falla por timeout/error mockeado', async () => {
    const now = new Date();
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    (global as any).fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('ipfs timeout'), { code: 'ETIMEDOUT' }),
    );

    const res = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs`)
      .send({
        ipfsUri: `ipfs://${'Qm' + 't'.repeat(44)}`,
        electionId: election.id,
      });

    expect(res.status).toBe(400);
    expect(String(res.body.message)).toContain('Error al obtener datos de IPFS');
    expect((global as any).fetch).toHaveBeenCalled();
  });

  it('validate-ballot-data retorna 409 cuando ya existe un acta con los mismos votos', async () => {
    const now = new Date();
    const election = await createElection({
      name: `ELEC-${now.getTime()}`,
      votingStartDate: new Date(now.getTime() - 60_000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60_000).toISOString(),
      resultsStartDate: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    });

    mockFetchWith(validIpfs());
    const created = await request(app.getHttpServer())
      .post(`${baseUrl}/from-ipfs`)
      .send({
        ipfsUri: `ipfs://${'Qm' + 'd'.repeat(44)}`,
        electionId: election.id,
      });
    expect([200, 201]).toContain(created.status);

    mockFetchWith(validIpfs());
    const duplicate = await request(app.getHttpServer())
      .post(`${baseUrl}/validate-ballot-data`)
      .send({
        ipfsUri: `ipfs://${'Qm' + 'e'.repeat(44)}`,
        electionId: election.id,
      });

    expect(duplicate.status).toBe(409);
    expect(String(duplicate.body.message)).toContain(
      'Ya existe un acta con los mismos votos para esta mesa',
    );
  });
});
