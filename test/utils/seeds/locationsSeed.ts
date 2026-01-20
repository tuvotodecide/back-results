import fs from "fs";
import path from "path";
import { Connection, Types } from "mongoose";
import type { Collection, Document } from "mongodb";

// Minimal importer for tests: loads final_data_replaced.json and upserts geo/table data.
// Mirrors src/scripts/import-prov-dept.ts but uses an existing test connection.

type Mesa = {
	codigo_mesa: string;
	num_mesa: number | string;
	habilitados?: number | string;
	inhabilitados?: number | string;
};

type InputRow = {
	NomDep: string;
	NomProv: string;
	NombreMuni: string;
	IdLoc: string;
	AsientoEle: string;
	Reci: string;
	NombreReci: string;
	NomDist?: string;
	NomZona?: string;
	Direccion?: string;
	NroCircun?: string | number;
	TipoCircun?: string;
	NomCircun?: string;
	latitud?: string | number;
	longitud?: string | number;
	mesas?: Mesa[];
};

const now = () => new Date();
const norm = (s?: unknown) => (s ?? "").toString().trim().replace(/\s+/g, " ");
const toInt = (v: unknown, d = 0) => {
	const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
	return Number.isFinite(n) ? n : d;
};
const toFloat = (v: unknown, d = 0) => {
	const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
	return Number.isFinite(n) ? n : d;
};

const depCache = new Map<string, Types.ObjectId>();
const provCache = new Map<string, Types.ObjectId>();
const muniCache = new Map<string, Types.ObjectId>();
const seatCache = new Map<string, Types.ObjectId>();
const locCache = new Map<string, Types.ObjectId>();

let Departments: Collection<Document>;
let Provinces: Collection<Document>;
let Municipalities: Collection<Document>;
let Seats: Collection<Document>;
let Locations: Collection<Document>;
let Tables: Collection<Document>;

async function upsertGetId(
	coll: Collection<Document>,
	filter: Record<string, unknown>,
	setOnInsert: Record<string, unknown>,
	set: Record<string, unknown>,
): Promise<Types.ObjectId> {
	for (const k of Object.keys(setOnInsert)) {
		if (k in set) delete (setOnInsert as any)[k];
	}
	await coll.updateOne(filter, { $setOnInsert: setOnInsert, $set: set }, { upsert: true });
	const doc = await coll.findOne(filter, { projection: { _id: 1 } });
	if (!doc?._id) throw new Error(`Upsert failed for ${coll.collectionName}`);
	return doc._id as Types.ObjectId;
}

async function upsertDepartment(nameRaw: string) {
	const name = norm(nameRaw);
	const cached = depCache.get(name);
	if (cached) return cached;
	const id = await upsertGetId(
		Departments,
		{ name },
		{ _id: new Types.ObjectId(), name, active: true, createdAt: now() },
		{ updatedAt: now() },
	);
	depCache.set(name, id);
	return id;
}

async function upsertProvince(depId: Types.ObjectId, nameRaw: string) {
	const name = norm(nameRaw);
	const key = `${String(depId)}|${name}`;
	const cached = provCache.get(key);
	if (cached) return cached;
	const id = await upsertGetId(
		Provinces,
		{ departmentId: depId, name },
		{ _id: new Types.ObjectId(), departmentId: depId, name, active: true, createdAt: now() },
		{ updatedAt: now() },
	);
	provCache.set(key, id);
	return id;
}

async function upsertMunicipality(provId: Types.ObjectId, nameRaw: string) {
	const name = norm(nameRaw);
	const key = `${String(provId)}|${name}`;
	const cached = muniCache.get(key);
	if (cached) return cached;
	const id = await upsertGetId(
		Municipalities,
		{ provinceId: provId, name },
		{ _id: new Types.ObjectId(), provinceId: provId, name, active: true, createdAt: now() },
		{ updatedAt: now() },
	);
	muniCache.set(key, id);
	return id;
}

async function upsertSeat(muniId: Types.ObjectId, idLocRaw: string, seatNameRaw: string) {
	const idLoc = norm(idLocRaw);
	const name = norm(seatNameRaw);
	const key = `${String(muniId)}|${idLoc}`;
	const cached = seatCache.get(key);
	if (cached) return cached;
	const id = await upsertGetId(
		Seats,
		{ municipalityId: muniId, idLoc },
		{ _id: new Types.ObjectId(), municipalityId: muniId, idLoc, active: true, createdAt: now() },
		{ name, updatedAt: now() },
	);
	seatCache.set(key, id);
	return id;
}

function buildCircunscripcion(row: InputRow) {
	const number = toInt(row.NroCircun, 0);
	const type = (norm(row.TipoCircun) as "Especial" | "Uninominal") || "Uninominal";
	const name = norm(row.NomCircun) || `${type} ${number || ""}`.trim();
	return { number, type, name };
}

function buildGeo(row: InputRow) {
	const lat = toFloat(row.latitud, 0);
	const lon = toFloat(row.longitud, 0);
	return {
		coordinates: { latitude: lat, longitude: lon },
		geo: { type: "Point", coordinates: [lon, lat] as [number, number] },
	};
}

async function upsertLocation(seatId: Types.ObjectId, row: InputRow) {
	const code = norm(row.Reci);
	const name = norm(row.NombreReci);
	const key = `${String(seatId)}|${code}`;
	const cached = locCache.get(key);
	if (cached) return cached;

	const district = norm(row.NomDist || "");
	const zone = norm(row.NomZona || "");
	const address = norm(row.Direccion || "");
	const circunscripcion = buildCircunscripcion(row);
	const { coordinates, geo } = buildGeo(row);

	const id = await upsertGetId(
		Locations,
		{ electoralSeatId: seatId, code },
		{ _id: new Types.ObjectId(), electoralSeatId: seatId, code, active: true, createdAt: now() },
		{
			name,
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

async function upsertTable(locId: Types.ObjectId, m: Mesa) {
	const tableCode = norm(m.codigo_mesa);
	const tableNumber = String(m.num_mesa);
	const enabledVoters = toInt(m.habilitados, 0);
	const disabledVoters = toInt(m.inhabilitados, 0);

	await Tables.updateOne(
		{ tableCode },
		{
			$setOnInsert: { _id: new Types.ObjectId(), active: true, createdAt: now() },
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

export async function seedLocations(conn: Connection) {
	const db = conn.db;
	if (!db) throw new Error("Connection not initialized");

	Departments = db.collection("departments");
	Provinces = db.collection("provinces");
	Municipalities = db.collection("municipalities");
	Seats = db.collection("electoral_seats");
	Locations = db.collection("electoral_locations");
	Tables = db.collection("electoral_tables");

	const dataFile = path.join(process.cwd(), "final_data_replaced.json");
	const raw = fs.readFileSync(dataFile, "utf8");
	const rows = JSON.parse(raw) as InputRow[];

	for (const row of rows) {
		const depId = await upsertDepartment(row.NomDep);
		const provId = await upsertProvince(depId, row.NomProv);
		const muniId = await upsertMunicipality(provId, row.NombreMuni);
		const seatId = await upsertSeat(muniId, row.IdLoc, row.AsientoEle);
		const locId = await upsertLocation(seatId, row);

		for (const m of row.mesas || []) {
			await upsertTable(locId, m);
		}
	}
}
