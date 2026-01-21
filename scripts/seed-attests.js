// /* eslint-disable no-console */
// const { MongoClient, ObjectId } = require('mongodb');
// const uid = (prefix, c, b, i) => `${prefix}:${c.tableCode}:v${b.version}:${i}`;

// const MONGO_URI =
//   process.env.MONGODB_URI ||
//   process.env.MONGO_URI ||
//   'mongodb://127.0.0.1:27017/electoral_db';
// const DB_NAME = (MONGO_URI.split('/').pop() || 'electoral_db').split('?')[0];

// const PICK_LIMIT_PER_STATUS = 50000; // mete attests a lo bestia

// // cuántos apoyos simulamos por mesa
// const USERS_WIN_MIN = 4,
//   USERS_WIN_MAX = 9;
// const JURIES_WIN_MIN = 1,
//   JURIES_WIN_MAX = 3;
// const USERS_NOISE_MAX = 2; // ruido a otras versiones

// function rand(min, max) {
//   return Math.floor(Math.random() * (max - min + 1)) + min;
// }

// async function main() {
//   const client = new MongoClient(MONGO_URI);
//   await client.connect();
//   const db = client.db(DB_NAME);

//   const colCases = db.collection('attestation_cases');
//   const colBallots = db.collection('ballots');
//   const colAtts = db.collection('attestations');

//   // Trae casos PENDING/VERIFYING
//   const cases = await colCases
//     .aggregate([
//       { $match: { status: { $in: ['PENDING', 'VERIFYING'] } } },
//       { $limit: PICK_LIMIT_PER_STATUS },
//     ])
//     .toArray();

//   console.log(`Casos seleccionados para attests: ${cases.length}`);

//   let inserted = 0;
//   const bulk = [];

//   for (const c of cases) {
//     const { electionId, tableCode } = c;

//     // Busca ballots de esa mesa/elección
//     const ballots = await colBallots
//       .find({ electionId, tableCode }, { projection: { _id: 1, version: 1 } })
//       .sort({ version: 1 })
//       .toArray();

//     if (!ballots.length) continue;

//     // Elegimos "ganadora" mock: v2 si hay 2 versiones; v3 si hay 3; si no, v1
//     const versions = ballots.map((b) => b.version).sort((a, b) => a - b);
//     const targetVersion = versions.includes(3)
//       ? 3
//       : versions.includes(2)
//         ? 2
//         : 1;

//     const targetBallot =
//       ballots.find((b) => b.version === targetVersion) || ballots[0];
//     const others = ballots.filter(
//       (b) => b._id.toString() !== targetBallot._id.toString(),
//     );

//     // Apoyos fuertes para la ganadora
//     const usersWin = rand(USERS_WIN_MIN, USERS_WIN_MAX);
//     const juriesWin = rand(JURIES_WIN_MIN, JURIES_WIN_MAX);

//     for (let i = 0; i < usersWin; i++) {
//       bulk.push({
//         insertOne: {
//           document: {
//             _id: new ObjectId(),
//             ballotId: targetBallot._id,
//             electionId,
//             tableCode,
//             userId: uid('user', c, targetBallot, i),
//             support: true,
//             isJury: false,
//             createdAt: new Date(),
//             updatedAt: new Date(),
//           },
//         },
//       });
//     }

//     for (let i = 0; i < juriesWin; i++) {
//       bulk.push({
//         insertOne: {
//           document: {
//             _id: new ObjectId(),
//             ballotId: targetBallot._id,
//             electionId,
//             tableCode,
//             userId: uid('jury', c, targetBallot, i),
//             support: true,
//             isJury: true,
//             createdAt: new Date(),
//             updatedAt: new Date(),
//           },
//         },
//       });
//     }

//     // Un poco de ruido a otras versiones (no-jury)
//     for (const ob of others) {
//       const noise = rand(0, USERS_NOISE_MAX);
//       for (let i = 0; i < noise; i++) {
//         bulk.push({
//           insertOne: {
//             document: {
//               _id: new ObjectId(),
//               ballotId: ob._id,
//               electionId,
//               tableCode,
//               userId: uid('noise', c, ob, i),
//               support: true,
//               isJury: false,
//               createdAt: new Date(),
//               updatedAt: new Date(),
//             },
//           },
//         });
//       }
//     }

//     if (bulk.length >= 5000) {
//       const r = await colAtts.bulkWrite(bulk, { ordered: false });
//       inserted += r.insertedCount || 0;
//       bulk.length = 0;
//     }
//   }

//   if (bulk.length) {
//     const r = await colAtts.bulkWrite(bulk, { ordered: false });
//     inserted += r.insertedCount || 0;
//   }

//   console.log(`✅ Attestations insertados: ${inserted}`);

//   // Muestra un conteo final
//   const cnt = await colAtts.estimatedDocumentCount();
//   console.log('Total attestations en la BD =', cnt);

//   await client.close();
// }

// main().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });
