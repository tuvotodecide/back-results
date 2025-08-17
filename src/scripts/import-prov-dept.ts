/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Types } from 'mongoose';

import { DepartmentService } from '../modules/geographic/services/department.service';
import { ProvinceService } from '../modules/geographic/services/province.service';
import { MunicipalityService } from '../modules/geographic/services/municipality.service';
import { ElectoralSeatService } from '../modules/geographic/services/electoral-seat.service';
import { ElectoralLocationService } from '../modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '../modules/geographic/services/electoral-table.service';

// ---------- Tipos de entrada ----------
type MesaInput = {
  codigo_mesa: string;
  num_mesa: number;
  habilitados: number;
  inhabilitados: number;
};

type RowInput = {
  FID: string;
  NomDep: string;
  NomProv: string;
  NombreMuni: string;
  IdLoc: string;
  AsientoEle: string;
  Reci: string;
  NombreReci: string;
  NomDist: string;
  NomZona: string;
  Direccion: string;
  NroCircun: string;
  TipoCircun: string;
  NomCircun: string;
  latitud: string;
  longitud: string;
  x: string;
  y: string;
  mesas: MesaInput[];
};

// ---------- Tipos para servicios ----------
type RecintoUpsert = {
  code: string;
  name: string;
  district?: string;
  zone?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  circNumber?: string;
  circType?: string;
  circName?: string;
};

type MesaUpsert = {
  code: string;
  number: number;
  habilitados: number;
  inhabilitados: number;
};

// ---------- Utilidades ----------
function parseArgs() {
  const args = process.argv.slice(2);
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out['dryRun'] = true;
    else if (a === '--file') {
      out['file'] = args[i + 1];
      i++;
    }
  }
  if (!out['file']) {
    console.error('❌ Debes pasar --file <ruta.json>');
    process.exit(1);
  }
  return { file: String(out['file']), dryRun: Boolean(out['dryRun']) };
}

