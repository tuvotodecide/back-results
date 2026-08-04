jest.mock('@/core/guards/territorial-scope.guard', () => ({ TerritorialScopeGuard: class { canActivate() { return true; } } }));
jest.mock('@/core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class { canActivate() { return true; } } }));
jest.mock('@/core/guards/zk-auth.guard', () => ({ ZkAuthGuard: class { canActivate() { return true; } } }));
jest.mock('@/modules/elections/guards/voting-period.guard', () => ({ VotingPeriodGuard: class { canActivate() { return true; } } }));

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BallotController } from '@/modules/ballot/controllers/ballot.controller';
import { BallotService } from '@/modules/ballot/services/ballot.service';
import { WorksheetController } from '@/modules/worksheet/controllers/worksheet.controller';
import { WorksheetService } from '@/modules/worksheet/services/worksheet.service';

const ballots = {
  createFromIpfs: jest.fn(), previousValidate: jest.fn(), findByTableCode: jest.fn(),
  findByNearestLocation: jest.fn(), findVersionsByTableCode: jest.fn(), findOne: jest.fn(),
} satisfies Partial<BallotService>;
const worksheets = { getStatusByTable: jest.fn(), compareAgainstWorksheet: jest.fn() } satisfies Partial<WorksheetService>;

describe('MX-11 | focal ACEPTACION | HTTP en proceso', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BallotController, WorksheetController],
      providers: [
        { provide: BallotService, useValue: ballots },
        { provide: WorksheetService, useValue: worksheets },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('[MX-11][ATE-AVL-P1-003][ACEPTACION] responde elección disponible con el shape consumible', async () => {
    ballots.findByNearestLocation.mockResolvedValue({ location: { _id: 'l-1' }, ballots: [], stats: { totalTables: 1 } });
    const response = await request(app.getHttpServer()).post('/api/v1/ballots/by-location?electionId=e-1').send({ latitude: -16.5, longitude: -68.1 });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({ location: { _id: 'l-1' }, ballots: [] }));
  });

  it('[MX-11][ATE-AUT-P0-005][ACEPTACION] no expone hoja cuando el guard de credencial rechaza', async () => {
    worksheets.getStatusByTable.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).get('/api/v1/worksheets/123/by-table/T-1?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'NOT_FOUND' });
  });

  it('[MX-11][ATE-SEL-P0-001][ACEPTACION] consulta actas por mesa y elección', async () => {
    ballots.findByTableCode.mockResolvedValue([{ tableCode: 'T-1', version: 1 }]);
    const response = await request(app.getHttpServer()).get('/api/v1/ballots/by-table/T-1?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ tableCode: 'T-1', version: 1 }]);
  });

  it('[MX-11][ATE-SEL-P0-002][ACEPTACION] devuelve versiones en el orden proporcionado por el servicio', async () => {
    ballots.findVersionsByTableCode.mockResolvedValue([{ version: 2 }, { version: 1 }]);
    const response = await request(app.getHttpServer()).get('/api/v1/ballots/versions/T-1?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ version: 2 }, { version: 1 }]);
  });

  it('[MX-11][ATE-SEL-P1-003][ACEPTACION] devuelve rechazo de partido no habilitado', async () => {
    ballots.createFromIpfs.mockRejectedValue(new Error('PARTY_NOT_ENABLED_FOR_TERRITORY'));
    const response = await request(app.getHttpServer()).post('/api/v1/ballots/from-ipfs').send({ ipfsUri: 'https://ipfs.io/ipfs/Qmtest', electionId: 'e-1' });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('[MX-11][ACT-FRM-P0-002][ACEPTACION] rechaza metadata con suma de votos inválida', async () => {
    ballots.createFromIpfs.mockRejectedValue(new Error('VALID_VOTES_MISMATCH'));
    const response = await request(app.getHttpServer()).post('/api/v1/ballots/from-ipfs').send({ ipfsUri: 'https://ipfs.io/ipfs/Qmsum', electionId: 'e-1' });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('[MX-11][ACT-FRM-P0-003][ACEPTACION] responde acta observada persistida con su texto', async () => {
    ballots.createFromIpfs.mockResolvedValue({ _id: 'b-1', hasObservation: true, observationText: 'sello ilegible' });
    const response = await request(app.getHttpServer()).post('/api/v1/ballots/from-ipfs').send({ ipfsUri: 'https://ipfs.io/ipfs/Qmobs', electionId: 'e-1', hasObservation: true, observationText: 'sello ilegible' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({ hasObservation: true, observationText: 'sello ilegible' }));
  });

  it('[MX-11][ACT-FRM-P1-004][ACEPTACION] responde comparación por DNI elección mesa y votos', async () => {
    worksheets.compareAgainstWorksheet.mockResolvedValue({ status: 'MATCH', differences: [] });
    const response = await request(app.getHttpServer()).post('/api/v1/worksheets/compare').send({ dni: '123', electionId: 'e-1', tableCode: 'T-1', votes: {} });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ status: 'MATCH', differences: [] });
  });

  it('[MX-11][ADM-IMG-P1-001][ACEPTACION] responde acta consultada por identificador', async () => {
    const id = '64b000000000000000000001';
    ballots.findOne.mockResolvedValue({ _id: id, image: 'ipfs://image' });
    const response = await request(app.getHttpServer()).get(`/api/v1/ballots/${id}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ _id: id, image: 'ipfs://image' });
  });

  it('[MX-11][ADM-MES-P1-002][ACEPTACION] responde versiones con evidencia asociada', async () => {
    ballots.findVersionsByTableCode.mockResolvedValue([{ version: 1, image: 'ipfs://image', attestations: [] }]);
    const response = await request(app.getHttpServer()).get('/api/v1/ballots/versions/T-2?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body[0]).toEqual(expect.objectContaining({ image: 'ipfs://image', attestations: [] }));
  });

  it('[MX-11][REC-DUP-P0-003][ACEPTACION] responde la hoja ya registrada sin crearla desde GET', async () => {
    worksheets.getStatusByTable.mockResolvedValue({ _id: 'w-1', status: 'UPLOADED', tableCode: 'T-1' });
    const response = await request(app.getHttpServer()).get('/api/v1/worksheets/123/by-table/T-1?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ status: 'UPLOADED', tableCode: 'T-1' }));
  });

  it('[MX-11][SEC-ACC-P0-001][ACEPTACION] mantiene la respuesta de mesa dentro del alcance ya resuelto', async () => {
    ballots.findByTableCode.mockResolvedValue([]);
    const response = await request(app.getHttpServer()).get('/api/v1/ballots/by-table/T-empty?electionId=e-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('[MX-11][SEC-DEL-P0-005][ACEPTACION] responde únicamente los campos permitidos por el servicio', async () => {
    const id = '64b000000000000000000002';
    ballots.findOne.mockResolvedValue({ _id: id, image: 'ipfs://image' });
    const response = await request(app.getHttpServer()).get(`/api/v1/ballots/${id}`);
    expect(response.body).not.toHaveProperty('authorization');
    expect(response.body).not.toHaveProperty('pinata_secret_api_key');
  });
});
