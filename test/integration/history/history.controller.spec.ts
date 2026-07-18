import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { HistoryModule } from '@/modules/history/history.module';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';
import { getBaseTestingModuleImports } from '../../utils/test-module';

describe('HistoryController (integration)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;
  let mongod: MongoMemoryServer;
  let httpServer: any;
  let authToken: string;
  const apiKey = 'test-history-api-key';
  const previousApiKeys = process.env.API_KEYS;

  beforeAll(async () => {
    process.env.API_KEYS = apiKey;
    mongod = await MongoMemoryServer.create();

    moduleRef = await Test.createTestingModule({
      imports: [...getBaseTestingModuleImports(mongod.getUri()), HistoryModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    conn = moduleRef.get<Connection>(getConnectionToken());
    httpServer = app.getHttpServer();
    authToken = moduleRef.get(JwtService).sign({ sub: 'test-user', role: 'ADMIN', active: true });
  });

  afterAll(async () => {
    if (previousApiKeys === undefined) {
      delete process.env.API_KEYS;
    } else {
      process.env.API_KEYS = previousApiKeys;
    }
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await conn.collection('histories').deleteMany({});
  });

  function authedGet(path: string) {
    return request(httpServer).get(path).set('Authorization', `Bearer ${authToken}`);
  }

  function authedPost(path: string) {
    return request(httpServer).post(path).set('Authorization', `Bearer ${authToken}`);
  }

  function buildPayload(overrides: Record<string, any> = {}) {
    return {
      txHash: `0x${Math.random().toString(16).slice(2)}`,
      operationName: HistoryOperationKey.setTvdPerCredit,
      type: HistoryType.MULTISIG,
      registerDate: new Date().toISOString(),
      ...overrides,
    };
  }

  async function createHistory(overrides: Record<string, any> = {}) {
    return authedPost('/history').send(buildPayload(overrides));
  }

  describe('POST /history', () => {
    it('crea un registro y responde {success, data}', async () => {
      const description = 'Cambio de emergencia';
      const roledUserId = new Types.ObjectId().toString();
      const institutionId = new Types.ObjectId().toString();
      const electionId = new Types.ObjectId().toString();
      const payload = buildPayload({
        description,
        roledUserId,
        institutionId,
        electionId,
      });

      const res = await authedPost('/history').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id).toBeDefined();
      expect(res.body.data.txHash).toBe(payload.txHash);
      expect(res.body.data.operationName).toBe(payload.operationName);
      expect(res.body.data.type).toBe(payload.type);
      expect(res.body.data.registerDate).toBeDefined();


      const stored = await conn
        .collection('histories')
        .findOne({ txHash: payload.txHash });
      expect(stored).toBeTruthy();
      expect(stored!.txHash).toBe(payload.txHash);
      expect(stored!.operationName).toBe(payload.operationName);
      expect(stored!.description).toBe(description);
      expect(stored!.type).toBe(payload.type);
      expect(stored!.registerDate).toBeDefined();
      expect(stored!.roledUserId.toString()).toBe(roledUserId);
      expect(stored!.institutionId.toString()).toBe(institutionId);
      expect(stored!.electionId.toString()).toBe(electionId);
    });

    it('convierte roledUserId, institutionId y electionId a ObjectId al persistir', async () => {
      const roledUserId = new Types.ObjectId().toString();
      const institutionId = new Types.ObjectId().toString();
      const electionId = new Types.ObjectId().toString();
      const payload = buildPayload({ roledUserId, institutionId, electionId });

      const res = await authedPost('/history').send(payload);
      expect(res.status).toBe(201);

      const stored: any = await conn
        .collection('histories')
        .findOne({ txHash: payload.txHash });
      expect(stored.roledUserId).toBeInstanceOf(Types.ObjectId);
      expect(stored.roledUserId.toString()).toBe(roledUserId);
      expect(stored.institutionId).toBeInstanceOf(Types.ObjectId);
      expect(stored.electionId).toBeInstanceOf(Types.ObjectId);
    });

    it('responde 400 si los campos string están vacíos', async () => {
      const payload = buildPayload({ operationName: '' });
      const res = await authedPost('/history').send(payload);

      expect(res.status).toBe(400);
    });

    it('responde 400 si faltan campos requeridos', async () => {
      const res = await authedPost('/history').send({ txHash: '0x1' });

      expect(res.status).toBe(400);
    });

    it('responde 400 si roledUserId no es un ObjectId válido', async () => {
      const payload = buildPayload({ roledUserId: 'not-an-id' });

      const res = await authedPost('/history').send(payload);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /history/:id', () => {
    it('responde {success, data} cuando el registro existe', async () => {
      const created = await createHistory();
      const id = created.body.data._id;

      const res = await authedGet(`/history/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data._id).toBe(id);
    });

    it('responde 404 cuando el registro no existe', async () => {
      const missingId = new Types.ObjectId().toString();

      const res = await authedGet(`/history/${missingId}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /history', () => {
    it('pagina resultados usando page y limit', async () => {
      for (let i = 0; i < 15; i++) {
        await createHistory({ txHash: `0xpage${i}` });
      }

      const page1 = await authedGet('/history').query({ page: 1, limit: 10 });

      expect(page1.status).toBe(200);
      expect(page1.body.data.items).toHaveLength(10);
      expect(page1.body.data.totalitems).toBe(15);
      expect(page1.body.data.totalPages).toBe(2);
      expect(page1.body.data.page).toBe(1);
      expect(page1.body.data.limit).toBe(10);

      const page2 = await authedGet('/history').query({ page: 2, limit: 10 });

      expect(page2.status).toBe(200);
      expect(page2.body.data.items).toHaveLength(5);
      expect(page2.body.data.page).toBe(2);
    });

    it('filtra por type', async () => {
      await createHistory({ txHash: '0xmulti', type: HistoryType.MULTISIG });
      await createHistory({ txHash: '0xowner', type: HistoryType.OWNER });

      const res = await authedGet('/history').query({ type: HistoryType.OWNER });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].txHash).toBe('0xowner');
    });

    it('filtra por txHash y operationName', async () => {
      await createHistory({
        txHash: '0xfoo',
        operationName: HistoryOperationKey.setBurnBps,
      });
      await createHistory({
        txHash: '0xbar',
        operationName: HistoryOperationKey.createElection,
      });

      const byTxHash = await authedGet('/history').query({ txHash: '0xfoo' });
      expect(byTxHash.body.data.items).toHaveLength(1);
      expect(byTxHash.body.data.items[0].txHash).toBe('0xfoo');

      const byName = await authedGet('/history').query({ operationName: HistoryOperationKey.setBurnBps });
      expect(byName.body.data.items).toHaveLength(1);
      expect(byName.body.data.items[0].operationName).toBe(HistoryOperationKey.setBurnBps);
    });

    it('filtra por roledUserId, institutionId y electionId', async () => {
      const roledUserId = new Types.ObjectId().toString();
      const institutionId = new Types.ObjectId().toString();
      const electionId = new Types.ObjectId().toString();

      await createHistory({
        txHash: '0xrelated',
        roledUserId,
        institutionId,
        electionId,
      });
      await createHistory({ txHash: '0xunrelated' });

      const res = await authedGet('/history').query({ roledUserId, institutionId, electionId });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].txHash).toBe('0xrelated');
    });

    it('filtra por rango de registerDate', async () => {
      await createHistory({
        txHash: '0xold',
        registerDate: new Date('2020-01-01T00:00:00.000Z').toISOString(),
      });
      await createHistory({
        txHash: '0xnew',
        registerDate: new Date('2026-06-01T00:00:00.000Z').toISOString(),
      });

      const res = await authedGet('/history').query({
        registerDateFrom: '2025-01-01T00:00:00.000Z',
        registerDateTo: '2026-12-31T23:59:59.000Z',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].txHash).toBe('0xnew');
    });

    it('responde 400 si se envía un query param desconocido', async () => {
      const res = await authedGet('/history').query({ unknownParam: 'x' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /history/contracts', () => {
    it('responde {success, data} con las direcciones de contratos configuradas', async () => {
      const res = await authedGet('/history/contracts');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      for (const key of [
        'tvdToken',
        'coreVesting',
        'institutionalVesting',
        'incentiveCampaigns',
        'electoralCredits',
        'voteManager',
      ]) {
        expect(res.body.data).toHaveProperty(key);
        expect(res.body.data[key]).toHaveProperty('address');
        expect(res.body.data[key]).toHaveProperty('txHash');
      }
    });
  });

  describe('autenticación (JWT o API key)', () => {
    it('responde 401 si no se envía JWT ni API key', async () => {
      const res = await request(httpServer).get('/history/contracts');
      expect(res.status).toBe(401);
    });

    it('responde 401 si el JWT es inválido y no se envía API key', async () => {
      const res = await request(httpServer)
        .get('/history/contracts')
        .set('Authorization', 'Bearer invalid-token');
      expect(res.status).toBe(401);
    });

    it('permite acceso solo con API key válida', async () => {
      const res = await request(httpServer)
        .get('/history/contracts')
        .set('x-api-key', apiKey);
      expect(res.status).toBe(200);
    });

    it('responde 401 si la API key es inválida y no se envía JWT', async () => {
      const res = await request(httpServer)
        .get('/history/contracts')
        .set('x-api-key', 'wrong-key');
      expect(res.status).toBe(401);
    });

    it('permite acceso solo con JWT válido', async () => {
      const res = await authedGet('/history/contracts');
      expect(res.status).toBe(200);
    });
  });
});
