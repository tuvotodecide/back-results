import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { NotificationLogsController } from '@/modules/notifications/controllers/notification-logs.controller';
import {
  NotificationLog,
  NotificationLogSchema,
} from '@/modules/notifications/schemas/notification-log.schema';

describe('Notification logs E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: NotificationLog.name, schema: NotificationLogSchema }]),
      ],
      controllers: [NotificationLogsController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await conn.collection('notification_logs').deleteMany({});
    await conn.collection('notification_logs').insertMany([
      {
        type: 'announce_count',
        topic: 'loc_1',
        locationId: 'loc-1',
        tableId: 'table-1',
        title: 'Conteo',
        body: 'Mesa lista',
        data: { tableCode: 'M1' },
        status: 'SENT',
        messageId: 'msg-1',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      {
        type: 'generic',
        topic: 'user_1',
        title: 'Credencial',
        body: 'Lista',
        data: { userId: 'user-1' },
        status: 'SENT',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
  });

  it('GET /api/v1/notifications/logs lista logs con shape paginado actual', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications/logs')
      .query({ page: 1, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        total: 2,
        page: 1,
        limit: 1,
        totalPages: 2,
      }),
    );
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        type: 'announce_count',
        topic: 'loc_1',
        status: 'SENT',
      }),
    );
  });

  it('GET /api/v1/notifications/logs filtra por locationId, topic y type', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/notifications/logs')
      .query({
        locationId: 'loc-1',
        topic: 'loc_1',
        type: 'announce_count',
        page: 1,
        limit: 10,
      });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.totalPages).toBe(1);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        type: 'announce_count',
        topic: 'loc_1',
        locationId: 'loc-1',
        tableId: 'table-1',
        status: 'SENT',
      }),
    );
  });
});
