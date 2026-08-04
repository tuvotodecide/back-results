import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';

type RequestFixture = { user?: { sub: string; role: string }; query: Record<string, string>; body: Record<string, string>; headers?: Record<string, string> };

const contextFor = (fixture: RequestFixture): ExecutionContext => {
  const request = {
    ...fixture,
    headers: fixture.headers ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('MX-10 | acceso y seguridad unitario focal', () => {
  const userId = new Types.ObjectId().toString();
  const electionId = new Types.ObjectId().toString();

  it('[MX-10][PER-GOV-P0-001][UNITARIA] fuerza el departamento del contrato de Gobernador', async () => {
    const model = { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ departmentId: new Types.ObjectId(), departmentName: 'La Paz', municipalityId: null, active: true }) }) };
    const guard = new TerritorialRestrictionGuard(
      ...([model] as unknown as ConstructorParameters<typeof TerritorialRestrictionGuard>),
    );
    const request: RequestFixture = { user: { sub: userId, role: 'GOVERNOR' }, query: { electionId }, body: {} };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.query.department).toBe('La Paz');
    expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
  });

  it('[MX-10][PER-MAY-P0-002][UNITARIA] fuerza el municipio del contrato de Alcalde', async () => {
    const model = { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ municipalityId: new Types.ObjectId(), municipalityName: 'Cochabamba', departmentId: null, active: true }) }) };
    const guard = new TerritorialRestrictionGuard(
      ...([model] as unknown as ConstructorParameters<typeof TerritorialRestrictionGuard>),
    );
    const request: RequestFixture = { user: { sub: userId, role: 'MAYOR' }, query: { electionId }, body: { electionId } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.query.municipality).toBe('Cochabamba');
    expect(request.body.municipality).toBe('Cochabamba');
  });

  it('[MX-10][PER-NOC-P0-003][UNITARIA] rechaza al usuario territorial sin contrato activo para la elección', async () => {
    const model = { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
    const guard = new TerritorialRestrictionGuard(
      ...([model] as unknown as ConstructorParameters<typeof TerritorialRestrictionGuard>),
    );

    await expect(guard.canActivate(contextFor({ user: { sub: userId, role: 'MAYOR' }, query: { electionId }, body: {} }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-10][PER-APP-P0-004][UNITARIA] permite al aprobador activo y rechaza a un Alcalde', async () => {
    const jwtServiceMock = { verifyAsync: jest.fn().mockResolvedValueOnce({ sub: userId, role: 'ACCESS_APPROVER', active: true }).mockResolvedValueOnce({ sub: userId, role: 'MAYOR', active: true }) } satisfies Partial<JwtService>;
    const guard = new AccessApproverGuard(jwtServiceMock as unknown as JwtService);

    await expect(guard.canActivate(contextFor({ query: {}, body: {}, headers: { authorization: 'Bearer approver' } }))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({ query: {}, body: {}, headers: { authorization: 'Bearer mayor' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-10][SEC-TEN-P0-001][UNITARIA] rechaza una ruta de aprobación sin token o con identidad inactiva', async () => {
    const jwtServiceMock = { verifyAsync: jest.fn().mockResolvedValue({ sub: userId, role: 'ACCESS_APPROVER', active: false }) } satisfies Partial<JwtService>;
    const guard = new AccessApproverGuard(jwtServiceMock as unknown as JwtService);

    await expect(guard.canActivate(contextFor({ query: {}, body: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contextFor({ query: {}, body: {}, headers: { authorization: 'Bearer inactive' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
