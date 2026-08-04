import { ExecutionContext, INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '@/modules/auth/services/auth.service';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { ContractsController } from '@/modules/contracts/controllers/contracts.controller';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';

describe('MX-10 | aceptación de aprobación territorial', () => {
  let app: INestApplication | undefined;
  const jwtService = {
    verifyAsync: jest.fn(),
  } satisfies Partial<JwtService>;
  const roledUserModel = {
    find: jest.fn(),
  };
  let authenticatedUser: Record<string, unknown>;
  const jwtGuardMock = {
    canActivate: jest.fn((context: ExecutionContext) => {
      const request = context.switchToHttp().getRequest<Record<string, unknown>>();
      request.user = authenticatedUser;
      return true;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        AccessApproverGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: ContractsService, useValue: {} },
        { provide: ElectoralLocationService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: getModelToken(RoledUser.name), useValue: roledUserModel },
      ],
    })
      // JwtAuthGuard belongs to unrelated contracts routes in this controller.
      // The approval routes keep their real AccessApproverGuard.
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuardMock)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authenticatedUser = { sub: '650000000000000000000001', role: 'ACCESS_APPROVER', active: true };
  });

  it('[MX-10][CON-ACC-P0-001][ACEPTACION] lista sólo solicitudes territoriales para un aprobador autenticado', async () => {
    authenticatedUser = { sub: '650000000000000000000001', role: 'ACCESS_APPROVER', active: true };
    jwtService.verifyAsync.mockResolvedValue({ sub: '650000000000000000000001', role: 'ACCESS_APPROVER', active: true });
    roledUserModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: { toString: () => '650000000000000000000002' }, dni: '1234567', email: 'mayor@example.test', name: 'Alcaldesa', role: 'MAYOR', active: false, territorialAccessStatus: 'PENDING_APPROVAL' },
        ]),
      }),
    });

    const response = await request(app!.getHttpServer())
      .get('/api/v1/contracts/territorial-access-requests?status=PENDING_APPROVAL')
      .set('Authorization', 'Bearer approver')
      .expect(200);

    expect(roledUserModel.find).toHaveBeenCalledWith({ role: { $in: ['MAYOR', 'GOVERNOR'] }, territorialAccessStatus: 'PENDING_APPROVAL' });
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('approver');
    expect(jwtGuardMock.canActivate).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({ data: [expect.objectContaining({ role: 'MAYOR', territorialAccessStatus: 'PENDING_APPROVAL' })], total: 1 });
  });

  it('[MX-10][PER-APP-P0-004][ACEPTACION] rechaza la bandeja de aprobación para un rol territorial', async () => {
    authenticatedUser = { sub: '650000000000000000000003', role: 'MAYOR', active: true };
    jwtService.verifyAsync.mockResolvedValue({ sub: '650000000000000000000003', role: 'MAYOR', active: true });

    await request(app!.getHttpServer())
      .get('/api/v1/contracts/territorial-access-requests')
      .set('Authorization', 'Bearer mayor')
      .expect(403);

    expect(roledUserModel.find).not.toHaveBeenCalled();
    expect(jwtGuardMock.canActivate).not.toHaveBeenCalled();
  });
});
