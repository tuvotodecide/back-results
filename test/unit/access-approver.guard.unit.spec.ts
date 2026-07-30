import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';

const buildContext = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authorization ? { authorization } : {},
      }),
    }),
  }) as ExecutionContext;

describe('AccessApproverGuard MX-03', () => {
  it('AUT-APR-P0-002 permite ADMIN y ACCESS_APPROVER activos en endpoints de aprobaciones', async () => {
    const jwtService = {
      verifyAsync: jest
        .fn()
        .mockResolvedValueOnce({ sub: 'admin-1', role: 'ADMIN', active: true })
        .mockResolvedValueOnce({
          sub: 'approver-1',
          role: 'ACCESS_APPROVER',
          active: true,
        }),
    } as unknown as JwtService;
    const guard = new AccessApproverGuard(jwtService);

    await expect(guard.canActivate(buildContext('Bearer admin-token'))).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(buildContext('Bearer approver-token')),
    ).resolves.toBe(true);
  });

  it('AUT-APR-P0-003 rechaza roles no aprobadores sin degradarlos a usuario anonimo', async () => {
    const jwtService = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'user-1',
        role: 'MAYOR',
        active: true,
      }),
    } as unknown as JwtService;
    const guard = new AccessApproverGuard(jwtService);

    await expect(guard.canActivate(buildContext('Bearer mayor-token'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('AUT-APR-P0-004 rechaza token ausente invalido o usuario inactivo', async () => {
    const jwtService = {
      verifyAsync: jest
        .fn()
        .mockRejectedValueOnce(new Error('bad token'))
        .mockResolvedValueOnce({ sub: 'approver-1', role: 'ACCESS_APPROVER', active: false }),
    } as unknown as JwtService;
    const guard = new AccessApproverGuard(jwtService);

    await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(buildContext('Bearer bad-token'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(buildContext('Bearer inactive-token')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
