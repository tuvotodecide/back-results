// scripts/seed-big-mock.js
// node scripts/seed-big-mock.js
/* eslint-disable no-console */
const { MongoClient, ObjectId } = require('mongodb');

// ========= CONFIG AJUSTABLE =========
const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/electoral_db';
const DB_NAME = process.env.DB_NAME || 'electoral_db';

// Escala geográfica
const N_DEPARTMENTS = Number(process.env.N_DEPARTMENTS || 9);
const N_PROVINCES = Number(process.env.N_PROVINCES || 3);
const N_MUNICIPAL = Number(process.env.N_MUNICIPAL || 2);
const N_SEATS = Number(process.env.N_SEATS || 2);
const N_LOCATIONS = Number(process.env.N_LOCATIONS || 3);
const TABLES_PER_LOC = Number(process.env.TABLES_PER_LOC || 30);

// Porcentajes de casos
const P_CONSENSUAL = 0.6; // 60%: 1 versión => ya resueltas (CONSENSUAL)
const P_2VERS = 0.3; // 30%: 2 versiones => PENDING (resuelve on-chain)
const P_3VERS = 0.1; // 10%: 3 versiones => VERIFYING (resuelve on-chain)
const P_OBSERVED = 0.02; // 2% de mesas observadas por elección

// Partidos (ids como strings; en tus pipelines no haces $lookup)
const PRES_PARTIES = ['PRES-P1', 'PRES-P2', 'PRES-P3', 'PRES-P4', 'PRES-P5'];
const DEP_PARTIES = [
  'DEP-P1',
  'DEP-P2',
  'DEP-P3',
  'DEP-P4',
  'DEP-P5',
  'DEP-P6',
  'DEP-P7',
];

// ========= HELPERS =========
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;

function distVotes(partyIds, baseVoters) {
  // Reparte votos válidos entre partidos y genera nulos/blancos razonables
  const nullVotes = rand(
    Math.floor(baseVoters * 0.01),
    Math.floor(baseVoters * 0.04),
  );
  const blankVotes = rand(
    Math.floor(baseVoters * 0.01),
    Math.floor(baseVoters * 0.03),
  );
  let remaining = baseVoters - nullVotes - blankVotes;
  if (remaining < partyIds.length) remaining = partyIds.length;

  // Genera pesos aleatorios y normaliza
  const weights = partyIds.map(() => Math.random());
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) =>
    Math.max(1, Math.round((w / wsum) * remaining)),
  ); // al menos 1

  // Ajusta suma exacta
  const diff = raw.reduce((a, b) => a + b, 0) - remaining;
  // corrige restando/ sumando del primero
  raw[0] = raw[0] - diff;

  const partyVotes = partyIds.map((pid, i) => ({
    partyId: pid,
    votes: raw[i],
  }));
  const validVotes = partyVotes.reduce((a, b) => a + b.votes, 0);

  return { validVotes, nullVotes, blankVotes, partyVotes };
}

function circunscripcionTag(deptIndex) {
  // ejemplo simple para poblar campos usados en tus consultas por circunscripción
  const number = (deptIndex % 10) + 1;
  const types = ['uninominal', 'plurinominal'];
  return {
    type: types[deptIndex % 2],
    number,
    name: `${types[deptIndex % 2]}-${number}`,
  };
}

