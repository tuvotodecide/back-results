// test/results/results.acceptance.spec.ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema, Types, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Ajusta este import a tu servicio real:
import { ResultsService } from '@/modules/results/services/results.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

// ----------------- Tipos mínimos para lean() -----------------
type ObjId = Types.ObjectId;

type CaseStatus = 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED';
type BallotStatus = 'processed' | 'synced' | 'pending' | 'error';

interface PartyVotes {
  partyId: string;
  votes: number;
}
interface VoteBlock {
  validVotes: number;
  nullVotes?: number;
  blankVotes?: number;
  partyVotes: PartyVotes[];
}
interface BallotDoc {
  _id: ObjId;
  electionId: ObjId;
  tableCode: string;
  status: BallotStatus;
  valuable: boolean;
  version?: number;
  // localización "plana" para filtros regionales:
  location?: {
    department?: string;
    province?: string;
    municipality?: string;
  };
  votes: {
    parties?: VoteBlock;
    deputies?: VoteBlock;
  };
  __v?: number;
}
interface AttestationCaseDoc {
  _id: ObjId;
  electionId: ObjId;
  tableCode: string;
  status: CaseStatus;
  winningBallotId: ObjId | null;
  resolvedAt?: Date;
  summary?: any;
  __v?: number;
}
interface ElectoralTableDoc {
  _id: ObjId;
  tableCode: string;
  observedByElection: Record<string, boolean>;
  __v?: number;
}

// Helper para aserciones no-null
function must<T>(val: T | null | undefined): T {
  expect(val).toBeTruthy();
  return val as T;
}

// ------------------- Model tokens y Schemas -------------------
const BALLOT = 'Ballot';
const CASE = 'AttestationCase';
const TABLE = 'ElectoralTable';

// Schema mínimo de Ballot (ajusta colección si difiere)
const BallotSchema = new Schema<BallotDoc>(
  {
    electionId: { type: Schema.Types.ObjectId, index: true, required: true },
    tableCode: { type: String, index: true, required: true },
    status: { type: String, enum: ['processed', 'synced', 'pending', 'error'], required: true },
    valuable: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    location: {
      department: String,
      province: String,
      municipality: String,
    },
    votes: {
      parties: {
        validVotes: Number,
        nullVotes: { type: Number, default: 0 },
        blankVotes: { type: Number, default: 0 },
        partyVotes: [{ partyId: String, votes: Number }],
      },
      deputies: {
        validVotes: Number,
        nullVotes: { type: Number, default: 0 },
        blankVotes: { type: Number, default: 0 },
        partyVotes: [{ partyId: String, votes: Number }],
      },
    },
  },
  { collection: 'ballots' },
);

// Schema mínimo de AttestationCase
const AttestationCaseSchema = new Schema<AttestationCaseDoc>(
  {
    electionId: { type: Schema.Types.ObjectId, index: true, required: true },
    tableCode: { type: String, index: true, required: true },
    status: { type: String, enum: ['VERIFYING', 'PENDING', 'CONSENSUAL', 'CLOSED'], required: true },
    winningBallotId: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date },
    summary: Schema.Types.Mixed,
  },
  { collection: 'attestationcases' },
);

// Schema mínimo de ElectoralTable
const ElectoralTableSchema = new Schema<ElectoralTableDoc>(
  {
    tableCode: { type: String, index: true },
    observedByElection: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'electoral_tables' },
);

