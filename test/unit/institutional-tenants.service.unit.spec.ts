import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InstitutionalTenantsService } from '@/modules/institutional-tenants/services/institutional-tenants.service';

describe('InstitutionalTenantsService (unit)', () => {
  let tenantModel: any;
  let assignmentModel: any;
  let roledUserModel: any;
  let service: InstitutionalTenantsService;

  beforeEach(() => {
    tenantModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
    };
    assignmentModel = {
      findOneAndUpdate: jest.fn(),
    };
    roledUserModel = {
      findById: jest.fn(),
    };
    service = new InstitutionalTenantsService(
      tenantModel,
      assignmentModel,
      roledUserModel,
    );
  });

  it('createTenant normaliza nombre, crea tenant activo y retorna shape estable', async () => {
    tenantModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    tenantModel.create.mockResolvedValue({
      _id: new Types.ObjectId('64b000000000000000000001'),
      name: 'Mi Institucion',
      description: 'Descripcion',
      active: true,
    });

    await expect(
      service.createTenant({ name: '  Mi   Institucion ', description: ' Descripcion ' }),
    ).resolves.toEqual({
      id: '64b000000000000000000001',
      name: 'Mi Institucion',
      description: 'Descripcion',
      active: true,
    });

    expect(tenantModel.findOne).toHaveBeenCalledWith({
      nameNorm: 'mi institucion',
    });
    expect(tenantModel.create).toHaveBeenCalledWith({
      name: 'Mi Institucion',
      nameNorm: 'mi institucion',
      description: 'Descripcion',
      active: true,
    });
  });

  it('createTenant rechaza nombre duplicado', async () => {
    tenantModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    });

    await expect(
      service.createTenant({ name: 'Tenant Duplicado' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assignAdmin aprueba asignacion para tenant y usuario activos', async () => {
    const tenantId = '64b000000000000000000002';
    const userId = '64b000000000000000000003';
    tenantModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(tenantId), active: true }),
    });
    roledUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(userId), active: true }),
    });
    assignmentModel.findOneAndUpdate.mockResolvedValue({});

    await expect(
      service.assignAdmin(tenantId, { userId, active: true }),
    ).resolves.toEqual({ tenantId, userId, active: true });

    expect(assignmentModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        tenantId: new Types.ObjectId(tenantId),
        userId: new Types.ObjectId(userId),
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'APPROVED',
          active: true,
          approvedAt: expect.any(Date),
          revokedAt: null,
        }),
      }),
      expect.objectContaining({ upsert: true, returnDocument: 'after' }),
    );
  });

  it('assignAdmin rechaza tenant invalido o inactivo', async () => {
    await expect(
      service.assignAdmin('not-valid', { userId: new Types.ObjectId().toString() }),
    ).rejects.toBeInstanceOf(NotFoundException);

    tenantModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await expect(
      service.assignAdmin(new Types.ObjectId().toString(), {
        userId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
