import { MongoClient } from 'mongodb';

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL ||
  process.env.DB_URI;

function print(result) {
  console.log(JSON.stringify(result, null, 2));
}

if (!uri) {
  print({
    ready: false,
    status: 'NOT_READY',
    reason: 'MONGO_URI_NOT_CONFIGURED',
  });
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: Number(process.env.MONGO_CHECK_TIMEOUT_MS ?? 5000),
});

try {
  await client.connect();
  const admin = client.db().admin();
  const hello = await admin.command({ hello: 1 });
  const replicaSetName = hello.setName ?? null;
  if (!replicaSetName) {
    print({
      ready: false,
      status: 'NOT_READY',
      reason: 'MONGO_STANDALONE_TOPOLOGY',
    });
    process.exit(1);
  }

  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const collection = client.db().collection('__transaction_readiness_check');
      await collection.insertOne(
        {
          createdAt: new Date(),
          probe: 'institutional_transactions',
        },
        { session },
      );
      await collection.deleteOne({ probe: 'institutional_transactions' }, { session });
    });
  } finally {
    await session.endSession();
  }

  print({
    ready: true,
    status: 'READY',
    replicaSet: replicaSetName,
    transactions: true,
  });
} catch (error) {
  print({
    ready: false,
    status: 'NOT_READY',
    reason: error instanceof Error ? error.message.replace(uri, '[redacted-uri]') : String(error),
  });
  process.exit(1);
} finally {
  await client.close().catch(() => undefined);
}
