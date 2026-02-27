/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function readCodesFile(path) {
  if (!path) return [];
  if (!fs.existsSync(path)) return [];
  const txt = fs.readFileSync(path, 'utf8');
  return txt
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildVotesFromTemplate(votes) {
  const clone = JSON.parse(JSON.stringify(votes || {}));
  const mutateCategory = (cat) => {
    if (!cat || !Array.isArray(cat.partyVotes) || cat.partyVotes.length === 0) return cat;
    const pv = cat.partyVotes.map((p) => ({ ...p }));
    let total = 0;
    for (const p of pv) {
      const base = Number(p.votes || 0);
      const delta = randomInt(-4, 6);
      p.votes = Math.max(1, base + delta);
      total += p.votes;
    }
    const nullVotes = randomInt(0, 6);
    const blankVotes = randomInt(0, 4);
    return {
      ...cat,
      partyVotes: pv,
      validVotes: total,
      nullVotes,
      blankVotes,
      totalVotes: total + nullVotes + blankVotes,
    };
  };
  clone.parties = mutateCategory(clone.parties);
  clone.deputies = mutateCategory(clone.deputies);
  return clone;
}

async function main() {
  const args = parseArgs(process.argv);
  const electionId = args.electionId || args.eid;
  if (!electionId) {
    console.error('Missing --electionId');
    process.exit(1);
  }

  const target = Number(args.target || args.targetBallots || 100000);
  const batchSize = Number(args.batchSize || 5000);
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/electoral_db';
  const dbName = process.env.DB_NAME;
  const codePrefix = String(args.prefix || 'PERF');
  const withCases = String(args.withCases || 'false').toLowerCase() === 'true';
  const codesFile = args.codesFile;

  await mongoose.connect(uri, dbName ? { dbName } : {});
  const db = mongoose.connection.db;
  const ballots = db.collection('ballots');
  const tables = db.collection('electoral_tables');
  const cases = db.collection('attestation_cases');

  const eid = toObjectId(electionId);

  const templateBallot =
    (await ballots.findOne({ electionId: eid, status: { $in: ['processed', 'synced'] } })) ||
    (await ballots.findOne({ status: { $in: ['processed', 'synced'] } }));
  if (!templateBallot) {
    throw new Error('No template ballot found. Seed at least 1 processed ballot first.');
  }

  const templateTable = await tables.findOne({ tableCode: templateBallot.tableCode });
  if (!templateTable) {
    throw new Error('Template electoral_table not found for template ballot.tableCode');
  }

  const existingCount = await ballots.countDocuments({ electionId: eid, version: 1 });
  const remaining = Math.max(0, target - existingCount);
  console.log(`electionId=${electionId}`);
  console.log(`existing version=1 ballots=${existingCount}`);
  console.log(`target=${target} remaining=${remaining}`);

  if (remaining === 0) {
    console.log('Nothing to insert.');
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  let inserted = 0;
  // Continue sequence from current volume to avoid regenerating existing codes
  // when the script is resumed with the same prefix.
  let seq = existingCount + 1;
  const preferredCodes = readCodesFile(codesFile);
  let preferredIndex = 0;

  while (inserted < remaining) {
    const take = Math.min(batchSize, remaining - inserted);
    const tableOps = [];
    const ballotOps = [];
    const caseOps = [];

    for (let i = 0; i < take; i += 1) {
      const n = seq + i;
      let code = preferredCodes[preferredIndex];
      if (code) {
        preferredIndex += 1;
      } else {
        code = `${codePrefix}${String(n).padStart(10, '0')}`;
      }
      // Debe ser único por electoralLocationId (índice único compuesto).
      // Usamos un valor derivado del código para evitar colisiones al escalar.
      const tableNumber = `TN-${code}`;
      const ballotId = new mongoose.Types.ObjectId();

      tableOps.push({
        updateOne: {
          filter: { tableCode: code },
          update: {
            $setOnInsert: {
              _id: new mongoose.Types.ObjectId(),
              tableNumber,
              tableCode: code,
              electoralLocationId: templateTable.electoralLocationId,
              observed: false,
              observedByElection: {},
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      });

      const doc = {
        _id: ballotId,
        tableNumber,
        tableCode: code,
        electionId: eid,
        electoralLocationId: templateBallot.electoralLocationId,
        location: templateBallot.location,
        votes: buildVotesFromTemplate(templateBallot.votes),
        ipfsUri: `ipfs://perf/${code}`,
        ipfsCid: `perf-${code}`,
        image: templateBallot.image || `https://example.com/perf/${code}.jpg`,
        recordId: `perf-rec-${code}`,
        tableIdIpfs: `perf-table-${code}`,
        hasObservation: false,
        status: 'processed',
        valuable: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };

      ballotOps.push({
        updateOne: {
          filter: { electionId: eid, tableCode: code, version: 1 },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      });

      if (withCases) {
        caseOps.push({
          updateOne: {
            filter: { electionId: eid, tableCode: code },
            update: {
              $setOnInsert: {
                _id: new mongoose.Types.ObjectId(),
                electionId: eid,
                tableCode: code,
                status: 'CONSENSUAL',
                winningBallotId: ballotId,
                resolvedAt: now,
                summary: { generated: true },
                createdAt: now,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        });
      }
    }

    if (tableOps.length) {
      await tables.bulkWrite(tableOps, { ordered: false });
    }
    if (ballotOps.length) {
      await ballots.bulkWrite(ballotOps, { ordered: false });
    }
    if (caseOps.length) {
      await cases.bulkWrite(caseOps, { ordered: false });
    }

    inserted += take;
    seq += take;
    console.log(`Inserted batch=${take} progress=${inserted}/${remaining}`);
  }

  const finalCount = await ballots.countDocuments({ electionId: eid, version: 1 });
  console.log(`Done. electionId=${electionId} version=1 ballots now=${finalCount}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
