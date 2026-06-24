import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { InternalPushController } from '@/modules/notifications/controllers/internal-push.controller';
import { DirectPushService } from '@/modules/notifications/services/direct-push.service';
import {
  NotificationLog,
  NotificationLogSchema,
} from '@/modules/notifications/schemas/notification-log.schema';
import { User, UserSchema } from '@/modules/users/schemas/user.schema';

describe('Notifications internal push E2E', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let conn: Connection;
  let mongod: MongoMemoryServer;
  let firebaseMessaging: { send: jest.Mock };
  const previousSecret = process.env.INTERNAL_PUSH_SECRET;

  beforeAll(async () => {
    process.env.INTERNAL_PUSH_SECRET = 'test-internal-secret';
    firebaseMessaging = {
      send: jest.fn().mockResolvedValue('mock-message-id'),
    };
    mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: NotificationLog.name, schema: NotificationLogSchema },
          { name: User.name, schema: UserSchema },
        ]),
      ],
      controllers: [InternalPushController],
      providers: [
        DirectPushService,
        { provide: 'FIREBASE_ADMIN', useValue: { messaging: jest.fn(() => firebaseMessaging) } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    conn = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    if (previousSecret === undefined) {
      delete process.env.INTERNAL_PUSH_SECRET;
    } else {
      process.env.INTERNAL_PUSH_SECRET = previousSecret;
    }
    await app.close();
    await conn.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    firebaseMessaging.send.mockClear();
    await conn.collection('notification_logs').deleteMany({});
    await conn.collection('users').deleteMany({});
  });

  it('POST /internal/push acepta x-internal-secret válido, llama Firebase mock y registra log', async () => {
    const userId = new Types.ObjectId();
    const response = await request(app.getHttpServer())
      .post('/internal/push')
      .set('x-internal-secret', 'test-internal-secret')
      .send({
        tokens: ['token-1'],
        notification: { title: 'Credencial lista', body: 'Tu credencial fue emitida' },
        data: { userId: String(userId), type: 'credential_issued' },
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ success: true });
    expect(firebaseMessaging.send).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-1',
        notification: { title: 'Credencial lista', body: 'Tu credencial fue emitida' },
        data: { userId: String(userId), type: 'credential_issued' },
      }),
    );

    const logs = await conn.collection('notification_logs').find({}).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual(
      expect.objectContaining({
        type: 'generic',
        topic: `user_${String(userId)}`,
        title: 'Credencial lista',
        body: 'Tu credencial fue emitida',
        status: 'SENT',
      }),
    );
  });

  it('POST /internal/push rechaza secret inválido y no llama Firebase', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/push')
      .set('x-internal-secret', 'wrong-secret')
      .send({
        tokens: ['token-1'],
        notification: { title: 'Titulo', body: 'Mensaje' },
        data: { dni: '123456' },
      });

    expect(response.status).toBe(401);
    expect(firebaseMessaging.send).not.toHaveBeenCalled();
    expect(await conn.collection('notification_logs').countDocuments()).toBe(0);
  });
});
