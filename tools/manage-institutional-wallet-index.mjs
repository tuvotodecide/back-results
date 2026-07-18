import { MongoClient } from 'mongodb';

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL ||
  process.env.DB_URI;

const command = process.argv[2] ?? 'preflight';
const apply = process.argv.includes('--apply');
const dryRun = !apply;
const validCommands = new Set([
  'preflight',
  'backfill',
  'create-index',
  'verify-index',
]);

function print(result) {
  console.log(JSON.stringify(result, null, 2));
}

function safeId(value) {
  return value ? String(value) : null;
}

function walletFingerprint(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized ? `${normalized.slice(0, 8)}...` : null;
}

function normalizeWallet(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
}

if (!validCommands.has(command)) {
  print({ ok: false, reason: 'INVALID_COMMAND', command });
  process.exit(1);
}

if (!uri) {
  print({ ok: false, reason: 'MONGO_URI_NOT_CONFIGURED' });
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: Number(process.env.MONGO_PREFLIGHT_TIMEOUT_MS ?? 5000),
});

try {
  await client.connect();
  const db = client.db();
  const assignments = db.collection('tenant_admin_assignments');

  const duplicateWallets = await assignments
    .aggregate([
      { $match: { accountAddress: { $nin: [null, ''] } } },
      {
        $addFields: {
          walletNormalized: {
            $toLower: { $trim: { input: '$accountAddress' } },
          },
        },
      },
      {
        $group: {
          _id: '$walletNormalized',
          count: { $sum: 1 },
          userIds: { $addToSet: '$userId' },
          assignmentIds: { $push: '$_id' },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
          $expr: { $gt: [{ $size: '$userIds' }, 1] },
        },
      },
    ])
    .toArray();

  if (command === 'preflight') {
    print({
      ok: duplicateWallets.length === 0,
      dryRun: true,
      duplicateWalletGroups: duplicateWallets.length,
      refs: duplicateWallets.slice(0, 20).map((row) => ({
        walletFingerprint: walletFingerprint(row._id),
        count: row.count,
        userCount: row.userIds.length,
        assignmentIds: row.assignmentIds.map(safeId).slice(0, 5),
      })),
    });
    process.exit(duplicateWallets.length === 0 ? 0 : 2);
  }

  if (command === 'backfill') {
    if (duplicateWallets.length > 0) {
      print({
        ok: false,
        dryRun,
        reason: 'DUPLICATE_WALLETS_BLOCK_BACKFILL',
        duplicateWalletGroups: duplicateWallets.length,
      });
      process.exit(2);
    }

    const candidates = await assignments
      .find({
        accountAddress: { $nin: [null, ''] },
        $or: [
          { accountAddressNormalized: null },
          { accountAddressNormalized: '' },
          { accountAddressNormalized: { $exists: false } },
        ],
      })
      .project({ _id: 1, accountAddress: 1 })
      .toArray();

    if (dryRun) {
      print({
        ok: true,
        dryRun: true,
        candidates: candidates.length,
        refs: candidates.slice(0, 20).map((row) => ({
          assignmentId: safeId(row._id),
          walletFingerprint: walletFingerprint(row.accountAddress),
        })),
      });
      process.exit(0);
    }

    let modified = 0;
    for (const row of candidates) {
      const result = await assignments.updateOne(
        { _id: row._id },
        { $set: { accountAddressNormalized: normalizeWallet(row.accountAddress) } },
      );
      modified += result.modifiedCount ?? 0;
    }
    print({ ok: true, dryRun: false, modified });
    process.exit(0);
  }

  if (command === 'create-index') {
    if (duplicateWallets.length > 0) {
      print({
        ok: false,
        dryRun,
        reason: 'DUPLICATE_WALLETS_BLOCK_INDEX',
        duplicateWalletGroups: duplicateWallets.length,
      });
      process.exit(2);
    }
    if (dryRun) {
      print({
        ok: true,
        dryRun: true,
        index: {
          key: { accountAddressNormalized: 1 },
          unique: true,
          partialFilterExpression: {
            accountAddressNormalized: { $exists: true, $type: 'string' },
          },
        },
      });
      process.exit(0);
    }
    await assignments.createIndex(
      { accountAddressNormalized: 1 },
      {
        name: 'accountAddressNormalized_1',
        unique: true,
        partialFilterExpression: {
          accountAddressNormalized: { $exists: true, $type: 'string' },
        },
      },
    );
    print({ ok: true, dryRun: false, created: true });
    process.exit(0);
  }

  const indexes = await assignments.indexes();
  const walletIndex = indexes.find(
    (index) =>
      index.key?.accountAddressNormalized === 1 &&
      index.unique === true,
  );
  print({
    ok: Boolean(walletIndex),
    dryRun: true,
    present: Boolean(walletIndex),
    indexName: walletIndex?.name ?? null,
  });
  process.exit(walletIndex ? 0 : 2);
} catch (error) {
  print({
    ok: false,
    dryRun,
    reason: error instanceof Error ? error.message.replace(uri, '[redacted-uri]') : String(error),
  });
  process.exit(1);
} finally {
  await client.close().catch(() => undefined);
}
