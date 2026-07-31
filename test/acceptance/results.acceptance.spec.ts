// test/results.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MongooseModule, getConnectionToken, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ResultsController } from '../../src/modules/results/controllers/results.controller';
import { ResultsService } from '../../src/modules/results/services/results.service';

import { Ballot, BallotSchema } from '../../src/modules/ballot/schemas/ballot.schema';
import { ElectoralTable, ElectoralTableSchema } from '../../src/modules/geographic/schemas/electoral-table.schema';
import { Department, DepartmentSchema } from '../../src/modules/geographic/schemas/department.schema';
import { Municipality, MunicipalitySchema } from '../../src/modules/geographic/schemas/municipality.schema';
import { Province, ProvinceSchema } from '../../src/modules/geographic/schemas/province.schema';
import { ElectoralSeat, ElectoralSeatSchema } from '../../src/modules/geographic/schemas/electoral-seat.schema';
import {
  ElectoralLocation,
  ElectoralLocationSchema,
} from '../../src/modules/geographic/schemas/electoral-location.schema';

import { ElectionConfig, ElectionConfigSchema } from '../../src/modules/elections/schemas/election-config.schema';
import { ElectionConfigService } from '../../src/modules/elections/services/election-config.service';
import { ResultsPeriodGuard } from '../../src/modules/elections/guards/results-period.guard';
import { PreliminaryResultsGuard } from '../../src/modules/elections/guards/preliminary-results.guard';

// Utilidades de seed locales
import { seedGeoMinimal, upsertTable, seedElectionConfig, seedBallot, seedCase } from '../utils/seed-helpers';

jest.setTimeout(60_000);

