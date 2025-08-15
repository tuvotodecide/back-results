/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import * as mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Configurar variables de entorno
dotenv.config();

interface Mesa {
  codigo_mesa: string;
  num_mesa: number;
  habilitados: number;
  inhabilitados: number;
}

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
  mesas: Mesa[];
}

const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'departments' });

const ProvinceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  departmentId: { type: mongoose.Types.ObjectId, ref: 'Department', required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'provinces' });

const MunicipalitySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  provinceId: { type: mongoose.Types.ObjectId, ref: 'Province', required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'municipalities' });

const ElectoralSeatSchema = new mongoose.Schema({
  idLoc: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  municipalityId: { type: mongoose.Types.ObjectId, ref: 'Municipality', required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'electoral_seats' });

const ElectoralLocationSchema = new mongoose.Schema({
  fid: { type: String, trim: true },
  code: { type: String, required: true, trim: true },
  name: { type: String, required: true, trim: true },
  electoralSeatId: { type: mongoose.Types.ObjectId, ref: 'ElectoralSeat', required: true },
  address: { type: String, trim: true },
  district: { type: String, trim: true },
  zone: { type: String, trim: true },
  circunscripcion: {
    number: { type: Number, required: true },
    type: { type: String, required: true },
    name: { type: String, required: true },
  },
  coordinates: {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
  },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'electoral_locations' });

const ElectoralTableSchema = new mongoose.Schema({
  tableNumber: { type: String, required: true, trim: true },
  tableCode: { type: String, required: true, trim: true },
  electoralLocationId: { type: mongoose.Types.ObjectId, ref: 'ElectoralLocation', required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true, collection: 'electoral_tables' });

ElectoralTableSchema.index({ tableCode: 1 }, { unique: true });
ElectoralTableSchema.index({ electoralLocationId: 1, tableNumber: 1 }, { unique: true });

async function connectToDatabase() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27017/electoral_results?authSource=admin';
  
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Conectado a MongoDB');
  } catch (error) {
    console.error('❌ Error conectando a MongoDB:', error);
    process.exit(1);
  }
}