const normName = (s: string) => (s || '').trim().replace(/\s+/g, ' ');
const normCode = (s: string | number) => String(s ?? '').trim();
const toNum = (v: unknown): number | undefined => {
  const n =
    typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

// ---------- Script principal ----------
async function main() {
  const { file, dryRun } = parseArgs();
  const abs = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(abs, 'utf8');
  const rows: RowInput[] = JSON.parse(raw);

  // ---- 1) Agregar y agrupar datos desde el JSON (para lotes) ----
  const depNames = new Set<string>();
  const provsByDep = new Map<string, Set<string>>();
  const munisByDepProv = new Map<string, Set<string>>(); // key: dep|prov -> set muni
  const seatsByMuniKey = new Map<string, Set<string>>(); // key: dep|prov|muni -> set seat
  const recintosBySeatKey = new Map<string, Map<string, RecintoUpsert>>(); // key: dep|prov|muni|seat -> code -> payload
  const mesasByPrecinctKey = new Map<string, MesaUpsert[]>(); // key: dep|prov|muni|seat|code

  const SEP = '¦'; // separador poco común para llaves compuestas

  for (const r of rows) {
    const dep = normName(r.NomDep);
    if (!dep) continue;
    const prov = normName(r.NomProv);
    const muni = normName(r.NombreMuni);
    const seat = normName(r.AsientoEle);
    const reciCode = normCode(r.Reci);
    const reciName = normName(r.NombreReci);

    depNames.add(dep);
    if (prov) {
      if (!provsByDep.has(dep)) provsByDep.set(dep, new Set());
      provsByDep.get(dep)!.add(prov);
    }

    if (prov && muni) {
      const keyDepProv = `${dep}${SEP}${prov}`;
      if (!munisByDepProv.has(keyDepProv))
        munisByDepProv.set(keyDepProv, new Set());
      munisByDepProv.get(keyDepProv)!.add(muni);
    }

    if (prov && muni && seat) {
      const keyMuni = `${dep}${SEP}${prov}${SEP}${muni}`;
      if (!seatsByMuniKey.has(keyMuni)) seatsByMuniKey.set(keyMuni, new Set());
      seatsByMuniKey.get(keyMuni)!.add(seat);

      // Recintos por asiento
      const keySeat = `${keyMuni}${SEP}${seat}`;
      if (!recintosBySeatKey.has(keySeat))
        recintosBySeatKey.set(keySeat, new Map());

      if (reciCode) {
        const payload: RecintoUpsert = {
          code: reciCode,
          name: reciName,
          district: normName(r.NomDist),
          zone: normName(r.NomZona),
          address: normName(r.Direccion),
          latitude: toNum(r.latitud),
          longitude: toNum(r.longitud),
          circNumber: normCode(r.NroCircun),
          circType: normName(r.TipoCircun),
          circName: normName(r.NomCircun),
        };
        // deduplicación por code: mantener el más “completo”
        const current = recintosBySeatKey.get(keySeat)!.get(reciCode);
        if (!current) {
          recintosBySeatKey.get(keySeat)!.set(reciCode, payload);
        } else {
          // merge simple: preferir campos nuevos no vacíos
          recintosBySeatKey.get(keySeat)!.set(reciCode, {
            ...current,
            ...Object.fromEntries(
              Object.entries(payload).filter(
                ([_, v]) =>
                  v !== undefined && v !== null && String(v).trim() !== '',
              ),
            ),
          });
        }

        // Mesas por recinto
        if (Array.isArray(r.mesas)) {
          const pKey = `${keySeat}${SEP}${reciCode}`;
          if (!mesasByPrecinctKey.has(pKey)) mesasByPrecinctKey.set(pKey, []);
          for (const m of r.mesas) {
            const mesa: MesaUpsert = {
              code: normCode(m.codigo_mesa),
              number: toNum(m.num_mesa) ?? 0,
              habilitados: toNum(m.habilitados) ?? 0,
              inhabilitados: toNum(m.inhabilitados) ?? 0,
            };
            if (!mesa.code && mesa.number <= 0) {
              console.warn(`⚠️ Mesa omitida por datos inválidos en ${pKey}`);
              continue;
            }
            mesasByPrecinctKey.get(pKey)!.push(mesa);
          }
        }
      } else {
        console.warn(
          `⚠️ Recinto SIN código (Reci) en: ${dep} / ${prov} / ${muni} / ${seat} -> "${reciName}". Se omitirá.`,
        );
      }
    }
  }

  // Stats preliminares
  const totalProvU = [...provsByDep.values()].reduce((a, s) => a + s.size, 0);
  const totalMuniU = [...munisByDepProv.values()].reduce(
    (a, s) => a + s.size,
    0,
  );
  const totalSeatU = [...seatsByMuniKey.values()].reduce(
    (a, s) => a + s.size,
    0,
  );
  const totalRecintosU = [...recintosBySeatKey.values()].reduce(
    (a, m) => a + m.size,
    0,
  );
  const totalMesasU = [...mesasByPrecinctKey.values()].reduce(
    (a, arr) => a + arr.length,
    0,
  );

  console.log(`🧭 Departamentos únicos: ${depNames.size}`);
  console.log(`🧭 Provincias únicas:    ${totalProvU}`);
  console.log(`🧭 Municipios únicos:    ${totalMuniU}`);
  console.log(`🧭 Asientos únicos:      ${totalSeatU}`);
  console.log(`🧭 Recintos únicos:      ${totalRecintosU}`);
  console.log(`🧭 Mesas totales:        ${totalMesasU}`);

  // ---- 2) Levantar Nest y usar tus servicios ----
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  try {
    const departmentService = app.get(DepartmentService);
    const provinceService = app.get(ProvinceService);
    const municipalityService = app.get(MunicipalityService);
    const seatService = app.get(ElectoralSeatService);
    const locationService = app.get(ElectoralLocationService);
    const tableService = app.get(ElectoralTableService);

    // ---- 3) Departments ----
    let depMap: Map<string, any>;
    if (dryRun) {
      console.log('🔎 [DRY-RUN] bulkEnsure Departments…');
      depMap = new Map(
        [...depNames].map((name) => [
          name,
          { _id: new Types.ObjectId(), name },
        ]),
      );
    } else {
      depMap = await departmentService.bulkEnsure([...depNames]);
    }

    // ---- 4) Provinces (por depto) ----
    const provMapByDep = new Map<string, Map<string, any>>(); // depName -> (provName -> doc)
    for (const [depName, setOfProv] of provsByDep.entries()) {
      const depDoc = depMap.get(depName);
      if (!depDoc?._id) {
        console.warn(`⚠️ Department no resuelto: ${depName}`);
        continue;
      }
      const names = [...setOfProv];

      const map = dryRun
        ? new Map(
            names.map((n) => [
              n,
              { _id: new Types.ObjectId(), name: n, departmentId: depDoc._id },
            ]),
          )
        : await provinceService.bulkEnsureByDept(depDoc._id, names); // (name -> doc)

      provMapByDep.set(depName, map);
    }

    // ---- 5) Municipalities (por provincia) ----
    const muniMapByDepProv = new Map<string, Map<string, any>>(); // key dep|prov -> (muniName -> doc)
    for (const [keyDepProv, muniSet] of munisByDepProv.entries()) {
      const [depName, provName] = keyDepProv.split(SEP);
      const provDoc = provMapByDep.get(depName)?.get(provName);
      if (!provDoc?._id) {
        console.warn(`⚠️ Provincia no resuelta: ${depName} / ${provName}`);
        continue;
      }
      const names = [...muniSet];

      const map = dryRun
        ? new Map(
            names.map((n) => [
              n,
              { _id: new Types.ObjectId(), name: n, provinceId: provDoc._id },
            ]),
          )
        : await municipalityService.bulkEnsureByProvince(provDoc._id, names);

      muniMapByDepProv.set(keyDepProv, map);
    }

    // ---- 6) Seats (por municipio) ----
    const seatMapByMuniKey = new Map<string, Map<string, any>>(); // key dep|prov|muni -> (seatName -> doc)
    for (const [keyMuni, seatSet] of seatsByMuniKey.entries()) {
      const [depName, provName, muniName] = keyMuni.split(SEP);
      const muniDoc = muniMapByDepProv
        .get(`${depName}${SEP}${provName}`)
        ?.get(muniName);
      if (!muniDoc?._id) {
        console.warn(
          `⚠️ Municipio no resuelto: ${depName} / ${provName} / ${muniName}`,
        );
        continue;
      }
      const names = [...seatSet];

      const map = dryRun
        ? new Map(
            names.map((n) => [
              n,
              {
                _id: new Types.ObjectId(),
                name: n,
                municipalityId: muniDoc._id,
              },
            ]),
          )
        : await seatService.bulkEnsureByMunicipality(muniDoc._id, names);

      seatMapByMuniKey.set(keyMuni, map);
    }

    // ---- 7) Locations (recintos) por seat + Mesas por recinto ----
    let totalRecintos = 0;
    let totalMesas = 0;

    for (const [keySeat, recintosMap] of recintosBySeatKey.entries()) {
      const [depName, provName, muniName, seatName] = keySeat.split(SEP);
      const seatDoc = seatMapByMuniKey
        .get(`${depName}${SEP}${provName}${SEP}${muniName}`)
        ?.get(seatName);
      if (!seatDoc?._id) {
        console.warn(
          `⚠️ Asiento no resuelto: ${depName} / ${provName} / ${muniName} / ${seatName}`,
        );
        continue;
      }

      const recintosArr = [...recintosMap.values()];
      totalRecintos += recintosArr.length;

      // Upsert de recintos por asiento
      const locMapByCode = dryRun
        ? new Map(
            recintosArr.map((r) => [
              r.code,
              { _id: new Types.ObjectId(), code: r.code, seatId: seatDoc._id },
            ]),
          )
        : await locationService.bulkUpsertBySeat(seatDoc._id, recintosArr); // (code -> doc)

      // Para cada recinto, insertar/bulk las mesas
      for (const [code, locDoc] of locMapByCode.entries()) {
        const pKey = `${keySeat}${SEP}${code}`;
        const mesas = mesasByPrecinctKey.get(pKey) ?? [];
        if (!mesas.length) continue;

        totalMesas += mesas.length;

        if (dryRun) {
          console.log(
            `🔎 [DRY-RUN] Mesas (${mesas.length}) -> Recinto ${code} (${depName}/${provName}/${muniName}/${seatName})`,
          );
        } else {
          await tableService.bulkUpsertByPrecinct(locDoc._id, mesas);
        }
      }
    }

    // ---- Resumen ----
    console.log(
      `\n✅ ${dryRun ? 'Simulación completada' : 'Migración completada'}.`,
    );
    console.log(`   Departamentos: ${depNames.size}`);
    console.log(`   Provincias:    ${totalProvU}`);
    console.log(`   Municipios:    ${totalMuniU}`);
    console.log(`   Asientos:      ${totalSeatU}`);
    console.log(`   Recintos:      ${totalRecintos}`);
    console.log(`   Mesas:         ${totalMesas}`);
  } catch (err) {
    console.error('❌ Error en la migración:', err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
