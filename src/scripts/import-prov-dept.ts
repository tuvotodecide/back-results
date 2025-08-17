import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Types } from 'mongoose';

import { DepartmentService } from '../modules/geographic/services/department.service';
import { ProvinceService } from '../modules/geographic/services/province.service';

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

async function main() {
  const { file, dryRun } = parseArgs();
  const abs = path.resolve(process.cwd(), file);
  const raw = await fs.readFile(abs, 'utf8');
  const rows: RowInput[] = JSON.parse(raw);

  // 1) Pre-agrupar info necesaria (solo Dep y Prov en esta fase)
  const depNames = new Set<string>();
  const provsByDep = new Map<string, Set<string>>();

  for (const r of rows) {
    const dep = normName(r.NomDep);
    const prov = normName(r.NomProv);
    if (!dep) continue;
    depNames.add(dep);
    if (prov) {
      if (!provsByDep.has(dep)) provsByDep.set(dep, new Set<string>());
      provsByDep.get(dep)!.add(prov);
    }
  }

  console.log(`🧭 Departamentos únicos: ${depNames.size}`);
  const totalProvU = [...provsByDep.values()].reduce((a, s) => a + s.size, 0);
  console.log(`🧭 Provincias únicas (agrupadas): ${totalProvU}`);

  // 2) Levantar Nest y usar TUS SERVICIOS
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  try {
    const departmentService = app.get(DepartmentService);
    const provinceService = app.get(ProvinceService);

    // 3) Crear/Asegurar Departamentos
    let depMap: Map<string, any> = new Map();
    if (dryRun) {
      console.log('🔎 [DRY-RUN] Simulando bulkEnsure de departamentos…');
      // Simulación: crear un map ficticio con _id fake
      depMap = new Map(
        [...depNames].map((name, i) => [
          name,
          { _id: new Types.ObjectId(), name },
        ]),
      );
    } else {
      depMap = await departmentService.bulkEnsure([...depNames]);
    }

    // 4) Crear/Asegurar Provincias por Departamento
    let provCounter = 0;
    for (const [depName, provSet] of provsByDep.entries()) {
      const depDoc = depMap.get(depName);
      if (!depDoc || !depDoc._id) {
        console.warn(
          `⚠️ Department no resuelto: "${depName}". Se omiten sus provincias.`,
        );
        continue;
      }
      const departmentId: Types.ObjectId = depDoc._id;

      const provNames = [...provSet];
      provCounter += provNames.length;

      if (dryRun) {
        console.log(
          `🔎 [DRY-RUN] Provincias para "${depName}" (${provNames.length}): ${provNames.join(', ')}`,
        );
      } else {
        await provinceService.bulkEnsureByDept(departmentId, provNames);
      }
    }

    console.log(
      `\n✅ ${dryRun ? 'Simulación completada' : 'Migración completada'}.`,
    );
    console.log(`   Departamentos procesados: ${depNames.size}`);
    console.log(`   Provincias procesadas:    ${provCounter}`);
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
