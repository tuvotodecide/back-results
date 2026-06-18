import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ContractsService } from '@/modules/contracts/services/contracts.service';

const execResolved = <T>(value: T) => ({ exec: jest.fn().mockResolvedValue(value) });
const chainResolved = <T>(value: T) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('ContractsService (unit)', () => {
  let contractModel: any;
  let roledUserModel: any;
  let departmentModel: any;
  let municipalityModel: any;
  let electoralLocationService: any;
  let electionConfigService: any;
  let service: ContractsService;

  const clientId = '64c000000000000000000001';
  const electionId = '64c000000000000000000002';
  const departmentId = '64c000000000000000000003';

  beforeEach(() => {
    contractModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn(),
    };
    roledUserModel = { findById: jest.fn() };
    departmentModel = { findById: jest.fn() };
    municipalityModel = { findById: jest.fn() };
    electoralLocationService = {
      findNearestLocation: jest.fn(),
      findOneWithHierarchy: jest.fn(),
    };
    electionConfigService = { getActiveConfigs: jest.fn() };
    service = new ContractsService(
      contractModel,
      roledUserModel,
      departmentModel,
      municipalityModel,
      electoralLocationService,
      electionConfigService,
    );
  });

  it('create genera contrato activo para gobernador con departamento', async () => {
    roledUserModel.findById.mockResolvedValue({ _id: clientId, active: true, role: 'GOVERNOR' });
    departmentModel.findById.mockResolvedValue({ _id: departmentId, name: 'La Paz' });
    contractModel.findOne.mockResolvedValue(null);
    contractModel.create.mockResolvedValue({ _id: new Types.ObjectId(), active: true });

    const startDate = new Date('2026-01-01T00:00:00.000Z');
    await service.create({ clientId, electionId, departmentId, startDate });

    expect(contractModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        clientId: new Types.ObjectId(clientId),
        clientRole: 'GOVERNOR',
        departmentId: new Types.ObjectId(departmentId),
        departmentName: 'La Paz',
        municipalityId: null,
        electionId: new Types.ObjectId(electionId),
        startDate,
      }),
    );
  });

  it('create valida cliente activo, territorio unico y rol territorial', async () => {
    roledUserModel.findById.mockResolvedValue(null);
    await expect(
      service.create({ clientId, electionId, departmentId, startDate: new Date() }),
    ).rejects.toBeInstanceOf(NotFoundException);

    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    await expect(
      service.create({ clientId, electionId, startDate: new Date() }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create({
        clientId,
        electionId,
        municipalityId: new Types.ObjectId().toString(),
        startDate: new Date(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rechaza contrato activo duplicado', async () => {
    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    departmentModel.findById.mockResolvedValue({ name: 'La Paz' });
    contractModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(
      service.create({ clientId, electionId, departmentId, startDate: new Date() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findActiveContracts arma filtros con ObjectId y cadena mongoose', async () => {
    contractModel.find.mockReturnValue(chainResolved([{ _id: 'contract-1' }]));

    await expect(
      service.findActiveContracts({ clientId, electionId, departmentId }),
    ).resolves.toEqual([{ _id: 'contract-1' }]);

    expect(contractModel.find).toHaveBeenCalledWith({
      active: true,
      clientId: new Types.ObjectId(clientId),
      electionId: new Types.ObjectId(electionId),
      departmentId: new Types.ObjectId(departmentId),
    });
  });

  it('deactivate marca contrato inactivo o lanza si no existe', async () => {
    contractModel.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await expect(service.deactivate(clientId)).resolves.toBeUndefined();
    expect(contractModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(clientId) },
      { $set: { active: false, endDate: expect.any(Date) } },
    );

    contractModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(service.deactivate(clientId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getMyContract retorna bandera false si no hay contrato activo', async () => {
    contractModel.findOne.mockReturnValue(chainResolved(null));

    await expect(service.getMyContract({ userId: clientId, electionId })).resolves.toEqual({
      hasContract: false,
      contract: null,
    });
  });
});
