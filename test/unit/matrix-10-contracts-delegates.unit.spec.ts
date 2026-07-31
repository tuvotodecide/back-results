import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ContractsService } from '@/modules/contracts/services/contracts.service';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';

const chainResolved = <T>(value: T) => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('MX-10 | Administración territorial, contratos y delegados | Backend Results | Contratos y delegados', () => {
  const clientId = '650000000000000000000001';
  const electionId = '650000000000000000000002';
  const departmentId = '650000000000000000000003';
  const municipalityId = '650000000000000000000004';
  const contractId = '650000000000000000000005';
  const superadminId = '650000000000000000000006';

  const buildContractsService = () => {
    const contractModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      updateOne: jest.fn(),
    };
    const roledUserModel = { findById: jest.fn() };
    const departmentModel = { findById: jest.fn() };
    const municipalityModel = { findById: jest.fn() };
    const electoralLocationService = {
      findNearestLocation: jest.fn(),
      findOneWithHierarchy: jest.fn(),
    };
    const electionConfigService = { getActiveConfigs: jest.fn() };
    const service = new ContractsService(
      contractModel as never,
      roledUserModel as never,
      departmentModel as never,
      municipalityModel as never,
      electoralLocationService as never,
      electionConfigService as never,
    );
    return {
      service,
      contractModel,
      roledUserModel,
      departmentModel,
      municipalityModel,
      electionConfigService,
    };
  };

  const buildDelegatesService = () => {
    const delegateModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    const contractModel = { findById: jest.fn() };
    const usersService = { findOrCreateByDni: jest.fn() };
    const service = new DelegatesService(
      delegateModel as never,
      contractModel as never,
      usersService as never,
    );
    return { service, delegateModel, contractModel, usersService };
  };

  it('[CON-NEW-P0-001][CON-TER-P0-002][CON-DUP-P0-003][CON-CON-P0-001][CON-DIS-P0-006][CON-ERR-P1-005] valida contrato territorial administrativo y duplicidad activa', async () => {
    const {
      service,
      contractModel,
      roledUserModel,
      departmentModel,
      municipalityModel,
    } = buildContractsService();
    const startDate = new Date('2026-01-01T00:00:00.000Z');

    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    departmentModel.findById.mockResolvedValue({ _id: departmentId, name: 'La Paz' });
    contractModel.findOne.mockResolvedValue(null);
    contractModel.create.mockResolvedValue({ _id: contractId });

    await service.create({ clientId, electionId, departmentId, startDate });

    expect(contractModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        clientId: new Types.ObjectId(clientId),
        clientRole: 'GOVERNOR',
        departmentId: new Types.ObjectId(departmentId),
        municipalityId: null,
        electionId: new Types.ObjectId(electionId),
        startDate,
      }),
    );

    await expect(
      service.create({ clientId, electionId, startDate }),
    ).rejects.toBeInstanceOf(BadRequestException);

    roledUserModel.findById.mockResolvedValue({ active: true, role: 'MAYOR' });
    await expect(
      service.create({ clientId, electionId, departmentId, startDate }),
    ).rejects.toBeInstanceOf(BadRequestException);

    roledUserModel.findById.mockResolvedValue({ active: true, role: 'GOVERNOR' });
    contractModel.findOne.mockResolvedValueOnce({ _id: contractId });
    await expect(
      service.create({ clientId, electionId, departmentId, startDate }),
    ).rejects.toBeInstanceOf(ConflictException);

    contractModel.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await expect(service.deactivate(contractId)).resolves.toBeUndefined();
    expect(contractModel.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(contractId) },
      { $set: { active: false, endDate: expect.any(Date) } },
    );

    contractModel.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await expect(service.deactivate(contractId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    municipalityModel.findById.mockResolvedValue({ _id: municipalityId, name: 'La Paz' });
  });

  it('[CON-LST-P1-004][CON-PUB-P1-005][SEC-DAT-P0-002][TRA-P1-001] expone contratos activos e históricos sin datos personales públicos', async () => {
    const { service, contractModel, electionConfigService } = buildContractsService();
    electionConfigService.getActiveConfigs.mockResolvedValue([
      { id: electionId, name: 'Eleccion Municipal', type: 'municipal', round: 1 },
    ]);
    contractModel.find.mockReturnValueOnce(
      chainResolved([
        {
          _id: new Types.ObjectId(contractId),
          active: true,
          clientRole: 'MAYOR',
          electionId: {
            _id: new Types.ObjectId(electionId),
            name: 'Eleccion Municipal',
            type: 'municipal',
            round: 1,
          },
          municipalityId: { _id: new Types.ObjectId(municipalityId), name: 'La Paz' },
          municipalityName: 'La Paz',
          departmentId: null,
          departmentName: null,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: null,
        },
      ]),
    );

    const publicContracts = await service.findPublicActiveContracts({ electionId });
    expect(publicContracts).toEqual([
      expect.objectContaining({
        contractId,
        clientRole: 'MAYOR',
        active: true,
        election: expect.objectContaining({ electionId }),
        territory: expect.objectContaining({
          type: 'municipality',
          municipalityName: 'La Paz',
        }),
      }),
    ]);
    expect(publicContracts[0]).not.toHaveProperty('client');
    expect(publicContracts[0]).not.toHaveProperty('delegates');

    contractModel.find.mockReturnValueOnce(
      chainResolved([
        {
          _id: new Types.ObjectId(contractId),
          active: false,
          clientRole: 'MAYOR',
          electionId: { _id: new Types.ObjectId(electionId), name: 'Histórica' },
          municipalityId: { _id: new Types.ObjectId(municipalityId), name: 'La Paz' },
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]),
    );
    const elections = await service.getMyElections(clientId);
    expect(elections[0].contracts[0]).toEqual(
      expect.objectContaining({
        contractId,
        active: false,
        startDate: expect.any(Date),
        endDate: expect.any(Date),
      }),
    );
  });

  it('[DEL-UPL-P0-001][DEL-ADD-P0-002][DEL-DUP-P0-003][DEL-MUL-P1-004][DEL-LST-P1-005][DEL-REM-P0-006][DEL-AUT-P0-007][SEC-DEL-P0-003] administra delegados por contrato con campos permitidos', async () => {
    const { service, delegateModel, contractModel, usersService } = buildDelegatesService();
    const contract = {
      _id: new Types.ObjectId(contractId),
      clientId: new Types.ObjectId(clientId),
      clientRole: 'MAYOR',
    };
    contractModel.findById.mockResolvedValue(contract);
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValueOnce(null);
    delegateModel.create.mockResolvedValue({ dni: '1234567' });

    await service.addDelegate({
      dni: '1234567',
      contractId,
      superadminId,
      name: 'Ana Delegada',
      phone: '70000000',
      email: 'ana@example.test',
    });
    expect(delegateModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dni: '1234567',
        name: 'Ana Delegada',
        phone: '70000000',
        email: 'ana@example.test',
        authorizedContracts: [
          expect.objectContaining({
            contractId: new Types.ObjectId(contractId),
            addedBy: new Types.ObjectId(superadminId),
            addedAt: expect.any(Date),
          }),
        ],
      }),
    );

    delegateModel.findOne.mockResolvedValueOnce({
      authorizedContracts: [{ contractId: new Types.ObjectId(contractId) }],
    });
    await expect(
      service.addDelegate({ dni: '1234567', contractId, superadminId }),
    ).rejects.toBeInstanceOf(BadRequestException);

    delegateModel.findOne.mockResolvedValueOnce(null);
    delegateModel.create.mockResolvedValue({});
    const upload = await service.uploadDelegatesCsv({
      csvContent: 'dni,name,phone,email\n1234567,Ana,70000000,ana@example.test\n,Sin DNI,1,x@test\n',
      contractId,
      superadminId,
    });
    expect(upload).toEqual({
      added: 1,
      updated: 0,
      errors: [expect.objectContaining({ row: 3, error: 'DNI requerido' })],
    });

    delegateModel.find.mockReturnValue(
      chainResolved([
        {
          dni: '1234567',
          name: 'Ana Delegada',
          phone: '70000000',
          email: 'ana@example.test',
          active: true,
          authorizedContracts: [{ contractId: new Types.ObjectId(contractId) }],
        },
      ]),
    );
    await expect(service.listByContract(contractId)).resolves.toHaveLength(1);
    expect(delegateModel.find).toHaveBeenCalledWith({
      'authorizedContracts.contractId': new Types.ObjectId(contractId),
      active: true,
    });

    delegateModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    await expect(service.removeFromContract('1234567', contractId)).resolves.toBeUndefined();

    delegateModel.countDocuments.mockResolvedValue(1);
    await expect(service.isAuthorizedForContract('1234567', contractId)).resolves.toBe(true);
  });

  it('[DEL-CON-P0-002] mantiene una sola autorización final cuando se detecta repetición equivalente', async () => {
    const { service, delegateModel, contractModel, usersService } = buildDelegatesService();
    contractModel.findById.mockResolvedValue({
      _id: new Types.ObjectId(contractId),
      clientId: new Types.ObjectId(clientId),
      clientRole: 'GOVERNOR',
    });
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne
      .mockResolvedValueOnce({
        authorizedContracts: [],
        save: jest.fn().mockResolvedValue({}),
      })
      .mockResolvedValueOnce({
        authorizedContracts: [{ contractId: new Types.ObjectId(contractId) }],
      });

    await service.addDelegate({ dni: '7654321', contractId, superadminId });
    await expect(
      service.addDelegate({ dni: '7654321', contractId, superadminId }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(delegateModel.findOne).toHaveBeenCalledWith({ dni: '7654321' });
  });
});
