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

describe('Auth context HTTP contract', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let authService: {
    signIn: jest.Mock;
    getAccessStatus: jest.Mock;
  };

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
          const authHeader = req.headers.authorization;
          if (!authHeader) {
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

  it('POST /api/v1/auth/login retorna contexto estable para admin', async () => {
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
    expect(response.body.accessStatus).toEqual(
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
    expect(response.body).not.toHaveProperty('password');
    expect(authService.signIn).toHaveBeenCalledWith({
      email: 'admin@example.com',
      password: 'secret123',
    });
  });

  it('POST /api/v1/auth/login inválido retorna error controlado sin token', async () => {
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
  });

  it('GET /api/v1/auth/access-status retorna shape estable autenticado', async () => {
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

  it('GET /api/v1/auth/access-status sin token retorna 401 controlado', async () => {
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
});
