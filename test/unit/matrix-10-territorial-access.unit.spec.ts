import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ContractsController } from '@/modules/contracts/controllers/contracts.controller';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { AuthService } from '@/modules/auth/services/auth.service';

type TerritorialStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REVOKED';

type TerritorialUser = {
  _id: Types.ObjectId;
  dni: string;
  email: string;
  name: string;
  role: 'MAYOR' | 'GOVERNOR';
  active: boolean;
  territorialAccessStatus: TerritorialStatus;
  territorialApprovedAt: Date | null;
  territorialRejectedAt: Date | null;
  territorialRevokedAt: Date | null;
  territorialReason: string | null;
  territorialApprovedBy: Types.ObjectId | null;
  save: jest.Mock<Promise<TerritorialUser>, []>;
};

const buildUser = (status: TerritorialStatus): TerritorialUser => {
  const user = {
    _id: new Types.ObjectId(),
    dni: '1234567',
    email: 'mayor@example.test',
    name: 'Alcaldesa de prueba',
    role: 'MAYOR' as const,
    active: status === 'APPROVED',
    territorialAccessStatus: status,
    territorialApprovedAt: status === 'APPROVED' ? new Date('2026-01-01T00:00:00.000Z') : null,
    territorialRejectedAt: status === 'REJECTED' ? new Date('2026-01-01T00:00:00.000Z') : null,
    territorialRevokedAt: status === 'REVOKED' ? new Date('2026-01-01T00:00:00.000Z') : null,
    territorialReason: status === 'REJECTED' ? 'Motivo previo' : null,
    territorialApprovedBy: null,
    save: jest.fn(),
  } satisfies Omit<TerritorialUser, 'save'> & { save: jest.Mock };
  user.save.mockResolvedValue(user);
  return user;
};

describe('MX-10 | transiciones de acceso territorial', () => {
  const requester = { sub: new Types.ObjectId().toString(), role: 'ACCESS_APPROVER' };
  let user: TerritorialUser;
  let syncUserActiveState: jest.Mock<Promise<void>, [Types.ObjectId]>;
  let findById: jest.Mock;
  let controller: ContractsController;

  beforeEach(() => {
    user = buildUser('PENDING_APPROVAL');
    syncUserActiveState = jest.fn().mockResolvedValue(undefined);
    const contractsServiceMock = {} satisfies Partial<ContractsService>;
    const electoralLocationServiceMock = {} satisfies Partial<ElectoralLocationService>;
    const authServiceMock = { syncUserActiveState } satisfies Partial<AuthService>;
    findById = jest.fn().mockResolvedValue(user);
    const roledUserModelMock = { findById };

    controller = new ContractsController(
      contractsServiceMock as unknown as ContractsService,
      electoralLocationServiceMock as unknown as ElectoralLocationService,
      authServiceMock as unknown as AuthService,
      roledUserModelMock as never,
    );
  });

  it('[MX-10][CON-ACC-P0-002][UNITARIA] aprueba solamente una solicitud pendiente y sincroniza su acceso', async () => {
    const result = await controller.approveTerritorialAccessEndpoint(user._id.toString(), {
      user: requester,
    });

    expect(result.user.territorialAccessStatus).toBe('APPROVED');
    expect(user.territorialApprovedAt).toBeInstanceOf(Date);
    expect(user.territorialApprovedBy?.toString()).toBe(requester.sub);
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(syncUserActiveState).toHaveBeenCalledWith(user._id);

    user.territorialAccessStatus = 'APPROVED';
    await expect(
      controller.approveTerritorialAccessEndpoint(user._id.toString(), { user: requester }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[MX-10][CON-ACC-P0-003][UNITARIA] rechaza una solicitud pendiente y conserva razón, fecha y aprobador', async () => {
    const result = await controller.rejectTerritorialAccessEndpoint(
      user._id.toString(),
      { reason: 'Documentación incompleta' },
      { user: requester },
    );

    expect(result.user.territorialAccessStatus).toBe('REJECTED');
    expect(user.territorialRejectedAt).toBeInstanceOf(Date);
    expect(user.territorialReason).toBe('Documentación incompleta');
    expect(user.territorialApprovedBy?.toString()).toBe(requester.sub);
    expect(syncUserActiveState).toHaveBeenCalledWith(user._id);
  });

  it('[MX-10][CON-ACC-P0-004][UNITARIA] revoca solamente un acceso aprobado y sincroniza el bloqueo', async () => {
    user = buildUser('APPROVED');
    findById.mockResolvedValue(user);

    const result = await controller.revokeTerritorialAccess(
      user._id.toString(),
      { reason: 'Revocado por auditoría' },
      { user: requester },
    );

    expect(result.user.territorialAccessStatus).toBe('REVOKED');
    expect(user.territorialRevokedAt).toBeInstanceOf(Date);
    expect(user.territorialReason).toBe('Revocado por auditoría');
    expect(syncUserActiveState).toHaveBeenCalledWith(user._id);
  });

  it('[MX-10][CON-ACC-P1-005][UNITARIA] reabre solicitudes rechazadas y limpia su información de revisión', async () => {
    user = buildUser('REJECTED');
    findById.mockResolvedValue(user);

    const result = await controller.reopenTerritorialAccess(
      user._id.toString(),
      {},
      { user: requester },
    );

    expect(result.user.territorialAccessStatus).toBe('PENDING_APPROVAL');
    expect(user.territorialApprovedAt).toBeNull();
    expect(user.territorialRejectedAt).toBeNull();
    expect(user.territorialRevokedAt).toBeNull();
    expect(user.territorialReason).toBeNull();
    expect(user.territorialApprovedBy).toBeNull();
  });
});
