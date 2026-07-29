jest.mock('@iden3/js-iden3-auth', () => ({
  auth: {},
  resolver: {},
}));

import appConfig from '@/config/app.config';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import {
  RoledUser,
  RoledUserSchema,
} from '@/modules/auth/schemas/roledUser.schema';
import {
  InstitutionalTenant,
  InstitutionalTenantSchema,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentSchema,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { InstitutionalVotingAdminController } from '@/modules/institutional-voting/controllers/institutional-voting-admin.controller';
import {
  PadronEntry,
  PadronEntrySchema,
} from '@/modules/institutional-voting/schemas/padron-entry.schema';
import {
  PadronImportJob,
  PadronImportJobSchema,
} from '@/modules/institutional-voting/schemas/padron-import-job.schema';
import {
  PadronVersion,
  PadronVersionSchema,
} from '@/modules/institutional-voting/schemas/padron-version.schema';
import {
  VotingEvent,
  VotingEventSchema,
} from '@/modules/institutional-voting/schemas/voting-event.schema';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '@/modules/payments/schemas/payment-transaction.schema';
import {
  TokenAccreditation,
  TokenAccreditationSchema,
} from '@/modules/tvd/schemas/token-accreditation.schema';
import { TvdBlockchainService } from '@/modules/tvd/services/tvd-blockchain.service';
import { TvdModule } from '@/modules/tvd/tvd.module';
import { InstitutionalVotingService } from '@/modules/institutional-voting/services/institutional-voting.service';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { getAddress } from 'viem';

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

type TestRequester = {
  sub?: string;
  role?: string;
  active?: boolean;
  tenantId?: string;
};

describe('TVD capacity endpoints (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let tenantModel: Model<InstitutionalTenant>;
  let assignmentModel: Model<TenantAdminAssignment>;
  let userModel: Model<RoledUser>;
  let eventModel: Model<VotingEvent>;
  let padronVersionModel: Model<PadronVersion>;
  let padronEntryModel: Model<PadronEntry>;
  let paymentModel: Model<PaymentTransaction>;
  let accreditationModel: Model<TokenAccreditation>;
  let currentUser: TestRequester | null;
  let seed: Awaited<ReturnType<typeof seedData>>;
  let previousTvdDecimals: string | undefined;

  const blockchain = {
    getTotalBalance: jest.fn(async () => ({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '10000000000000000000',
      totalBalanceSmallestUnit: '10000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '10',
      totalBalanceFormatted: '10',
      isUnlocked: false,
      unlockTime: '0',
    })),
    getLiquidBalance: jest.fn(async () => '10000000000000000000'),
    getTokenDecimals: jest.fn(async () => 18),
  };

  beforeAll(async () => {
    previousTvdDecimals = process.env.TVD_DECIMALS;
    process.env.TVD_DECIMALS = '18';
    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: InstitutionalTenant.name, schema: InstitutionalTenantSchema },
          {
            name: TenantAdminAssignment.name,
            schema: TenantAdminAssignmentSchema,
          },
          { name: RoledUser.name, schema: RoledUserSchema },
          { name: VotingEvent.name, schema: VotingEventSchema },
          { name: PadronVersion.name, schema: PadronVersionSchema },
          { name: PadronEntry.name, schema: PadronEntrySchema },
          { name: PadronImportJob.name, schema: PadronImportJobSchema },
          { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
          { name: TokenAccreditation.name, schema: TokenAccreditationSchema },
        ]),
      ],
      controllers: [InstitutionalVotingAdminController],
      providers: [
        { provide: InstitutionalVotingService, useValue: {} },
      ],
    })
      .overrideProvider(TvdBlockchainService)
      .useValue(blockchain)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) {
            throw new UnauthorizedException();
          }
          req.user = currentUser;
          return true;
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    tenantModel = moduleRef.get(getModelToken(InstitutionalTenant.name));
    assignmentModel = moduleRef.get(getModelToken(TenantAdminAssignment.name));
    userModel = moduleRef.get(getModelToken(RoledUser.name));
    eventModel = moduleRef.get(getModelToken(VotingEvent.name));
    padronVersionModel = moduleRef.get(getModelToken(PadronVersion.name));
    padronEntryModel = moduleRef.get(getModelToken(PadronEntry.name));
    paymentModel = moduleRef.get(getModelToken(PaymentTransaction.name));
    accreditationModel = moduleRef.get(getModelToken(TokenAccreditation.name));
    await Promise.all([
      tenantModel.init(),
      assignmentModel.init(),
      userModel.init(),
      eventModel.init(),
      padronVersionModel.init(),
      padronEntryModel.init(),
      paymentModel.init(),
      accreditationModel.init(),
    ]);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await Promise.all([
      conn.collection('institutional_tenants').deleteMany({}),
      conn.collection('tenant_admin_assignments').deleteMany({}),
      conn.collection('roled_users').deleteMany({}),
      conn.collection('voting_events').deleteMany({}),
      conn.collection('padron_versions').deleteMany({}),
      conn.collection('padron_entries').deleteMany({}),
      conn.collection('padron_import_jobs').deleteMany({}),
      conn.collection('payment_transactions').deleteMany({}),
      conn.collection('token_accreditations').deleteMany({}),
    ]);
    seed = await seedData();
    currentUser = {
      sub: String(seed.userA._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantA._id),
    };
    blockchain.getTotalBalance.mockResolvedValue({
      wallet: walletA,
      decimals: 18,
      liquidBalanceSmallestUnit: '0',
      assignedBalanceSmallestUnit: '10000000000000000000',
      totalBalanceSmallestUnit: '10000000000000000000',
      liquidBalanceFormatted: '0',
      assignedBalanceFormatted: '10',
      totalBalanceFormatted: '10',
      isUnlocked: false,
      unlockTime: '0',
    });
    blockchain.getLiquidBalance.mockResolvedValue('10000000000000000000');
    blockchain.getTokenDecimals.mockResolvedValue(18);
  });

  afterAll(async () => {
    if (previousTvdDecimals === undefined) {
      delete process.env.TVD_DECIMALS;
    } else {
      process.env.TVD_DECIMALS = previousTvdDecimals;
    }
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  async function seedData() {
    const [tenantA, tenantB] = await tenantModel.create([
      { name: 'Tenant A', nameNorm: 'tenant-a', active: true },
      { name: 'Tenant B', nameNorm: 'tenant-b', active: true },
    ]);
    const [userA, userB] = await userModel.create([
      {
        dni: '111',
        email: 'a@example.test',
        name: 'User A',
        password: 'hash',
        role: 'USER',
        active: true,
      },
      {
        dni: '222',
        email: 'b@example.test',
        name: 'User B',
        password: 'hash',
        role: 'USER',
        active: true,
      },
    ]);
    const [assignmentA, assignmentB] = await assignmentModel.create([
      {
        tenantId: tenantA._id,
        userId: userA._id,
        status: 'APPROVED',
        active: true,
        institutionalRole: 'PRIMARY',
        accountAddress: walletA,
        accountAddressNormalized: walletA.toLowerCase(),
        walletVerifiedAt: new Date(),
        walletVerificationSource: 'TEST',
      },
      {
        tenantId: tenantB._id,
        userId: userB._id,
        status: 'APPROVED',
        active: true,
        institutionalRole: 'PRIMARY',
        accountAddress: walletB,
        accountAddressNormalized: walletB.toLowerCase(),
        walletVerifiedAt: new Date(),
        walletVerificationSource: 'TEST',
      },
    ]);
    const [eventA, eventB] = await eventModel.create([
      {
        tenantId: tenantA._id,
        name: 'Event A',
        objective: 'Objective A',
        state: 'READY_FOR_REVIEW',
      },
      {
        tenantId: tenantB._id,
        name: 'Event B',
        objective: 'Objective B',
        state: 'READY_FOR_REVIEW',
      },
    ]);
    const [oldVersion, currentVersion] = await padronVersionModel.create([
      {
        eventId: eventA._id,
        tenantId: tenantA._id,
        createdBy: userA._id,
        fileDigest: 'old',
        totals: { validCount: 50, duplicateCount: 0, invalidCount: 0 },
        isCurrent: false,
      },
      {
        eventId: eventA._id,
        tenantId: tenantA._id,
        createdBy: userA._id,
        fileDigest: 'current',
        totals: { validCount: 12, duplicateCount: 1, invalidCount: 0 },
        isCurrent: true,
      },
    ]);
    await padronEntryModel.insertMany([
      ...Array.from({ length: 20 }, (_, index) => ({
        eventId: eventA._id,
        padronVersionId: oldVersion._id,
        carnetNorm: `OLD-${index}`,
        enabled: true,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        eventId: eventA._id,
        padronVersionId: currentVersion._id,
        carnetNorm: `CUR-${index}`,
        enabled: true,
      })),
      {
        eventId: eventA._id,
        padronVersionId: currentVersion._id,
        carnetNorm: 'DISABLED-1',
        enabled: false,
      },
      {
        eventId: eventA._id,
        padronVersionId: currentVersion._id,
        carnetNorm: 'DISABLED-2',
        enabled: false,
      },
    ]);

    return {
      tenantA,
      tenantB,
      userA,
      userB,
      assignmentA,
      assignmentB,
      eventA,
      eventB,
      oldVersion,
      currentVersion,
    };
  }

  it('calcula capacidad definitiva desde padrón vigente y no muta la elección', async () => {
    const beforePayments = await paymentModel.countDocuments({});
    const beforeAccreditations = await accreditationModel.countDocuments({});
    const beforeEvent = await eventModel.findById(seed.eventA._id).lean();

    const res = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletA);
    expect(res.body).toMatchObject({
      eventId: String(seed.eventA._id),
      participantCount: 10,
      padronVersionId: String(seed.currentVersion._id),
      tokensPerParticipant: '1',
      requiredTokens: '10',
      requiredSmallestUnit: '10000000000000000000',
      availableTokens: '10',
      missingTokens: '0',
      missingSmallestUnit: '0',
      canPublish: true,
      reasonCode: null,
      balanceSource: 'BLOCKCHAIN',
      usableBalanceField: 'liquidBalanceSmallestUnit',
      walletAddress: walletA,
    });
    expect(await paymentModel.countDocuments({})).toBe(beforePayments);
    expect(await accreditationModel.countDocuments({})).toBe(beforeAccreditations);
    const afterEvent = await eventModel.findById(seed.eventA._id).lean();
    expect(afterEvent?.state).toBe(beforeEvent?.state);
    expect(afterEvent?.publicationConfirmed).toBe(
      beforeEvent?.publicationConfirmed,
    );
  });

  it('ignora cualquier estimación previa y bloquea participantCount enviado por query', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .query({
        participantCount: 100,
        requiredTokens: '100',
        availableTokens: '100',
        walletAddress: walletB,
        canPublish: true,
      })
      .expect(400);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);

    expect(res.body.participantCount).toBe(10);
    expect(res.body.requiredTokens).toBe('10');
    expect(res.body.walletAddress).toBe(walletA);
  });

  it('devuelve canPublish=false con saldo insuficiente sin reservar ni consumir TVD', async () => {
    blockchain.getLiquidBalance.mockResolvedValueOnce('5000000000000000000');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);

    expect(res.body).toMatchObject({
      participantCount: 10,
      requiredTokens: '10',
      availableTokens: '5',
      missingTokens: '5',
      canPublish: false,
      reasonCode: 'INSUFFICIENT_TVD_BALANCE',
    });
    expect(await paymentModel.countDocuments({})).toBe(0);
    expect(await accreditationModel.countDocuments({})).toBe(0);
  });

  it('bloquea sin JWT, cross-tenant, assignment no aprobado y wallet no verificada', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .expect(401);

    currentUser = {
      sub: String(seed.userB._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantB._id),
    };
    await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer tenant-b')
      .expect(404);
    expect(blockchain.getLiquidBalance).not.toHaveBeenCalled();

    currentUser = {
      sub: String(seed.userA._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantA._id),
    };
    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      { $set: { status: 'PENDING' } },
    );
    await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(403);

    await assignmentModel.updateOne(
      { _id: seed.assignmentA._id },
      {
        $set: {
          status: 'APPROVED',
          walletVerifiedAt: null,
          walletVerificationSource: null,
        },
      },
    );
    await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(400);
  });

  it('usa la wallet del admin autenticado cuando otro admin del mismo tenant valida', async () => {
    const userC = await userModel.create({
      dni: '333',
      email: 'c@example.test',
      name: 'User C',
      password: 'hash',
      role: 'USER',
      active: true,
    });
    await assignmentModel.create({
      tenantId: seed.tenantA._id,
      userId: userC._id,
      status: 'APPROVED',
      active: true,
      institutionalRole: 'SECONDARY',
      accountAddress: walletB,
      accountAddressNormalized: walletB.toLowerCase(),
      walletVerifiedAt: new Date(),
      walletVerificationSource: 'TEST',
    });
    currentUser = {
      sub: String(userC._id),
      role: 'USER',
      active: true,
      tenantId: String(seed.tenantA._id),
    };
    blockchain.getLiquidBalance.mockResolvedValueOnce('100000000000000000000');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional-c')
      .expect(200);

    expect(blockchain.getLiquidBalance).toHaveBeenCalledWith(walletB);
    expect(blockchain.getLiquidBalance).not.toHaveBeenCalledWith(walletA);
    expect(res.body).toMatchObject({
      walletAddress: walletB,
      availableTokens: '100',
      canPublish: true,
    });
  });

  it('maneja padrón inexistente, en procesamiento, vacío y RPC no disponible con respuestas seguras', async () => {
    await padronVersionModel.deleteMany({ eventId: seed.eventA._id });
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(missing.body).toMatchObject({
      participantCount: 0,
      padronVersionId: null,
      canPublish: false,
      reasonCode: 'PADRON_NOT_FOUND',
    });

    await conn.collection('padron_import_jobs').insertOne({
      eventId: seed.eventA._id,
      tenantId: seed.tenantA._id,
      createdBy: seed.userA._id,
      sourceType: 'PDF',
      status: 'PROCESSING',
      isActiveDraft: true,
      originalFileName: 'padron.pdf',
      originalFileMimeType: 'application/pdf',
      originalFileSize: 1,
      originalFileSha256: 'processing',
      parserProvider: 'test',
      parserUsedFallback: true,
      summary: {
        parsedCount: 0,
        validCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        stagingCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        missingIdentityCount: 0,
      },
      importErrors: [],
    });
    const processing = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(processing.body.reasonCode).toBe('PADRON_PROCESSING');

    await conn.collection('padron_import_jobs').deleteMany({});
    const emptyVersion = await padronVersionModel.create({
      eventId: seed.eventA._id,
      tenantId: seed.tenantA._id,
      createdBy: seed.userA._id,
      fileDigest: 'empty',
      totals: { validCount: 0, duplicateCount: 0, invalidCount: 0 },
      isCurrent: true,
    });
    const empty = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(200);
    expect(empty.body).toMatchObject({
      participantCount: 0,
      padronVersionId: String(emptyVersion._id),
      canPublish: false,
      reasonCode: 'PADRON_EMPTY',
    });

    await padronVersionModel.deleteMany({ eventId: seed.eventA._id });
    await padronVersionModel.create({
      eventId: seed.eventA._id,
      tenantId: seed.tenantA._id,
      createdBy: seed.userA._id,
      fileDigest: 'rpc',
      totals: { validCount: 1, duplicateCount: 0, invalidCount: 0 },
      isCurrent: true,
    });
    blockchain.getLiquidBalance.mockRejectedValueOnce(
      new Error('RPC http://private-rpc.local unavailable'),
    );
    const rpc = await request(app.getHttpServer())
      .get(`/api/v1/voting/events/${seed.eventA._id}/tvd-capacity`)
      .set('Authorization', 'Bearer institutional')
      .expect(503);
    expect(rpc.body).toMatchObject({
      code: 'TVD_BALANCE_TEMPORARILY_UNAVAILABLE',
    });
    expect(JSON.stringify(rpc.body)).not.toContain('private-rpc');
  });
});
