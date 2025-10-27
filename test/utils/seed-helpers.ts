// test/utils/seed-helpers.ts
import { Connection, Types } from 'mongoose';

type GeoNames = {
  department?: string;
  province?: string;
  municipality?: string;
  seat?: string;
  location?: string;
};
type AnyDoc = Record<string, any>;

export async function seedGeoMinimal(conn: Connection, names: GeoNames = {}) {
  const dName = names.department ?? 'La Paz';
  const pName = names.province ?? 'Murillo';
  const mName = names.municipality ?? 'La Paz';
  const sName = names.seat ?? 'Achachicala';
  const lName = names.location ?? 'U.E Achachicala';

  const depId = new Types.ObjectId();
  const proId = new Types.ObjectId();
  const munId = new Types.ObjectId();
  const seatId = new Types.ObjectId();
  const locId = new Types.ObjectId();

  await conn
    .collection<AnyDoc>('departments')
    .updateOne(
      { _id: depId },
      { $setOnInsert: { _id: depId, name: dName } },
      { upsert: true },
    );

  await conn
    .collection<AnyDoc>('provinces')
    .updateOne(
      { _id: proId },
      { $setOnInsert: { _id: proId, name: pName, departmentId: depId } },
      { upsert: true },
    );

  await conn
    .collection<AnyDoc>('municipalities')
    .updateOne(
      { _id: munId },
      { $setOnInsert: { _id: munId, name: mName, provinceId: proId } },
      { upsert: true },
    );

  await conn
    .collection<AnyDoc>('electoral_seats')
    .updateOne(
      { _id: seatId },
      { $setOnInsert: { _id: seatId, name: sName, municipalityId: munId } },
      { upsert: true },
    );

  await conn
    .collection<AnyDoc>('electoral_locations')
    .updateOne(
      { _id: locId },
      { $setOnInsert: { _id: locId, name: lName, electoralSeatId: seatId } },
      { upsert: true },
    );

  return {
    depId,
    proId,
    munId,
    seatId,
    locId,
    names: { dName, pName, mName, sName, lName },
  };
}

