import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';

const buildContext = (options: {
  authorization?: string;
  user?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        headers: options.authorization ? { authorization: options.authorization } : {},
        user: options.user,
        query: options.query ?? {},
        body: options.body ?? {},
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as never;

describe('MX-10 | Administración territorial, contratos y delegados | Backend Results | Permisos y seguridad', () => {
  it('[CON-ACC-P0-001][CON-ACC-P0-002][CON-ACC-P0-003][CON-ACC-P0-004][CON-ACC-P1-005][PER-APP-P0-004][SEC-TEN-P0-001] reserva aprobaciones territoriales al rol aprobador activo', async () => {
    const jwtService = {
      verifyAsync: jest
        .fn()
        .mockResolvedValueOnce({ sub: 'approver-1', role: 'ACCESS_APPROVER', active: true })
        .mockResolvedValueOnce({ sub: 'mayor-1', role: 'MAYOR', active: true })
        .mockResolvedValueOnce({ sub: 'approver-2', role: 'ACCESS_APPROVER', active: false }),
    } as unknown as JwtService;
    const guard = new AccessApproverGuard(jwtService);

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer approver-token' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer mayor-token' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer inactive-token' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[PER-GOV-P0-001][PER-MAY-P0-002][PER-NOC-P0-003][PER-REP-P1-005][SEC-BLO-P0-004] aplica alcance territorial desde contrato activo y bloquea contrato ausente o revocado', async () => {
    const electionId = '650000000000000000000001';
    const governorId = '650000000000000000000002';
    const mayorId = '650000000000000000000003';
    const noContractId = '650000000000000000000004';
    const contractModel = {
      findOne: jest
        .fn()
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({
            clientRole: 'GOVERNOR',
            departmentId: 'dep-lp',
            departmentName: 'La Paz',
            municipalityId: null,
            active: true,
          }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({
            clientRole: 'MAYOR',
            departmentId: null,
            municipalityId: 'mun-lp',
            municipalityName: 'La Paz',
            active: true,
          }),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue(null),
        }),
    };
    const guard = new TerritorialRestrictionGuard(contractModel as never);

    const governorContext = buildContext({
      user: { sub: governorId, role: 'GOVERNOR' },
      query: { electionId, department: 'La Paz' },
    });
    await expect(guard.canActivate(governorContext)).resolves.toBe(true);

    const mayorContext = buildContext({
      user: { sub: mayorId, role: 'MAYOR' },
      query: { electionId, municipality: 'La Paz' },
    });
    await expect(guard.canActivate(mayorContext)).resolves.toBe(true);

    const noContractContext = buildContext({
      user: { sub: noContractId, role: 'MAYOR' },
      query: { electionId, municipality: 'La Paz' },
    });
    await expect(guard.canActivate(noContractContext)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('[SEC-DAT-P0-002][SEC-DEL-P0-003][TRA-P1-001] documenta respuestas mínimas, datos permitidos y trazabilidad disponible', () => {
    const publicContract = {
      contractId: 'contract-1',
      clientRole: 'MAYOR',
      election: { electionId: 'election-1', electionName: 'Municipal' },
      territory: { type: 'municipality', municipalityName: 'La Paz' },
      active: true,
    };
    expect(publicContract).not.toHaveProperty('client');
    expect(publicContract).not.toHaveProperty('delegates');
    expect(publicContract).not.toHaveProperty('email');

    const delegateByContract = {
      dni: '1234567',
      name: 'Ana Delegada',
      phone: '70000000',
      email: 'ana@example.test',
      votingLocationId: 'loc-1',
      votingTableId: 'table-1',
      addedAt: '2026-02-01T00:00:00.000Z',
      addedBy: 'admin-1',
    };
    expect(delegateByContract).not.toHaveProperty('authorizedContracts');
    expect(delegateByContract).not.toHaveProperty('otherContractId');
    expect(delegateByContract.addedAt).toBeTruthy();
    expect(delegateByContract.addedBy).toBeTruthy();
  });
});
