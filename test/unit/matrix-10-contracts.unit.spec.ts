import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ContractsService } from '@/modules/contracts/services/contracts.service';

describe('MX-10 | contratos unitario focal', () => {
  const clientId = new Types.ObjectId().toString();
  const electionId = new Types.ObjectId().toString();
  const departmentId = new Types.ObjectId().toString();

  const buildService = () => {
    const contractModel = { findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() };
    const roledUserModel = { findById: jest.fn() };
    const departmentModel = { findById: jest.fn() };
    const municipalityModel = { findById: jest.fn() };
    const dependencies = [
      contractModel,
      roledUserModel,
      departmentModel,
      municipalityModel,
      {},
      {},
    ] as unknown as ConstructorParameters<typeof ContractsService>;
    const service = new ContractsService(...dependencies);
    return { service, contractModel, roledUserModel, departmentModel };
  };

  it('[MX-10][CON-NEW-P0-001][UNITARIA] rechaza cliente inexistente o territorial inactivo antes de crear contrato', async () => {
    const { service, contractModel, roledUserModel } = buildService();
    roledUserModel.findById.mockResolvedValueOnce(null).mockResolvedValueOnce({ active: false, role: 'GOVERNOR' });

    await expect(service.create({ clientId, electionId, departmentId, startDate: new Date() })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.create({ clientId, electionId, departmentId, startDate: new Date() })).rejects.toBeInstanceOf(BadRequestException);
    expect(contractModel.create).not.toHaveBeenCalled();
  });

  it('[MX-10][CON-TER-P0-002][UNITARIA] exige exactamente el territorio compatible con el rol del cliente', async () => {
    const { service, roledUserModel } = buildService();
    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });

    await expect(service.create({ clientId, electionId, startDate: new Date() })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ clientId, electionId, departmentId, municipalityId: new Types.ObjectId().toString(), startDate: new Date() })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[MX-10][CON-DUP-P0-003][UNITARIA] devuelve conflicto antes de persistir un segundo contrato activo', async () => {
    const { service, contractModel, roledUserModel, departmentModel } = buildService();
    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    departmentModel.findById.mockResolvedValue({ _id: departmentId, name: 'La Paz' });
    contractModel.findOne.mockResolvedValue({ _id: new Types.ObjectId() });

    await expect(service.create({ clientId, electionId, departmentId, startDate: new Date() })).rejects.toBeInstanceOf(ConflictException);
    expect(contractModel.create).not.toHaveBeenCalled();
  });

  it('[MX-10][CON-DIS-P0-006][UNITARIA] inactiva el contrato, registra fin y rechaza el contrato inexistente', async () => {
    const { service, contractModel } = buildService();
    const contractId = new Types.ObjectId().toString();
    contractModel.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });

    await expect(service.deactivate(contractId)).resolves.toBeUndefined();
    expect(contractModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(contractId) },
      { $set: { active: false, endDate: expect.any(Date) } },
    );
    await expect(service.deactivate(contractId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
