import { ForbiddenException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

jest.mock('@/core/guards/admin-only.guard', () => ({
  AdminOnlyGuard: class AdminOnlyGuard {
    canActivate() {
      return true;
    }
  },
}));

jest.mock('@/core/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { AuthController } from '@/modules/auth/controllers/auth.controller';
import { AuthService } from '@/modules/auth/services/auth.service';

describe('MX-03 | Auth administrative canonical HTTP contract', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let authService: { signIn: jest.Mock; getAccessStatus: jest.Mock };

  const accessStatus = {
    tenant: {
      hasApprovedAccess: false,
      latestStatus: null,
      canRequest: true,
      shouldSelectTenantContext: false,
      message: 'El usuario no tiene acceso institucional aprobado',
      items: [],
    },
    territorial: {
      hasApprovedAccess: false,
      status: 'NONE',
      requestedRole: null,
      votingDepartmentId: null,
      votingMunicipalityId: null,
      reason: null,
      canRequest: true,
      message: 'El usuario no tiene acceso territorial aprobado',
    },
  };

  beforeEach(async () => {
    authService = {
      signIn: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        role: 'ADMIN',
        active: true,
        tenantId: null,
        availableContexts: [
          { type: 'GLOBAL_ADMIN', role: 'ADMIN', label: 'Administrador global' },
        ],
        requiresContextSelection: false,
        defaultContext: {
          type: 'GLOBAL_ADMIN',
          role: 'ADMIN',
          label: 'Administrador global',
        },
        accessStatus,
      }),
      getAccessStatus: jest.fn().mockResolvedValue(accessStatus),
    };

    moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) {
            throw new UnauthorizedException();
          }
          req.user = { sub: '507f1f77bcf86cd799439011' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    await moduleRef?.close();
  });

  it('[MX-03][AUT-LOG-P0-002][ACEPTACION] login administrativo valido retorna token usuario contexto y access-status', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'secret123' })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        role: 'ADMIN',
        active: true,
        tenantId: null,
        availableContexts: expect.any(Array),
        requiresContextSelection: expect.any(Boolean),
        defaultContext: expect.any(Object),
        accessStatus: expect.any(Object),
      }),
    );
    expect(response.body.availableContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'GLOBAL_ADMIN', role: 'ADMIN' }),
      ]),
    );
    expect(response.body).not.toHaveProperty('password');
    expect(authService.signIn).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'secret123',
    });
  });

  it('[MX-03][AUT-STA-P0-001][ACEPTACION] bloquea correo pendiente sin emitir token', async () => {
    authService.signIn.mockRejectedValueOnce(
      new UnauthorizedException({
        message: 'El correo electrónico no ha sido verificado',
        code: 'EMAIL_NOT_VERIFIED',
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pending@example.com', password: 'secret123' })
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        message: 'El correo electrónico no ha sido verificado',
        code: 'EMAIL_NOT_VERIFIED',
      }),
    );
    expect(response.body).not.toHaveProperty('accessToken');
    expect(authService.signIn).toHaveBeenCalledWith({
      email: 'pending@example.com',
      password: 'secret123',
    });
  });

  it('[MX-03][AUT-SES-P0-001][ACEPTACION] access-status autenticado retorna shape estable', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .auth('mock-access-token', { type: 'bearer' })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        tenant: expect.objectContaining({
          hasApprovedAccess: expect.any(Boolean),
          canRequest: expect.any(Boolean),
          shouldSelectTenantContext: expect.any(Boolean),
          message: expect.any(String),
          items: expect.any(Array),
        }),
        territorial: expect.objectContaining({
          hasApprovedAccess: expect.any(Boolean),
          status: expect.any(String),
          canRequest: expect.any(Boolean),
          message: expect.any(String),
        }),
      }),
    );
    expect(authService.getAccessStatus).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
    );
  });

  it('[MX-03][AUT-SES-P0-002][ACEPTACION] access-status sin token retorna 401 controlado', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/access-status')
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        message: expect.any(String),
      }),
    );
  });

  it('[MX-03][AUT-HTTP-P0-001][AUT-CRE-P0-003][ACEPTACION] login invalido no retorna token ni datos sensibles', async () => {
    authService.signIn.mockRejectedValueOnce(
      new ForbiddenException('Credenciales inválidas'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' })
      .expect(403);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 403,
        message: expect.any(String),
        error: expect.any(String),
      }),
    );
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('password');
    expect(response.body).not.toHaveProperty('availableContexts');
    expect(response.body).not.toHaveProperty('accessStatus');
  });

  it('[MX-03][AUT-CRE-P1-004][INTEGRACION] dos ingresos del mismo usuario conservan rol y contexto funcional', async () => {
    const credentials = { email: 'admin@example.com', password: 'secret123' };
    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/api/v1/auth/login').send(credentials).expect(200),
      request(app.getHttpServer()).post('/api/v1/auth/login').send(credentials).expect(200),
    ]);

    expect(authService.signIn).toHaveBeenCalledTimes(2);
    expect(authService.signIn).toHaveBeenNthCalledWith(1, credentials);
    expect(authService.signIn).toHaveBeenNthCalledWith(2, credentials);

    for (const response of [first, second]) {
      expect(response.body).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          role: 'ADMIN',
          active: true,
          tenantId: null,
          availableContexts: [
            expect.objectContaining({ type: 'GLOBAL_ADMIN', role: 'ADMIN' }),
          ],
          requiresContextSelection: false,
          defaultContext: expect.objectContaining({
            type: 'GLOBAL_ADMIN',
            role: 'ADMIN',
          }),
          accessStatus,
        }),
      );
      expect(response.body).not.toHaveProperty('password');
    }

    expect(first.body.role).toBe(second.body.role);
    expect(first.body.availableContexts).toEqual(second.body.availableContexts);
    expect(first.body.defaultContext).toEqual(second.body.defaultContext);
    expect(first.body.accessStatus).toEqual(second.body.accessStatus);
  });
});
