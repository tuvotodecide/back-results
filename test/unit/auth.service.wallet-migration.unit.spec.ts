import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { AuthService } from '@/modules/auth/services/auth.service';

const sortedLean = <T>(value: T) => ({
  sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
});
const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('AuthService wallet migration on sign-in', () => {
  const userId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const user = {
    _id: userId,
    email: 'primary@example.com',
    dni: '12345678',
    name: 'Primary',
    role: 'USER',
    active: true,
    password: bcrypt.hashSync('secret123', 4),
    authVersion: 0,
  };

  const build = (walletMigrationService?: any) =>
    new AuthService(
      { findOne: jest.fn().mockResolvedValue(user) } as any,
      { exists: jest.fn() } as any,
      { exists: jest.fn() } as any,
      {
        find: jest.fn().mockReturnValue(
          sortedLean([
            {
              _id: new Types.ObjectId(),
              userId,
              tenantId,
              institutionalRole: 'PRIMARY',
              status: 'APPROVED',
              active: true,
            },
          ]),
        ),
      } as any,
      { find: jest.fn().mockReturnValue(lean([{ _id: tenantId, name: 'Tenant', active: true }])) } as any,
      {
        find: jest.fn().mockReturnValue(sortedLean([])),
        findOne: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(null) }),
      } as any,
      { signAsync: jest.fn().mockResolvedValue('token') } as unknown as JwtService,
      { sendEmail: jest.fn() } as any,
      { get: jest.fn() } as any,
      walletMigrationService,
    );

  it('dispara la migración y devuelve su estado en la respuesta del login', async () => {
    const summary = {
      tenantId: String(tenantId),
      status: 'READY',
      newAdminWallet: '0x2222222222222222222222222222222222222222',
      pendingAuthorizedAddressRevocations: 1,
      message: null,
    };
    const walletMigrationService = { handleSignIn: jest.fn().mockResolvedValue([summary]) };

    const response = await build(walletMigrationService).signIn({
      email: user.email,
      password: 'secret123',
    });

    expect(walletMigrationService.handleSignIn).toHaveBeenCalledWith(user);
    expect(response.accessToken).toBe('token');
    expect(response.institutionalWalletMigrations).toEqual([summary]);
  });

  it('no agrega el campo si no hay migraciones', async () => {
    const response = await build({ handleSignIn: jest.fn().mockResolvedValue([]) }).signIn({
      email: user.email,
      password: 'secret123',
    });

    expect(response).not.toHaveProperty('institutionalWalletMigrations');
  });

  it('no consulta migraciones si la contraseña es incorrecta', async () => {
    const walletMigrationService = { handleSignIn: jest.fn() };

    await expect(
      build(walletMigrationService).signIn({ email: user.email, password: 'wrong' }),
    ).rejects.toThrow('Credenciales inválidas');
    expect(walletMigrationService.handleSignIn).not.toHaveBeenCalled();
  });
});
