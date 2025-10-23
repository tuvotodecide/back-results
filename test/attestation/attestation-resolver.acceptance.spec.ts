// test/attestation/attestation-resolver.acceptance.spec.ts
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import mongoose, { Connection, Schema, Types, Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { AttestationResolverService } from '@/modules/attestation/services/attestation-resolver.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

// ---------------------- Tipos TS para lean() ----------------------
type ObjId = Types.ObjectId;

interface AttestationDoc {
  _id: ObjId;
  ballotId: ObjId;
  support: boolean;
  isJury: boolean;
  __v?: number;
}

type CaseStatus = 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED';

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

interface BallotDoc {
  _id: ObjId;
  electionId: ObjId;
  tableCode: string;
  valuable: boolean;
  __v?: number;
}

interface ElectoralTableDoc {
  _id: ObjId;
  tableCode: string;
  observedByElection: Record<string, boolean>;
  __v?: number;
}

// Helper para afirmar no-null de forma limpia
function must<T>(val: T | null): T {
  expect(val).toBeTruthy();
  return val as T;
}

// Model names (coinciden con los usados por el servicio)
const ATTESTATION = 'Attestation';
const BALLOT = 'Ballot';
const CASE = 'AttestationCase';
const TABLE = 'ElectoralTable';

// Schemas mínimos para las operaciones que hace el resolver
const AttestationSchema = new Schema<AttestationDoc>(
  {
    ballotId: { type: Schema.Types.ObjectId, required: true, index: true },
    support: { type: Boolean, default: true },
    isJury: { type: Boolean, default: false },
  },
  { collection: 'attestations' },
);

const BallotSchema = new Schema<BallotDoc>(
  {
    electionId: { type: Schema.Types.ObjectId, index: true, required: true },
    tableCode: { type: String, index: true, required: true },
    valuable: { type: Boolean, default: false },
  },
  { collection: 'ballots' },
);

const AttestationCaseSchema = new Schema<AttestationCaseDoc>(
  {
    electionId: { type: Schema.Types.ObjectId, index: true, required: true },
    tableCode: { type: String, index: true, required: true },
    status: { type: String, enum: ['VERIFYING', 'PENDING', 'CONSENSUAL', 'CLOSED'] },
    winningBallotId: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date },
    summary: { type: Schema.Types.Mixed },
  },
  { collection: 'attestationcases' }, // usa tu nombre real si difiere
);

const ElectoralTableSchema = new Schema<ElectoralTableDoc>(
  {
    tableCode: { type: String, index: true, unique: false },
    observedByElection: { type: Schema.Types.Mixed, default: {} },
  },
  { collection: 'electoral_tables' },
);

