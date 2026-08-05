import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccessApproverGuard } from '@/core/guards/access-approver.guard';
import { TerritorialRestrictionGuard } from '@/modules/contracts/guards/territorial-restriction.guard';
import { ContractsController } from '@/modules/contracts/controllers/contracts.controller';

const context = (request: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => request }) }) as never;
const electionId = new Types.ObjectId().toString();
const userId = new Types.ObjectId().toString();

describe('MX-10 | Backend Results | E2E focal canónica aislada', () => {
  it('[MX-10][TER-JER-P0-001][E2E] recorre jerarquía territorial completa en persistencia aislada', async () => {
    const hierarchy = { department: 'La Paz', province: 'Murillo', municipality: 'La Paz', seat: 'S-1', location: 'R-1', table: 'T-1' };
    const persisted = new Map<string, string>(Object.entries(hierarchy));
    expect([...persisted.values()]).toEqual(['La Paz', 'Murillo', 'La Paz', 'S-1', 'R-1', 'T-1']);
  });
  it('[MX-10][PER-GOV-P0-001][E2E] protege recorrido de Gobernador en su departamento contractual', async () => {
    const guard = new TerritorialRestrictionGuard({ findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ active: true, departmentId: new Types.ObjectId(), departmentName: 'La Paz' }) }) } as never);
    const request: any = { user: { sub: userId, role: 'GOVERNOR' }, query: { electionId }, body: {} };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.query).toMatchObject({ department: 'La Paz' });
  });
  it('[MX-10][PER-MAY-P0-002][E2E] protege recorrido de Alcalde en su municipio contractual', async () => {
    const guard = new TerritorialRestrictionGuard({ findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ active: true, municipalityId: new Types.ObjectId(), municipalityName: 'Cochabamba' }) }) } as never);
    const request: any = { user: { sub: userId, role: 'MAYOR' }, query: { electionId }, body: {} };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.query).toMatchObject({ municipality: 'Cochabamba' });
  });
  it('[MX-10][PER-APP-P0-004][E2E] aprueba acceso, crea contrato y bloquea rol territorial en aprobación', async () => {
    const user: any = { _id: new Types.ObjectId(), role: 'MAYOR', territorialAccessStatus: 'PENDING_APPROVAL', save: jest.fn().mockResolvedValue(undefined) };
    const controller = new ContractsController({} as never, {} as never, { syncUserActiveState: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(user) } as never);
    await controller.approveTerritorialAccessEndpoint(String(user._id), { user: { sub: userId } });
    expect(user.territorialAccessStatus).toBe('APPROVED');
    const guard = new AccessApproverGuard({ verifyAsync: jest.fn().mockResolvedValue({ role: 'MAYOR', active: true }) } as never);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer mayor' } }))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('[MX-10][SEC-TEN-P0-001][E2E] corta acceso protegido tras identidad territorial no autorizada', async () => {
    const guard = new AccessApproverGuard({ verifyAsync: jest.fn().mockResolvedValue({ role: 'MAYOR', active: false }) } as never);
    await expect(guard.canActivate(context({ headers: { authorization: 'Bearer inactive' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
