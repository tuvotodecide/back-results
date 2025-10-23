// test/ballot/ballot.service.acceptance.spec.ts
import { Test } from '@nestjs/testing';
import { Types, Connection } from 'mongoose';
import { InMemoryMongo } from '../utils/mongo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';

import { BallotModule } from '@/modules/ballot/ballot.module';
import { GeographicModule } from '@/modules/geographic/geographic.module';
import { ElectionsModule } from '@/modules/elections/elections.module';

import { BallotService } from '@/modules/ballot/services/ballot.service';
import { PoliticalPartyService } from '@/modules/political/services/political-party.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import { Module, Global } from '@nestjs/common';
import { LoggerService } from '@/core/services/logger.service';

const loggerMock = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

@Global()
@Module({
  providers: [{ provide: LoggerService, useValue: loggerMock }],
  exports: [LoggerService],
})
class LoggerTestingModule {}

describe('BallotService (aceptación, DB real en memoria)', () => {
  const mongo = new InMemoryMongo();
  let service: BallotService;
  let conn: Connection; // <-- conexión real de Nest/Mongoose
  const electionId = new Types.ObjectId().toString();
  const partySvcMock = { validatePartyIds: jest.fn().mockResolvedValue(true) };

  const electionCfgMock = {
    getActiveConfig: jest.fn().mockResolvedValue({ id: electionId }),
  };

  // IDs jerárquicos
  const ids = {
    dept: new Types.ObjectId(),
    prov: new Types.ObjectId(),
    muni: new Types.ObjectId(),
    seat: new Types.ObjectId(),
    location: new Types.ObjectId(),
  };

  // Usa SIEMPRE la misma conexión (conn), no mongoose.connection
  const seedGeo = async () => {
    await conn.collection('departments').insertOne({
      _id: ids.dept,
      name: 'La Paz',
    });
    await conn.collection('provinces').insertOne({
      _id: ids.prov,
      name: 'Murillo',
      departmentId: ids.dept,
    });
    await conn.collection('municipalities').insertOne({
      _id: ids.muni,
      name: 'La Paz',
      provinceId: ids.prov,
    });
    await conn.collection('electoral_seats').insertOne({
      _id: ids.seat,
      name: 'Centro',
      municipalityId: ids.muni,
    });
    await conn.collection('electoral_locations').insertOne({
      _id: ids.location,
      code: 'RECI-001',
      name: 'Colegio Bolívar',
      address: 'Calle X',
      district: 'Distrito 1',
      zone: 'Centro',
      circunscripcion: { number: 10, type: 'Uninominal', name: 'Circ 10' },
      electoralSeatId: ids.seat,
      active: true,
    });

    await conn.collection('electoral_tables').insertOne({
      electoralLocationId: ids.location,
      tableNumber: '5',
      tableCode: '1234',
      active: true,
    });
  };

  let uri: string;

  beforeAll(async () => {
    uri = await mongo.start();

    const moduleRef = await Test.createTestingModule({
      imports: [
        // opcional: autoIndex:false para silenciar warnings de índices en test
        MongooseModule.forRoot(uri, {
          dbName: 'testdb',
          autoIndex: false,
        } as any),
        LoggerTestingModule,
        GeographicModule,
        ElectionsModule,
        BallotModule,
      ],
    })
      .overrideProvider(PoliticalPartyService)
      .useValue(partySvcMock)
      .overrideProvider(ElectionConfigService)
      .useValue(electionCfgMock)
      .compile();

    service = moduleRef.get(BallotService);

    // ✅ Obtén la conexión que usa Nest y espera a que conecte
    conn = moduleRef.get<Connection>(getConnectionToken());
    await conn.asPromise();

    // Ahora sí: seed
    await seedGeo();

    // Mock de fetch (IPFS)
    (global as any).fetch = jest.fn(async (_url: string) => ({
      text: async () => JSON.stringify(globalThis.__IPFS_PAYLOAD__),
    }));
  });

  afterAll(async () => {
    // Cierra la conexión de Nest explícitamente
    await conn.dropDatabase();
    await conn.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Limpieza usando la MISMA conexión
    await Promise.all(
      Object.values(conn.collections).map((c) => c.deleteMany({})),
    );
    await seedGeo();
  });

  const makeMeta = (overrides?: Partial<any>) => ({
    image: 'ipfs://QmImagen',
    data: {
      tableCode: '1234',
      tableNumber: '5',
      locationId: ids.location.toString(),
      votes: {
        parties: {
          validVotes: 100,
          nullVotes: 2,
          blankVotes: 3,
          partyVotes: [
            { partyId: 'libre', votes: 60 },
            { partyId: 'pdc', votes: 40 },
          ],
        },
      },
    },
    ...overrides,
  });

  // TEST #14: Primera acta de una mesa
  it('#14 registra primera acta con enriquecimiento', async () => {
    (globalThis as any).__IPFS_PAYLOAD__ = makeMeta();

    const dto = {
      ipfsUri: 'https://ipfs.io/ipfs/QmXxx',
      electionId,
    } as any;

    const saved = await service.createFromIpfs(dto);

    expect(saved.version).toBe(1);
    expect(saved.tableCode).toBe('1234');
    expect(saved.status).toBe('processed');
    expect(saved.location.department).toBe('La Paz');
    expect(saved.location.electoralLocationName).toBe('Colegio Bolívar');

    const count = await conn.collection('ballots').countDocuments({});
    expect(count).toBe(1);
  });

  // TEST #15: Segunda versión misma mesa
  it('#15 registra segunda versión (versión 2) con votos distintos', async () => {
    // v1
    (globalThis as any).__IPFS_PAYLOAD__ = makeMeta();
    await service.createFromIpfs({
      ipfsUri: 'https://ipfs.io/ipfs/QmCid1',
      electionId,
    } as any);

    (globalThis as any).__IPFS_PAYLOAD__ = makeMeta({
      data: {
        tableCode: '1234',
        tableNumber: '5',
        locationId: ids.location.toString(),
        votes: {
          parties: {
            validVotes: 100,
            nullVotes: 1,
            blankVotes: 0,
            partyVotes: [
              { partyId: 'libre', votes: 55 },
              { partyId: 'pdc', votes: 45 },
            ],
          },
        },
      },
    });
    const saved2 = await service.createFromIpfs({
      ipfsUri: 'https://ipfs.io/ipfs/QmCid2',
      electionId,
    } as any);
    expect(saved2.version).toBe(2);

    const count = await conn
      .collection('ballots')
      .countDocuments({ tableCode: '1234' });
    expect(count).toBe(2);
  });

  // TEST #16: Datos inválidos (suma no cuadra) → no guarda nada
  it('#16 rechaza acta inválida y no persiste en DB', async () => {
    (globalThis as any).__IPFS_PAYLOAD__ = makeMeta({
      data: {
        tableCode: '1234',
        tableNumber: '5',
        locationId: ids.location.toString(),
        votes: {
          parties: {
            validVotes: 100,
            nullVotes: 0,
            blankVotes: 0,
            partyVotes: [
              { partyId: 'libre', votes: 60 },
              { partyId: 'pdc', votes: 30 }, // suma 90
            ],
          },
        },
      },
    });

    await expect(
      service.createFromIpfs({ ipfsUri: 'ipfs://cid-bad', electionId } as any),
    ).rejects.toThrow(/suma de votos/i);

    const count = await conn.collection('ballots').countDocuments({});
    expect(count).toBe(0);
  });

  // TEST #17: Enriquecimiento geográfico completo
  it('#17 verifica jerarquía geográfica poblada', async () => {
    (globalThis as any).__IPFS_PAYLOAD__ = makeMeta();
    const saved = await service.createFromIpfs({
      ipfsUri: 'https://ipfs.io/ipfs/QmGeo1',
      electionId,
    } as any);

    expect(saved.location.department).toBe('La Paz');
    expect(saved.location.province).toBe('Murillo');
    expect(saved.location.municipality).toBe('La Paz');
    expect(saved.location.electoralSeat).toBe('Centro');
    expect(saved.location.electoralLocationName).toBe('Colegio Bolívar');
    expect(saved.location.circunscripcion.number).toBe(10);
    expect(saved.location.circunscripcion.type).toBe('Uninominal');
  });
});
