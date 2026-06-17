import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { HealthController } from '@/core/controllers/health.controller';
import { HealthService } from '@/core/services/health.service';

describe('Core health smoke', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: getConnectionToken(),
          useValue: {
            readyState: 1,
            host: 'mock-mongo-host',
            name: 'mock-health-db',
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                'app.nodeEnv': 'test',
                'app.version': 'test-version',
              };
              return values[key];
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  it('GET /health responde 200 con un payload minimo estable', async () => {
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
  });
});
