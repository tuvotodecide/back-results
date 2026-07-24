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

  it('deriva institutionId contractual desde applicationId de la asignacion institucional activa', async () => {
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
      institutionId: String(applicationId),
      accountAddress: wallet,
      institutionalRole: 'PRIMARY',
    });
  });

  it('rechaza publicar sin asignacion institucional activa', async () => {
    assignmentModel.findOne.mockReturnValueOnce(leanResult(null));

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza asignacion sin applicationId contractual', async () => {
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

  it('rechaza aplicacion institucional inexistente o no aprobada', async () => {
    applicationModel.findOne.mockReturnValueOnce(leanResult(null));

    await expect(
      service.resolveOfficialPublicationInstitution(
        { _id: eventId, tenantId } as any,
        { sub: String(requesterId) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza discrepancia entre wallet de asignacion y aplicacion', async () => {
    applicationModel.findOne.mockReturnValueOnce(
      leanResult({
        _id: applicationId,
        tenantId,
        userId: requesterId,
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
});