// ========= MAIN =========
(async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  const colDepartments = db.collection('departments');
  const colProvinces = db.collection('provinces');
  const colMunicip = db.collection('municipalities');
  const colSeats = db.collection('electoral_seats');
  const colLocations = db.collection('electoral_locations');
  const colTables = db.collection('electoral_tables');
  const colBallots = db.collection('ballots');
  const colCases = db.collection('attestation_cases');
  const colElections = db.collection('election_configs'); // si no existe, se creará

  console.log('>> Limpiando colecciones principales...');
  await Promise.all([
    colDepartments.deleteMany({}),
    colProvinces.deleteMany({}),
    colMunicip.deleteMany({}),
    colSeats.deleteMany({}),
    colLocations.deleteMany({}),
    colTables.deleteMany({}),
    colBallots.deleteMany({}),
    colCases.deleteMany({}),
    // colElections.deleteMany({})  // si no quieres limpiar elecciones, comenta esto
  ]);

  // ====== 2.1 Crear elecciones (opcional pero útil) ======
  const now = new Date();
  const presi = {
    _id: new ObjectId(),
    name: 'Eleccion Presidencial MOCK',
    type: 'presidential',
    round: 1,
    timezone: 'America/La_Paz',
    votingStartDate: new Date(now.getTime() - 48 * 3600 * 1000),
    votingEndDate: new Date(now.getTime() - 24 * 3600 * 1000),
    resultsStartDate: new Date(now.getTime() - 24 * 3600 * 1000),
    isActive: false, // usaremos electionId explícito en queries
    allowDataModification: true,
    createdAt: now,
    updatedAt: now,
  };
  const deputies = {
    _id: new ObjectId(),
    name: 'Eleccion Diputados MOCK',
    type: 'deputies',
    round: 1,
    timezone: 'America/La_Paz',
    votingStartDate: new Date(now.getTime() - 48 * 3600 * 1000),
    votingEndDate: new Date(now.getTime() - 24 * 3600 * 1000),
    resultsStartDate: new Date(now.getTime() - 24 * 3600 * 1000),
    isActive: false,
    allowDataModification: true,
    createdAt: now,
    updatedAt: now,
  };
  await colElections.insertMany([presi, deputies]);

  console.log('>> Elections creadas:');
  console.log('   presidential electionId =', presi._id.toString());
  console.log('   deputies     electionId =', deputies._id.toString());

  // ====== 2.2 Geografía extensa y mesas ======
  console.log('>> Generando geografía y mesas...');
  const depDocs = [];
  for (let d = 0; d < N_DEPARTMENTS; d++) {
    depDocs.push({
      _id: new ObjectId(),
      name: `Depto-${d + 1}`,
      code: `D${d + 1}`,
      createdAt: now,
      updatedAt: now,
    });
  }
  await colDepartments.insertMany(depDocs);

  const provDocs = [];
  const munDocs = [];
  const seatDocs = [];
  const locDocs = [];
  const tableDocs = [];

  let tableCounter = 0;

  for (let d = 0; d < N_DEPARTMENTS; d++) {
    const dep = depDocs[d];
    for (let p = 0; p < N_PROVINCES; p++) {
      const prov = {
        _id: new ObjectId(),
        name: `Prov-${d + 1}-${p + 1}`,
        departmentId: dep._id,
        createdAt: now,
        updatedAt: now,
      };
      provDocs.push(prov);
      for (let m = 0; m < N_MUNICIPAL; m++) {
        const mun = {
          _id: new ObjectId(),
          name: `Mun-${d + 1}-${p + 1}-${m + 1}`,
          provinceId: prov._id,
          createdAt: now,
          updatedAt: now,
        };
        munDocs.push(mun);
        for (let s = 0; s < N_SEATS; s++) {
          const seat = {
            _id: new ObjectId(),
            idLoc: s + 1,
            name: `Asiento-${d + 1}-${p + 1}-${m + 1}-${s + 1}`,
            municipalityId: mun._id,
            createdAt: now,
            updatedAt: now,
          };
          seatDocs.push(seat);
          for (let l = 0; l < N_LOCATIONS; l++) {
            const loc = {
              _id: new ObjectId(),
              idLoc: l + 1, // ya lo tenías
              code: `LOC-${d + 1}-${p + 1}-${m + 1}-${s + 1}-${l + 1}`, // <<--- NUEVO
              name: `Recinto-${d + 1}-${p + 1}-${m + 1}-${s + 1}-${l + 1}`,
              electoralSeatId: seat._id,
              createdAt: now,
              updatedAt: now,
            };
            locDocs.push(loc);
            for (let t = 0; t < TABLES_PER_LOC; t++) {
              tableCounter++;
              const tableCode = `T-${d + 1}-${p + 1}-${m + 1}-${s + 1}-${l + 1}-${t + 1}`;
              tableDocs.push({
                _id: new ObjectId(),
                tableNumber: String(t + 1),
                tableCode,
                electoralLocationId: loc._id,
                observed: false,
                observedByElection: {}, // llenamos luego por elección
                active: true,
                createdAt: now,
                updatedAt: now,
              });
            }
          }
        }
      }
    }
  }

  // Inserciones en bulk
  await colProvinces.insertMany(provDocs);
  await colMunicip.insertMany(munDocs);
  await colSeats.insertMany(seatDocs);
  await colLocations.insertMany(locDocs);
  await colTables.insertMany(tableDocs);

  console.log(
    `>> Geografía creada: ${depDocs.length} departamentos, ${provDocs.length} provincias, ${munDocs.length} municipios, ${seatDocs.length} asientos, ${locDocs.length} recintos, ${tableDocs.length} mesas.`,
  );

  // ====== 2.3 Marcar mesas observadas por elección (pequeño %)
  function markObservedByElection(tablesArray, electionIdStr) {
    const total = tablesArray.length;
    const target = Math.max(1, Math.floor(total * P_OBSERVED));
    const picks = new Set();
    while (picks.size < target) picks.add(rand(0, total - 1));
    const ops = [];
    for (const idx of picks) {
      const t = tablesArray[idx];
      const key = `observedByElection.${electionIdStr}`;
      ops.push({
        updateOne: {
          filter: { _id: t._id },
          update: { $set: { [key]: true } },
        },
      });
    }
    return ops;
  }
  const obsOps = [
    ...markObservedByElection(tableDocs, presi._id.toString()),
    ...markObservedByElection(tableDocs, deputies._id.toString()),
  ];
  if (obsOps.length) await colTables.bulkWrite(obsOps, { ordered: false });

  // ====== 2.4 Generar BALLOTS y ATTESTATION CASES
  console.log('>> Generando ballots y attestation_cases (grande)...');

  const batchSize = 5000;
  const ballotOps = [];
  const caseOps = [];

  // mezcla mesas para variedad
  const shuffled = tableDocs.slice().sort(() => Math.random() - 0.5);

  const makeBallot = (
    table,
    election,
    version,
    createdSkewMin = 0,
    createdSkewMax = 24,
  ) => {
    const deptIndex = Number(table.tableCode.split('-')[1]) - 1; // D del código
    const circ = circunscripcionTag(deptIndex);
    // base de votantes por mesa (aleatorio pero estable)
    const baseVoters = rand(120, 320);

    const partiesVotes = distVotes(
      PRES_PARTIES,
      rand(baseVoters - 30, baseVoters + 30),
    );
    const depVotes = distVotes(
      DEP_PARTIES,
      rand(baseVoters - 30, baseVoters + 30),
    );

    const createdAt = new Date(
      now.getTime() - rand(createdSkewMin, createdSkewMax) * 3600 * 1000,
    );

    return {
      _id: new ObjectId(),
      electionId: election._id,
      tableCode: table.tableCode,
      version, // importante para tu pipeline
      status: chance(0.8) ? 'processed' : 'synced',
      valuable: false, // se pondrá true si es ganadora (pre-resueltas o tras on-chain)
      location: {
        department: `Depto-${deptIndex + 1}`,
        province: null, // no hace falta para sumar; el pipeline usa estos strings
        municipality: null,
        electoralSeat: null,
        electoralLocationName: null,
        circunscripcion: circ,
      },
      votes: {
        parties: partiesVotes,
        deputies: depVotes,
      },
      createdAt,
      updatedAt: createdAt,
    };
  };

  let consensualCount = 0;
  let pendingCount = 0;
  let verifyingCount = 0;

  for (const table of shuffled) {
    // Distribuye el tipo de caso por mesa y por elección (creamos para ambas elecciones)
    const forElections = [presi, deputies];
    for (const election of forElections) {
      const r = Math.random();
      if (r < P_CONSENSUAL) {
        // 1 versión => caso CONSENSUAL, ganadora conocida
        const b1 = makeBallot(table, election, 1);
        b1.valuable = true;

        ballotOps.push({ insertOne: { document: b1 } });
        caseOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              electionId: election._id,
              tableCode: table.tableCode,
              status: 'CONSENSUAL',
              winningBallotId: b1._id,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
        consensualCount++;
      } else if (r < P_CONSENSUAL + P_2VERS) {
        // 2 versiones => PENDING (que resuelva on-chain)
        const b1 = makeBallot(table, election, 1, 30, 48);
        const b2 = makeBallot(table, election, 2, 1, 24);
        // de momento ninguna es valuable; lo pondrá el listener tras el evento on-chain
        ballotOps.push({ insertOne: { document: b1 } });
        ballotOps.push({ insertOne: { document: b2 } });
        caseOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              electionId: election._id,
              tableCode: table.tableCode,
              status: 'PENDING',
              winningBallotId: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
        pendingCount++;
      } else {
        // 3 versiones => VERIFYING (también para on-chain)
        const b1 = makeBallot(table, election, 1, 40, 60);
        const b2 = makeBallot(table, election, 2, 20, 40);
        const b3 = makeBallot(table, election, 3, 0, 20);
        ballotOps.push({ insertOne: { document: b1 } });
        ballotOps.push({ insertOne: { document: b2 } });
        ballotOps.push({ insertOne: { document: b3 } });
        caseOps.push({
          insertOne: {
            document: {
              _id: new ObjectId(),
              electionId: election._id,
              tableCode: table.tableCode,
              status: 'VERIFYING',
              winningBallotId: null,
              createdAt: now,
              updatedAt: now,
            },
          },
        });
        verifyingCount++;
      }

      // flush batches para no reventar memoria
      if (ballotOps.length >= batchSize) {
        await colBallots.bulkWrite(ballotOps, { ordered: false });
        ballotOps.length = 0;
      }
      if (caseOps.length >= batchSize) {
        await colCases.bulkWrite(caseOps, { ordered: false });
        caseOps.length = 0;
      }
    }
  }

  if (ballotOps.length)
    await colBallots.bulkWrite(ballotOps, { ordered: false });
  if (caseOps.length) await colCases.bulkWrite(caseOps, { ordered: false });

  console.log(
    `>> Casos por eleccion: CONSENSUAL=${consensualCount}, PENDING=${pendingCount}, VERIFYING=${verifyingCount}`,
  );

  // ====== 2.5 Índices recomendados (no cambian tus nombres; solo aceleran)
  console.log('>> Creando índices recomendados (si no existen)...');
  await Promise.all([
    colTables.createIndex({ tableCode: 1 }, { unique: true }),
    colTables.createIndex({ electoralLocationId: 1 }),
    colTables.createIndex({ active: 1 }),

    colBallots.createIndex({ electionId: 1, status: 1, valuable: 1 }),
    colBallots.createIndex({ tableCode: 1, version: -1 }),
    colBallots.createIndex({ createdAt: -1 }),

    colCases.createIndex({ electionId: 1, tableCode: 1 }, { unique: true }),
    colCases.createIndex({ status: 1 }),
  ]);

  console.log('SEED COMPLETADO.');
  console.log('   Usa estos IDs para consultas:');
  console.log('   presidential electionId =', presi._id.toString());
  console.log('   deputies     electionId =', deputies._id.toString());

  await client.close();
})();
