import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { AuthService } from '@/modules/auth/services/auth.service';

const sortedLean = <T>(value: T) => ({
  sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
});

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

const buildService = (user: any, memberships: any[], tenants: any[]) =>
  new AuthService(
    { findOne: jest.fn().mockResolvedValue(user) } as any,
    { exists: jest.fn() } as any,
    { exists: jest.fn() } as any,
    { find: jest.fn().mockReturnValue(sortedLean(memberships)) } as any,
    { find: jest.fn().mockReturnValue(lean(tenants)) } as any,
    {
      find: jest.fn().mockReturnValue(sortedLean([])),
      findOne: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(null) }),
    } as any,
    { signAsync: jest.fn().mockResolvedValue('token') } as unknown as JwtService,
    { sendEmail: jest.fn() } as any,
    { get: jest.fn() } as any,
  );

describe('AuthService institutional role login contexts', () => {
  it.each(['PRIMARY', 'SECONDARY'] as const)(
    'expone %s separado del rol global USER y conserva membershipId',
    async (institutionalRole) => {
      const userId = new Types.ObjectId();
      const tenantId = new Types.ObjectId();
      const assignmentId = new Types.ObjectId();
      const user = {
        _id: userId,
        email: 'institutional@example.com',
        dni: '12345678',
        name: 'Institutional user',
        role: 'USER',
        active: true,
        password: bcrypt.hashSync('secret123', 4),
        authVersion: 0,
      };
      const service = buildService(
        user,
        [
          {
            _id: assignmentId,
            userId,
            tenantId,
            institutionalRole,
            status: 'APPROVED',
            active: true,
          },
        ],
        [{ _id: tenantId, name: 'Tenant A', active: true }],
      );

      const response = await service.signIn({
        email: user.email,
        password: 'secret123',
      });

      expect(response.role).toBe('USER');
      expect(response.availableContexts).toEqual([
        expect.objectContaining({
          type: 'TENANT',
          role: 'USER',
          institutionalRole,
          tenantId: String(tenantId),
          membershipId: String(assignmentId),
        }),
      ]);
      expect(response.defaultContext).toEqual(
        expect.objectContaining({
          institutionalRole,
          membershipId: String(assignmentId),
        }),
      );
      expect(response.accessStatus.tenant.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            membershipId: String(assignmentId),
            tenantId: String(tenantId),
            institutionalRole,
          }),
        ]),
      );
    },
  );
});
