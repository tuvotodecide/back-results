import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import {
  ApiHealthController,
  HealthController,
} from '@/core/controllers/health.controller';
import { AdminOnlyGuard } from '@/core/guards/admin-only.guard';
import { HealthService } from '@/core/services/health.service';

const mockGeminiGet = jest.fn();

const mockRedisClient = {
  connect: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn(),
  isOpen: true,
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      get: mockGeminiGet,
    },
  })),
}));

jest.mock('firebase-admin', () => ({
  apps: [{}],
}));

describe('Core health smoke', () => {
  const defaultConfig: Record<string, string | number> = {
    'app.nodeEnv': 'test',
    'app.version': 'test-version',
    'app.redis.host': 'redis.local',
    'app.redis.port': 6379,
    'app.redis.password': '',
    'app.firebase.projectId': 'test-project',
    'app.firebase.clientEmail': 'firebase@test.local',
    'app.firebase.privateKey': 'private-key',
    'app.ai.gemini.apiKey': 'gemini-key',
    'app.ai.gemini.model': 'gemini-test-model',
    'app.zkAuth.ipfsGatewayUrl': 'https://ipfs.example.test',
    'app.blockchain.chain': 'base-sepolia',
  };

  async function createHealthApp(options?: {
    mongoReadyState?: number;
    mongoPing?: jest.Mock;
    config?: Record<string, string | number | undefined>;
  }) {
    const mongoPing = options?.mongoPing ?? jest.fn().mockResolvedValue({ ok: 1 });
    const configValues = {
      ...defaultConfig,
      ...(options?.config ?? {}),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, ApiHealthController],
      providers: [
        HealthService,
        AdminOnlyGuard,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(async (token: string) => {
              if (token === 'admin-token') {
                return { sub: 'admin-id', role: 'ADMIN', active: true };
              }
              if (token === 'user-token') {
                return { sub: 'user-id', role: 'USER', active: true };
              }
              throw new Error('invalid token');
            }),
          },
        },
        {
          provide: getConnectionToken(),
          useValue: {
            readyState: options?.mongoReadyState ?? 1,
            host: 'mock-mongo-host',
            name: 'mock-health-db',
            db: {
              admin: () => ({
                ping: mongoPing,
              }),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              return configValues[key];
            }),
          },
        },
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();
    return { app, moduleRef, mongoPing };
  }

  beforeEach(() => {
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.quit.mockResolvedValue(undefined);
    mockRedisClient.on.mockReturnValue(mockRedisClient);
    mockRedisClient.destroy.mockReturnValue(undefined);
    mockRedisClient.isOpen = true;
    mockGeminiGet.mockResolvedValue({ name: 'models/gemini-test-model' });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x14a34' }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('GET /health responde 200 con un payload minimo estable', async () => {
    const { app, moduleRef } = await createHealthApp();
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: 'test',
        version: 'test-version',
        services: expect.objectContaining({
          database: expect.objectContaining({
            status: 'connected',
            host: 'mock-mongo-host',
            name: 'mock-health-db',
          }),
        }),
        nodeVersion: expect.any(String),
        platform: expect.any(String),
        memory: expect.objectContaining({
          used: expect.any(Number),
          total: expect.any(Number),
        }),
      }),
    );
    expect(new Date(response.body.timestamp).toString()).not.toBe('Invalid Date');
    expect(response.body.externals).toEqual(
      expect.objectContaining({
        gemini: expect.objectContaining({ status: 'skipped', configured: true }),
        ipfs: expect.objectContaining({ status: 'skipped', configured: true }),
        blockchainRpc: expect.objectContaining({ status: 'skipped', configured: true }),
      }),
    );

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health responde estructura segura', async () => {
    const { app, moduleRef } = await createHealthApp();
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
        uptime: expect.any(Number),
        environment: 'test',
        version: 'test-version',
        services: expect.objectContaining({
          database: expect.objectContaining({ status: 'connected' }),
          redis: expect.objectContaining({ status: 'ok', critical: true }),
          firebase: expect.objectContaining({ status: 'ok', critical: true }),
        }),
        externals: expect.objectContaining({
          gemini: expect.objectContaining({ status: 'skipped', configured: true }),
          ipfs: expect.objectContaining({ status: 'skipped', configured: true }),
          blockchainRpc: expect.objectContaining({ status: 'skipped', configured: true }),
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('private-key');
    expect(JSON.stringify(response.body)).not.toContain('gemini-key');

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/liveness responde 200 sin tocar dependencias', async () => {
    const { app, moduleRef, mongoPing } = await createHealthApp();
    await request(app.getHttpServer())
      .get('/api/v1/health/liveness')
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.objectContaining({
            status: 'ok',
            timestamp: expect.any(String),
            uptime: expect.any(Number),
            environment: 'test',
            version: 'test-version',
          }),
        );
      });

    expect(mongoPing).not.toHaveBeenCalled();
    expect(mockRedisClient.connect).not.toHaveBeenCalled();
    expect(mockRedisClient.ping).not.toHaveBeenCalled();
    expect(mockGeminiGet).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/readiness con Mongo, Redis y Firebase OK responde 200', async () => {
    const { app, moduleRef, mongoPing } = await createHealthApp();
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/readiness')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        environment: 'test',
        uptime: expect.any(Number),
        version: 'test-version',
        timestamp: expect.any(String),
        status: 'ok',
        checks: expect.objectContaining({
          database: expect.objectContaining({
            status: 'ok',
            critical: true,
            readyState: 'connected',
            name: 'mock-health-db',
            latencyMs: expect.any(Number),
          }),
          redis: expect.objectContaining({ status: 'ok', critical: true, configured: true, latencyMs: expect.any(Number) }),
          firebase: expect.objectContaining({ status: 'ok', critical: true, configured: true }),
        }),
      }),
    );
    expect(mongoPing).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
    expect(mockGeminiGet).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/readiness con Mongo down responde 503', async () => {
    const { app, moduleRef } = await createHealthApp({ mongoReadyState: 0 });
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/readiness')
      .expect(503);

    expect(response.body.status).toBe('down');
    expect(response.body.checks.database).toEqual(
      expect.objectContaining({
        status: 'down',
        critical: true,
        readyState: 'disconnected',
      }),
    );

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/readiness con Redis sin configuracion requerida responde 503', async () => {
    const { app, moduleRef } = await createHealthApp({
      config: {
        'app.redis.host': '',
      },
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/readiness')
      .expect(503);

    expect(response.body.status).toBe('down');
    expect(response.body.checks.redis).toEqual(
      expect.objectContaining({
        status: 'down',
        critical: true,
        configured: false,
      }),
    );
    expect(mockRedisClient.connect).not.toHaveBeenCalled();

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/readiness con Redis configurado pero PING fallando responde 503', async () => {
    mockRedisClient.ping.mockRejectedValueOnce(new Error('redis unavailable'));
    const { app, moduleRef } = await createHealthApp();
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/readiness')
      .expect(503);

    expect(response.body.status).toBe('down');
    expect(response.body.checks.redis).toEqual(
      expect.objectContaining({
        status: 'down',
        critical: true,
        configured: true,
      }),
    );

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/readiness con Firebase missing config responde 503', async () => {
    const { app, moduleRef } = await createHealthApp({
      config: {
        'app.firebase.projectId': '',
      },
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/readiness')
      .expect(503);

    expect(response.body.status).toBe('down');
    expect(response.body.checks.firebase).toEqual(
      expect.objectContaining({
        status: 'down',
        critical: true,
        configured: false,
      }),
    );

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/externals sin JWT responde 401', async () => {
    const { app, moduleRef } = await createHealthApp();

    await request(app.getHttpServer()).get('/api/v1/health/externals').expect(401);
    expect(mockGeminiGet).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/externals con usuario no admin responde 403', async () => {
    const { app, moduleRef } = await createHealthApp();

    await request(app.getHttpServer())
      .get('/api/v1/health/externals')
      .set('Authorization', 'Bearer user-token')
      .expect(403);
    expect(mockGeminiGet).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await app.close();
    await moduleRef.close();
  });

  it('GET /api/v1/health/externals con admin ejecuta checks reales seguros', async () => {
    const { app, moduleRef } = await createHealthApp();

    const response = await request(app.getHttpServer())
      .get('/api/v1/health/externals')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        timestamp: expect.any(String),
        checks: expect.objectContaining({
          gemini: expect.objectContaining({
            status: 'ok',
            configured: true,
            latencyMs: expect.any(Number),
          }),
          ipfsGateway: expect.objectContaining({
            status: 'ok',
            configured: true,
            latencyMs: expect.any(Number),
          }),
          blockchainRpc: expect.objectContaining({
            status: 'ok',
            configured: true,
            latencyMs: expect.any(Number),
          }),
        }),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain('gemini-key');
    expect(mockGeminiGet).toHaveBeenCalledWith({ model: 'gemini-test-model' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    await app.close();
    await moduleRef.close();
  });
});