describe('AttestationResolverService (acceptance, in-memory DB)', () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let conn: Connection;

  let attModel: Model<AttestationDoc>;
  let ballotModel: Model<BallotDoc>;
  let caseModel: Model<AttestationCaseDoc>;
  let tableModel: Model<ElectoralTableDoc>;
  let svc: AttestationResolverService;

  const electionCfg = {
    getElectionStatus: jest
      .fn()
      .mockResolvedValue({ hasActiveConfig: true, isVotingPeriod: false }),
    getActiveConfig: jest.fn(),
  };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();

    const mod = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri, { dbName: 'testdb', autoIndex: false } as any),
        MongooseModule.forFeature([
          { name: ATTESTATION, schema: AttestationSchema },
          { name: BALLOT, schema: BallotSchema },
          { name: CASE, schema: AttestationCaseSchema },
          { name: TABLE, schema: ElectoralTableSchema },
        ]),
      ],
      providers: [
        AttestationResolverService,
        { provide: ElectionConfigService, useValue: electionCfg },
      ],
    }).compile();

    conn = mod.get<Connection>(getConnectionToken());
    await conn.asPromise();

    attModel = mod.get(getModelToken(ATTESTATION));
    ballotModel = mod.get(getModelToken(BALLOT));
    caseModel = mod.get(getModelToken(CASE));
    tableModel = mod.get(getModelToken(TABLE));
    svc = mod.get(AttestationResolverService);
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

  // #36 Flujo completo de consenso simple
  it('#36 flujo completo: 1 acta, 3 usuarios → CLOSED', async () => {
    const eId = new Types.ObjectId();
    await tableModel.create({ tableCode: 'ABC123' });
    const ballot = await ballotModel.create({ electionId: eId, tableCode: 'ABC123' });

    await attModel.create([
      { ballotId: ballot._id, isJury: false, support: true },
      { ballotId: ballot._id, isJury: false, support: true },
      { ballotId: ballot._id, isJury: false, support: true },
    ]);

    await (svc as any).resolveCase(eId, 'ABC123');

    const kase = must(
      await caseModel
        .findOne({ electionId: eId, tableCode: 'ABC123' })
        .lean<AttestationCaseDoc>()
        .exec(),
    );
    expect(kase.status).toBe('CLOSED');
    expect(String(kase.winningBallotId)).toBe(String(ballot._id));

    const updated = must(await ballotModel.findById(ballot._id).lean<BallotDoc>().exec());
    expect(updated.valuable).toBe(true);

    const tbl = must(
      await tableModel.findOne({ tableCode: 'ABC123' }).lean<ElectoralTableDoc>().exec(),
    );
    expect(tbl.observedByElection?.[eId.toString()]).toBe(false);
  });

  // #37 Flujo de conflicto (empate jurados) → VERIFYING
  it('#37 conflicto: 2 actas, 1 jurado cada una → VERIFYING', async () => {
    const eId = new Types.ObjectId();
    await tableModel.create({ tableCode: 'XYZ789' });
    const b1 = await ballotModel.create({ electionId: eId, tableCode: 'XYZ789' });
    const b2 = await ballotModel.create({ electionId: eId, tableCode: 'XYZ789' });

    await attModel.create([
      { ballotId: b1._id, isJury: true, support: true },
      { ballotId: b2._id, isJury: true, support: true },
    ]);

    await (svc as any).resolveCase(eId, 'XYZ789');

    const kase = must(
      await caseModel
        .findOne({ electionId: eId, tableCode: 'XYZ789' })
        .lean<AttestationCaseDoc>()
        .exec(),
    );
    expect(kase.status).toBe('VERIFYING');
    expect(kase.winningBallotId).toBeNull();

    const bb = await ballotModel.find({ tableCode: 'XYZ789' }).lean<BallotDoc[]>().exec();
    bb.forEach((doc) => expect(doc.valuable).toBe(false));

    const tbl = must(
      await tableModel.findOne({ tableCode: 'XYZ789' }).lean<ElectoralTableDoc>().exec(),
    );
    expect(tbl.observedByElection?.[eId.toString()]).toBe(true);
  });

  // #38 Cambio de estado: VERIFYING → CONSENSUAL (nuevos usuarios)
  it('#38 transición: VERIFYING → CONSENSUAL con más usuarios', async () => {
    const eId = new Types.ObjectId();
    await tableModel.create({ tableCode: 'DEF456' });
    const b1 = await ballotModel.create({ electionId: eId, tableCode: 'DEF456' });
    const b2 = await ballotModel.create({ electionId: eId, tableCode: 'DEF456' });

    // Empate inicial de jurados → VERIFYING
    await attModel.create([
      { ballotId: b1._id, isJury: true, support: true },
      { ballotId: b2._id, isJury: true, support: true },
    ]);
    await (svc as any).resolveCase(eId, 'DEF456');

    let kase = must(
      await caseModel
        .findOne({ electionId: eId, tableCode: 'DEF456' })
        .lean<AttestationCaseDoc>()
        .exec(),
    );
    expect(kase.status).toBe('VERIFYING');

    // Llegan 3 usuarios a favor de b1
    await attModel.create([
      { ballotId: b1._id, isJury: false, support: true },
      { ballotId: b1._id, isJury: false, support: true },
      { ballotId: b1._id, isJury: false, support: true },
    ]);
    await (svc as any).resolveCase(eId, 'DEF456');

    kase = must(
      await caseModel
        .findOne({ electionId: eId, tableCode: 'DEF456' })
        .lean<AttestationCaseDoc>()
        .exec(),
    );
    expect(kase.status).toBe('CONSENSUAL');
    expect(String(kase.winningBallotId)).toBe(String(b1._id));

    const b1doc = must(await ballotModel.findById(b1._id).lean<BallotDoc>().exec());
    expect(b1doc.valuable).toBe(true);

    const tbl = must(
      await tableModel.findOne({ tableCode: 'DEF456' }).lean<ElectoralTableDoc>().exec(),
    );
    expect(tbl.observedByElection?.[eId.toString()]).toBe(false);
  });

  // #39 Procesamiento batch resolvePending()
  it('#39 batch: 5 mesas con escenarios distintos', async () => {
    const eId = new Types.ObjectId();

    // Mesa A: 1 acta, 3 usuarios → CLOSED
    await tableModel.create({ tableCode: 'A' });
    const a = await ballotModel.create({ electionId: eId, tableCode: 'A' });
    await attModel.create([
      { ballotId: a._id, isJury: false, support: true },
      { ballotId: a._id, isJury: false, support: true },
      { ballotId: a._id, isJury: false, support: true },
    ]);

    // Mesa B: 2 actas, empate jurados → VERIFYING
    await tableModel.create({ tableCode: 'B' });
    const b1 = await ballotModel.create({ electionId: eId, tableCode: 'B' });
    const b2 = await ballotModel.create({ electionId: eId, tableCode: 'B' });
    await attModel.create([
      { ballotId: b1._id, isJury: true, support: true },
      { ballotId: b2._id, isJury: true, support: true },
    ]);

    // Mesa C: 1 acta, 1 jurado → CLOSED
    await tableModel.create({ tableCode: 'C' });
    const c = await ballotModel.create({ electionId: eId, tableCode: 'C' });
    await attModel.create([{ ballotId: c._id, isJury: true, support: true }]);

    // Mesa D: 2 actas, mayoría usuarios sin jurados → CONSENSUAL
    await tableModel.create({ tableCode: 'D' });
    const d1 = await ballotModel.create({ electionId: eId, tableCode: 'D' });
    const d2 = await ballotModel.create({ electionId: eId, tableCode: 'D' });
    await attModel.create([
      // 5 a d1 vs 2 a d2
      { ballotId: d1._id, isJury: false, support: true },
      { ballotId: d1._id, isJury: false, support: true },
      { ballotId: d1._id, isJury: false, support: true },
      { ballotId: d1._id, isJury: false, support: true },
      { ballotId: d1._id, isJury: false, support: true },
      { ballotId: d2._id, isJury: false, support: true },
      { ballotId: d2._id, isJury: false, support: true },
    ]);

    // Mesa E: 1 acta, 0 apoyos (pero 1 attestation support=false para que aparezca en aggregate) → VERIFYING
    await tableModel.create({ tableCode: 'E' });
    const e = await ballotModel.create({ electionId: eId, tableCode: 'E' });
    await attModel.create([{ ballotId: e._id, isJury: false, support: false }]);

    // Ejecuta el batch real
    await (svc as any).resolvePending();

    const aCase = must(
      await caseModel.findOne({ electionId: eId, tableCode: 'A' }).lean<AttestationCaseDoc>().exec(),
    );
    const bCase = must(
      await caseModel.findOne({ electionId: eId, tableCode: 'B' }).lean<AttestationCaseDoc>().exec(),
    );
    const cCase = must(
      await caseModel.findOne({ electionId: eId, tableCode: 'C' }).lean<AttestationCaseDoc>().exec(),
    );
    const dCase = must(
      await caseModel.findOne({ electionId: eId, tableCode: 'D' }).lean<AttestationCaseDoc>().exec(),
    );
    const eCase = must(
      await caseModel.findOne({ electionId: eId, tableCode: 'E' }).lean<AttestationCaseDoc>().exec(),
    );

    expect(aCase.status).toBe('CLOSED');
    expect(bCase.status).toBe('VERIFYING');
    expect(cCase.status).toBe('CLOSED');
    expect(dCase.status).toBe('CONSENSUAL');
    expect(eCase.status).toBe('VERIFYING');

    // Valuable por mesa
    const [aDoc, cDoc, d1Doc, d2Doc] = await Promise.all([
      ballotModel.findById(a._id).lean<BallotDoc>().exec(),
      ballotModel.findById(c._id).lean<BallotDoc>().exec(),
      ballotModel.findById(d1._id).lean<BallotDoc>().exec(),
      ballotModel.findById(d2._id).lean<BallotDoc>().exec(),
    ]);
    expect(must(aDoc).valuable).toBe(true);
    expect(must(cDoc).valuable).toBe(true);
    expect(must(d1Doc).valuable).toBe(true);
    expect(must(d2Doc).valuable).toBe(false);

    // Observed flags
    const [tblA, tblB, tblC, tblD, tblE] = await Promise.all([
      tableModel.findOne({ tableCode: 'A' }).lean<ElectoralTableDoc>().exec(),
      tableModel.findOne({ tableCode: 'B' }).lean<ElectoralTableDoc>().exec(),
      tableModel.findOne({ tableCode: 'C' }).lean<ElectoralTableDoc>().exec(),
      tableModel.findOne({ tableCode: 'D' }).lean<ElectoralTableDoc>().exec(),
      tableModel.findOne({ tableCode: 'E' }).lean<ElectoralTableDoc>().exec(),
    ]);
    const eid = eId.toString();
    expect(must(tblA).observedByElection?.[eid]).toBe(false);
    expect(must(tblB).observedByElection?.[eid]).toBe(true);
    expect(must(tblC).observedByElection?.[eid]).toBe(false);
    expect(must(tblD).observedByElection?.[eid]).toBe(false);
    expect(must(tblE).observedByElection?.[eid]).toBe(true);
  });
});
