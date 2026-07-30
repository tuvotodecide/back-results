import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { AuthModule } from '@/modules/auth/auth.module';
import { InstitutionalAccessRecoveryRequestsModule } from '@/modules/institutional-access-recovery-requests/institutional-access-recovery-requests.module';
import { InstitutionalEmailOutboxService } from '@/modules/mail/institutional-email-outbox.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { MailService } from '@/modules/mail/mail.service';
import { TestLoggerModule } from '../utils/module-helpers';

describe('MX-02 | Gestión de instituciones, administradores y wallets | Backend Results | Recuperación de acceso institucional', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let currentAdmin: any;
  let emailOutboxService: InstitutionalEmailOutboxService;

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
        AuthModule,
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
    emailOutboxService = moduleRef.get(InstitutionalEmailOutboxService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    currentAdmin = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };
    await conn.collection('institutional_access_recovery_requests').deleteMany({});
    await conn.collection('tenant_admin_assignments').deleteMany({});
    await conn.collection('institutional_tenants').deleteMany({});
    await conn.collection('roled_users').deleteMany({});
    await conn.collection('institutional_email_outbox').deleteMany({});
    await conn.collection('institutional_audit_events').deleteMany({});
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedAdminAssignment(
    role: 'PRIMARY' | 'SECONDARY' = 'PRIMARY',
    active = true,
    tenantName = 'Universidad Demo',
  ) {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    const now = new Date();
    await conn.collection('institutional_tenants').insertOne({
      _id: tenantId,
      name: tenantName,
      nameNorm: tenantName.trim().toLowerCase(),
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

  async function seedLoginReadyAdminAssignment(
    role: 'PRIMARY' | 'SECONDARY' = 'PRIMARY',
    password = 'secret123',
    tenantName = 'Universidad Demo',
  ) {
    const seeded = await seedAdminAssignment(role, true, tenantName);
    const email = `mail-${String(seeded.userId)}@example.com`;
    const passwordHash = bcrypt.hashSync(password, 10);
    await conn.collection('roled_users').updateOne(
      { _id: seeded.userId },
      {
        $set: {
          email,
          password: passwordHash,
          authVersion: 0,
          active: true,
        },
        $unset: {
          passwordResetToken: '',
          passwordResetTokenExpiresAt: '',
        },
      },
    );
    return { ...seeded, email, password, passwordHash };
  }

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
  }

  function createEmailChange(token: string, newEmail: string, extra: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/v1/institutional-access-recovery-requests/me/email-change')
      .set('Authorization', `Bearer ${token}`)
      .send({ newEmail, ...extra });
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

  it('D-MAIL-001 crea una sola solicitud autenticada sin aceptar datos arbitrarios ni cambiar correo', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    const signedIn = await login(seeded.email, seeded.password).expect(200);

    const created = await createEmailChange(
      signedIn.body.accessToken,
      '  Nuevo.Admin@Example.COM  ',
      {
        userId: String(new Types.ObjectId()),
        dni: 'dni-manipulado',
        wallet: '0x0000000000000000000000000000000000000999',
        role: 'ADMIN',
        status: 'APPROVED',
      },
    ).expect(201);

    expect(created.body).toMatchObject({
      status: 'PENDING',
      currentEmail: seeded.email,
      newEmail: 'nuevo.admin@example.com',
    });

    const user = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const stored = await conn.collection('institutional_access_recovery_requests').findOne({
      _id: new Types.ObjectId(created.body.requestId),
    });
    expect(user).toMatchObject({ email: seeded.email, password: seeded.passwordHash });
    expect(stored).toMatchObject({
      requestType: 'ADMIN_EMAIL_CHANGE',
      candidateUserId: seeded.userId,
      candidateAssignmentId: seeded.assignmentId,
      currentEmail: seeded.email,
      newEmail: 'nuevo.admin@example.com',
      accountAddress: '0x0000000000000000000000000000000000000801',
      institutionalRole: 'PRIMARY',
      status: 'PENDING',
    });

    await createEmailChange(signedIn.body.accessToken, 'otro@example.com').expect(409);
    expect(
      await conn.collection('institutional_access_recovery_requests').countDocuments({
        candidateUserId: seeded.userId,
        requestType: 'ADMIN_EMAIL_CHANGE',
        status: 'PENDING',
      }),
    ).toBe(1);
  });

  it('D-MAIL-002 rechaza correo ocupado, formato invalido y mismo correo sin persistencia ni avisos', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'dni-correo-ocupado',
      email: 'ocupado@example.com',
      name: 'Cuenta Existente',
      password: bcrypt.hashSync('secret123', 10),
      role: 'USER',
      active: true,
      authVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const signedIn = await login(seeded.email, seeded.password).expect(200);

    await createEmailChange(signedIn.body.accessToken, 'ocupado@example.com').expect(409);
    await createEmailChange(signedIn.body.accessToken, 'correo-invalido').expect(400);
    await createEmailChange(signedIn.body.accessToken, `  ${seeded.email.toUpperCase()}  `).expect(409);

    expect(
      await conn.collection('institutional_access_recovery_requests').countDocuments({
        requestType: 'ADMIN_EMAIL_CHANGE',
      }),
    ).toBe(0);
    expect(await conn.collection('institutional_email_outbox').countDocuments({})).toBe(0);
    expect(await conn.collection('roled_users').findOne({ _id: seeded.userId })).toMatchObject({
      email: seeded.email,
      password: seeded.passwordHash,
    });
  });

  it('D-MAIL-003 / D-MAIL-005 / D-MAIL-006 / D-MAIL-007 / D-MAIL-008 / D-MAIL-009 / D-MAIL-010 / D-MAIL-011 | aprueba cambiando solo correo, invalida token viejo y conserva invariantes', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    const beforeUser = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const beforeAssignments = await conn.collection('tenant_admin_assignments').find({ userId: seeded.userId }).toArray();
    const oldLogin = await login(seeded.email, seeded.password).expect(200);
    const created = await createEmailChange(oldLogin.body.accessToken, 'correo-nuevo@example.com').expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/email-change/approve`)
      .send({ reason: 'Aprobado por superadministrador' })
      .expect(201);

    const afterUser = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const afterAssignments = await conn.collection('tenant_admin_assignments').find({ userId: seeded.userId }).toArray();
    expect(String(afterUser?._id)).toBe(String(beforeUser?._id));
    expect(afterUser?.dni).toBe(beforeUser?.dni);
    expect(afterUser?.password).toBe(beforeUser?.password);
    expect(afterUser?.passwordResetToken).toBeUndefined();
    expect(afterUser?.role).toBe(beforeUser?.role);
    expect(afterUser?.email).toBe('correo-nuevo@example.com');
    expect(afterUser?.authVersion).toBe((beforeUser?.authVersion ?? 0) + 1);
    expect(afterAssignments).toHaveLength(beforeAssignments.length);
    expect(afterAssignments[0]).toMatchObject({
      _id: beforeAssignments[0]._id,
      tenantId: beforeAssignments[0].tenantId,
      userId: beforeAssignments[0].userId,
      accountAddress: beforeAssignments[0].accountAddress,
      institutionalRole: beforeAssignments[0].institutionalRole,
      status: beforeAssignments[0].status,
      active: beforeAssignments[0].active,
    });

    await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .set('Authorization', `Bearer ${oldLogin.body.accessToken}`)
      .expect(401);
    await login(seeded.email, seeded.password).expect(403);
    const newLogin = await login('correo-nuevo@example.com', seeded.password).expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .set('Authorization', `Bearer ${newLogin.body.accessToken}`)
      .expect(200);

    expect(
      await conn.collection('institutional_email_outbox').findOne({
        targetId: seeded.userId,
        type: 'INSTITUTIONAL_EMAIL_CHANGE_NOTICE',
      }),
    ).toMatchObject({
      recipient: 'correo-nuevo@example.com',
      status: 'SENT',
      attempts: 0,
      safePayload: expect.objectContaining({ previousEmail: seeded.email }),
    });
    expect(
      await conn.collection('institutional_email_outbox').countDocuments({
        targetId: seeded.userId,
        type: 'INSTITUTIONAL_PASSWORD_RESET',
      }),
    ).toBe(0);
    expect(
      await conn.collection('institutional_audit_events').findOne({
        action: 'ADMIN_EMAIL_CHANGE_APPROVED',
        targetUserId: seeded.userId,
      }),
    ).toBeTruthy();
  });

  it('D-MAIL-004 rechaza sin modificar cuenta, sesiones, password, wallet ni relaciones', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    const oldLogin = await login(seeded.email, seeded.password).expect(200);
    const created = await createEmailChange(oldLogin.body.accessToken, 'rechazado@example.com').expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/reject`)
      .send({ reason: 'No corresponde' })
      .expect(201);

    expect(await conn.collection('roled_users').findOne({ _id: seeded.userId })).toMatchObject({
      email: seeded.email,
      password: seeded.passwordHash,
      authVersion: 0,
    });
    expect(await conn.collection('tenant_admin_assignments').findOne({ _id: seeded.assignmentId })).toMatchObject({
      accountAddress: '0x0000000000000000000000000000000000000801',
      institutionalRole: 'PRIMARY',
      status: 'APPROVED',
      active: true,
    });
    await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .set('Authorization', `Bearer ${oldLogin.body.accessToken}`)
      .expect(200);
    await login(seeded.email, seeded.password).expect(200);
    expect(
      await conn.collection('institutional_access_recovery_requests').findOne({
        _id: new Types.ObjectId(created.body.requestId),
      }),
    ).toMatchObject({ status: 'REJECTED', resolutionReason: 'No corresponde' });
    expect(await conn.collection('institutional_email_outbox').countDocuments({})).toBe(0);
  });

  it('D-MAIL-013 / D-MAIL-014 conserva cambio aprobado si falla aviso y reintenta solo el aviso', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    const oldLogin = await login(seeded.email, seeded.password).expect(200);
    const created = await createEmailChange(oldLogin.body.accessToken, 'aviso-fallido@example.com').expect(201);
    mailService.sendEmail.mockRejectedValueOnce(new Error('SES_SECRET_ACCESS_KEY leaked? no'));

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/email-change/approve`)
      .send({ reason: 'Aprobado aunque falle el aviso' })
      .expect(201);

    const approvedUser = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const approvedRequest = await conn.collection('institutional_access_recovery_requests').findOne({
      _id: new Types.ObjectId(created.body.requestId),
    });
    const failedOutbox = await conn.collection('institutional_email_outbox').findOne({
      targetId: seeded.userId,
      type: 'INSTITUTIONAL_EMAIL_CHANGE_NOTICE',
    });
    expect(approvedUser).toMatchObject({
      email: 'aviso-fallido@example.com',
      password: seeded.passwordHash,
      authVersion: 1,
    });
    expect(approvedUser?.passwordResetToken).toBeUndefined();
    expect(approvedRequest).toMatchObject({ status: 'APPROVED' });
    expect(failedOutbox).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      lastErrorSanitized: expect.any(String),
    });
    expect(failedOutbox?.lastErrorSanitized).not.toContain(seeded.passwordHash);
    expect(JSON.stringify(failedOutbox)).not.toContain(seeded.passwordHash);

    mailService.sendEmail.mockResolvedValue(undefined);
    await conn.collection('institutional_email_outbox').updateOne(
      { _id: failedOutbox?._id },
      { $set: { nextAttemptAt: new Date(Date.now() - 1000) } },
    );
    await emailOutboxService.processPendingBatch(1);

    const retriedUser = await conn.collection('roled_users').findOne({ _id: seeded.userId });
    const retriedOutbox = await conn.collection('institutional_email_outbox').findOne({
      _id: failedOutbox?._id,
    });
    expect(retriedUser).toMatchObject({
      email: 'aviso-fallido@example.com',
      password: seeded.passwordHash,
      authVersion: 1,
    });
    expect(retriedOutbox).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(
      await conn.collection('institutional_audit_events').countDocuments({
        action: 'ADMIN_EMAIL_CHANGE_APPROVED',
        targetUserId: seeded.userId,
      }),
    ).toBe(1);
    expect(
      await conn.collection('institutional_access_recovery_requests').countDocuments({
        requestType: 'ADMIN_EMAIL_CHANGE',
        candidateUserId: seeded.userId,
      }),
    ).toBe(1);
  });

  it('D-MAIL-005 / D-MAIL-010 / D-MAIL-012 | bloquea actor no superadmin, resoluciones repetidas y correo ocupado al aprobar', async () => {
    const seeded = await seedLoginReadyAdminAssignment('PRIMARY');
    const oldLogin = await login(seeded.email, seeded.password).expect(200);
    const created = await createEmailChange(oldLogin.body.accessToken, 'decision@example.com').expect(201);

    currentAdmin = { sub: String(new Types.ObjectId()), role: 'USER', active: true };
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/email-change/approve`)
      .send({ reason: 'No autorizado' })
      .expect(403);
    currentAdmin = { sub: String(new Types.ObjectId()), role: 'ADMIN', active: true };

    await conn.collection('roled_users').insertOne({
      _id: new Types.ObjectId(),
      dni: 'dni-ocupado-approval',
      email: 'decision@example.com',
      name: 'Usuario que ocupo',
      password: bcrypt.hashSync('secret123', 10),
      role: 'USER',
      active: true,
      authVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${created.body.requestId}/email-change/approve`)
      .send({ reason: 'Correo se ocupo' })
      .expect(409);
    expect(await conn.collection('roled_users').findOne({ _id: seeded.userId })).toMatchObject({
      email: seeded.email,
      password: seeded.passwordHash,
      authVersion: 0,
    });

    const secondSeeded = await seedLoginReadyAdminAssignment(
      'PRIMARY',
      'secret123',
      'Universidad Demo Alterna',
    );
    const secondLogin = await login(secondSeeded.email, secondSeeded.password).expect(200);
    const second = await createEmailChange(
      secondLogin.body.accessToken,
      'decision-libre@example.com',
    ).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${second.body.requestId}/email-change/approve`)
      .send({ reason: 'Ok' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${second.body.requestId}/email-change/approve`)
      .send({ reason: 'Doble click' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/institutional-access-recovery-requests/${second.body.requestId}/reject`)
      .send({ reason: 'Tarde' })
      .expect(409);
    expect(await conn.collection('roled_users').findOne({ _id: secondSeeded.userId })).toMatchObject({
      email: 'decision-libre@example.com',
      password: secondSeeded.passwordHash,
      authVersion: 1,
    });
  });
});
