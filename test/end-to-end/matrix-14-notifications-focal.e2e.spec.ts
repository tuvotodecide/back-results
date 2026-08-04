import { Body, Controller, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { InstitutionalVotingNotificationsService } from '@/modules/institutional-voting/services/notifications/institutional-voting-notifications.service';
import { VotingEvent } from '@/modules/institutional-voting/schemas/voting-event.schema';
import { TenantAdminAssignment } from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { PadronUsersService } from '@/modules/institutional-voting/services/core/padron-users.service';
import { MailService } from '@/modules/mail/mail.service';
import { UsersController } from '@/modules/users/controllers/users.controller';
import { UsersService } from '@/modules/users/services/users.service';
import { UserNotification } from '@/modules/notifications/schemas/user-notification.schema';
import { NotificationLog } from '@/modules/notifications/schemas/notification-log.schema';
import { ZkAuthGuard } from '@/core/guards/zk-auth.guard';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthServiceMock {},
}));

type StoredRow = Record<string, unknown>;

@Controller('_mx14/e2e')
class Matrix14E2eController {
  constructor(private readonly notifications: InstitutionalVotingNotificationsService) {}

  @Post('partial')
  partial(@Body() body: { eventId: string }) {
    return this.notifications.notifyNewsToCurrentPadron(
      { _id: body.eventId, name: 'Elección de prueba' } as never,
      { title: 'Noticia', body: 'Mensaje focal' },
    );
  }
}

function listQuery(rows: StoredRow[]) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
}

describe('MX-14 Backend Results — E2E focal', () => {
  let app: INestApplication | undefined;
  let firebaseSend: jest.Mock;
  let inboxRows: StoredRow[];
  let logRows: StoredRow[];
  let apiKeyIsValid: boolean;

  beforeEach(async () => {
    inboxRows = [];
    logRows = [];
    apiKeyIsValid = true;
    firebaseSend = jest.fn().mockResolvedValueOnce('sent-1').mockRejectedValueOnce(new Error('simulated firebase failure'));
    const padronUsers = {
      getPadronUsersFromEvent: jest.fn().mockResolvedValue([
        { _id: new Types.ObjectId(), dni: '111', active: true, enabled: true },
        { _id: new Types.ObjectId(), dni: '222', active: true, enabled: true },
      ]),
    };
    const userId = new Types.ObjectId();
    const moduleRef = await Test.createTestingModule({
      controllers: [Matrix14E2eController, UsersController],
      providers: [
        InstitutionalVotingNotificationsService,
        { provide: 'FIREBASE_ADMIN', useValue: { messaging: jest.fn(() => ({ send: firebaseSend })) } },
        { provide: getModelToken(UserNotification.name), useValue: { insertMany: jest.fn(async (rows: StoredRow[]) => { inboxRows.push(...rows); return rows; }), find: jest.fn(() => listQuery(inboxRows)), countDocuments: jest.fn(async () => inboxRows.length) } },
        { provide: getModelToken(NotificationLog.name), useValue: { insertMany: jest.fn(async (rows: StoredRow[]) => { logRows.push(...rows); return rows; }), find: jest.fn(() => listQuery(logRows)), exists: jest.fn(), countDocuments: jest.fn(async () => logRows.length) } },
        { provide: getModelToken(VotingEvent.name), useValue: { updateOne: jest.fn() } },
        { provide: getModelToken(TenantAdminAssignment.name), useValue: { find: jest.fn() } },
        { provide: getModelToken(RoledUser.name), useValue: { find: jest.fn() } },
        { provide: PadronUsersService, useValue: padronUsers },
        { provide: MailService, useValue: { sendEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => {
          if (key === 'app.apiKey.header') return 'x-api-key';
          if (key === 'app.blockchain.chain') return 'test-chain';
          return undefined;
        }) } },
        { provide: ZkAuthService, useValue: { isApiKeyValid: jest.fn(() => apiKeyIsValid) } },
        { provide: UsersService, useValue: { findOrCreateByDni: jest.fn(async (dni: string) => ({ _id: userId, dni, votingLocationId: undefined })) } },
        ZkAuthGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    jest.clearAllMocks();
  });

  it('[MX-14][NOT-DUP-P1-002][E2E] HTTP con éxito parcial conserva bandeja, logs SENT/FAILED y respuesta agregada', async () => {
    if (!app) throw new Error('MX-14 E2E app no inicializada');
    const response = await request(app.getHttpServer()).post('/_mx14/e2e/partial').send({ eventId: String(new Types.ObjectId()) });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ sent: 1, failed: 1 });
    expect(inboxRows).toHaveLength(2);
    expect(logRows.map((row) => row.status).sort()).toEqual(['FAILED', 'SENT']);
    expect(firebaseSend).toHaveBeenCalledTimes(2);
  });

  it('[MX-14][NOT-SEC-P0-001][E2E] documenta comportamiento actual con DNI diferente y rechaza sesión inválida', async () => {
    if (!app) throw new Error('MX-14 E2E app no inicializada');
    const differentDni = await request(app.getHttpServer()).get('/api/v1/users/otro-dni/notifications').set('x-api-key', 'valid');
    apiKeyIsValid = false;
    const invalid = await request(app.getHttpServer()).get('/api/v1/users/otro-dni/notifications');

    expect(differentDni.status).toBe(200);
    expect(differentDni.body).toEqual(expect.objectContaining({ data: [], page: 1, limit: 50 }));
    expect(invalid.status).toBe(403);
    expect(invalid.body.data).toBeUndefined();
  });
});