describe('Results E2E (HTTP caja negra)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryServer;
  let mongoUri: string;
  let conn: Connection;

  let electionFinalId: string; // resultados habilitados (resultsStartDate < now)
  let electionLiveId: string;  // jornada en curso (votingStart < now < votingEnd)

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    mongoUri = mongod.getUri();

    moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register({ isGlobal: true }), // para CacheInterceptor
        MongooseModule.forRoot(mongoUri),
        MongooseModule.forFeature([
          { name: Ballot.name, schema: BallotSchema },
          { name: ElectoralTable.name, schema: ElectoralTableSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: Municipality.name, schema: MunicipalitySchema },
          { name: Province.name, schema: ProvinceSchema },
          { name: ElectoralSeat.name, schema: ElectoralSeatSchema },
          { name: ElectoralLocation.name, schema: ElectoralLocationSchema },
          { name: ElectionConfig.name, schema: ElectionConfigSchema },
        ]),
      ],
      controllers: [ResultsController],
      providers: [
        ResultsService,
        ElectionConfigService,
        ResultsPeriodGuard,
        PreliminaryResultsGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());

    // Geo mínimo para los lookups de ResultsService.buildLocationTableQuery()
    await seedGeoMinimal(conn);

    // Config FINAL (resultados abiertos)
    const now = Date.now();
    electionFinalId = await seedElectionConfig(conn, {
      name: 'final-OK',
      votingStartDate: new Date(now - 4 * 60 * 60 * 1000),
      votingEndDate:   new Date(now - 3 * 60 * 60 * 1000),
      resultsStartDate:new Date(now - 2 * 60 * 60 * 1000),
      isActive: true,
      type: 'presidential',
      allowDataModification: false,
    });

    // Config LIVE (jornada en curso)
    electionLiveId = await seedElectionConfig(conn, {
      name: 'live-OK',
      votingStartDate: new Date(now - 30 * 60 * 1000),
      votingEndDate:   new Date(now + 30 * 60 * 1000),
      resultsStartDate:new Date(now + 60 * 60 * 1000),
      isActive: true,
      type: 'congress',
      allowDataModification: false,
    });

    // Mesas base (La Paz / Murillo / La Paz / Achachicala / U.E. Achachicala)
    // T1 y T2 activas; T3 observada
    await upsertTable(conn, { tableCode: 'T1', electoralLocationName: 'U.E Achachicala', active: true, observedMap: { [electionFinalId]: false, [electionLiveId]: false }});
    await upsertTable(conn, { tableCode: 'T2', electoralLocationName: 'U.E Achachicala', active: true, observedMap: { [electionFinalId]: false, [electionLiveId]: false }});
    await upsertTable(conn, { tableCode: 'T3', electoralLocationName: 'U.E Achachicala', active: true, observedMap: { [electionFinalId]: true,  [electionLiveId]: true  }});

    // ------ Datos FINAL:
    // T1: dos versiones, case CONSENSUAL favorece v2, valuable:true solo v2
    const b1v1 = await seedBallot(conn, {
      electionId: electionFinalId, tableCode: 'T1', version: 1, valuable: false,
      status: 'processed',
      loc: { department:'La Paz', province:'Murillo', municipality:'La Paz', seat:'Achachicala', location:'U.E Achachicala',
             district:'D1', zone:'Z1', circ: { number: 24, type: 'Uninominal', name:'Circ 24' } },
      parties: { valid: 100, null: 5, blank: 5, votes: { 'MAS': 60, 'CC': 40 } }
    });

    const b1v2 = await seedBallot(conn, {
      electionId: electionFinalId, tableCode: 'T1', version: 2, valuable: true,
      status: 'synced',
      loc: { department:'La Paz', province:'Murillo', municipality:'La Paz', seat:'Achachicala', location:'U.E Achachicala',
             district:'D1', zone:'Z1', circ: { number: 24, type: 'Uninominal', name:'Circ 24' } },
      parties: { valid: 120, null: 5, blank: 5, votes: { 'MAS': 70, 'CC': 50 } }
    });

    await seedCase(conn, {
      electionId: electionFinalId, tableCode: 'T1',
      status: 'CONSENSUAL', winningBallotId: b1v2._id
    });

    // T3: observada (no debe contar)
    await seedBallot(conn, {
      electionId: electionFinalId, tableCode: 'T3', version: 1, valuable: true,
      status: 'processed',
      loc: { department:'La Paz', province:'Murillo', municipality:'La Paz', seat:'Achachicala', location:'U.E Achachicala',
             district:'D1', zone:'Z1', circ: { number: 24, type: 'Uninominal', name:'Circ 24' } },
      parties: { valid: 80, null: 2, blank: 3, votes: { 'MAS': 40, 'CC': 40 } }
    });
    await seedCase(conn, { electionId: electionFinalId, tableCode: 'T3', status: 'CLOSED', winningBallotId: null });

    // ------ Datos LIVE:
    // LIVE ignora attestation_cases y toma solo mesas con countVersions==1 y no observadas.
    await seedBallot(conn, {
      electionId: electionLiveId, tableCode: 'T2', version: 1, valuable: false,
      status: 'processed',
      loc: { department:'La Paz', province:'Murillo', municipality:'La Paz', seat:'Achachicala', location:'U.E Achachicala',
             district:'D1', zone:'Z1', circ: { number: 24, type: 'Uninominal', name:'Circ 24' } },
      parties: { valid: 200, null: 10, blank: 5, votes: { 'MAS': 120, 'CC': 80 } }
    });

    // Agregamos una provincia distinta para heat-map/cobertura
    // Santa Cruz / Andrés Ibáñez / Santa Cruz de la Sierra / ...
    await seedGeoMinimal(conn, { department: 'Santa Cruz', province: 'Andrés Ibáñez', municipality: 'Santa Cruz de la Sierra', seat: 'Centro', location: 'Colegio Central' });
    await upsertTable(conn, { tableCode: 'SC1', electoralLocationName: 'Colegio Central', active: true, observedMap: { [electionFinalId]: false, [electionLiveId]: false }});
    const sc1 = await seedBallot(conn, {
      electionId: electionFinalId, tableCode: 'SC1', version: 1, valuable: true,
      status: 'processed',
      loc: { department:'Santa Cruz', province:'Andrés Ibáñez', municipality:'Santa Cruz de la Sierra', seat:'Centro', location:'Colegio Central',
             district:'D2', zone:'Z2', circ: { number: 8, type: 'Uninominal', name:'Circ 8' } },
      parties: { valid: 50, null: 1, blank: 2, votes: { 'MAS': 10, 'CC': 40 } }
    });
    await seedCase(conn, {
      electionId: electionFinalId,
      tableCode: 'SC1',
      status: 'CLOSED',
      winningBallotId: sc1._id,
    });
  });

  afterAll(async () => {
    await app.close();
    await conn?.close();
    await mongod?.stop();
  });

  describe('403 cuando no hay configuración activa', () => {
    it('[RES-ACC-P0-001][RES-ACC-P1-003][RES-SEC-P0-001] rechaza quick-count sin configuracion electoral activa', async () => {
      // Vaciar configs
      await conn.collection('election_configs').deleteMany({});
      const res = await request(app.getHttpServer())
        .get('/api/v1/results/quick-count')
        .expect(403);

      expect(res.body?.error).toBe('NO_ELECTION_CONFIG');
    });
  });

  describe('Guards + escenarios', () => {
    it('[RES-ACC-P0-001] permite resultados finales solo al alcanzar resultsStartDate', async () => {
      // dejamos solo la FINAL activa
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        _id: new Types.ObjectId(electionFinalId),
        name: 'final-OK',
        votingStartDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
        votingEndDate:   new Date(Date.now() - 3 * 60 * 60 * 1000),
        resultsStartDate:new Date(Date.now() - 2 * 60 * 60 * 1000),
        isActive: true,
        allowDataModification: false,
        timezone: 'America/La_Paz',
        type: 'presidential',
        createdAt: new Date(), updatedAt: new Date(),
      });

      await request(app.getHttpServer())
        .get('/api/v1/results/quick-count')
        .expect(200);
    });

    it('[RES-ACC-P0-001][RES-SUM-P0-002] permite resultados live solo durante jornada o modificacion habilitada', async () => {
      // solo LIVE activa y estamos dentro de votación
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        _id: new Types.ObjectId(electionLiveId),
        name: 'live-OK',
        votingStartDate: new Date(Date.now() - 30 * 60 * 1000),
        votingEndDate:   new Date(Date.now() + 30 * 60 * 1000),
        resultsStartDate:new Date(Date.now() + 60 * 60 * 1000),
        isActive: true,
        allowDataModification: false,
        timezone: 'America/La_Paz',
        type: 'congress',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/live/quick-count?electionId=${electionLiveId}`)
        .expect(200);

      expect(res.body.summary?.validVotes).toBe(200);
    });

    it('[RES-ACC-P1-003][RES-FIL-P1-001] rechaza multiples elecciones activas sin electionId', async () => {
      // Activamos FINAL y LIVE a la vez
      const now = Date.now();
      await conn.collection('election_configs').deleteMany({});
      await seedElectionConfig(conn, {
        name: 'final-OK-2',
        votingStartDate: new Date(now - 4 * 60 * 60 * 1000),
        votingEndDate:   new Date(now - 3 * 60 * 60 * 1000),
        resultsStartDate:new Date(now - 2 * 60 * 60 * 1000),
        isActive: true, type: 'presidential'
      });
      await seedElectionConfig(conn, {
        name: 'live-OK-2',
        votingStartDate: new Date(now - 30 * 60 * 1000),
        votingEndDate:   new Date(now + 30 * 60 * 1000),
        resultsStartDate:new Date(now + 60 * 60 * 1000),
        isActive: true, type: 'congress'
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/results/quick-count')
        .expect(403);

      expect(res.body?.error).toBe('NO_ELECTION_CONFIG_FOR_REQUEST');
    });
  });

  describe('Resultados FINAL vs LIVE', () => {
    beforeAll(async () => {
      // Dejar activa SOLO la FINAL para estas pruebas
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        _id: new Types.ObjectId(electionFinalId),
        name: 'final-OK',
        votingStartDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
        votingEndDate:   new Date(Date.now() - 3 * 60 * 60 * 1000),
        resultsStartDate:new Date(Date.now() - 2 * 60 * 60 * 1000),
        isActive: true, allowDataModification: false, type: 'presidential',
        timezone: 'America/La_Paz', createdAt: new Date(), updatedAt: new Date(),
      });
    });

    it('[RES-SUM-P0-001][RES-CAS-P0-003][RES-CON-P0-001] quick-count final usa solo version ganadora y excluye mesas observadas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/quick-count?electionId=${electionFinalId}`)
        .expect(200);

      // FINAL incluye T1 v2 (valid=120 null=5 blank=5 -> total=130) + SC1 (valid=50 null=1 blank=2 -> total=53)
      // ValidVotes totales = 170
      expect(res.body.summary.validVotes).toBe(170);
      expect(res.body.summary.totalVotes).toBe(170 + 5 + 5 + 1 + 2); // suma de todo

      // Por partido: T1v2 MAS 70 + SC1 MAS 10 = 80 ; CC 50 + 40 = 90
      const mas = res.body.results.find((r: any) => r.partyId === 'MAS');
      const cc  = res.body.results.find((r: any) => r.partyId === 'CC');
      expect(mas.totalVotes).toBe(80);
      expect(cc.totalVotes).toBe(90);

      // porcentaje sobre válidos 170
      expect(mas.percentage).toBe('47.06'); // 80/170*100=47.0588
      expect(cc.percentage).toBe('52.94');  // 90/170*100=52.9411
    });

    it('[RES-SUM-P0-001][RES-TER-P0-001][RES-CON-P0-001] by-location final cuenta mesas activas y procesadas efectivas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/by-location?electionType=presidential&department=La%20Paz&electionId=${electionFinalId}`)
        .expect(200);

      // En La Paz tenemos T1 y T2 activas/no observadas; T3 observada queda fuera.
      expect(res.body.summary.totalTables).toBe(2);
      // tablesProcessed: FINAL efectivas en La Paz => T1 (1)
      expect(res.body.summary.tablesProcessed).toBe(1);

      expect(res.body.summary.nullVotes).toBe(5);
      expect(res.body.summary.blankVotes).toBe(5);

      // porcentajes sobre válidos en La Paz (solo T1 v2 => 120)
      const mas = res.body.results.find((r: any) => r.partyId === 'MAS');
      const cc  = res.body.results.find((r: any) => r.partyId === 'CC');
      expect(mas.percentage).toBe('58.33'); // 70/120
      expect(cc.percentage).toBe('41.67');  // 50/120
    });

    it('[RES-TER-P0-001][RES-CAT-P0-001] by-circunscripcion final filtra dimension y calcula votos efectivos', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/results/by-circunscripcion?electionType=presidential&circunscripcionType=Uninominal&electionId=${electionFinalId}`,
        )
        .expect(200);

      expect(
        res.body.circunscripciones.every(
          (item: any) => item.circunscripcion?.circunscripcionType === 'Uninominal',
        ),
      ).toBe(true);
      const circ = res.body.circunscripciones.find(
        (item: any) => item.circunscripcion?.circunscripcionNumber === 24,
      );
      expect(circ).toBeDefined();
      expect(circ.validVotes).toBe(120);
      expect(circ.nullVotes).toBe(5);
      expect(circ.blankVotes).toBe(5);
    });

    it('[RES-TER-P1-003][RES-SUM-P0-003] heat-map final calcula porcentajes por departamento con dos decimales', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/heat-map?electionType=presidential&locationType=department&electionId=${electionFinalId}`)
        .expect(200);

      // Debe incluir La Paz y Santa Cruz
      const lp = res.body.data.find((d: any) => d.location === 'La Paz');
      const sc = res.body.data.find((d: any) => d.location === 'Santa Cruz');

      // La Paz -> válidos 120: MAS 70 (58.33), CC 50 (41.67)
      expect(lp.partyPercentages.MAS).toBe(58.33);
      expect(lp.partyPercentages.CC).toBe(41.67);

      // Santa Cruz -> válidos 50: MAS 10 (20.00), CC 40 (80.00)
      expect(sc.partyPercentages.MAS).toBe(20.00);
      expect(sc.partyPercentages.CC).toBe(80.00);
    });

    it('[RES-MES-P1-004][RES-ACT-P0-001][RES-CON-P0-001] final ballots retorna actas efectivas excluye observadas y pagina', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/final/ballots?electionType=presidential&electionId=${electionFinalId}&limit=10`)
        .expect(200);

      expect(res.body.mode).toBe('final');
      expect(res.body.total).toBe(2);
      expect(res.body.data.map((ballot: any) => ballot.tableCode).sort()).toEqual([
        'SC1',
        'T1',
      ]);
      expect(res.body.data.find((ballot: any) => ballot.tableCode === 'T1')).toEqual(
        expect.objectContaining({
          version: 2,
          status: 'synced',
        }),
      );
      expect(res.body.data.some((ballot: any) => ballot.tableCode === 'T3')).toBe(false);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(10);
      expect(res.body.totalPages).toBe(1);
    });

    it('[RES-SUM-P0-002][RES-TER-P0-001] live by-location calcula resumen preliminar autorizado', async () => {
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        _id: new Types.ObjectId(electionLiveId),
        name: 'live-OK',
        votingStartDate: new Date(Date.now() - 30 * 60 * 1000),
        votingEndDate: new Date(Date.now() + 30 * 60 * 1000),
        resultsStartDate: new Date(Date.now() + 60 * 60 * 1000),
        isActive: true,
        allowDataModification: false,
        timezone: 'America/La_Paz',
        type: 'congress',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/live/by-location?department=La%20Paz&electionId=${electionLiveId}`)
        .expect(200);

      expect(res.body.summary.validVotes).toBe(200);
      expect(res.body.summary.nullVotes).toBe(10);
      expect(res.body.summary.blankVotes).toBe(5);
      expect(res.body.summary.tablesProcessed).toBe(1);
      const mas = res.body.results.find((r: any) => r.partyId === 'MAS');
      const cc = res.body.results.find((r: any) => r.partyId === 'CC');
      expect(mas.percentage).toBe('60.00');
      expect(cc.percentage).toBe('40.00');
    });

    it('[RES-SUM-P0-002][RES-TER-P1-003] live heat-map agrega porcentajes preliminares por departamento', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/live/heat-map?locationType=department&electionId=${electionLiveId}`)
        .expect(200);

      const lp = res.body.data.find((d: any) => d.location === 'La Paz');
      expect(lp).toBeDefined();
      expect(lp.partyPercentages.MAS).toBe(60.00);
      expect(lp.partyPercentages.CC).toBe(40.00);
    });

    it('[RES-SUM-P0-002][RES-CAT-P0-001] live by-circunscripcion usa ballots live efectivos', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/results/live/by-circunscripcion?circunscripcionType=Uninominal&electionId=${electionLiveId}`,
        )
        .expect(200);

      expect(
        res.body.circunscripciones.every(
          (item: any) => item.circunscripcion?.circunscripcionType === 'Uninominal',
        ),
      ).toBe(true);
      const circ = res.body.circunscripciones.find(
        (item: any) => item.circunscripcion?.circunscripcionNumber === 24,
      );
      expect(circ).toBeDefined();
      expect(circ.validVotes).toBe(200);
      expect(circ.nullVotes).toBe(10);
      expect(circ.blankVotes).toBe(5);
    });

    it('[RES-MES-P1-004][RES-SUM-P0-002] live ballots retorna actas preliminares efectivas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/live/ballots?electionId=${electionLiveId}&limit=10`)
        .expect(200);

      expect(res.body.mode).toBe('live');
      expect(res.body.total).toBe(1);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          tableCode: 'T2',
          version: 1,
          status: 'processed',
        }),
      );
      expect(res.body.data.some((ballot: any) => ballot.tableCode === 'T3')).toBe(false);
      expect(res.body.totalPages).toBe(1);
    });

    it('[RES-ACC-P1-003][RES-SUM-P0-003] quick-count final responde vacio y cero votos sin dividir por cero', async () => {
      const emptyElectionId = await seedElectionConfig(conn, {
        name: 'final-empty',
        votingStartDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
        votingEndDate: new Date(Date.now() - 3 * 60 * 60 * 1000),
        resultsStartDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        isActive: true,
        type: 'presidential',
      });

      const empty = await request(app.getHttpServer())
        .get(`/api/v1/results/quick-count?electionId=${emptyElectionId}`)
        .expect(200);

      expect(empty.body.summary.validVotes).toBe(0);
      expect(empty.body.results).toEqual([]);

      await upsertTable(conn, {
        tableCode: 'Z0',
        electoralLocationName: 'U.E Achachicala',
        active: true,
        observedMap: { [emptyElectionId]: false },
      });
      const zero = await seedBallot(conn, {
        electionId: emptyElectionId,
        tableCode: 'Z0',
        version: 1,
        valuable: true,
        status: 'processed',
        loc: {
          department: 'La Paz',
          province: 'Murillo',
          municipality: 'La Paz',
          seat: 'Achachicala',
          location: 'U.E Achachicala',
          district: 'D1',
          zone: 'Z1',
          circ: { number: 24, type: 'Uninominal', name: 'Circ 24' },
        },
        parties: { valid: 0, null: 0, blank: 0, votes: { MAS: 0 } },
      });
      await seedCase(conn, {
        electionId: emptyElectionId,
        tableCode: 'Z0',
        status: 'CLOSED',
        winningBallotId: zero._id,
      });

      const zeroResult = await request(app.getHttpServer())
        .get(`/api/v1/results/quick-count?electionId=${emptyElectionId}`)
        .expect(200);

      expect(zeroResult.body.summary.validVotes).toBe(0);
      expect(zeroResult.body.results).toEqual([]);

      await conn.collection('attestation_cases').deleteMany({
        electionId: new Types.ObjectId(emptyElectionId),
        tableCode: 'Z0',
      });
      await conn.collection('ballots').deleteMany({
        electionId: new Types.ObjectId(emptyElectionId),
        tableCode: 'Z0',
      });
      await conn.collection('electoral_tables').deleteMany({ tableCode: 'Z0' });
    });

    it('[RES-ACC-P1-003][RES-SUM-P0-002] live quick-count y ballots responden vacio sin actas preliminares', async () => {
      await conn.collection('election_configs').deleteMany({});
      const emptyLiveId = await seedElectionConfig(conn, {
        name: 'live-empty',
        votingStartDate: new Date(Date.now() - 30 * 60 * 1000),
        votingEndDate: new Date(Date.now() + 30 * 60 * 1000),
        resultsStartDate: new Date(Date.now() + 60 * 60 * 1000),
        isActive: true,
        type: 'congress',
      });

      const quick = await request(app.getHttpServer())
        .get(`/api/v1/results/live/quick-count?electionId=${emptyLiveId}`)
        .expect(200);
      expect(quick.body.summary.validVotes).toBe(0);
      expect(quick.body.results).toEqual([]);

      const ballots = await request(app.getHttpServer())
        .get(`/api/v1/results/live/ballots?electionId=${emptyLiveId}`)
        .expect(200);
      expect(ballots.body).toEqual(
        expect.objectContaining({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          mode: 'live',
        }),
      );
    });

    it('[RES-REP-P1-002][RES-TRA-P1-003] registration-progress y estadisticas responden sin 500 con BD vacia', async () => {
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        _id: new Types.ObjectId(electionFinalId),
        name: 'final-OK',
        votingStartDate: new Date(Date.now() - 4 * 60 * 60 * 1000),
        votingEndDate: new Date(Date.now() - 3 * 60 * 60 * 1000),
        resultsStartDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        isActive: true,
        allowDataModification: false,
        type: 'presidential',
        timezone: 'America/La_Paz',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/registration-progress?department=La%20Paz&electionId=${electionFinalId}`)
        .expect(200);

      // totalTables en La Paz: T1 y T2 cuentan; T3 observada queda fuera
      expect(res.body.progress.totalTables).toBe(2);
      // registeredBallots: status processed/synced con ese eid y en La Paz (T1 v1+v2+T3 v1 cuentan, son 3)
      expect(res.body.progress.registeredBallots).toBe(3);

      // System statistics no debe fallar aunque borremos todo
      await conn.dropDatabase();
      const res2 = await request(app.getHttpServer())
        .get('/api/v1/results/statistics')
        .expect(200);

      expect(res2.body.summary.totalBallots).toBe(0);
      expect(res2.body.departmentCoverage.length).toBe(0);
    });

    it('[RES-UPD-P1-002][RES-CON-P0-002][RES-TRA-P1-003] cache TTL mantiene lastUpdate dentro del endpoint y cambia al vencer', async () => {
      // Dejamos una sola config presidencial activa para evitar conflicto con el índice parcial único
      await conn.collection('election_configs').deleteMany({});
      await conn.collection('election_configs').insertOne({
        name: 'final-cache',
        votingStartDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
        votingEndDate:   new Date(Date.now() - 60 * 60 * 1000),
        resultsStartDate:new Date(Date.now() - 30 * 60 * 1000),
        isActive: true, type: 'presidential', timezone:'America/La_Paz',
        createdAt: new Date(), updatedAt: new Date(),
      });

      const first = await request(app.getHttpServer()).get('/api/v1/results/quick-count').expect(200);
      const second = await request(app.getHttpServer()).get('/api/v1/results/quick-count').expect(200);

      expect(second.body.lastUpdate).toBe(first.body.lastUpdate); // mismo cache

      // Espera real para vencer @CacheTTL(30_000) del endpoint HTTP/cache interceptor
      await new Promise(resolve => setTimeout(resolve, 31_000));

      const third = await request(app.getHttpServer()).get('/api/v1/results/quick-count').expect(200);
      expect(third.body.lastUpdate).not.toBe(first.body.lastUpdate);
    }, 90_000);
  });
});
