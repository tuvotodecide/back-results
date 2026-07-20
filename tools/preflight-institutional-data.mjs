import { MongoClient } from 'mongodb';

const COLLECTIONS = Object.freeze({
  assignments: 'tenant_admin_assignments',
  applications: 'institutional_admin_applications',
  recoveryRequests: 'institutional_access_recovery_requests',
  users: 'roled_users',
  tenants: 'institutional_tenants',
  audit: 'institutional_audit_events',
});

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL ||
  process.env.DB_URI;

function safeId(value) {
  return value ? String(value) : null;
}

function summarizeRefs(rows, mapper) {
  return rows.slice(0, 20).map(mapper);
}

function category(count, severity, action, refs = []) {
  return {
    total: count,
    severity,
    action,
    refs,
  };
}

function print(result) {
  console.log(JSON.stringify(result, null, 2));
}

if (!uri) {
  print({
    ok: false,
    reason: 'MONGO_URI_NOT_CONFIGURED',
  });
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: Number(process.env.MONGO_PREFLIGHT_TIMEOUT_MS ?? 5000),
});

try {
  await client.connect();
  const db = client.db();
  const assignments = db.collection(COLLECTIONS.assignments);
  const applications = db.collection(COLLECTIONS.applications);
  const recoveryRequests = db.collection(COLLECTIONS.recoveryRequests);
  const users = db.collection(COLLECTIONS.users);
  const tenants = db.collection(COLLECTIONS.tenants);
  const audit = db.collection(COLLECTIONS.audit);

  const [
    assignmentsWithoutRole,
    assignmentsWithoutWallet,
    duplicatePrimaryGroups,
    inactivePrimaryRows,
    duplicateWalletGroups,
    usersWithoutDni,
    inconsistentRecoveryRequests,
    tenantsWithoutPrimary,
    approvedApplicationsWithoutWallet,
    auditWithoutTenant,
  ] = await Promise.all([
    assignments
      .find({
        active: true,
        $or: [{ institutionalRole: null }, { institutionalRole: { $exists: false } }],
      })
      .project({ _id: 1, tenantId: 1, userId: 1, status: 1, active: 1 })
      .toArray(),
    assignments
      .find({
        active: true,
        status: 'APPROVED',
        $or: [{ accountAddress: null }, { accountAddress: '' }, { accountAddress: { $exists: false } }],
      })
      .project({ _id: 1, tenantId: 1, userId: 1, institutionalRole: 1 })
      .toArray(),
    assignments
      .aggregate([
        { $match: { institutionalRole: 'PRIMARY', active: true } },
        { $group: { _id: '$tenantId', count: { $sum: 1 }, assignmentIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray(),
    assignments
      .find({
        institutionalRole: 'PRIMARY',
        active: true,
        status: { $ne: 'APPROVED' },
      })
      .project({ _id: 1, tenantId: 1, userId: 1, status: 1 })
      .toArray(),
    assignments
      .aggregate([
        {
          $match: {
            accountAddress: { $nin: [null, ''] },
          },
        },
        {
          $addFields: {
            walletNormalized: {
              $toLower: {
                $trim: { input: '$accountAddress' },
              },
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
      .toArray(),
    users
      .find({
        role: 'USER',
        $or: [{ dni: null }, { dni: '' }, { dni: { $exists: false } }],
      })
      .project({ _id: 1, active: 1 })
      .toArray(),
    recoveryRequests
      .find({
        status: 'APPROVED',
        $or: [
          { candidateUserId: null },
          { candidateAssignmentId: null },
          { resolvedAt: null },
        ],
      })
      .project({ _id: 1, tenantId: 1, status: 1 })
      .toArray(),
    assignments
      .aggregate([
        { $match: { active: true, status: 'APPROVED' } },
        {
          $group: {
            _id: '$tenantId',
            activeAdmins: { $sum: 1 },
            primaryCount: {
              $sum: {
                $cond: [{ $eq: ['$institutionalRole', 'PRIMARY'] }, 1, 0],
              },
            },
          },
        },
        { $match: { activeAdmins: { $gt: 0 }, primaryCount: 0 } },
      ])
      .toArray(),
    applications
      .find({
        status: 'APPROVED',
        $or: [{ accountAddress: null }, { accountAddress: '' }, { accountAddress: { $exists: false } }],
      })
      .project({ _id: 1, tenantId: 1, userId: 1, status: 1 })
      .toArray(),
    audit
      .find({
        action: { $regex: /^TENANT_|^INSTITUTIONAL_/ },
        $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
      })
      .project({ _id: 1, action: 1, targetType: 1 })
      .limit(20)
      .toArray(),
  ]);

  const existingTenantIds = new Set(
    (
      await tenants
        .find({}, { projection: { _id: 1 } })
        .toArray()
    ).map((tenant) => safeId(tenant._id)),
  );

  const categories = {
    assignmentsWithoutRole: category(
      assignmentsWithoutRole.length,
      'BLOCKING_FOR_AUTOMATED_PRIMARY_AUTHORITY',
      'Designar rol institucional mediante migracion/revision explicita',
      summarizeRefs(assignmentsWithoutRole, (row) => ({
        assignmentId: safeId(row._id),
        tenantId: safeId(row.tenantId),
        userId: safeId(row.userId),
      })),
    ),
    assignmentsWithoutWallet: category(
      assignmentsWithoutWallet.length,
      'BLOCKING_FOR_WALLET_DEPENDENT_OPERATIONS',
      'Usar regularizacion de wallet heredada',
      summarizeRefs(assignmentsWithoutWallet, (row) => ({
        assignmentId: safeId(row._id),
        tenantId: safeId(row.tenantId),
        userId: safeId(row.userId),
      })),
    ),
    multipleActivePrimaries: category(
      duplicatePrimaryGroups.length,
      'BLOCKING_FOR_PRIMARY_UNIQUENESS_INDEX',
      'Resolver duplicados antes de asegurar indice unico',
      summarizeRefs(duplicatePrimaryGroups, (row) => ({
        tenantId: safeId(row._id),
        count: row.count,
        assignmentIds: row.assignmentIds.map(safeId).slice(0, 5),
      })),
    ),
    primaryNotApprovedButActive: category(
      inactivePrimaryRows.length,
      'BLOCKING_FOR_PRIMARY_UNIQUENESS_INDEX',
      'Normalizar PRIMARY no operativo a active=false',
      summarizeRefs(inactivePrimaryRows, (row) => ({
        assignmentId: safeId(row._id),
        tenantId: safeId(row.tenantId),
        status: row.status ?? null,
      })),
    ),
    duplicateWallets: category(
      duplicateWalletGroups.length,
      'BLOCKING_FOR_WALLET_UNIQUENESS_INDEX',
      'Resolver wallets duplicadas case-insensitive antes de crear/backfill de indice',
      summarizeRefs(duplicateWalletGroups, (row) => ({
        walletFingerprint: row._id ? `${String(row._id).slice(0, 8)}...` : null,
        count: row.count,
        userCount: row.userIds.length,
        assignmentIds: row.assignmentIds.map(safeId).slice(0, 5),
      })),
    ),
    institutionalUsersWithoutDni: category(
      usersWithoutDni.length,
      'BLOCKING_FOR_WALLET_REGULARIZATION',
      'Regularizar DNI interno antes de validar wallet heredada',
      summarizeRefs(usersWithoutDni, (row) => ({
        userId: safeId(row._id),
        active: row.active ?? null,
      })),
    ),
    inconsistentRecoveryRequests: category(
      inconsistentRecoveryRequests.length,
      'BLOCKING_FOR_RECOVERY_AUDIT',
      'Revisar solicitudes aprobadas sin referencias/resolucion completas',
      summarizeRefs(inconsistentRecoveryRequests, (row) => ({
        recoveryRequestId: safeId(row._id),
        tenantId: safeId(row.tenantId),
      })),
    ),
    tenantsWithoutPrimary: category(
      tenantsWithoutPrimary.length,
      'REQUIRES_EXPLICIT_ADMIN_DESIGNATION',
      'Usar designacion explicita de PRIMARY por ADMIN',
      summarizeRefs(tenantsWithoutPrimary, (row) => ({
        tenantId: safeId(row._id),
        activeAdmins: row.activeAdmins,
      })),
    ),
    approvedApplicationsWithoutWallet: category(
      approvedApplicationsWithoutWallet.length,
      'LEGACY_COMPATIBILITY_DEBT',
      'No fabricar wallet; regularizar via flujo heredado cuando aplique',
      summarizeRefs(approvedApplicationsWithoutWallet, (row) => ({
        applicationId: safeId(row._id),
        tenantId: safeId(row.tenantId),
        userId: safeId(row.userId),
      })),
    ),
    auditWithoutTenant: category(
      auditWithoutTenant.length,
      'REVIEW_GLOBAL_OR_UNRESOLVED_AUDIT_EVENTS',
      'Confirmar que los eventos sin tenant son globales o pre-resolucion',
      summarizeRefs(auditWithoutTenant, (row) => ({
        auditEventId: safeId(row._id),
        action: row.action ?? null,
        targetType: row.targetType ?? null,
      })),
    ),
  };

  print({
    ok: true,
    readOnly: true,
    generatedAt: new Date().toISOString(),
    collections: COLLECTIONS,
    tenantCollectionReachable: existingTenantIds.size >= 0,
    categories,
    totals: Object.fromEntries(
      Object.entries(categories).map(([key, value]) => [key, value.total]),
    ),
  });
} catch (error) {
  print({
    ok: false,
    readOnly: true,
    reason: error instanceof Error ? error.message.replace(uri, '[redacted-uri]') : String(error),
  });
  process.exit(1);
} finally {
  await client.close().catch(() => undefined);
}
