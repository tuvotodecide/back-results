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
const chainSelectedResolved = <T>(value: T) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockReturnThis(),
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

  it('findPublicActiveContracts expone solo contratos de elecciones activas filtradas', async () => {
    electionConfigService.getActiveConfigs.mockResolvedValue([
      {
        id: electionId,
        name: 'Eleccion Municipal',
        type: 'municipal',
        round: 1,
      },
      {
        id: new Types.ObjectId().toString(),
        name: 'Eleccion Departamental',
        type: 'departamental',
      },
    ]);
    contractModel.find.mockReturnValue(
      chainResolved([
        {
          _id: new Types.ObjectId(),
          active: true,
          clientRole: 'MAYOR',
          electionId: {
            _id: new Types.ObjectId(electionId),
            name: 'Eleccion Municipal',
            type: 'municipal',
            round: 1,
          },
          departmentId: new Types.ObjectId(departmentId),
          departmentName: 'Cochabamba',
          municipalityId: new Types.ObjectId(),
          municipalityName: 'Cochabamba',
        },
      ]),
    );

    const data = await service.findPublicActiveContracts({
      electionType: 'municipal',
    });

    expect(contractModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        electionId: { $in: [new Types.ObjectId(electionId)] },
      }),
    );
    expect(data).toEqual([
      expect.objectContaining({
        clientRole: 'MAYOR',
        election: expect.objectContaining({
          electionId,
          electionType: 'municipal',
        }),
        territory: expect.objectContaining({
          type: 'municipality',
          municipalityName: 'Cochabamba',
        }),
      }),
    ]);
  });

  it('hasCoverage distingue cobertura verdadera y falsa con active=true', async () => {
    contractModel.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      service.hasCoverage({ electionId, departmentId }),
    ).resolves.toBe(true);
    expect(contractModel.countDocuments).toHaveBeenCalledWith({
      active: true,
      electionId: new Types.ObjectId(electionId),
      departmentId: new Types.ObjectId(departmentId),
    });

    await expect(
      service.hasCoverage({
        electionId,
        municipalityId: new Types.ObjectId().toString(),
      }),
    ).resolves.toBe(false);
  });

  it('getMyElections y getContractHistory documentan contratos activos e inactivos', async () => {
    const inactiveContract = {
      _id: new Types.ObjectId(),
      active: false,
      clientRole: 'GOVERNOR',
      electionId: {
        _id: new Types.ObjectId(electionId),
        name: 'Eleccion Historica',
        type: 'departamental',
        round: 1,
        isActive: false,
      },
      departmentId: { _id: new Types.ObjectId(departmentId), name: 'La Paz' },
      departmentName: 'La Paz',
      municipalityId: null,
      municipalityName: null,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    contractModel.find.mockReturnValueOnce(chainResolved([inactiveContract]));

    const myElections = await service.getMyElections(clientId);
    expect(myElections).toEqual([
      expect.objectContaining({
        electionId,
        isActive: false,
        contracts: [
          expect.objectContaining({
            contractId: inactiveContract._id.toString(),
            active: false,
            clientRole: 'GOVERNOR',
          }),
        ],
      }),
    ]);

    contractModel.find.mockReturnValueOnce(chainResolved([inactiveContract]));
    const history = await service.getContractHistory(clientId, {
      active: false,
      electionId,
    });

    expect(contractModel.find).toHaveBeenLastCalledWith({
      clientId: new Types.ObjectId(clientId),
      active: false,
      electionId: new Types.ObjectId(electionId),
    });
    expect(history[0]).toEqual(
      expect.objectContaining({
        contractId: inactiveContract._id.toString(),
        active: false,
        clientRole: 'GOVERNOR',
      }),
    );
  });

  it('checkAttestationAvailability devuelve contrato activo o razon sin cobertura', async () => {
    electoralLocationService.findNearestLocation.mockResolvedValue({
      _id: new Types.ObjectId(),
      name: 'Recinto Central',
      address: 'Av. Principal',
      distance: 100,
      coordinates: { latitude: -16.5, longitude: -68.1 },
    });
    electoralLocationService.findOneWithHierarchy.mockResolvedValue({
      department: { name: 'La Paz' },
      municipality: { name: 'Achocalla' },
    });
    electionConfigService.getActiveConfigs.mockResolvedValue([
      { id: electionId, name: 'Eleccion Activa', type: 'municipal', round: 1 },
      {
        id: new Types.ObjectId().toString(),
        name: 'Eleccion Sin Contrato',
        type: 'departamental',
      },
    ]);
    contractModel.find
      .mockReturnValueOnce(
        chainSelectedResolved([
          {
            _id: new Types.ObjectId(),
            clientRole: 'MAYOR',
            municipalityName: 'Achocalla',
            departmentName: 'La Paz',
          },
        ]),
      )
      .mockReturnValueOnce(chainSelectedResolved([]));

    const result = await service.checkAttestationAvailability(-16.5, -68.1);

    expect(result.nearestLocation).toEqual(
      expect.objectContaining({
        name: 'Recinto Central',
        department: 'La Paz',
        municipality: 'Achocalla',
      }),
    );
    expect(result.availableElections[0]).toEqual(
      expect.objectContaining({
        canAttest: true,
        contract: expect.objectContaining({
          clientRole: 'MAYOR',
          territory: 'Achocalla',
        }),
      }),
    );
    expect(result.availableElections[1]).toEqual(
      expect.objectContaining({
        canAttest: false,
      }),
    );
  });
});
