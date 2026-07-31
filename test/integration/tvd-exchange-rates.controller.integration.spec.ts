import appConfig from '@/config/app.config';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { InstitutionalAuditEvent } from '@/modules/institutional-audit/schemas/institutional-audit-event.schema';
import {
  TvdExchangeRate,
  TvdExchangeRateSchema,
} from '@/modules/tvd/schemas/tvd-exchange-rate.schema';
import { TvdModule } from '@/modules/tvd/tvd.module';
import {
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';

const endpoint = '/api/v1/tvd/exchange-rates';

describe('TVD exchange rates endpoint (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let mongod: MongoMemoryReplSet;
  let conn: Connection;
  let rateModel: Model<any>;
  let auditModel: Model<any>;
  let currentUser: any;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ launchTimeout: 120000 }],
    });
    await mongod.waitUntilRunning();

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
        JwtModule.register({ global: true, secret: 'test-secret' }),
        MongooseModule.forRoot(mongod.getUri()),
        TvdModule,
        MongooseModule.forFeature([
          { name: TvdExchangeRate.name, schema: TvdExchangeRateSchema },
        ]),
      ],
    })
      .overrideGuard(AdminOnlyGuard)
      .useValue({
        canActivate: jest.fn((context) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) {
            throw new UnauthorizedException('Missing token');
          }
          if (currentUser?.role !== 'ADMIN') {
            throw new ForbiddenException('Admin role required');
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
    rateModel = moduleRef.get(getModelToken(TvdExchangeRate.name));
    auditModel = moduleRef.get(getModelToken(InstitutionalAuditEvent.name));
    await Promise.all([rateModel.init(), auditModel.init()]);
  });

  beforeEach(async () => {
    currentUser = {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    };
    await Promise.all([
      conn.collection('tvd_exchange_rates').deleteMany({}),
      conn.collection('institutional_audit_events').deleteMany({}),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close();
    await mongod?.stop();
  });

  const validBody = {
    fiatCurrency: 'BOB',
    bobPerToken: '1',
    validFrom: '2020-01-01T00:00:00.000Z',
    validUntil: null,
    reason: 'Tasa inicial controlada para prueba QR',
  };

  it('TVD-RATE-POS-I-001 | POSITIVO | INTEGRACION | ADMIN crea tasa vigente versionada con auditoria', async () => {
    const res = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-1')
      .send(validBody)
      .expect(201);

    expect(res.body).toMatchObject({
      fiatCurrency: 'BOB',
      bobPerToken: '1',
      version: 1,
      active: true,
      current: true,
      reason: validBody.reason,
    });
    expect(res.body.validFrom).toBe('2020-01-01T00:00:00.000Z');
    expect(res.body.validUntil).toBeNull();

    const persisted = await rateModel.findById(res.body.id).lean();
    expect(persisted).toMatchObject({
      currency: 'BOB',
      bobPerToken: '1',
      version: 1,
      active: true,
      idempotencyKey: 'rate-key-1',
    });
    expect(String(persisted.createdBy)).toBe(currentUser.sub);

    const audit = await auditModel
      .findOne({ action: 'TVD_EXCHANGE_RATE_CREATED' })
      .lean();
    expect(audit).toMatchObject({
      actorGlobalRole: 'ADMIN',
      targetType: 'TvdExchangeRate',
      targetId: res.body.id,
      reason: validBody.reason,
      correlationId: 'rate-key-1',
    });
  });

  it('TVD-RATE-POS-I-002/003 | POSITIVO | INTEGRACION | lista tasas y consulta la vigente', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-list')
      .send(validBody)
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .query({ current: 'true', page: '1', limit: '10' })
      .expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      fiatCurrency: 'BOB',
      bobPerToken: '1',
      current: true,
    });

    const current = await request(app.getHttpServer())
      .get(`${endpoint}/current`)
      .set('Authorization', 'Bearer test-admin')
      .expect(200);
    expect(current.body).toMatchObject({
      fiatCurrency: 'BOB',
      bobPerToken: '1',
      current: true,
    });
  });

  it('TVD-RATE-POS-I-004 | POSITIVO | INTEGRACION | misma Idempotency-Key y mismo payload devuelve la misma tasa', async () => {
    const first = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-idem')
      .send(validBody)
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-idem')
      .send(validBody)
      .expect(201);

    expect(repeated.body.id).toBe(first.body.id);
    expect(await rateModel.countDocuments()).toBe(1);
  });

  it('TVD-RATE-POS-I-005 | POSITIVO | INTEGRACION | nueva tasa conserva historico y aumenta version', async () => {
    const first = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-first')
      .send(validBody)
      .expect(201);

    const secondBody = {
      ...validBody,
      bobPerToken: '2.5',
      validFrom: '2021-01-01T00:00:00.000Z',
      reason: 'Cambio controlado de tasa TVD',
    };
    const second = await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-second')
      .send(secondBody)
      .expect(201);

    expect(second.body).toMatchObject({ bobPerToken: '2.5', version: 2, active: true });
    const historical = await rateModel.findById(first.body.id).lean();
    expect(historical).toMatchObject({ active: false, version: 1 });
    expect(historical.effectiveTo).toEqual(new Date(secondBody.validFrom));
  });

  it('TVD-RATE-NEG-I-001/002/003 | NEGATIVO | INTEGRACION | rechaza tasa cero negativa o invalida', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-zero')
      .send({ ...validBody, bobPerToken: '0' })
      .expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-negative')
      .send({ ...validBody, bobPerToken: '-1' })
      .expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-invalid')
      .send({ ...validBody, bobPerToken: '1e2' })
      .expect(400);
  });

  it('TVD-RATE-NEG-I-004/005 | NEGATIVO | INTEGRACION | rechaza periodo invalido y moneda distinta de BOB', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-period')
      .send({
        ...validBody,
        validUntil: '2019-12-31T23:59:59.000Z',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-currency')
      .send({ ...validBody, fiatCurrency: 'USD' })
      .expect(400);
  });

  it('TVD-RATE-NEG-I-006/007/008 | NEGATIVO | INTEGRACION | valida idempotencia y rol ADMIN', async () => {
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Idempotency-Key', 'rate-key-no-jwt')
      .send(validBody)
      .expect(401);

    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .send(validBody)
      .expect(400);

    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-conflict')
      .send(validBody)
      .expect(201);
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-admin')
      .set('Idempotency-Key', 'rate-key-conflict')
      .send({ ...validBody, bobPerToken: '2' })
      .expect(409);

    currentUser = { sub: new Types.ObjectId().toHexString(), role: 'USER', active: true };
    await request(app.getHttpServer())
      .post(endpoint)
      .set('Authorization', 'Bearer test-user')
      .set('Idempotency-Key', 'rate-key-user')
      .send(validBody)
      .expect(403);
  });

  it('TVD-RATE-NEG-I-009 | NEGATIVO | INTEGRACION | consulta current sin tasa vigente devuelve 404', async () => {
    await request(app.getHttpServer())
      .get(`${endpoint}/current`)
      .set('Authorization', 'Bearer test-admin')
      .expect(404);
  });
});
