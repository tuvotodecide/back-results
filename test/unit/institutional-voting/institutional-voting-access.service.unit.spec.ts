import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

import { InstitutionalVotingAccessService } from '@/modules/institutional-voting/services/core/institutional-voting-access.service';

function leanResult(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('InstitutionalVotingAccessService official publication institution', () => {
  const requesterId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const eventId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const applicationId = new Types.ObjectId();
  const stableInstitutionId = 'institution-tse-001';
  const wallet = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  let assignmentModel: any;
  let applicationModel: any;
  let service: InstitutionalVotingAccessService;

  beforeEach(() => {
    assignmentModel = {
      findOne: jest.fn().mockReturnValue(
        leanResult({
          _id: assignmentId,
          tenantId,
          userId: requesterId,
          applicationId,
          accountAddress: wallet,
          institutionalRole: 'PRIMARY',
        }),
      ),
    };
    applicationModel = {
      findOne: jest.fn().mockReturnValue(
        leanResult({
          _id: applicationId,
          tenantId,
          userId: requesterId,
          stableInstitutionId,
          accountAddress: wallet,
          status: 'APPROVED',
        }),
      ),
    };
    service = new InstitutionalVotingAccessService(
      {} as any,
      {} as any,
      assignmentModel,
      applicationModel,
    );
  });

  it('[MX-02][D-PERM-001][UNITARIA] autoriza una operación institucional con identidad estable y wallet activa', async () => {
    const result = await service.resolveOfficialPublicationInstitution(
      { _id: eventId, tenantId } as any,
      { sub: String(requesterId) },
    );

    expect(assignmentModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        userId: requesterId,
        active: true,
      }),
      expect.objectContaining({
        applicationId: 1,
        accountAddress: 1,
      }),
    );
    expect(applicationModel.findOne).toHaveBeenCalledWith(
      {
        _id: applicationId,
        tenantId,
        userId: requesterId,
        status: 'APPROVED',
      },
      expect.objectContaining({ accountAddress: 1 }),
    );
    expect(result).toMatchObject({
      eventId: String(eventId),
      tenantId: String(tenantId),
      assignmentId: String(assignmentId),
      applicationId: String(applicationId),
      institutionId: stableInstitutionId,
      accountAddress: wallet,
      institutionalRole: 'PRIMARY',
    });
  });

  it('[MX-02][D-PERM-002][UNITARIA] rechaza editar sin asignacion institucional activa', async () => {
    assignmentModel.findOne.mockReturnValueOnce(leanResult(null));

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('[MX-02][D-PERM-003][UNITARIA] rechaza publicar sin vínculo institucional contractual', async () => {
    assignmentModel.findOne.mockReturnValueOnce(
      leanResult({
        _id: assignmentId,
        tenantId,
        userId: requesterId,
        accountAddress: wallet,
      }),
    );

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-02][D-PERM-004][UNITARIA] rechaza operar TVD con aplicación inexistente o no aprobada', async () => {
    applicationModel.findOne.mockReturnValueOnce(leanResult(null));

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-02][D-PERM-005][UNITARIA] rechaza consultar operaciones con una wallet institucional inconsistente', async () => {
    applicationModel.findOne.mockReturnValueOnce(
      leanResult({
        _id: applicationId,
        tenantId,
        userId: requesterId,
        stableInstitutionId,
        accountAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        status: 'APPROVED',
      }),
    );

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('[MX-02][D-PERM-006][UNITARIA] bloquea modificar datos generales a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'modificar datos generales')).toThrow(ForbiddenException);
  });

  it('[MX-02][D-PERM-007][UNITARIA] bloquea invitar administradores a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'invitar administradores')).toThrow(ForbiddenException);
  });

  it('[MX-02][D-PERM-008][UNITARIA] bloquea aprobar solicitudes a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'aprobar solicitudes')).toThrow(ForbiddenException);
  });

  it('[MX-02][D-PERM-009][UNITARIA] bloquea suspender administradores a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'suspender administradores')).toThrow(ForbiddenException);
  });

  it('[MX-02][D-PERM-010][UNITARIA] bloquea eliminar administradores a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'eliminar administradores')).toThrow(ForbiddenException);
  });

  it('[MX-02][D-PERM-011][UNITARIA] bloquea transferir el rol principal a quien no es ADMIN global', () => {
    expect(() => service.assertGlobalAdminAccess({ role: 'USER' }, 'transferir el rol principal')).toThrow(ForbiddenException);
  });
});
