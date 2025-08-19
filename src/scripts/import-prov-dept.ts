/*
  Nest-integrated importer for missing_415_tables.json → MongoDB/AWS DocumentDB
  - Reuses your Nest connection (CoreModule → DatabaseModule → MongooseModule.forRootAsync)
  - DocumentDB-safe upserts (updateOne + findOne)
  - Avoids duplicate field paths across $setOnInsert and $set (error code 40)
  - Idempotent, key-driven upserts aligned to your unique indexes

  Run:
    ts-node -r tsconfig-paths/register src/scripts/import-electoral-data.nest.ts --file ./final_data_replaced.json
*/
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '../core/core.module';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { Db, Collection, Document, ObjectId } from 'mongodb';

// ===== Input types =====
type Mesa = {
  codigo_mesa: string;
  num_mesa: number | string;
  habilitados?: number | string;
  inhabilitados?: number | string;
};

type InputRow = {
  FID?: string;
  NomDep: string;
  NomProv: string;
  NombreMuni: string;
  IdLoc: string; // seat code
  AsientoEle: string; // seat name
  Reci: string; // location code
  NombreReci: string; // location name
  NomDist?: string; // district
  NomZona?: string; // zone
  Direccion?: string; // address
  NroCircun?: string | number; // circ. number
  TipoCircun?: 'Especial' | 'Uninominal' | string;
  NomCircun?: string; // circ. name (often blank)
  latitud?: string | number;
  longitud?: string | number;
  x?: string | number;
  y?: string | number;
  mesas?: Mesa[];
};

// ===== Helpers =====
const now = () => new Date();
const norm = (s?: unknown) => (s ?? '').toString().trim().replace(/\s+/g, ' ');
const toInt = (v: unknown, d = 0) => {
  const n =
    typeof v === 'string'
      ? parseInt(v, 10)
      : typeof v === 'number'
        ? Math.trunc(v)
        : NaN;
  return Number.isFinite(n) ? n : d;
};
const toFloat = (v: unknown, d = 0) => {
  const n =
    typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : d;
};

// ===== Caches =====
const depCache = new Map<string, ObjectId>();
const provCache = new Map<string, ObjectId>(); // key: depId|name
const muniCache = new Map<string, ObjectId>(); // key: provId|name
const seatCache = new Map<string, ObjectId>(); // key: muniId|idLoc
const locCache = new Map<string, ObjectId>(); // key: seatId|Reci

// ===== Collections =====
let Departments!: Collection<Document>;
let Provinces!: Collection<Document>;
let Municipalities!: Collection<Document>;
let Seats!: Collection<Document>;
let Locations!: Collection<Document>;
let Tables!: Collection<Document>;

// ===== DocumentDB-safe upsert helper =====
async function upsertGetId(
  coll: Collection<Document>,
  filter: Record<string, unknown>,
  setOnInsert: Record<string, unknown>,
  set: Record<string, unknown>,
): Promise<ObjectId> {
  // Ensure no duplicate field paths across operators (DocumentDB code 40)
  for (const k of Object.keys(setOnInsert)) {
    if (k in set) delete (setOnInsert as any)[k];
  }
  await coll.updateOne(
    filter,
    { $setOnInsert: setOnInsert, $set: set },
    { upsert: true },
  );
  const doc = await coll.findOne(filter, { projection: { _id: 1 } });
  if (!doc || !doc._id)
    throw new Error(`Upsert/readback failed for ${coll.collectionName}`);
  return doc._id as ObjectId;
}

// ===== Upserts =====
async function upsertDepartment(nameRaw: string) {
  const name = norm(nameRaw);
  if (!name) throw new Error('Department name missing');
  const cached = depCache.get(name);
  if (cached) return cached;
  const id = await upsertGetId(
    Departments,
    { name },
    { name, active: true, createdAt: now() },
    { updatedAt: now() },
  );
  depCache.set(name, id);
  return id;
}

async function upsertProvince(depId: ObjectId, nameRaw: string) {
  const name = norm(nameRaw);
  const key = `${String(depId)}|${name}`;
  const cached = provCache.get(key);
  if (cached) return cached;
  const id = await upsertGetId(
    Provinces,
    { departmentId: depId, name },
    { departmentId: depId, name, active: true, createdAt: now() },
    { updatedAt: now() },
  );
  provCache.set(key, id);
  return id;
}

async function upsertMunicipality(provId: ObjectId, nameRaw: string) {
  const name = norm(nameRaw);
  const key = `${String(provId)}|${name}`;
  const cached = muniCache.get(key);
  if (cached) return cached;
  const id = await upsertGetId(
    Municipalities,
    { provinceId: provId, name },
    { provinceId: provId, name, active: true, createdAt: now() },
    { updatedAt: now() },
  );
  muniCache.set(key, id);
  return id;
}

