import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { OfficialPublicationAdminController } from '@/modules/institutional-voting/controllers/official-publication-admin.controller';
import { OfficialPublicationMobileController } from '@/modules/institutional-voting/controllers/official-publication-mobile.controller';
import { OfficialPublicationApiService } from '@/modules/institutional-voting/services/publication/official-publication-api.service';

describe('Official publication API routes (integration)', () => {
  let app: INestApplication;
  let api: Record<string, jest.Mock>;

  beforeEach(async () => {
    api = {
      createAdminRequest: jest.fn().mockResolvedValue({
        created: true,
        request: { requestId: 'request-1', status: 'PENDING_APPROVAL' },
      }),
      getActiveAdminRequest: jest.fn().mockResolvedValue({ request: null }),
      getAdminRequest: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'PENDING_APPROVAL' },
      }),
      cancelAdminRequest: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'CANCELLED' },
      }),
      getMobileRequest: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'PENDING_APPROVAL' },
      }),
      claimMobileRequest: jest.fn().mockResolvedValue({
        requestId: 'request-1',
        status: 'CLAIMED',
      }),
      markMobileSigning: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'SIGNING' },
      }),
      rejectMobileRequest: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'REJECTED' },
      }),
      registerMobileSubmission: jest.fn().mockResolvedValue({
        request: { requestId: 'request-1', status: 'SUBMITTED' },
      }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        OfficialPublicationAdminController,
        OfficialPublicationMobileController,
      ],
      providers: [
        {
          provide: OfficialPublicationApiService,
          useValue: api,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          context.switchToHttp().getRequest().user = { sub: 'admin-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('expone la ruta administrativa canonica de creacion sin llamar legacy', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/voting/events/event-1/official-publication/requests')
      .expect(201);

    expect(api.createAdminRequest).toHaveBeenCalledWith('event-1', {
      sub: 'admin-1',
    });
  });

  it('valida deviceId y elimina campos contractuales arbitrarios del body movil', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/mobile/official-publication/requests/request-1/claim')
      .send({ deviceId: '   ' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/mobile/official-publication/requests/request-1/submission')
      .send({
        deviceId: 'device-1',
        userOpHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        callData: '0xdead',
        institutionId: 'evil',
        status: 'CHAIN_CONFIRMED',
      })
      .expect(200);

    expect(api.registerMobileSubmission).toHaveBeenCalledWith(
      'request-1',
      { sub: 'admin-1' },
      {
        deviceId: 'device-1',
        userOpHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    );
  });

  it('no expone endpoint cliente para marcar CHAIN_CONFIRMED', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/mobile/official-publication/requests/request-1/chain-confirmed')
      .send({ status: 'CHAIN_CONFIRMED' })
      .expect(404);
  });
});
