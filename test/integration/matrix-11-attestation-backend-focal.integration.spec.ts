import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ContractsService } from '@/modules/contracts/services/contracts.service';

const chain = <T>(value: T) => ({
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('MX-11 | focal INTEGRACION | ContractsService con gateway y repositorio simulados', () => {
  const contractModel = { find: jest.fn() };
  const locationGateway = {
    findNearestLocation: jest.fn(),
    findOneWithHierarchy: jest.fn(),
  };
  const electionsGateway = { getActiveConfigs: jest.fn() };
  const service = new ContractsService(
    contractModel as never,
    {} as never,
    {} as never,
    {} as never,
    locationGateway as never,
    electionsGateway as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    locationGateway.findNearestLocation.mockResolvedValue({
      _id: new Types.ObjectId(), name: 'Recinto Central', address: 'Av. Uno', distance: 20,
      coordinates: { latitude: -16.5, longitude: -68.1 },
    });
    locationGateway.findOneWithHierarchy.mockResolvedValue({
      department: { name: 'La Paz' }, municipality: { name: 'Achocalla' },
    });
    electionsGateway.getActiveConfigs.mockResolvedValue([{ id: new Types.ObjectId().toString(), name: 'Elección', type: 'municipal' }]);
  });

  it('[MX-11][ATE-AVL-P0-001][INTEGRACION] combina recinto cercano contratos activos y elección activa', async () => {
    contractModel.find.mockReturnValue(chain([{ _id: new Types.ObjectId(), clientRole: 'MAYOR', departmentName: 'La Paz', municipalityName: 'Achocalla' }]));
    const result = await service.checkAttestationAvailability(-16.5, -68.1, 10_000);
    expect(locationGateway.findNearestLocation).toHaveBeenCalledWith(-16.5, -68.1, 10_000);
    expect(result.availableElections).toEqual([expect.objectContaining({ canAttest: true, contract: expect.objectContaining({ territory: 'Achocalla' }) })]);
  });

  it('[MX-11][ATE-AVL-P0-002][INTEGRACION] responde ausencia de recinto sin consultar contratos', async () => {
    locationGateway.findNearestLocation.mockResolvedValue(null);
    await expect(service.checkAttestationAvailability(-16.5, -68.1, 100)).rejects.toBeInstanceOf(NotFoundException);
    expect(contractModel.find).not.toHaveBeenCalled();
  });

  it('[MX-11][EVD-IPF-P0-004][INTEGRACION] mantiene aislado el gateway simulado de cualquier infraestructura externa', async () => {
    contractModel.find.mockReturnValue(chain([]));
    const result = await service.checkAttestationAvailability(-16.5, -68.1);
    expect(result.availableElections[0]).toEqual(expect.objectContaining({ canAttest: false }));
    expect(contractModel.find).toHaveBeenCalledTimes(1);
  });

  it('[MX-11][ADM-AUD-P1-005][INTEGRACION] conserva filtros de contrato y territorio en la consulta simulada', async () => {
    contractModel.find.mockReturnValue(chain([]));
    await service.checkAttestationAvailability(-16.5, -68.1);
    expect(contractModel.find).toHaveBeenCalledWith(expect.objectContaining({ active: true, $or: expect.any(Array) }));
  });

  it('[MX-11][SEC-FIL-P0-003][INTEGRACION] limita el contrato retornado a campos de disponibilidad', async () => {
    contractModel.find.mockReturnValue(chain([{ _id: new Types.ObjectId(), clientRole: 'GOVERNOR', departmentName: 'La Paz' }]));
    const result = await service.checkAttestationAvailability(-16.5, -68.1);
    expect(result.availableElections[0].contract).toEqual(expect.objectContaining({ id: expect.any(String), clientRole: 'GOVERNOR', territory: 'La Paz' }));
  });

  it('[MX-11][TRA-P1-004][INTEGRACION] no crea registros al consultar disponibilidad', async () => {
    contractModel.find.mockReturnValue(chain([]));
    await service.checkAttestationAvailability(-16.5, -68.1);
    expect(contractModel).not.toHaveProperty('create');
  });
});