async function upsertSeat(
  muniId: ObjectId,
  idLocRaw: string,
  seatNameRaw: string,
) {
  const idLoc = norm(idLocRaw);
  if (!idLoc) throw new Error('ElectoralSeat.idLoc missing');
  const name = norm(seatNameRaw);
  const key = `${String(muniId)}|${idLoc}`;
  const cached = seatCache.get(key);
  if (cached) return cached;
  const id = await upsertGetId(
    Seats,
    { municipalityId: muniId, idLoc },
    { municipalityId: muniId, idLoc, active: true, createdAt: now() }, // NO 'name' here to avoid duplicate path
    { name, updatedAt: now() },
  );
  seatCache.set(key, id);
  return id;
}

function buildCircunscripcion(row: InputRow) {
  const number = toInt(row.NroCircun, 0);
  const type =
    (norm(row.TipoCircun) as 'Especial' | 'Uninominal') || 'Uninominal';
  const name = norm(row.NomCircun) || `${type} ${number || ''}`.trim();
  return { number, type, name };
}

function buildGeo(row: InputRow) {
  const lat = toFloat(row.latitud, 0);
  const lon = toFloat(row.longitud, 0);
  return {
    coordinates: { latitude: lat, longitude: lon },
    geo: { type: 'Point', coordinates: [lon, lat] as [number, number] },
  };
}

async function upsertLocation(seatId: ObjectId, row: InputRow) {
  const code = norm(row.Reci);
  const name = norm(row.NombreReci);
  const fid = norm(row.FID || '');
  const district = norm(row.NomDist || '');
  const zone = norm(row.NomZona || '');
  const address = norm(row.Direccion || '');
  const circunscripcion = buildCircunscripcion(row);
  const { coordinates, geo } = buildGeo(row);

  const key = `${String(seatId)}|${code}`;
  const cached = locCache.get(key);
  if (cached) return cached;

  const id = await upsertGetId(
    Locations,
    { electoralSeatId: seatId, code },
    { electoralSeatId: seatId, code, active: true, createdAt: now() },
    {
      name,
      fid: fid || undefined,
      district: district || undefined,
      zone: zone || undefined,
      address: address || undefined,
      circunscripcion,
      coordinates,
      geo,
      updatedAt: now(),
    },
  );
  locCache.set(key, id);
  return id;
}

async function upsertTable(locId: ObjectId, m: Mesa) {
  const tableCode = norm(m.codigo_mesa);
  const tableNumber = String(m.num_mesa);
  const enabledVoters = toInt(m.habilitados, 0);
  const disabledVoters = toInt(m.inhabilitados, 0);

  await Tables.updateOne(
    { tableCode }, // unique by code
    {
      $setOnInsert: {
        active: true,
        createdAt: now(),
      },
      $set: {
        electoralLocationId: locId,
        tableCode,
        tableNumber,
        enabledVoters,
        disabledVoters,
        updatedAt: now(),
      },
    },
    { upsert: true },
  );
}

// ===== Main (Nest connection reuse) =====
async function main() {
  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const conn = app.get<Connection>(getConnectionToken());
    const db: Db = (conn as any).db!; // ensured by Mongoose once connected

    // Bind collections from the same Nest/Mongoose connection
    Departments = db.collection('departments');
    Provinces = db.collection('provinces');
    Municipalities = db.collection('municipalities');
    Seats = db.collection('electoral_seats');
    Locations = db.collection('electoral_locations');
    Tables = db.collection('electoral_tables');

    // Resolve input file (supports --file=... or --file ...)
    let dataFile = path.join(process.cwd(), 'missing_415_tables.json');
    for (let i = 0; i < process.argv.length; i++) {
      const a = process.argv[i];
      if (a.startsWith('--file=')) dataFile = a.split('=')[1];
      if (a === '--file' && process.argv[i + 1]) dataFile = process.argv[i + 1];
    }

    const raw = fs.readFileSync(dataFile, 'utf8');
    const rows = JSON.parse(raw) as InputRow[];

    let upsertedTables = 0;

    for (const row of rows) {
      const depId = await upsertDepartment(row.NomDep);
      const provId = await upsertProvince(depId, row.NomProv);
      const muniId = await upsertMunicipality(provId, row.NombreMuni);
      const seatId = await upsertSeat(muniId, row.IdLoc, row.AsientoEle);
      const locId = await upsertLocation(seatId, row);

      for (const m of row.mesas || []) {
        await upsertTable(locId, m);
        upsertedTables++;
      }
    }

    console.log(`\n✅ Import terminado. Tables upserted: ${upsertedTables}`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('❌ Import error:', err);
    process.exit(1);
  });
}
