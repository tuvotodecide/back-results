import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { AnnouncementsController } from '@/modules/notifications/controllers/announcements.controller';
import { TopicMessagingService } from '@/modules/notifications/services/topic-messaging.service';
import {
  NotificationLog,
  NotificationLogSchema,
} from '@/modules/notifications/schemas/notification-log.schema';
import {
  UserNotification,
  UserNotificationSchema,
} from '@/modules/notifications/schemas/user-notification.schema';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';

describe('Notifications announcements E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;
  let mongod: MongoMemoryServer;
  let firebaseMessaging: { send: jest.Mock };
  let locations: { resolveByIdOrCode: jest.Mock };
  let tables: { resolveByIdOrCode: jest.Mock };
  const locationId = new Types.ObjectId();
  const tableId = new Types.ObjectId();

  beforeAll(async () => {
    firebaseMessaging = {
      send: jest.fn().mockResolvedValue('mock-message-id'),
    };
    locations = {
      resolveByIdOrCode: jest.fn(),
    };
    tables = {
      resolveByIdOrCode: jest.fn(),
    };
    mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: NotificationLog.name, schema: NotificationLogSchema },
          { name: UserNotification.name, schema: UserNotificationSchema },
          { name: User.name, schema: UserSchema },
        ]),
      ],
      controllers: [AnnouncementsController],
      providers: [
        TopicMessagingService,
        { provide: 'FIREBASE_ADMIN', useValue: { messaging: jest.fn(() => firebaseMessaging) } },
        { provide: ElectoralLocationService, useValue: locations },
        { provide: ElectoralTableService, useValue: tables },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    firebaseMessaging.send.mockReset().mockResolvedValue('mock-message-id');
    locations.resolveByIdOrCode.mockReset().mockResolvedValue({
      _id: locationId,
      name: 'Recinto Central',
      address: 'Av. Principal',
    });
    tables.resolveByIdOrCode.mockReset().mockResolvedValue({
      _id: tableId,
      electoralLocationId: locationId,
      tableNumber: '7',
      tableCode: 'MESA-7',
    });
    await conn.collection('notification_logs').deleteMany({});
    await conn.collection('user_notifications').deleteMany({});
    await conn.collection('users').deleteMany({});
  });

  it('POST /api/v1/announcements/count anuncia al topic del recinto y registra log SENT', async () => {
    await conn.collection('users').insertOne({
      _id: new Types.ObjectId(),
      dni: '123456',
      votingLocationId: locationId,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/announcements/count')
      .send({
        locationId: String(locationId),
        tableId: String(tableId),
        title: 'Inicio de conteo',
        body: 'Se habilito conteo en el recinto',
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ success: true, result: 'mock-message-id' });
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `loc_${String(locationId)}`,
        notification: {
          title: 'Inicio de conteo',
          body: 'Se habilito conteo en el recinto',
        },
        data: expect.objectContaining({
          type: 'announce_count',
          locationId: String(locationId),
          tableId: String(tableId),
          tableNumber: '7',
          tableCode: 'MESA-7',
        }),
      }),
    );

    const logs = await conn.collection('notification_logs').find({}).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        type: 'announce_count',
        topic: `loc_${String(locationId)}`,
        locationId: String(locationId),
        tableId: String(tableId),
        title: 'Inicio de conteo',
        body: 'Se habilito conteo en el recinto',
        status: 'SENT',
        messageId: 'mock-message-id',
      }),
    );

    const userNotifications = await conn.collection('user_notifications').find({}).toArray();
    expect(userNotifications).toHaveLength(1);
    expect(userNotifications[0]).toEqual(
      expect.objectContaining({
        dni: '123456',
        topic: `loc_${String(locationId)}`,
        locationId: String(locationId),
        tableId: String(tableId),
        status: 'NEW',
      }),
    );
  });

  it('POST /api/v1/announcements/count documenta error cuando la mesa no pertenece al recinto', async () => {
    tables.resolveByIdOrCode.mockResolvedValueOnce({
      _id: tableId,
      electoralLocationId: new Types.ObjectId(),
      tableNumber: '8',
      tableCode: 'MESA-8',
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/announcements/count')
      .send({
        locationId: String(locationId),
        tableId: String(tableId),
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      success: false,
      error: 'La mesa no pertenece al recinto',
    });
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(await conn.collection('notification_logs').countDocuments()).toBe(0);
  });

  it('POST /api/v1/announcements/count registra FAILED cuando Firebase mock falla', async () => {
    firebaseMessaging.send.mockRejectedValueOnce(new Error('fcm failed'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/announcements/count')
      .send({
        locationId: String(locationId),
        tableId: String(tableId),
      });

    expect(response.status).toBe(500);
    const logs = await conn.collection('notification_logs').find({}).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        type: 'announce_count',
        topic: `loc_${String(locationId)}`,
        status: 'FAILED',
        error: 'fcm failed',
      }),
    );
  });
});
