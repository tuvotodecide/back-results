import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { JwtAuthGuard } from '@/core/guards/jwt-auth.guard';
import {
  PasswordResetContext,
} from '@/modules/auth/dto/password-reset.dto';
import { RoledUser } from '@/modules/auth/schemas/roledUser.schema';
import { AuthService } from '@/modules/auth/services/auth.service';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';

const buildAuthService = (
  roledUserModel: Record<string, jest.Mock>,
  overrides: Partial<{
    configService: Pick<ConfigService, 'get'>;
    mailService: { sendEmail: jest.Mock };
  }> = {},
) =>
  new AuthService(
    roledUserModel as any,
    { exists: jest.fn() } as any,
    { exists: jest.fn() } as any,
    { exists: jest.fn(), find: jest.fn() } as any,
    { find: jest.fn() } as any,
    { find: jest.fn(), findOne: jest.fn() } as any,
    { signAsync: jest.fn() } as unknown as JwtService,
    (overrides.mailService ?? { sendEmail: jest.fn() }) as any,
    (overrides.configService ?? { get: jest.fn() }) as ConfigService,
  );

const buildUser = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'MAYOR',
  active: true,
  verificationToken: 'verification-current',
  verificationTokenExpiresAt: new Date(Date.now() + 60_000),
  passwordResetToken: 'reset-current',
  passwordResetTokenExpiresAt: new Date(Date.now() + 60_000),
  authVersion: 4,
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const chainLean = <T>(value: T) => ({
  lean: jest.fn().mockResolvedValue(value),
});

