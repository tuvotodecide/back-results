// test/results.service.int-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { ResultsService } from '../../src/modules/results/services/results.service';
import {
  Ballot,
  BallotSchema,
} from '../../src/modules/ballot/schemas/ballot.schema';
import {
  ElectoralTable,
  ElectoralTableSchema,
} from '../../src/modules/geographic/schemas/electoral-table.schema';
import {
  Department,
  DepartmentSchema,
} from '../../src/modules/geographic/schemas/department.schema';
import {
  Municipality,
  MunicipalitySchema,
} from '../../src/modules/geographic/schemas/municipality.schema';
import {
  Province,
  ProvinceSchema,
} from '../../src/modules/geographic/schemas/province.schema';
import {
  ElectoralSeat,
  ElectoralSeatSchema,
} from '../../src/modules/geographic/schemas/electoral-seat.schema';
import {
  ElectoralLocation,
  ElectoralLocationSchema,
} from '../../src/modules/geographic/schemas/electoral-location.schema';

import {
  ElectionConfig,
  ElectionConfigSchema,
} from '../../src/modules/elections/schemas/election-config.schema';
import { ElectionConfigService } from '../../src/modules/elections/services/election-config.service';

import {
  seedGeoMinimal,
  upsertTable,
  seedElectionConfig,
  seedBallot,
  seedCase,
  bulkManyBallots,
} from '../utils/seed-helpers';

jest.setTimeout(120_000);

