/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { NestFactory } from '@nestjs/core';
import { Model } from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Department } from '../modules/geographic/schemas/department.schema';
import { Municipality } from '../modules/geographic/schemas/municipality.schema';
import { Province } from '../modules/geographic/schemas/province.schema';
import { ElectoralSeat } from '../modules/geographic/schemas/electoral-seat.schema';
import { ElectoralLocation } from '../modules/geographic/schemas/electoral-location.schema';

// Configurar variables de entorno
import * as dotenv from 'dotenv';
dotenv.config();

interface ElectoralRecord {
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
}

async function importElectoralData() {
  const app = await NestFactory.createApplicationContext(AppModule);

  // Get models
  const departmentModel = app.get<Model<Department>>(
    getModelToken(Department.name),
  );
  const provinceModel = app.get<Model<Province>>(getModelToken(Province.name));
  const municipalityModel = app.get<Model<Municipality>>(
    getModelToken(Municipality.name),
  );
  const electoralSeatModel = app.get<Model<ElectoralSeat>>(
    getModelToken(ElectoralSeat.name),
  );
  const electoralLocationModel = app.get<Model<ElectoralLocation>>(
    getModelToken(ElectoralLocation.name),
  );

  try {
    console.log('🚀 Iniciando importación de datos electorales...');

    // SOLUCIÓN TEMPORAL: Eliminar índice único problemático
    console.log(
      '🔧 Eliminando índice único de code para permitir duplicados...',
    );
    try {
      await electoralLocationModel.collection.dropIndex('code_1');
      console.log('✅ Índice único eliminado');
    } catch (error) {
      console.log('⚠️  Índice no existía o ya fue eliminado');
    }

    // Leer archivo JSON
    const filePath = join(process.cwd(), 'consolidadoRecintosElectorales.json');
    const allData = JSON.parse(
      readFileSync(filePath, 'utf-8'),
    ) as ElectoralRecord[];

    // Filtrar solo registros con IdLoc válido
    const jsonData = allData.filter(
      (record) =>
        record.IdLoc &&
        record.IdLoc.trim() !== '' &&
        record.IdLoc !== 'null' &&
        record.IdLoc !== 'undefined',
    );

    console.log(
      `📄 Archivo leído: ${allData.length} registros totales, ${jsonData.length} con IdLoc válido`,
    );

    // Extraer entidades únicas
    const departments = [...new Set(jsonData.map((r) => r.NomDep))];
    const provinces = [
      ...new Set(jsonData.map((r) => `${r.NomDep}|${r.NomProv}`)),
    ];
    const municipalities = [
      ...new Set(
        jsonData.map((r) => `${r.NomDep}|${r.NomProv}|${r.NombreMuni}`),
      ),
    ];
    const electoralSeats = [
      ...new Set(
        jsonData.map(
          (r) =>
            `${r.NomDep}|${r.NomProv}|${r.NombreMuni}|${r.IdLoc}|${r.AsientoEle}`,
        ),
      ),
    ];

    console.log(`📊 Entidades encontradas:
    - Departamentos: ${departments.length}
    - Provincias: ${provinces.length}
    - Municipios: ${municipalities.length}
    - Asientos Electorales: ${electoralSeats.length}
    - Recintos Electorales: ${jsonData.length}`);

    // 1. Insertar Departamentos
    console.log('1️⃣ Insertando departamentos...');
    const departmentMap = new Map();
    for (const depName of departments) {
      const result = await departmentModel.findOneAndUpdate(
        { name: depName },
        { name: depName, active: true },
        { upsert: true, new: true },
      );
      departmentMap.set(depName, result._id);
    }
    console.log(`✅ ${departments.length} departamentos procesados`);

    // 2. Insertar Provincias
    console.log('2️⃣ Insertando provincias...');
    const provinceMap = new Map();
    for (const provKey of provinces) {
      const [depName, provName] = provKey.split('|');
      const departmentId = departmentMap.get(depName);

      const result = await provinceModel.findOneAndUpdate(
        { name: provName, departmentId },
        { name: provName, departmentId, active: true },
        { upsert: true, new: true },
      );
      provinceMap.set(provKey, result._id);
    }
    console.log(`✅ ${provinces.length} provincias procesadas`);

    // 3. Insertar Municipios
    console.log('3️⃣ Insertando municipios...');
    const municipalityMap = new Map();
    for (const muniKey of municipalities) {
      const [depName, provName, muniName] = muniKey.split('|');
      const provinceId = provinceMap.get(`${depName}|${provName}`);

      const result = await municipalityModel.findOneAndUpdate(
        { name: muniName, provinceId },
        { name: muniName, provinceId, active: true },
        { upsert: true, new: true },
      );
      municipalityMap.set(muniKey, result._id);
    }
    console.log(`✅ ${municipalities.length} municipios procesados`);

    // 4. Insertar Asientos Electorales
    console.log('4️⃣ Insertando asientos electorales...');
    const electoralSeatMap = new Map();
    for (const seatKey of electoralSeats) {
      const [depName, provName, muniName, idLoc, seatName] = seatKey.split('|');
      const municipalityId = municipalityMap.get(
        `${depName}|${provName}|${muniName}`,
      );

      const result = await electoralSeatModel.findOneAndUpdate(
        { idLoc, municipalityId },
        { idLoc, name: seatName, municipalityId, active: true },
        { upsert: true, new: true },
      );
      electoralSeatMap.set(seatKey, result._id);
    }
    console.log(`✅ ${electoralSeats.length} asientos electorales procesados`);

    // 5. Insertar Recintos Electorales en batches
    console.log('5️⃣ Insertando recintos electorales...');
    const batchSize = 100;
    let processed = 0;

    for (let i = 0; i < jsonData.length; i += batchSize) {
      const batch = jsonData.slice(i, i + batchSize);
      const operations: any[] = [];

      for (const record of batch) {
        const seatKey = `${record.NomDep}|${record.NomProv}|${record.NombreMuni}|${record.IdLoc}|${record.AsientoEle}`;
        const electoralSeatId = electoralSeatMap.get(seatKey);

        if (!electoralSeatId) {
          console.warn(`⚠️  No se encontró electoral seat para: ${seatKey}`);
          continue;
        }

        const locationData = {
          fid: record.FID,
          code: record.Reci,
          name: record.NombreReci,
          electoralSeatId,
          address: record.Direccion,
          district: record.NomDist,
          zone: record.NomZona,
          circunscripcion: {
            number: parseInt(record.NroCircun),
            type: record.TipoCircun,
            name: record.NomCircun,
          },
          coordinates: {
            latitude: parseFloat(record.latitud),
            longitude: parseFloat(record.longitud),
          },
          active: true,
        };

        operations.push({
          updateOne: {
            filter: { fid: record.FID },
            update: { $set: locationData },
            upsert: true,
          },
        });
      }

      await electoralLocationModel.bulkWrite(operations);
      processed += batch.length;

      const percentage = Math.round((processed / jsonData.length) * 100);
      console.log(
        `   📍 Procesados ${processed}/${jsonData.length} recintos (${percentage}%)`,
      );
    }

    console.log('✅ Importación completada exitosamente');

    // Mostrar estadísticas finales
    const stats = {
      departments: await departmentModel.countDocuments({ active: true }),
      provinces: await provinceModel.countDocuments({ active: true }),
      municipalities: await municipalityModel.countDocuments({ active: true }),
      electoralSeats: await electoralSeatModel.countDocuments({ active: true }),
      electoralLocations: await electoralLocationModel.countDocuments({
        active: true,
      }),
    };

    console.log(`
🎉 IMPORTACIÓN COMPLETADA EXITOSAMENTE
📊 Estadísticas finales:
   - Departamentos: ${stats.departments}
   - Provincias: ${stats.provinces}
   - Municipios: ${stats.municipalities}
   - Asientos Electorales: ${stats.electoralSeats}
   - Recintos Electorales: ${stats.electoralLocations}
    `);
  } catch (error) {
    console.error('💥 Error fatal:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  importElectoralData()
    .then(() => {
      console.log('🏁 Proceso terminado exitosamente');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Error en el proceso:', error);
      process.exit(1);
    });
}
