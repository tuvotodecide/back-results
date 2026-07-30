import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthService } from '@/modules/auth/services/auth.service';
import {
  PasswordResetContext,
  RequestPasswordResetDto,
} from '@/modules/auth/dto/password-reset.dto';

const buildService = (
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

describe('AuthService MX-03 email and password tokens', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('AUT-EML-P1-003 rechaza token de verificacion vencido por TTL de 24 horas', async () => {
    const expiredUser = buildUser({
      verificationTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    const service = buildService({
      findOne: jest.fn().mockResolvedValue(expiredUser),
    });

    await expect(service.verifyEmail('verification-current')).rejects.toThrow(
      new BadRequestException('El token de verificación ha expirado'),
    );

    expect(expiredUser.save).not.toHaveBeenCalled();
  });

  it('AUT-EML-P1-004 rechaza token de verificacion consumido porque ya no esta almacenado', async () => {
    const service = buildService({
      findOne: jest.fn().mockResolvedValue(null),
    });

    await expect(service.verifyEmail('verification-used')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
  });

  it('AUT-EML-P1-005 acepta solo token de verificacion actualmente almacenado', async () => {
    const currentUser = buildUser();
    const roledUserModel = {
      findOne: jest
        .fn()
        .mockImplementation(({ verificationToken }) =>
          Promise.resolve(
            verificationToken === 'verification-current' ? currentUser : null,
          ),
        ),
    };
    const service = buildService(roledUserModel);
    jest.spyOn(service, 'syncUserActiveState').mockResolvedValue(undefined);

    await expect(service.verifyEmail('verification-old')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );

    await expect(service.verifyEmail('verification-current')).resolves.toBe(currentUser);

    expect(currentUser.verificationToken).toBeUndefined();
    expect(currentUser.verificationTokenExpiresAt).toBeUndefined();
    expect((currentUser as any).territorialAccessStatus).toBe('PENDING_APPROVAL');
    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });

  it('AUT-EML-P1-001 / AUT-EML-P1-002 acepta token valido y rechaza token inexistente sin modificar cuenta', async () => {
    const currentUser = buildUser();
    const service = buildService({
      findOne: jest.fn().mockImplementation(({ verificationToken }) =>
        Promise.resolve(verificationToken === 'verification-current' ? currentUser : null),
      ),
    });
    jest.spyOn(service, 'syncUserActiveState').mockResolvedValue(undefined);

    await expect(service.verifyEmail('missing-token')).rejects.toThrow(
      new BadRequestException('Token de verificación inválido'),
    );
    expect(currentUser.save).not.toHaveBeenCalled();

    await expect(service.verifyEmail('verification-current')).resolves.toBe(currentUser);
    expect(currentUser.verificationToken).toBeUndefined();
    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });

  it('AUT-PWD-P1-002 rechaza recovery para usuario no verificado o inactivo sin emitir reset usable', async () => {
    const mailService = { sendEmail: jest.fn() };
    const unverifiedUser = buildUser({ verificationToken: 'verification-pending' });
    const inactiveUser = buildUser({ verificationToken: undefined, active: false });
    const service = buildService(
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

  it('AUT-PWD-P1-003 rechaza contexto de recuperación no soportado en el DTO', async () => {
    const dto = plainToInstance(RequestPasswordResetDto, {
      email: 'admin@example.com',
      context: 'superadmin',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'context')).toBe(true);
  });

  it('AUT-PWD-P0-005 rechaza token de reset vencido por TTL de 2 horas', async () => {
    const expiredUser = buildUser({
      passwordResetTokenExpiresAt: new Date(Date.now() - 1_000),
    });
    const service = buildService({
      findOne: jest.fn().mockResolvedValue(expiredUser),
    });

    await expect(
      service.resetPassword({ token: 'reset-current', password: 'newSecret123' }),
    ).rejects.toThrow(
      new BadRequestException('El token de restablecimiento ha expirado'),
    );

    expect(expiredUser.save).not.toHaveBeenCalled();
  });

  it('AUT-PWD-P0-007 rechaza token de reset consumido porque ya no esta almacenado', async () => {
    const service = buildService({
      findOne: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.resetPassword({ token: 'reset-used', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));
  });

  it('AUT-PWD-P0-009 acepta solo token de reset actualmente almacenado', async () => {
    const currentUser = buildUser({ authVersion: 6 });
    const roledUserModel = {
      findOne: jest
        .fn()
        .mockImplementation(({ passwordResetToken }) =>
          Promise.resolve(passwordResetToken === 'reset-current' ? currentUser : null),
        ),
    };
    const service = buildService(roledUserModel);

    await expect(
      service.resetPassword({ token: 'reset-old', password: 'newSecret123' }),
    ).rejects.toThrow(new BadRequestException('Token de restablecimiento inválido'));

    await expect(
      service.resetPassword({ token: 'reset-current', password: 'newSecret123' }),
    ).resolves.toBeUndefined();

    expect(currentUser.passwordResetToken).toBeUndefined();
    expect(currentUser.passwordResetTokenExpiresAt).toBeUndefined();
    expect(currentUser.authVersion).toBe(7);
    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });

  it('AUT-PWD-P0-006 limpia token y aumenta authVersion al restablecer contrasena valida', async () => {
    const currentUser = buildUser({ authVersion: 2 });
    const service = buildService({
      findOne: jest.fn().mockResolvedValue(currentUser),
    });

    await service.resetPassword({
      token: 'reset-current',
      password: 'newSecret123',
    });

    expect((currentUser as any).password).toEqual(expect.any(String));
    expect((currentUser as any).password).not.toBe('newSecret123');
    expect(currentUser.passwordResetToken).toBeUndefined();
    expect(currentUser.passwordResetTokenExpiresAt).toBeUndefined();
    expect(currentUser.authVersion).toBe(3);
    expect(currentUser.save).toHaveBeenCalledTimes(1);
  });
});