describe('MX-03 | Auth administrative canonical unit coverage', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('[MX-03][AUT-EML-P1-001][UNITARIA] consume un token de verificacion valido', async () => {
    const user = buildUser();
    const service = buildAuthService({
      findOne: jest.fn().mockResolvedValue(user),
    });
    jest.spyOn(service, 'syncUserActiveState').mockResolvedValue(undefined);

    await expect(service.verifyEmail('verification-current')).resolves.toBe(user);

    expect(user.verificationToken).toBeUndefined();
    expect(user.verificationTokenExpiresAt).toBeUndefined();
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('[MX-03][AUT-EML-P1-002][UNITARIA] rechaza token de verificacion ausente vacio o inexistente', async () => {
    const user = buildUser();
    const service = buildAuthService({ findOne: jest.fn().mockResolvedValue(null) });

    await expect(service.verifyEmail(undefined as unknown as string)).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
    await expect(service.verifyEmail('')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
    await expect(service.verifyEmail('verification-missing')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );

    expect(user.save).not.toHaveBeenCalled();
  });

  it('[MX-03][AUT-EML-P1-003][UNITARIA] rechaza token de verificacion vencido', async () => {
    const expiredUser = buildUser({
      verificationTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    const service = buildAuthService({
      findOne: jest.fn().mockResolvedValue(expiredUser),
    });

    await expect(service.verifyEmail('verification-current')).rejects.toThrow(
      new BadRequestException('El token de verificación ha expirado'),
    );

    expect(expiredUser.save).not.toHaveBeenCalled();
  });

  it('[MX-03][AUT-EML-P1-004][UNITARIA] rechaza un token de verificacion consumido', async () => {
    const service = buildAuthService({ findOne: jest.fn().mockResolvedValue(null) });

    await expect(service.verifyEmail('verification-used')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
  });

  it('[MX-03][AUT-EML-P1-005][UNITARIA] acepta solamente el token de verificacion vigente almacenado', async () => {
    const currentUser = buildUser();
    const service = buildAuthService({
      findOne: jest.fn().mockImplementation(({ verificationToken }) =>
        Promise.resolve(
          verificationToken === 'verification-current' ? currentUser : null,
        ),
      ),
    });
    jest.spyOn(service, 'syncUserActiveState').mockResolvedValue(undefined);

    await expect(service.verifyEmail('verification-old')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
    await expect(service.verifyEmail('verification-current')).resolves.toBe(
      currentUser,
    );

    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });

  it('[MX-03][AUT-PWD-P1-002][UNITARIA] no emite reset para usuario no verificado o inactivo', async () => {
    const mailService = { sendEmail: jest.fn() };
    const unverifiedUser = buildUser({ verificationToken: 'verification-pending' });
    const inactiveUser = buildUser({ verificationToken: undefined, active: false });
    const service = buildAuthService(
      {
        findOne: jest
          .fn()
          .mockResolvedValueOnce(unverifiedUser)
          .mockResolvedValueOnce(inactiveUser),
      },
      { mailService },
    );

    await expect(
      service.requestPasswordReset({
        email: 'admin@example.com',
        context: PasswordResetContext.RESULTADOS,
      }),
    ).rejects.toThrow(
      new UnauthorizedException('El correo electrónico no ha sido verificado'),
    );
    await expect(
      service.requestPasswordReset({
        email: 'admin@example.com',
        context: PasswordResetContext.RESULTADOS,
      }),
    ).rejects.toThrow(new UnauthorizedException('El usuario no está activo'));

    expect(unverifiedUser.save).not.toHaveBeenCalled();
    expect(inactiveUser.save).not.toHaveBeenCalled();
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('[MX-03][AUT-PWD-P0-004][UNITARIA] rechaza reset sin token vacio o inexistente sin cambiar password', async () => {
    const user = buildUser();
    const service = buildAuthService({ findOne: jest.fn().mockResolvedValue(null) });

    await expect(
      service.resetPassword({
        token: undefined as unknown as string,
        password: 'newSecret123',
      }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));
    await expect(
      service.resetPassword({ token: '', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));
    await expect(
      service.resetPassword({ token: 'reset-missing', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));

    expect((user as any).password).toBeUndefined();
    expect(user.save).not.toHaveBeenCalled();
  });

  it('[MX-03][AUT-PWD-P0-005][UNITARIA] rechaza token de reset vencido', async () => {
    const expiredUser = buildUser({
      passwordResetTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    const service = buildAuthService({
      findOne: jest.fn().mockResolvedValue(expiredUser),
    });

    await expect(
      service.resetPassword({ token: 'reset-current', password: 'newSecret123' }),
    ).rejects.toThrow(
      new BadRequestException('El token de restablecimiento ha expirado'),
    );

    expect(expiredUser.save).not.toHaveBeenCalled();
  });

  it('[MX-03][AUT-PWD-P0-006][UNITARIA] hashea password limpia token e incrementa authVersion', async () => {
    const user = buildUser({ authVersion: 2 });
    const service = buildAuthService({ findOne: jest.fn().mockResolvedValue(user) });

    await service.resetPassword({
      token: 'reset-current',
      password: 'newSecret123',
    });

    expect((user as any).password).toEqual(expect.any(String));
    expect((user as any).password).not.toBe('newSecret123');
    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetTokenExpiresAt).toBeUndefined();
    expect(user.authVersion).toBe(3);
    expect(user.save).toHaveBeenCalledTimes(1);
  });

  it('[MX-03][AUT-PWD-P0-007][UNITARIA] rechaza un token de reset consumido', async () => {
    const service = buildAuthService({ findOne: jest.fn().mockResolvedValue(null) });

    await expect(
      service.resetPassword({ token: 'reset-used', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));
  });

  it('[MX-03][AUT-PWD-P0-009][UNITARIA] acepta solamente el segundo token de reset vigente', async () => {
    const currentUser = buildUser({ authVersion: 6 });
    const service = buildAuthService({
      findOne: jest.fn().mockImplementation(({ passwordResetToken }) =>
        Promise.resolve(
          passwordResetToken === 'reset-current' ? currentUser : null,
        ),
      ),
    });

    await expect(
      service.resetPassword({ token: 'reset-old', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));
    await expect(
      service.resetPassword({ token: 'reset-current', password: 'newSecret123' }),
    ).resolves.toBeUndefined();

    expect(currentUser.authVersion).toBe(7);
    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });

  it('[MX-03][AUT-SES-P0-003][UNITARIA] mantiene un 401 generico para JWT invalido', async () => {
    const jwtService = {
      verifyAsync: jest.fn().mockRejectedValue(new Error('jwt malformed')),
    } as unknown as JwtService;
    const guard = new JwtAuthGuard(
      jwtService,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      { models: {}, model: jest.fn() } as unknown as ConstructorParameters<
        typeof JwtAuthGuard
      >[2],
    );

    try {
      await guard.canActivate(
        buildContext({
          headers: { authorization: 'Bearer bad-token' },
          path: '/api/v1/institutional-access-recovery-requests',
        }),
      );
      throw new Error('Expected guard to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(JSON.stringify((error as UnauthorizedException).getResponse())).not.toContain(
        'AUTH_VERSION_MISMATCH',
      );
      expect(JSON.stringify((error as UnauthorizedException).getResponse())).not.toContain(
        'jwt malformed',
      );
    }
  });

  it('[MX-03][AUT-SES-P0-005][UNITARIA] devuelve AUTH_VERSION_MISMATCH para token obsoleto', async () => {
    const userId = new Types.ObjectId().toString();
    const findById = jest.fn().mockReturnValue(
      chainLean({ active: true, authVersion: 2 }),
    );
    const guard = new JwtAuthGuard(
      {
        verifyAsync: jest
          .fn()
          .mockResolvedValue({ sub: userId, active: true, authVersion: 1 }),
      } as unknown as JwtService,
      { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector,
      {
        models: { [RoledUser.name]: { findById } },
        model: jest.fn(),
      } as unknown as ConstructorParameters<typeof JwtAuthGuard>[2],
    );

    await expect(
      guard.canActivate(
        buildContext({
          headers: { authorization: 'Bearer token-old' },
          path: '/api/v1/institutional-access-recovery-requests',
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        statusCode: 401,
        code: 'AUTH_VERSION_MISMATCH',
        message: 'Authentication session is no longer valid',
      },
    });
    expect(findById).toHaveBeenCalledWith(userId, { active: 1, authVersion: 1 });
  });

  it('[MX-03][AUT-APR-P0-002][UNITARIA] permite ADMIN y ACCESS_APPROVER activos', async () => {
    const guard = new AccessApproverGuard({
      verifyAsync: jest
        .fn()
        .mockResolvedValueOnce({ sub: 'admin-1', role: 'ADMIN', active: true })
        .mockResolvedValueOnce({
          sub: 'approver-1',
          role: 'ACCESS_APPROVER',
          active: true,
        }),
    } as unknown as JwtService);

    await expect(
      guard.canActivate(buildContext({ headers: { authorization: 'Bearer admin' } })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        buildContext({ headers: { authorization: 'Bearer approver' } }),
      ),
    ).resolves.toBe(true);
  });

  it('[MX-03][AUT-APR-P0-003][UNITARIA] prohíbe un rol no aprobador', async () => {
    const guard = new AccessApproverGuard({
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'mayor-1', role: 'MAYOR', active: true }),
    } as unknown as JwtService);

    await expect(
      guard.canActivate(
        buildContext({ headers: { authorization: 'Bearer mayor-token' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-03][AUT-APR-P0-004][UNITARIA] rechaza token ausente invalido o usuario inactivo', async () => {
    const guard = new AccessApproverGuard({
      verifyAsync: jest
        .fn()
        .mockRejectedValueOnce(new Error('bad token'))
        .mockResolvedValueOnce({
          sub: 'approver-1',
          role: 'ACCESS_APPROVER',
          active: false,
        }),
    } as unknown as JwtService);

    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(
        buildContext({ headers: { authorization: 'Bearer bad-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      guard.canActivate(
        buildContext({ headers: { authorization: 'Bearer inactive-token' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[MX-03][AUT-TER-P0-001][UNITARIA] fuerza alcance propio y bloquea territorio ajeno', async () => {
    const userId = new Types.ObjectId().toString();
    const electionId = new Types.ObjectId().toString();
    const contractModel = { findOne: jest.fn() };
    const guard = new TerritorialRestrictionGuard(contractModel as any);
    const governorContract = {
      clientId: new Types.ObjectId(userId),
      electionId: new Types.ObjectId(electionId),
      active: true,
      departmentId: new Types.ObjectId(),
      departmentName: 'La Paz',
      municipalityId: null,
      municipalityName: null,
    };
    const mayorContract = {
      clientId: new Types.ObjectId(userId),
      electionId: new Types.ObjectId(electionId),
      active: true,
      departmentId: null,
      departmentName: null,
      municipalityId: new Types.ObjectId(),
      municipalityName: 'Cochabamba',
    };
    const governorRequest: any = {
      user: { sub: userId, role: 'GOVERNOR' },
      query: { electionId },
      body: {},
    };
    contractModel.findOne.mockReturnValueOnce(chainLean(governorContract));

    await expect(guard.canActivate(buildContext(governorRequest))).resolves.toBe(true);
    expect(governorRequest.query.department).toBe('La Paz');
    expect(governorRequest.contract).toBe(governorContract);

    contractModel.findOne.mockReturnValueOnce(chainLean(governorContract));
    await expect(
      guard.canActivate(
        buildContext({
          user: { sub: userId, role: 'GOVERNOR' },
          query: { electionId, department: 'Santa Cruz' },
          body: {},
        }),
      ),
    ).rejects.toThrow(/fuera de su departamento/i);

    const mayorRequest: any = {
      user: { sub: userId, role: 'MAYOR' },
      query: { electionId },
      body: { electionId },
    };
    contractModel.findOne.mockReturnValueOnce(chainLean(mayorContract));

    await expect(guard.canActivate(buildContext(mayorRequest))).resolves.toBe(true);
    expect(mayorRequest.query.municipality).toBe('Cochabamba');
    expect(mayorRequest.body.municipality).toBe('Cochabamba');

    contractModel.findOne.mockReturnValueOnce(chainLean(mayorContract));
    await expect(
      guard.canActivate(
        buildContext({
          user: { sub: userId, role: 'MAYOR' },
          query: { electionId, municipality: 'Quillacollo' },
          body: {},
        }),
      ),
    ).rejects.toThrow(/fuera de su municipio/i);
  });

  it('[MX-03][AUT-TER-P0-002][UNITARIA] exige electionId y contrato territorial activo', async () => {
    const userId = new Types.ObjectId().toString();
    const electionId = new Types.ObjectId().toString();
    const contractModel = { findOne: jest.fn() };
    const guard = new TerritorialRestrictionGuard(contractModel as any);

    await expect(
      guard.canActivate(
        buildContext({
          user: { sub: userId, role: 'GOVERNOR' },
          query: {},
          body: {},
        }),
      ),
    ).rejects.toThrow(/electionId es requerido/i);

    contractModel.findOne.mockReturnValue(chainLean(null));
    await expect(
      guard.canActivate(
        buildContext({
          user: { sub: userId, role: 'GOVERNOR' },
          query: { electionId },
          body: {},
        }),
      ),
    ).rejects.toThrow(/No tiene un contrato activo/i);
  });
});