describe('ResultsService integración', () => {
  let moduleRef: TestingModule;
  let service: ResultsService;
  let conn: Connection;
  let mongod: MongoMemoryServer;
  let electionA: string;
  let electionB: string;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
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
      providers: [ResultsService, ElectionConfigService],
    }).compile();

    service = moduleRef.get(ResultsService);
    conn = moduleRef.get<Connection>(getConnectionToken());

    await seedGeoMinimal(conn);
    await upsertTable(conn, {
      tableCode: 'X1',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: {},
    });
    await upsertTable(conn, {
      tableCode: 'X2',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: {},
    });
    await upsertTable(conn, {
      tableCode: 'X3',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: {},
    });
    const now = Date.now();

    // Dos activas (una por tipo). Servirá para probar electionId list con $in
    electionA = await seedElectionConfig(conn, {
      name: 'A-pres',
      votingStartDate: new Date(now - 7200_000),
      votingEndDate: new Date(now - 3600_000),
      resultsStartDate: new Date(now - 1800_000),
      isActive: true,
      type: 'presidential',
    });

    electionB = await seedElectionConfig(conn, {
      name: 'B-congress',
      votingStartDate: new Date(now - 7200_000),
      votingEndDate: new Date(now - 3600_000),
      resultsStartDate: new Date(now - 1800_000),
      isActive: true,
      type: 'congress',
    });

    // X1: A -> 2 versiones, gana v2
    const v1 = await seedBallot(conn, {
      electionId: electionA,
      tableCode: 'X1',
      version: 1,
      valuable: false,
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
      parties: { valid: 100, null: 0, blank: 0, votes: { A: 60, B: 40 } },
    });
    const v2 = await seedBallot(conn, {
      electionId: electionA,
      tableCode: 'X1',
      version: 2,
      valuable: true,
      status: 'synced',
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
      parties: { valid: 120, null: 0, blank: 0, votes: { A: 50, B: 70 } },
    });
    await seedCase(conn, {
      electionId: electionA,
      tableCode: 'X1',
      status: 'CLOSED',
      winningBallotId: new Types.ObjectId(v2._id),
    });

    // X2: B -> 1 versión
    const x2 = await seedBallot(conn, {
      electionId: electionB,
      tableCode: 'X2',
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
      parties: { valid: 200, null: 0, blank: 0, votes: { A: 120, B: 80 } },
    });
    await seedCase(conn, {
      electionId: electionB,
      tableCode: 'X2',
      status: 'CLOSED',
      winningBallotId: new Types.ObjectId(x2._id),
    });
    await upsertTable(conn, {
      tableCode: 'X2',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: { [electionA]: true },
    });

    // X3: A -> observada (no cuenta)
    await upsertTable(conn, {
      tableCode: 'X3',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: { [electionA]: true },
    });
    await seedBallot(conn, {
      electionId: electionA,
      tableCode: 'X3',
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
      parties: { valid: 50, null: 0, blank: 0, votes: { A: 25, B: 25 } },
    });
    await seedCase(conn, {
      electionId: electionA,
      tableCode: 'X3',
      status: 'CONSENSUAL',
      winningBallotId: null,
    });
  });

  afterAll(async () => {
    await conn?.close();
    await mongod?.stop();
    await moduleRef?.close();
  });

  it('getQuickCount FINAL con lista de electionId ($in)', async () => {
    const r = await service.getQuickCount(`${electionA},${electionB}`, 'final');
    // A: X1 (v2) valid=120 ; B: X2 valid=200 => total valid=320
    expect(r.summary.validVotes).toBe(320);
    // por partido: A: 50 + 120 = 170 ; B: 70 + 80 = 150
    const pa = r.results.find((x) => x.partyId === 'A');
    const pb = r.results.find((x) => x.partyId === 'B');
    expect(pa).toBeDefined();
    expect(pb).toBeDefined();
    expect(pa!.totalVotes).toBe(170);
    expect(pb!.totalVotes).toBe(150);
    expect(pa!.percentage).toBe('53.13');
    expect(pb!.percentage).toBe('46.88');
  });

  it('getQuickCount LIVE incluye solo mesas con 1 versión y no observadas (ignora cases)', async () => {
    const r = await service.getQuickCount(electionB, 'live');
    // B solo X2 (1 versión), valid=200
    expect(r.summary.validVotes).toBe(200);
  });

  it('getResultsByLocation: summary.totalTables vs tablesProcessed (FINAL)', async () => {
    const r = await service.getResultsByLocation({
      electionType: 'presidential',
      department: 'La Paz',
      electionId: electionA,
      mode: 'final',
    } as any);

    // totalTables: X1 y X3 activas pero X3 observada => 1
    expect(r.summary.totalTables).toBe(1);
    // tablesProcessed (efectivas) FINAL => X1 (1)
    expect(r.summary.tablesProcessed).toBe(1);
  });

  it('getResultsByCircunscripcion: agrupa y respeta filtros', async () => {
    const r = await service.getResultsByCircunscripcion({
      electionType: 'presidential',
      circunscripcionType: 'Uninominal',
      circunscripcionNumber: 24,
      electionId: electionA,
      mode: 'final',
    } as any);

    expect(r.circunscripciones.length).toBeGreaterThan(0);
    const c: any = r.circunscripciones[0];
    expect(c.validVotes).toBe(120); // X1 v2
  });

  it('getHeatMapData: redondeo a 2 decimales y claves por departamento', async () => {
    const r = await service.getHeatMapData({
      electionType: 'presidential',
      locationType: 'department',
      electionId: electionA,
      mode: 'final',
    });
    const lp = r.data.find((d) => d.location === 'La Paz');
    expect(lp).toBeDefined();
    expect(lp!.partyPercentages.A).toBe(41.67);
    expect(lp!.partyPercentages.B).toBe(58.33);
  });

  it('getRegistrationProgress: compara con tablas activas (no observadas) bajo mismo filtro', async () => {
    const rp = await service.getRegistrationProgress({
      department: 'La Paz',
      electionId: electionA,
    });
    // totalTables: X1 (no observada) + X2 (distinta elección) + X3 (observada) => solo X1 cuenta en este filtro+eid => 1
    expect(rp.progress.totalTables).toBe(1);
    // registeredBallots: en A hay X1 v1+v2 + X3 v1 => 3
    expect(rp.progress.registeredBallots).toBe(3);
  });

  it('getSystemStatistics: no falla con BD vacía', async () => {
    await conn.dropDatabase();
    const stats = await service.getSystemStatistics();
    expect(stats.summary.totalBallots).toBe(0);
    expect(stats.departmentCoverage.length).toBe(0);
  });

  it('allowDiskUse(true) no falla con miles de docs', async () => {
    // re-seed mínimo
    await seedGeoMinimal(conn);
    await upsertTable(conn, {
      tableCode: 'M1',
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: {},
    });
    const eid = await seedElectionConfig(conn, {
      name: 'massive',
      votingStartDate: new Date(Date.now() - 7200_000),
      votingEndDate: new Date(Date.now() - 3600_000),
      resultsStartDate: new Date(Date.now() - 1800_000),
      isActive: true,
      type: 'presidential',
    });

    // inserta ~3000 ballots random en 1000 mesas (3 versiones promedio)
    await bulkManyBallots(conn, {
      electionId: eid,
      tables: 1000,
      versionsAvg: 3,
    });

    const r = await service.getQuickCount(eid, 'final'); // no debe lanzar
    expect(r).toBeTruthy();
  });
});