export async function upsertTable(conn: Connection, opts: {
  tableCode: string;
  electoralLocationName: string;
  active: boolean;
  observedMap: Record<string, boolean>;
}) {
  const loc = await conn.collection<AnyDoc>('electoral_locations').findOne({ name: opts.electoralLocationName });
  if (!loc) throw new Error('electoral location missing for upsertTable');

  // usa la combinación (electoralLocationId, tableNumber) que es la del índice único
  await conn.collection<AnyDoc>('electoral_tables').updateOne(
    { electoralLocationId: loc._id, tableNumber: opts.tableCode },
    {
      $set: {
        electoralLocationId: loc._id,
        tableCode: opts.tableCode,
        tableNumber: opts.tableCode,        // <-- clave: ya no queda null
        active: opts.active,
        observedByElection: opts.observedMap ?? {},
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
}

export async function seedElectionConfig(
  conn: Connection,
  data: {
    name: string;
    votingStartDate: Date;
    votingEndDate: Date;
    resultsStartDate: Date;
    isActive: boolean;
    type?: string;
    allowDataModification?: boolean;
  },
) {
  const _id = new Types.ObjectId();
  await conn.collection<AnyDoc>('election_configs').insertOne({
    _id,
    name: data.name,
    votingStartDate: data.votingStartDate,
    votingEndDate: data.votingEndDate,
    resultsStartDate: data.resultsStartDate,
    isActive: data.isActive,
    allowDataModification: data.allowDataModification ?? false,
    timezone: 'America/La_Paz',
    type: data.type ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return _id.toHexString();
}

export async function seedBallot(
  conn: Connection,
  opts: {
    electionId: string;
    tableCode: string;
    version: number;
    valuable: boolean;
    status: 'pending' | 'processed' | 'synced' | 'error';
    loc: {
      department: string;
      province: string;
      municipality: string;
      seat: string;
      location: string;
      district: string;
      zone: string;
      circ: { number: number; type: string; name: string };
    };
    parties: {
      valid: number;
      null: number;
      blank: number;
      votes: Record<string, number>;
    };
  },
) {
  const ballot = {
    electionId: new Types.ObjectId(opts.electionId),
    tableNumber: opts.tableCode,
    tableCode: opts.tableCode,
    electoralLocationId: await resolveLocationId(conn, opts.loc.location),
    location: {
      department: opts.loc.department,
      province: opts.loc.province,
      municipality: opts.loc.municipality,
      electoralSeat: opts.loc.seat,
      electoralLocationName: opts.loc.location,
      district: opts.loc.district,
      zone: opts.loc.zone,
      circunscripcion: {
        number: opts.loc.circ.number,
        type: opts.loc.circ.type,
        name: opts.loc.circ.name,
      },
    },
    votes: {
      parties: {
        validVotes: opts.parties.valid,
        nullVotes: opts.parties.null,
        blankVotes: opts.parties.blank,
        partyVotes: Object.entries(opts.parties.votes).map(
          ([partyId, votes]) => ({ partyId, votes }),
        ),
      },
    },
    ipfsUri: `ipfs://fake/${opts.tableCode}/${opts.version}`,
    image: 'ipfs://fake/image',
    status: opts.status,
    valuable: opts.valuable,
    version: opts.version,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await conn
    .collection<AnyDoc>('ballots')
    .insertOne(ballot as any);
  return { _id: result.insertedId, ...ballot };
}

export async function seedCase(
  conn: Connection,
  opts: {
    electionId: string;
    tableCode: string;
    status: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED';
    winningBallotId: Types.ObjectId | null;
  },
) {
  await conn.collection<AnyDoc>('attestation_cases').updateOne(
    {
      electionId: new Types.ObjectId(opts.electionId),
      tableCode: opts.tableCode,
    },
    {
      $set: {
        electionId: new Types.ObjectId(opts.electionId),
        tableCode: opts.tableCode,
        status: opts.status,
        winningBallotId: opts.winningBallotId,
        resolvedAt: new Date(),
        summary: {},
      },
    },
    { upsert: true },
  );
}

async function resolveLocationId(conn: Connection, name: string) {
  const loc = await conn
    .collection<AnyDoc>('electoral_locations')
    .findOne({ name });
  if (!loc) throw new Error('location not found');
  return loc._id;
}

export async function bulkManyBallots(
  conn: Connection,
  params: {
    electionId: string;
    tables: number;
    versionsAvg: number;
  },
) {
  const eid = new Types.ObjectId(params.electionId);
  // crear N mesas activas
  for (let i = 0; i < params.tables; i++) {
    const code = `M${i}`;
    await upsertTable(conn, {
      tableCode: code,
      electoralLocationName: 'U.E Achachicala',
      active: true,
      observedMap: {},
    });
    const versions = Math.max(
      1,
      Math.round(Math.random() * params.versionsAvg * 2),
    );
    const docs: AnyDoc[] = [];
    for (let v = 1; v <= versions; v++) {
      docs.push({
        electionId: eid,
        tableNumber: code,
        tableCode: code,
        electoralLocationId: await resolveLocationId(conn, 'U.E Achachicala'),
        location: {
          department: 'La Paz',
          province: 'Murillo',
          municipality: 'La Paz',
          electoralSeat: 'Achachicala',
          electoralLocationName: 'U.E Achachicala',
          district: 'D1',
          zone: 'Z1',
          circunscripcion: { number: 24, type: 'Uninominal', name: 'Circ 24' },
        },
        votes: {
          parties: {
            validVotes: 50 + (v % 3) * 10,
            nullVotes: 0,
            blankVotes: 0,
            partyVotes: [
              { partyId: 'X', votes: 25 },
              { partyId: 'Y', votes: 25 + (v % 3) * 10 },
            ],
          },
        },
        ipfsUri: `ipfs://bulk/${code}/${v}`,
        image: 'ipfs://bulk/image',
        status: 'processed',
        valuable: v === versions,
        version: v,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await conn.collection('ballots').insertMany(docs as any[]);
  }
  // marcar algunos casos para ganador
  await conn.collection('attestation_cases').insertOne({
    electionId: eid,
    tableCode: 'M0',
    status: 'CLOSED',
    winningBallotId: null,
    resolvedAt: new Date(),
    summary: {},
  });
}
