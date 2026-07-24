import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalAccessRecoveryRequestsModule } from '@/modules/institutional-access-recovery-requests/institutional-access-recovery-requests.module';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { MailService } from '@/modules/mail/mail.service';
import { TestLoggerModule } from '../utils/module-helpers';

describe('Institutional access recovery requests (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let currentAdmin: any;

  const mailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
    createEmail: jest.fn(),
    getTemplate: jest.fn(),
  };

  beforeAll(async () => {
    process.env.PASSWORD_RESET_BASE_URL = 'https://front.example.test';
    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        TestLoggerModule,
        InstitutionalAccessRecoveryRequestsModule,
      ],
    })
      .overrideProvider(MailService)
      .useValue(mailService)
      .overrideGuard(AdminOnlyGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          if (currentAdmin?.role !== 'ADMIN') {
            return false;
          }
          req.user = currentAdmin;
          return true;
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    currentAdmin = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await conn.collection('institutional_access_recovery_requests').deleteMany({});
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedAdminAssignment(role: 'PRIMARY' | 'SECONDARY' = 'PRIMARY', active = true) {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    const now = new Date();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: 'Universidad Demo',
      nameNorm: 'universidad demo',
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await conn.collection('roled_users').insertOne({
      _id: userId,
      dni: `dni-${String(userId).slice(-6)}`,
      email: `old-${String(userId)}@example.com`,
      name: 'Admin Recuperable',
      password: 'hash',
      role: 'USER',
      active,
      createdAt: now,
      updatedAt: now,
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: assignmentId,
      tenantId,
      userId,
      accountAddress: '0x0000000000000000000000000000000000000801',
      institutionalRole: role,
      status: active ? 'APPROVED' : 'REVOKED',
      active,
      requestedAt: now,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { tenantId, userId, assignmentId };
  }

  function createRecovery(tenantId: Types.ObjectId, newEmail = 'new@example.com') {
    return request(app.getHttpServer())
      .post('/api/v1/institutional-access-recovery-requests')
      .send({
        institutionId: String(tenantId),
        fullName: 'Admin Recuperable',
        phoneNumber: '+591 70000001',
        newEmail,
        supervisorPhoneNumber: '+591 70000002',
      });
  }

  it('crea solicitud con cinco campos, ADMIN lista/detalla y respuesta no expone secretos', async () => {
    const seeded = await seedAdminAssignment();

    const created = await createRecovery(seeded.tenantId, 'recover@example.com').expect(201);
    expect(created.body).toMatchObject({ status: 'PENDING' });
    expect(JSON.stringify(created.body)).not.toContain('old-');
    expect(JSON.stringify(created.body)).not.toContain('0x0000');

    const list = await request(app.getHttpServer())
      .get('/api/v1/institutional-access-recovery-requests')
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      institutionName: 'Universidad Demo',
      fullName: 'Admin Recuperable',
      newEmail: 'recover@example.com',
      status: 'PENDING',
    });
    expect(list.body.data[0]).not.toHaveProperty('currentEmail');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      candidateUserId: String(seeded.userId),
      candidateAssignmentId: String(seeded.assignmentId),
      currentEmail: expect.stringContaining('old-'),
      accountAddress: '0x0000000000000000000000000000000000000801',
      institutionalRole: 'PRIMARY',
    });
    expect(JSON.stringify(detail.body)).not.toContain('hash');
  });

  it('normaliza nuevo correo y rechaza correo invalido, vacio o ya registrado', async () => {
    const seeded = await seedAdminAssignment();
    const existingUser = await conn.collection('roled_users').findOne({ _id: seeded.userId });

    const normalized = await createRecovery(seeded.tenantId, '  Normalized@Example.COM  ').expect(201);
    expect(normalized.body).toMatchObject({ status: 'PENDING' });
    expect(
      await conn.collection('institutional_access_recovery_requests').findOne({
        _id: new Types.ObjectId(normalized.body.requestId),
      }),
    ).toMatchObject({ newEmail: 'normalized@example.com' });

    await conn.collection('institutional_access_recovery_requests').deleteMany({});
    await createRecovery(seeded.tenantId, 'correo-invalido').expect(400);
    await createRecovery(seeded.tenantId, '   ').expect(400);
    await createRecovery(seeded.tenantId, String(existingUser?.email)).expect(409);
  });

  it('aprueba recuperacion sobre PRIMARY conservando usuario tenant assignment wallet y rol', async () => {
    const seeded = await seedAdminAssignment('PRIMARY');
    const created = await createRecovery(seeded.tenantId, 'primary-new@example.com').expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(seeded.userId),
        targetAssignmentId: String(seeded.assignmentId),
        reason: 'Verificado manualmente',
      })
      .expect(201);

    const user = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const assignment = await conn.collection('tenant_admin_assignments').findOne({
      _id: seeded.assignmentId,
    });
    const recovery = await conn.collection('institutional_access_recovery_requests').findOne({
      _id: new Types.ObjectId(created.body.requestId),
    });

    expect(user).toEqual(
      expect.objectContaining({
        email: 'primary-new@example.com',
        role: 'USER',
        active: true,
        authVersion: 1,
        passwordResetToken: expect.any(String),
      }),
    );
    expect(assignment).toEqual(
      expect.objectContaining({
        tenantId: seeded.tenantId,
        userId: seeded.userId,
        accountAddress: '0x0000000000000000000000000000000000000801',
        institutionalRole: 'PRIMARY',
        status: 'APPROVED',
        active: true,
      }),
    );
    expect(recovery).toMatchObject({ status: 'APPROVED' });
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      'primary-new@example.com',
      'Restablecer contraseña',
      'reset-password',
      expect.objectContaining({ resetLink: expect.stringContaining('token=') }),
    );
    expect(JSON.stringify(user)).not.toContain('primary-new@example.com?token=');

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(seeded.userId),
        targetAssignmentId: String(seeded.assignmentId),
      })
      .expect(409);

    expect(
      await conn.collection('roled_users').findOne({ _id: seeded.userId }),
    ).toMatchObject({ email: 'primary-new@example.com', authVersion: 1 });
    expect(
      await conn.collection('institutional_email_outbox').countDocuments({
        targetId: seeded.userId,
        type: 'INSTITUTIONAL_PASSWORD_RESET',
      }),
    ).toBe(1);
  });

  it('aprueba recuperacion sobre SECONDARY y cuenta revocada conserva revocacion', async () => {
    const secondary = await seedAdminAssignment('SECONDARY');
    const created = await createRecovery(secondary.tenantId, 'secondary-new@example.com').expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(secondary.userId),
        targetAssignmentId: String(secondary.assignmentId),
      })
      .expect(201);
    expect(
      await conn.collection('tenant_admin_assignments').findOne({ _id: secondary.assignmentId }),
    ).toMatchObject({ institutionalRole: 'SECONDARY', active: true });

    await conn.collection('institutional_access_recovery_requests').deleteMany({});
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
    const revoked = await seedAdminAssignment('PRIMARY', false);
    const revokedRequest = await createRecovery(
      revoked.tenantId,
      'revoked-new@example.com',
    ).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${revokedRequest.body.requestId}/approve`)
      .send({
        targetUserId: String(revoked.userId),
        targetAssignmentId: String(revoked.assignmentId),
      })
      .expect(201);
    expect(
      await conn.collection('tenant_admin_assignments').findOne({ _id: revoked.assignmentId }),
    ).toMatchObject({ status: 'REVOKED', active: false });
  });

  it('email duplicado, rechazo y actor no ADMIN no modifican cuenta', async () => {
    const seeded = await seedAdminAssignment();
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'other',
      email: 'used@example.com',
      name: 'Other',
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await createRecovery(seeded.tenantId, 'used@example.com').expect(409);

    const created = await createRecovery(seeded.tenantId, 'reject@example.com').expect(201);
    currentAdmin = { sub: String(new Types.ObjectId()), role: 'USER', active: true };
    await request(app.getHttpServer())
      .get('/api/v1/institutional-access-recovery-requests')
      .expect(403);
    currentAdmin = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/reject`)
      .send({ reason: 'No coincide evidencia' })
      .expect(201);

    const user = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    expect(user?.email).not.toBe('reject@example.com');
    expect(
      await conn.collection('institutional_access_recovery_requests').findOne({
        _id: new Types.ObjectId(created.body.requestId),
      }),
    ).toMatchObject({ status: 'REJECTED', resolutionReason: 'No coincide evidencia' });
  });

  it('rechaza aprobacion si intentan resolver contra otro administrador del mismo tenant', async () => {
    const seeded = await seedAdminAssignment('PRIMARY');
    const created = await createRecovery(seeded.tenantId, 'same-admin-only@example.com').expect(201);
    const otherUserId = new Types.ObjectId();
    const otherAssignmentId = new Types.ObjectId();
    const now = new Date();
    await conn.collection('roled_users').insertOne({
      _id: otherUserId,
      dni: 'other-admin-dni',
      email: 'other-admin@example.com',
      name: 'Admin Secundario',
      password: 'hash',
      role: 'USER',
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await conn.collection('tenant_admin_assignments').insertOne({
      _id: otherAssignmentId,
      tenantId: seeded.tenantId,
      userId: otherUserId,
      accountAddress: '0x0000000000000000000000000000000000000802',
      institutionalRole: 'SECONDARY',
      status: 'APPROVED',
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(otherUserId),
        targetAssignmentId: String(otherAssignmentId),
      })
      .expect(409);

    expect(
      await conn.collection('roled_users').findOne({ _id: seeded.userId }),
    ).toMatchObject({ email: expect.stringContaining('old-') });
    expect(
      await conn.collection('roled_users').findOne({ _id: otherUserId }),
    ).toMatchObject({ email: 'other-admin@example.com' });
  });

  it('bloquea aprobacion si wallet o rol del assignment cambiaron desde la solicitud', async () => {
    const seeded = await seedAdminAssignment('PRIMARY');
    const walletChanged = await createRecovery(
      seeded.tenantId,
      'wallet-changed@example.com',
    ).expect(201);
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.assignmentId },
      { $set: { accountAddress: '0x0000000000000000000000000000000000000999' } },
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${walletChanged.body.requestId}/approve`)
      .send({
        targetUserId: String(seeded.userId),
        targetAssignmentId: String(seeded.assignmentId),
      })
      .expect(409);

    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.assignmentId },
      {
        $set: {
          accountAddress: '0x0000000000000000000000000000000000000801',
          institutionalRole: 'SECONDARY',
        },
      },
    );
    const roleChanged = await createRecovery(seeded.tenantId, 'role-changed@example.com').expect(201);
    await conn.collection('tenant_admin_assignments').updateOne(
      { _id: seeded.assignmentId },
      { $set: { institutionalRole: 'PRIMARY' } },
    );

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${roleChanged.body.requestId}/approve`)
      .send({
        targetUserId: String(seeded.userId),
        targetAssignmentId: String(seeded.assignmentId),
      })
      .expect(409);

    expect(
      await conn.collection('roled_users').findOne({ _id: seeded.userId }),
    ).toMatchObject({ email: expect.stringContaining('old-') });
  });

  it('fallo de correo en aprobacion conserva recuperacion aprobada y deja outbox fallido', async () => {
    const seeded = await seedAdminAssignment();
    const created = await createRecovery(seeded.tenantId, 'mail-fail@example.com').expect(201);
    mailService.sendEmail.mockRejectedValueOnce(new Error('SES down'));

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/approve`)
      .send({
        targetUserId: String(seeded.userId),
        targetAssignmentId: String(seeded.assignmentId),
      })
      .expect(201);

    const user = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const recovery = await conn.collection('institutional_access_recovery_requests').findOne({
      _id: new Types.ObjectId(created.body.requestId),
    });
    const outbox = await conn.collection('institutional_email_outbox').findOne({
      targetId: seeded.userId,
      type: 'INSTITUTIONAL_PASSWORD_RESET',
    });
    expect(user?.email).toBe('mail-fail@example.com');
    expect(user?.passwordResetToken).toEqual(expect.any(String));
    expect(recovery?.status).toBe('APPROVED');
    expect(outbox).toMatchObject({
      status: 'FAILED',
      attempts: 1,
    });
    expect(JSON.stringify(outbox)).not.toContain(user?.passwordResetToken);
  });
});