// ===================== TEST SUITE ======================
describe('ResultsService (acceptance, pipelines reales)', () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let conn: Connection;

  let ballotModel: Model<BallotDoc>;
  let caseModel: Model<AttestationCaseDoc>;
  let tableModel: Model<ElectoralTableDoc>;
  let svc: ResultsService;

  // election cfg mock: si tu ResultsService lo requiere
  const electionCfg = {
    getActiveConfig: jest.fn(),
  };

  // Helpers de creación
  const mkBallot = async (b: Partial<BallotDoc>) => {
    return await ballotModel.create({
      valuable: false,
      status: 'processed',
      votes: {},
      ...b,
    } as any);
  };
  const mkCase = async (c: Partial<AttestationCaseDoc>) => {
    return await caseModel.create({
      status: 'CLOSED',
      winningBallotId: null,
      ...c,
    } as any);
  };
  const mkTable = async (t: Partial<ElectoralTableDoc>) => {
    return await tableModel.create({
      observedByElection: {},
      ...t,
    } as any);
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();

    const mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri, { dbName: 'testdb', autoIndex: false } as any),
        MongooseModule.forFeature([
          { name: BALLOT, schema: BallotSchema },
          { name: CASE, schema: AttestationCaseSchema },
          { name: TABLE, schema: ElectoralTableSchema },
        ]),
      ],
      providers: [
        ResultsService,
        { provide: ElectionConfigService, useValue: electionCfg },
      ],
    }).compile();

    conn = mod.get<Connection>(getConnectionToken());
    await conn.asPromise();

    ballotModel = mod.get(getModelToken(BALLOT));
    caseModel = mod.get(getModelToken(CASE));
    tableModel = mod.get(getModelToken(TABLE));
    svc = mod.get(ResultsService);
  });

  afterAll(async () => {
    await conn.dropDatabase();
    await conn.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all(Object.values(conn.collections).map((c) => c.deleteMany({})));
  });

  // ======================================================
  // #40: Excluir actas con status incorrecto
  it('#40 excluye status != processed/synced', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A' });
    await mkTable({ tableCode: 'B' });
    await mkTable({ tableCode: 'C' });
    await mkTable({ tableCode: 'D' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 100, nullVotes: 0, blankVotes: 0, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'pending', valuable: true,
      votes: { parties: { validVotes: 50, nullVotes: 0, blankVotes: 0, partyVotes: [{ partyId: 'MAS', votes: 50 }] } },
    });
    const c = await mkBallot({
      electionId: eId, tableCode: 'C', status: 'synced', valuable: true,
      votes: { parties: { validVotes: 75, nullVotes: 0, blankVotes: 0, partyVotes: [{ partyId: 'MAS', votes: 75 }] } },
    });
    const d = await mkBallot({
      electionId: eId, tableCode: 'D', status: 'error', valuable: true,
      votes: { parties: { validVotes: 25, nullVotes: 0, blankVotes: 0, partyVotes: [{ partyId: 'MAS', votes: 25 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'CLOSED', winningBallotId: b._id });
    await mkCase({ electionId: eId, tableCode: 'C', status: 'CLOSED', winningBallotId: c._id });
    await mkCase({ electionId: eId, tableCode: 'D', status: 'CLOSED', winningBallotId: d._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(175); // 100 + 75
    expect(must(res).summary.tablesProcessed).toBe(2);
  });

  // #41: Excluir actas valuable=false (evita doble conteo)
  it('#41 solo valuable=true cuenta', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });
    await mkTable({ tableCode: 'ABC123' });

    const b1 = await mkBallot({
      electionId: eId, tableCode: 'ABC123', status: 'processed', valuable: false, version: 1,
      votes: { parties: { validVotes: 90, partyVotes: [{ partyId: 'MAS', votes: 90 }] } },
    });
    const b2 = await mkBallot({
      electionId: eId, tableCode: 'ABC123', status: 'processed', valuable: true, version: 2,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'ABC123', status: 'CLOSED', winningBallotId: b2._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(100);
    expect(must(res).summary.tablesProcessed).toBe(1);
  });

  // #42: Excluir mesas con caso VERIFYING
  it('#42 excluye mesas con AttestationCase.status=VERIFYING', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A' });
    await mkTable({ tableCode: 'B' });
    await mkTable({ tableCode: 'C' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 50, partyVotes: [{ partyId: 'MAS', votes: 50 }] } },
    });
    const c = await mkBallot({
      electionId: eId, tableCode: 'C', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 75, partyVotes: [{ partyId: 'MAS', votes: 75 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'VERIFYING', winningBallotId: b._id });
    await mkCase({ electionId: eId, tableCode: 'C', status: 'CONSENSUAL', winningBallotId: c._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(175); // A + C
    expect(must(res).summary.tablesProcessed).toBe(2);
  });

  // #43: Incluir CONSENSUAL, CLOSED y PENDING (excluir VERIFYING)
  it('#43 incluye CONSENSUAL, CLOSED y PENDING; excluye VERIFYING', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A' });
    await mkTable({ tableCode: 'B' });
    await mkTable({ tableCode: 'C' });
    await mkTable({ tableCode: 'D' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 50, partyVotes: [{ partyId: 'MAS', votes: 50 }] } },
    });
    const c = await mkBallot({
      electionId: eId, tableCode: 'C', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 75, partyVotes: [{ partyId: 'MAS', votes: 75 }] } },
    });
    const d = await mkBallot({
      electionId: eId, tableCode: 'D', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 25, partyVotes: [{ partyId: 'MAS', votes: 25 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'VERIFYING', winningBallotId: b._id });
    await mkCase({ electionId: eId, tableCode: 'C', status: 'CONSENSUAL', winningBallotId: c._id });
    await mkCase({ electionId: eId, tableCode: 'D', status: 'PENDING', winningBallotId: d._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(200); // 100 + 75 + 25
    expect(must(res).summary.tablesProcessed).toBe(3);
  });

  // #44: Excluir mesas observedByElection[electionId] === true
  it('#44 excluye mesas con observedByElection[electionId]=true', async () => {
    const eId = new Types.ObjectId('111111111111111111111111');
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A', observedByElection: {} });
    await mkTable({ tableCode: 'B', observedByElection: { [eId.toString()]: true } });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 50, partyVotes: [{ partyId: 'MAS', votes: 50 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'CLOSED', winningBallotId: b._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(100);
    expect(must(res).summary.tablesProcessed).toBe(1);
  });

  // #45: Contar solo winningBallotId (última barrera contra doble conteo)
  it('#45 usa solo case.winningBallotId por mesa (aunque haya 2 valuable=true)', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });
    await mkTable({ tableCode: 'XYZ789' });

    const b1 = await mkBallot({
      electionId: eId, tableCode: 'XYZ789', status: 'processed', valuable: true, version: 1,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b2 = await mkBallot({
      electionId: eId, tableCode: 'XYZ789', status: 'processed', valuable: true, version: 2,
      votes: { parties: { validVotes: 95, partyVotes: [{ partyId: 'MAS', votes: 95 }] } },
    });

    // caso elige b2 explícitamente
    await mkCase({ electionId: eId, tableCode: 'XYZ789', status: 'CLOSED', winningBallotId: b2._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(95);
    expect(must(res).summary.tablesProcessed).toBe(1);
  });

  // #46: Cálculo de porcentajes exacto (2 decimales)
  it('#46 calcula porcentajes a 2 decimales', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });
    await mkTable({ tableCode: 'PERC' });

    const b = await mkBallot({
      electionId: eId, tableCode: 'PERC', status: 'processed', valuable: true,
      votes: {
        parties: {
          validVotes: 200,
          nullVotes: 0,
          blankVotes: 0,
          partyVotes: [
            { partyId: 'MAS', votes: 120 },
            { partyId: 'CC', votes: 80 },
          ],
        },
      },
    });
    await mkCase({ electionId: eId, tableCode: 'PERC', status: 'CLOSED', winningBallotId: b._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    expect(must(res).summary.validVotes).toBe(200);

    const mas = must(must(res).parties.find((p: any) => p.partyId === 'MAS'));
    const cc = must(must(res).parties.find((p: any) => p.partyId === 'CC'));
    expect(mas.totalVotes).toBe(120);
    expect(cc.totalVotes).toBe(80);

    // La mayoría de servicios devuelven string con 2 decimales; acepta '60.00' y '40.00'
    expect(String(mas.percentage)).toBe('60.00');
    expect(String(cc.percentage)).toBe('40.00');
  });

  // #47: Agregación de múltiples mesas
  it('#47 suma votos de múltiples mesas correctamente', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A' });
    await mkTable({ tableCode: 'B' });
    await mkTable({ tableCode: 'C' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      votes: { parties: {
        validVotes: 100, nullVotes: 5, blankVotes: 3,
        partyVotes: [{ partyId: 'MAS', votes: 60 }, { partyId: 'CC', votes: 40 }],
      }},
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'processed', valuable: true,
      votes: { parties: {
        validVotes: 150, nullVotes: 8, blankVotes: 2,
        partyVotes: [{ partyId: 'MAS', votes: 90 }, { partyId: 'CC', votes: 60 }],
      }},
    });
    const c = await mkBallot({
      electionId: eId, tableCode: 'C', status: 'processed', valuable: true,
      votes: { parties: {
        validVotes: 100, nullVotes: 10, blankVotes: 5,
        partyVotes: [{ partyId: 'MAS', votes: 50 }, { partyId: 'CC', votes: 50 }],
      }},
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'CLOSED', winningBallotId: b._id });
    await mkCase({ electionId: eId, tableCode: 'C', status: 'CLOSED', winningBallotId: c._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    const sum = must(res).summary;
    expect(sum.validVotes).toBe(350);
    expect(sum.nullVotes).toBe(23);
    expect(sum.blankVotes).toBe(10);
    expect(sum.totalVotes).toBe(383);
    expect(sum.tablesProcessed).toBe(3);

    const mas = must(res).parties.find((p: any) => p.partyId === 'MAS');
    const cc = must(res).parties.find((p: any) => p.partyId === 'CC');
    expect(must(mas).totalVotes).toBe(200);
    expect(must(cc).totalVotes).toBe(150);
  });

  // #48: Cambiar de categoría según electionType (presidential vs deputies)
  it('#48 usa votes.parties para presidential y votes.deputies para deputies', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });
    await mkTable({ tableCode: 'TYPE' });

    const b = await mkBallot({
      electionId: eId, tableCode: 'TYPE', status: 'processed', valuable: true,
      votes: {
        parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] },
        deputies: { validVotes: 80, partyVotes: [{ partyId: 'MAS', votes: 80 }] },
      },
    });
    await mkCase({ electionId: eId, tableCode: 'TYPE', status: 'CLOSED', winningBallotId: b._id });

    const pres = await (svc as any).getResultsByLocation({ electionId: eId, electionType: 'presidential' });
    const deps = await (svc as any).getResultsByLocation({ electionId: eId, electionType: 'deputies' });

    expect(must(pres).summary.validVotes).toBe(100);
    expect(must(pres).parties.find((p: any) => p.partyId === 'MAS')!.totalVotes).toBe(100);

    expect(must(deps).summary.validVotes).toBe(80);
    expect(must(deps).parties.find((p: any) => p.partyId === 'MAS')!.totalVotes).toBe(80);
  });

  // #49: Filtro geográfico por department/province/municipality
  it('#49 filtra por ubicación geográfica (department)', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'A' });
    await mkTable({ tableCode: 'B' });
    await mkTable({ tableCode: 'C' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'A', status: 'processed', valuable: true,
      location: { department: 'La Paz' },
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });
    const b = await mkBallot({
      electionId: eId, tableCode: 'B', status: 'processed', valuable: true,
      location: { department: 'Santa Cruz' },
      votes: { parties: { validVotes: 50, partyVotes: [{ partyId: 'MAS', votes: 50 }] } },
    });
    const c = await mkBallot({
      electionId: eId, tableCode: 'C', status: 'processed', valuable: true,
      location: { department: 'La Paz' },
      votes: { parties: { validVotes: 75, partyVotes: [{ partyId: 'MAS', votes: 75 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'A', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'B', status: 'CLOSED', winningBallotId: b._id });
    await mkCase({ electionId: eId, tableCode: 'C', status: 'CLOSED', winningBallotId: c._id });

    const res = await (svc as any).getResultsByLocation({
      electionId: eId,
      electionType: 'presidential',
      department: 'La Paz',
    });

    expect(must(res).summary.validVotes).toBe(175); // A + C
    const mas = must(res).parties.find((p: any) => p.partyId === 'MAS');
    expect(must(mas).totalVotes).toBe(175);
  });

  // #50: Deduplicar por tableCode en conteo de mesas
  it('#50 tablesProcessed cuenta mesas únicas (distinct tableCode)', async () => {
    const eId = new Types.ObjectId();
    electionCfg.getActiveConfig.mockResolvedValue({ id: eId });

    await mkTable({ tableCode: 'AAA' });
    await mkTable({ tableCode: 'BBB' });
    await mkTable({ tableCode: 'CCC' });

    const a = await mkBallot({
      electionId: eId, tableCode: 'AAA', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 100, partyVotes: [{ partyId: 'MAS', votes: 100 }] } },
    });

    // BBB con 3 versiones; solo 1 ganadora
    const b1 = await mkBallot({
      electionId: eId, tableCode: 'BBB', status: 'processed', valuable: false, version: 1,
      votes: { parties: { validVotes: 10, partyVotes: [{ partyId: 'CC', votes: 10 }] } },
    });
    const b2 = await mkBallot({
      electionId: eId, tableCode: 'BBB', status: 'processed', valuable: true, version: 2,
      votes: { parties: { validVotes: 50, partyVotes: [{ partyId: 'CC', votes: 50 }] } },
    });
    const b3 = await mkBallot({
      electionId: eId, tableCode: 'BBB', status: 'processed', valuable: false, version: 3,
      votes: { parties: { validVotes: 5, partyVotes: [{ partyId: 'CC', votes: 5 }] } },
    });

    const c = await mkBallot({
      electionId: eId, tableCode: 'CCC', status: 'processed', valuable: true,
      votes: { parties: { validVotes: 75, partyVotes: [{ partyId: 'MAS', votes: 75 }] } },
    });

    await mkCase({ electionId: eId, tableCode: 'AAA', status: 'CLOSED', winningBallotId: a._id });
    await mkCase({ electionId: eId, tableCode: 'BBB', status: 'CLOSED', winningBallotId: b2._id });
    await mkCase({ electionId: eId, tableCode: 'CCC', status: 'CLOSED', winningBallotId: c._id });

    const res = await (svc as any).getQuickCount({ electionId: eId, electionType: 'presidential' });
    const sum = must(res).summary;
    expect(sum.tablesProcessed).toBe(3); // AAA, BBB, CCC (no 6)
    expect(sum.validVotes).toBe(225);    // 100 + 50 + 75
  });
});
