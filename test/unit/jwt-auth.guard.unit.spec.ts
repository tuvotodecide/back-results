import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';

type RequestLike = {
  headers: { authorization?: string };
  path?: string;
  url?: string;
  user?: unknown;
};

const buildContext = (request: RequestLike): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  }) as unknown as ExecutionContext;

const buildGuard = (
  payload: Record<string, unknown>,
  storedUser: { active: boolean; authVersion: number } | null,
) => {
  const jwtService = {
    verifyAsync: jest.fn().mockResolvedValue(payload),
  } as unknown as JwtService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const findById = jest.fn().mockReturnValue({
    lean: jest.fn().mockResolvedValue(storedUser),
  });
  const model = { findById };
  const connection = {
    models: { [RoledUser.name]: model },
    model: jest.fn(),
  };

  return {
    guard: new JwtAuthGuard(
      jwtService,
      reflector,
      connection as unknown as ConstructorParameters<typeof JwtAuthGuard>[2],
    ),
    jwtService,
    findById,
  };
};

describe('JwtAuthGuard authVersion freshness', () => {
  const userId = new Types.ObjectId().toString();

  it('permite rutas institucionales cuando el authVersion del token sigue vigente', async () => {
    const request: RequestLike = {
      headers: { authorization: 'Bearer token-ok' },
      path: '/api/v1/institutional-access-recovery-requests',
    };
    const payload = {
      sub: userId,
      active: true,
      authVersion: 3,
    };
    const { guard, findById } = buildGuard(payload, {
      active: true,
      authVersion: 3,
    });

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);

    expect(findById).toHaveBeenCalledWith(userId, {
      active: 1,
      authVersion: 1,
    });
    expect(request.user).toEqual(payload);
  });

  it('devuelve AUTH_VERSION_MISMATCH solo cuando el token institucional queda viejo', async () => {
    const request: RequestLike = {
      headers: { authorization: 'Bearer token-old' },
      path: '/api/v1/institutional-access-recovery-requests',
    };
    const { guard } = buildGuard(
      { sub: userId, active: true, authVersion: 1 },
      { active: true, authVersion: 2 },
    );

    await expect(guard.canActivate(buildContext(request))).rejects.toMatchObject({
      response: {
        statusCode: 401,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Authentication session is no longer valid',
      },
    });

    await expect(guard.canActivate(buildContext(request))).rejects.not.toThrow(
      /authVersion.*1|authVersion.*2/i,
    );
  });

  it('mantiene 401 generico para JWT invalido', async () => {
    const request: RequestLike = {
      headers: { authorization: 'Bearer bad-token' },
      path: '/api/v1/institutional-access-recovery-requests',
    };
    const jwtService = {
      verifyAsync: jest.fn().mockRejectedValue(new Error('jwt malformed')),
    } as unknown as JwtService;
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(
      jwtService,
      reflector,
      {
        models: {},
        model: jest.fn(),
      } as unknown as ConstructorParameters<typeof JwtAuthGuard>[2],
    );

    try {
      await guard.canActivate(buildContext(request));
      throw new Error('Expected guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      const response =
        error instanceof UnauthorizedException ? error.getResponse() : null;
      expect(JSON.stringify(response)).not.toContain('AUTH_VERSION_MISMATCH');
      expect(JSON.stringify(response)).not.toContain('jwt malformed');
    }
  });
});
