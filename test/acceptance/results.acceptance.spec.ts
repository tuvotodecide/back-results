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
    it('GET /api/v1/results/quick-count -> 403 NO_ELECTION_CONFIG (sin configs)', async () => {
      // Vaciar configs
      await conn.collection('election_configs').deleteMany({});
      const res = await request(app.getHttpServer())
        .get('/api/v1/results/quick-count')
        .expect(403);

      expect(res.body?.error).toBe('NO_ELECTION_CONFIG');
    });
  });

  describe('Guards + escenarios', () => {
    it('ResultsPeriodGuard: requiere resultsStartDate alcanzada (FINAL)', async () => {
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

    it('PreliminaryResultsGuard: LIVE solo durante jornada o allowDataModification=true', async () => {
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

    it('Con múltiples activas y sin electionId: 403 NO_ELECTION_CONFIG_FOR_REQUEST (guard)', async () => {
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

    it('quick-count FINAL: usa solo la versión ganadora (T1 v2) y excluye mesas observadas', async () => {
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

    it('by-location FINAL: totalTables cuenta mesas activas no observadas y tablesProcessed solo efectivas', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/results/by-location?electionType=presidential&department=La%20Paz&electionId=${electionFinalId}`)
        .expect(200);

      // En La Paz tenemos T1 y T2 activas/no observadas; T3 observada queda fuera.
      expect(res.body.summary.totalTables).toBe(2);
      // tablesProcessed: FINAL efectivas en La Paz => T1 (1)
      expect(res.body.summary.tablesProcessed).toBe(1);

      // porcentajes sobre válidos en La Paz (solo T1 v2 => 120)
      const mas = res.body.results.find((r: any) => r.partyId === 'MAS');
      const cc  = res.body.results.find((r: any) => r.partyId === 'CC');
      expect(mas.percentage).toBe('58.33'); // 70/120
      expect(cc.percentage).toBe('41.67');  // 50/120
    });

    it('heat-map FINAL department: partyPercentages con round(2) y orden por location', async () => {
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

    it('registration-progress por filtro y system-statistics sin 500 con BD vacía', async () => {
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

    it('Cache TTL: lastUpdate estable dentro del TTL del endpoint; cambia al vencer', async () => {
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