async function importElectoralDataDirect() {
  await connectToDatabase();

  const Department = mongoose.model('Department', DepartmentSchema);
  const Province = mongoose.model('Province', ProvinceSchema);
  const Municipality = mongoose.model('Municipality', MunicipalitySchema);
  const ElectoralSeat = mongoose.model('ElectoralSeat', ElectoralSeatSchema);
  const ElectoralLocation = mongoose.model('ElectoralLocation', ElectoralLocationSchema);
  const ElectoralTable = mongoose.model('ElectoralTable', ElectoralTableSchema);

  try {
    console.log('🚀 Iniciando importación de datos electorales con mesas...');

    /**
     * AQUI PONER EL NOMBRE DEL ARCHIVO QUE ESTA EN LA RAIZ DEL PROYECTO
     */
    const filePath = join(process.cwd(), 'missing_415_tables.json');
    const allData = JSON.parse(readFileSync(filePath, 'utf-8')) as ElectoralRecord[];

    const jsonData = allData.filter(
      (record) =>
        record.IdLoc &&
        record.IdLoc.trim() !== '' &&
        record.IdLoc !== 'null' &&
        record.IdLoc !== 'undefined',
    );

    console.log(`📄 Archivo leído: ${allData.length} registros totales, ${jsonData.length} con IdLoc válido`);

    // Contar mesas totales
    const totalMesas = jsonData.reduce((total, record) => {
      return total + (record.mesas ? record.mesas.length : 0);
    }, 0);

    console.log(`📊 Se procesarán ${totalMesas} mesas electorales`);

    const departments = [...new Set(jsonData.map((r) => r.NomDep))];
    const provinces = [...new Set(jsonData.map((r) => `${r.NomDep}|${r.NomProv}`))];
    const municipalities = [...new Set(jsonData.map((r) => `${r.NomDep}|${r.NomProv}|${r.NombreMuni}`))];
    const electoralSeats = [...new Set(jsonData.map((r) => `${r.NomDep}|${r.NomProv}|${r.NombreMuni}|${r.IdLoc}|${r.AsientoEle}`))];

    console.log(`📊 Entidades encontradas:
    - Departamentos: ${departments.length}
    - Provincias: ${provinces.length}
    - Municipios: ${municipalities.length}
    - Asientos Electorales: ${electoralSeats.length}
    - Recintos Electorales: ${jsonData.length}
    - Mesas Electorales: ${totalMesas}`);

    // 1. Insertar Departamentos
    console.log('1️⃣ Insertando departamentos...');
    const departmentMap = new Map();
    for (const depName of departments) {
      const result = await Department.findOneAndUpdate(
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

      const result = await Province.findOneAndUpdate(
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

      const result = await Municipality.findOneAndUpdate(
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
      const municipalityId = municipalityMap.get(`${depName}|${provName}|${muniName}`);

      const result = await ElectoralSeat.findOneAndUpdate(
        { idLoc, municipalityId },
        { idLoc, name: seatName, municipalityId, active: true },
        { upsert: true, new: true },
      );
      electoralSeatMap.set(seatKey, result._id);
    }
    console.log(`✅ ${electoralSeats.length} asientos electorales procesados`);

    // 5. Insertar Recintos Electorales
    console.log('5️⃣ Insertando recintos electorales...');
    const electoralLocationMap = new Map();
    let processed = 0;

    for (const record of jsonData) {
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
          number: parseInt(record.NroCircun) || 0,
          type: record.TipoCircun,
          name: record.NomCircun,
        },
        coordinates: {
          latitude: parseFloat(record.latitud) || 0,
          longitude: parseFloat(record.longitud) || 0,
        },
        active: true,
      };

      const result = await ElectoralLocation.findOneAndUpdate(
        { code: record.Reci },
        locationData,
        { upsert: true, new: true },
      );

      electoralLocationMap.set(record.Reci, result._id);
      processed++;

      if (processed % 50 === 0) {
        const percentage = Math.round((processed / jsonData.length) * 100);
        console.log(`   📍 Procesados ${processed}/${jsonData.length} recintos (${percentage}%)`);
      }
    }
    console.log(`✅ ${processed} recintos procesados`);

    // 6. Insertar Mesas Electorales
    console.log('6️⃣ Insertando mesas electorales...');
    let processedTables = 0;

    for (const record of jsonData) {
      if (!record.mesas || record.mesas.length === 0) continue;

      const electoralLocationId = electoralLocationMap.get(record.Reci);
      if (!electoralLocationId) {
        console.warn(`⚠️  No se encontró recinto para código: ${record.Reci}`);
        continue;
      }

      for (const mesa of record.mesas) {
        const mesaData = {
          tableNumber: mesa.num_mesa.toString(),
          tableCode: mesa.codigo_mesa,
          electoralLocationId,
          active: true,
        };

        try {
          await ElectoralTable.findOneAndUpdate(
            { tableCode: mesa.codigo_mesa },
            mesaData,
            { upsert: true, new: true },
          );
          processedTables++;
        } catch (error) {
          if (error.code !== 11000) { // Ignorar duplicados
            console.warn(`⚠️  Error insertando mesa ${mesa.codigo_mesa}:`, error.message);
          }
        }
      }

      if (processedTables % 100 === 0) {
        console.log(`   🗳️  Procesadas ${processedTables} mesas`);
      }
    }

    console.log('✅ Importación completada exitosamente');

    // Mostrar estadísticas finales
    const stats = {
      departments: await Department.countDocuments({ active: true }),
      provinces: await Province.countDocuments({ active: true }),
      municipalities: await Municipality.countDocuments({ active: true }),
      electoralSeats: await ElectoralSeat.countDocuments({ active: true }),
      electoralLocations: await ElectoralLocation.countDocuments({ active: true }),
      electoralTables: await ElectoralTable.countDocuments({ active: true }),
    };

    console.log(`
🎉 IMPORTACIÓN COMPLETADA EXITOSAMENTE
📊 Estadísticas finales:
   - Departamentos: ${stats.departments}
   - Provincias: ${stats.provinces}
   - Municipios: ${stats.municipalities}
   - Asientos Electorales: ${stats.electoralSeats}
   - Recintos Electorales: ${stats.electoralLocations}
   - Mesas Electorales: ${stats.electoralTables}
    `);

  } catch (error) {
    console.error('💥 Error fatal:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB');
  }
}

if (require.main === module) {
  importElectoralDataDirect()
    .then(() => {
      console.log('🏁 Proceso terminado exitosamente');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Error en el proceso:', error);
      process.exit(1);
    });
}