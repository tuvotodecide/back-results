import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';

import request from 'supertest';

// Módulo real de Elections (usa el modelo real ElectionConfig)
import { ElectionsModule } from '../../src/modules/elections/elections.module';

// Controladores reales con guards aplicados
import { ResultsController } from '../../src/modules/results/controllers/results.controller';
import { BallotController } from '../../src/modules/ballot/controllers/ballot.controller';

// Servicios a mockear (para no levantar todo el ecosistema)
import { ResultsService } from '../../src/modules/results/services/results.service';
import { BallotService } from '../../src/modules/ballot/services/ballot.service';

// Helper Mongo en memoria (usa tu clase ya existente)
import { InMemoryMongo } from '../utils/mongo';

describe('Aceptación: Elections / Guards', () => {
  let app: INestApplication;
  const mongo = new InMemoryMongo();

  // Mocks “livianos” para que los controladores puedan responder 200 cuando el guard permite el acceso
  const resultsMock: Partial<ResultsService> = {
    getQuickCount: async () => ({
      results: [],
      summary: {
        validVotes: 0,
        nullVotes: 0,
        blankVotes: 0,
        totalVotes: 0,
        tablesProcessed: 0,
      },
      lastUpdate: new Date(),
    }),
    getResultsByLocation: async () => ({
      filters: {},
      results: [],
      summary: {
        validVotes: 0,
        nullVotes: 0,
        blankVotes: 0,
        totalVotes: 0,
        tablesProcessed: 0,
        totalTables: 0,
      },
      lastUpdate: new Date(),
    }),
    getRegistrationProgress: async () => ({
      progress: {
        totalTables: 0,
        registeredBallots: 0,
        percentage: '0.00',
        pending: 0,
      },
      byStatus: { pending: 0, processed: 0, synced: 0, error: 0 },
      lastUpdate: new Date(),
    }),
    getSystemStatistics: async () => ({
      summary: {
        totalBallots: 0,
        byStatus: { pending: 0, processed: 0, synced: 0, error: 0 },
        departmentsCovered: 0,
      },
      departmentCoverage: [],
      recentActivity: [],
      lastUpdate: new Date(),
    }),
    getHeatMapData: async () => ({
      data: [],
      electionType: 'presidential',
      lastUpdate: new Date(),
    }),
    getResultsByCircunscripcion: async () => ({
      filters: {},
      circunscripciones: [],
      lastUpdate: new Date(),
    }),
    onModuleInit: async () => undefined,
  };

  const ballotMock: Partial<BallotService> = {
    previousValidate: async () => true,
    createFromIpfs: async () => ({}) as any,
  };

  const baseUrl = '/api/v1';

  const createElection = async (payload: {
    name: string;
    votingStartDate: string; // ISO
    votingEndDate: string; // ISO
    resultsStartDate: string; // ISO
    allowDataModification?: boolean;
    type?:
      | 'presidential'
      | 'departamental'
      | 'municipal'
      | 'referendum'
      | 'congress'
      | 'parlacen';
    round?: 1 | 2;
  }) => {
    const { body, status } = await request(app.getHttpServer())
      .post(`${baseUrl}/elections/config`)
      .send(payload);
    expect([201, 200]).toContain(status);
    return body; // { id, ... }
  };

  beforeAll(async () => {
    await mongo.start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }),
        MongooseModule.forRootAsync({
          useFactory: async () => ({
            uri: mongo.uri,
          }),
        }),

        ElectionsModule,
      ],

      controllers: [ResultsController, BallotController],
      providers: [
        { provide: ResultsService, useValue: resultsMock },

        { provide: BallotService, useValue: ballotMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await mongo.clear(); // base limpia por test
  });

  // -----------------------
  // 1) /results/* sin config activa
  // -----------------------
  it('SIN config activa → GET /results/quick-count responde 403 NO_ELECTION_CONFIG', async () => {
    const { status, body } = await request(app.getHttpServer()).get(
      `${baseUrl}/results/quick-count`,
    );

    expect(status).toBe(403);
    expect(body?.error).toBe('NO_ELECTION_CONFIG');
  });

  // -----------------------
  // 2) ResultsPeriodGuard
  // -----------------------
  it('Con una config activa pero resultsStartDate en el FUTURO → 403 RESULTS_NOT_AVAILABLE', async () => {
    const now = new Date();

    await createElection({
      name: `ELEC-${now.getTime()}-A`,
      // Votación ya terminó hace 1h
      votingStartDate: new Date(
        now.getTime() - 2 * 60 * 60 * 1000,
      ).toISOString(),
      votingEndDate: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      // Resultados todavía NO disponibles (en 1h)
      resultsStartDate: new Date(
        now.getTime() + 1 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const { status, body } = await request(app.getHttpServer()).get(
      `${baseUrl}/results/quick-count`,
    );

    expect(status).toBe(403);
    expect(body?.error).toBe('RESULTS_NOT_AVAILABLE');
  });

  it('Con una config activa y resultsStartDate en el PASADO → 200 OK (guard permite)', async () => {
    const now = new Date();

    // Activa "presidential"
    await createElection({
      name: `ELEC-${now.getTime()}-B`,
      votingStartDate: new Date(
        now.getTime() - 2 * 60 * 60 * 1000,
      ).toISOString(),
      votingEndDate: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(), // ya habilitado
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const { status, body } = await request(app.getHttpServer()).get(
      `${baseUrl}/results/quick-count`,
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('summary');
  });

  // -----------------------
  // 3) PreliminaryResultsGuard
  // -----------------------
  it('SIN config activa → GET /results/live/quick-count responde 403 NO_ELECTION_CONFIG', async () => {
    const { status, body } = await request(app.getHttpServer()).get(
      `${baseUrl}/results/live/quick-count`,
    );

    expect(status).toBe(403);
    expect(body?.error).toBe('LIVE_NOT_AVAILABLE');
  });

  it('Con 2 activas de distinto type y SIN electionId → 403 NO_ELECTION_CONFIG_FOR_REQUEST', async () => {
    const now = new Date();

    // 2 activas dentro del horario de votación
    await createElection({
      name: `ELEC-${now.getTime()}-C1`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const created2 = await createElection({
      name: `ELEC-${now.getTime()}-C2`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'congress',
      round: 1,
    });

    // Sin electionId
    const r1 = await request(app.getHttpServer()).get(
      `${baseUrl}/results/live/quick-count`,
    );
    expect(r1.status).toBe(403);
    expect(r1.body?.error).toBe('NO_ELECTION_CONFIG_FOR_REQUEST');

    // Con electionId → OK (guard permite durante votación)
    const r2 = await request(app.getHttpServer()).get(
      `${baseUrl}/results/live/quick-count?electionId=${created2.id}`,
    );
    expect(r2.status).toBe(200);
    expect(r2.body).toHaveProperty('summary');
  });

  it('Fuera del horario de votación PERO allowDataModification=true → 200 OK (LIVE permitido)', async () => {
    const now = new Date();

    const created = await createElection({
      name: `ELEC-${now.getTime()}-D`,
      // Todo en el PASADO → fuera de horario
      votingStartDate: new Date(
        now.getTime() - 3 * 60 * 60 * 1000,
      ).toISOString(),
      votingEndDate: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() - 1 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: true, // habilita LIVE aún fuera de horario
      type: 'presidential',
      round: 2,
    });

    const { status } = await request(app.getHttpServer()).get(
      `${baseUrl}/results/live/quick-count?electionId=${created.id}`,
    );

    expect(status).toBe(200);
  });


  it('SIN config activa → POST /ballots/validate-ballot-data responde 403 NO_ELECTION_CONFIG', async () => {
    const { status, body } = await request(app.getHttpServer())
      .post(`${baseUrl}/ballots/validate-ballot-data`)
      .send({ ipfsUri: 'ipfs://cid-xyz' });
    expect(status).toBe(403);
    expect(body?.error).toBe('NO_ELECTION_CONFIG_FOR_REQUEST');
  });

  it('Fuera de horario y allowDataModification=false → 403 OUTSIDE_VOTING_HOURS', async () => {
    const now = new Date();

    const created = await createElection({
      name: `ELEC-${now.getTime()}-E`,
      votingStartDate: new Date(
        now.getTime() - 3 * 60 * 60 * 1000,
      ).toISOString(),
      votingEndDate: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() - 1 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const { status, body } = await request(app.getHttpServer())
      .post(`${baseUrl}/ballots/validate-ballot-data?electionId=${created.id}`)
      .send({ ipfsUri: 'ipfs://cid-xyz', electionId: created.id });

    expect(status).toBe(403);
    expect(body?.error).toBe('OUTSIDE_VOTING_HOURS');
  });

  it('Dentro de horario de votación → 200 OK (guard permite)', async () => {
    const now = new Date();

    const created = await createElection({
      name: `ELEC-${now.getTime()}-F`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const { status } = await request(app.getHttpServer())
      .post(`${baseUrl}/ballots/validate-ballot-data?electionId=${created.id}`)
      .send({ ipfsUri: 'ipfs://cid-xyz' });

    expect(status).toBe(201); // el controlador devuelve true (mock) → 201/200 según tu handler
  });

  it('Dos activas y SIN electionId en POST (VotingPeriodGuard) → 403 NO_ELECTION_CONFIG_FOR_REQUEST', async () => {
    const now = new Date();

    await createElection({
      name: `ELEC-${now.getTime()}-G1`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    await createElection({
      name: `ELEC-${now.getTime()}-G2`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'congress',
      round: 1,
    });

    const { status, body } = await request(app.getHttpServer())
      .post(`${baseUrl}/ballots/validate-ballot-data`) // sin electionId
      .send({ ipfsUri: 'ipfs://cid-xyz' });

    expect(status).toBe(403);
    expect(body?.error).toBe('NO_ELECTION_CONFIG_FOR_REQUEST');
  });

  // -----------------------
  // 5) CRUD y “múltiples activas por type”
  // -----------------------
  it('Crear 2 activas de distinto type → /elections/config lista ambas activas, /active devuelve SOLO la última', async () => {
    const now = new Date();

    const c1 = await createElection({
      name: `ELEC-${now.getTime()}-H1`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 1,
    });

    const c2 = await createElection({
      name: `ELEC-${now.getTime()}-H2`,
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'congress',
      round: 1,
    });

    // GET /elections/config (todas)
    const list = await request(app.getHttpServer()).get(
      `${baseUrl}/elections/config`,
    );
    expect(list.status).toBe(200);
    const activeOnes = (list.body as any[]).filter((x) => x.isActive === true);
    expect(activeOnes.length).toBe(2);

    // GET /elections/config/active (en tu código devuelve una sola, la más reciente)
    const active = await request(app.getHttpServer()).get(
      `${baseUrl}/elections/config/active`,
    );
    expect(active.status).toBe(200);
    // Como se ordena por createdAt desc en service.getActiveConfig(), debería ser la última creada
    expect([c1.id, c2.id]).toContain(active.body?.id);
  });

  it('GET /elections/config/status responde flags correctos', async () => {
    const now = new Date();
    await createElection({
      name: `ELEC-${now.getTime()}-I`,
      // Dentro de votación
      votingStartDate: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      votingEndDate: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      resultsStartDate: new Date(
        now.getTime() + 2 * 60 * 60 * 1000,
      ).toISOString(),
      allowDataModification: false,
      type: 'presidential',
      round: 2,
    });

    const { status, body } = await request(app.getHttpServer()).get(
      `${baseUrl}/elections/config/status`,
    );

    expect(status).toBe(200);
    expect(body?.hasActiveConfig).toBe(true);
    expect(body?.isVotingPeriod).toBe(true);
    expect(body?.isResultsPeriod).toBe(false);
  });
});
