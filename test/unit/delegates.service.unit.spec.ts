import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';

const contractId = '64d000000000000000000001';
const clientId = '64d000000000000000000002';
const superadminId = '64d000000000000000000003';
const otherContractId = '64d000000000000000000004';

describe('DelegatesService (unit)', () => {
  let delegateModel: any;
  let contractModel: any;
  let usersService: any;
  let service: DelegatesService;

  const contract = {
    _id: new Types.ObjectId(contractId),
    clientId: new Types.ObjectId(clientId),
    clientRole: 'GOVERNOR',
  };

  beforeEach(() => {
    delegateModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    contractModel = { findById: jest.fn() };
    usersService = { findOrCreateByDni: jest.fn() };
    service = new DelegatesService(delegateModel, contractModel, usersService);
  });

  it('addDelegate crea delegado nuevo para contrato existente', async () => {
    contractModel.findById.mockResolvedValue(contract);
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue(null);
    delegateModel.create.mockResolvedValue({ dni: '123456' });

    await service.addDelegate({
      dni: '123456',
      contractId,
      superadminId,
      name: 'Delegado Uno',
    });

    expect(delegateModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dni: '123456',
        active: true,
        name: 'Delegado Uno',
        authorizedContracts: [
          expect.objectContaining({
            contractId: new Types.ObjectId(contractId),
            clientId: new Types.ObjectId(clientId),
            clientRole: 'GOVERNOR',
            addedBy: new Types.ObjectId(superadminId),
          }),
        ],
      }),
    );
  });

  it('addDelegate rechaza contrato inexistente y duplicado en mismo contrato', async () => {
    contractModel.findById.mockResolvedValueOnce(null);
    await expect(
      service.addDelegate({ dni: '123456', contractId, superadminId }),
    ).rejects.toBeInstanceOf(NotFoundException);

    contractModel.findById.mockResolvedValue(contract);
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue({
      authorizedContracts: [{ contractId: new Types.ObjectId(contractId) }],
    });

    await expect(
      service.addDelegate({ dni: '123456', contractId, superadminId }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('uploadDelegatesCsv agrega filas válidas y reporta errores parciales', async () => {
    contractModel.findById.mockResolvedValue(contract);
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue(null);
    delegateModel.create.mockResolvedValue({});

    const result = await service.uploadDelegatesCsv({
      contractId,
      superadminId,
      csvContent: 'dni,name,email\n123456,Ana,a@example.com\n,Sin DNI,b@example.com\n',
    });

    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, error: 'DNI requerido' }),
    ]);
  });

  it('removeFromContract y consultas usan contrato específico', async () => {
    delegateModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    await expect(service.removeFromContract('123456', contractId)).resolves.toBeUndefined();
    expect(delegateModel.updateOne).toHaveBeenCalledWith(
      { dni: '123456' },
      { $pull: { authorizedContracts: { contractId: new Types.ObjectId(contractId) } } },
    );

    delegateModel.countDocuments.mockResolvedValue(1);
    await expect(service.isAuthorizedForContract('123456', contractId)).resolves.toBe(true);
  });

  it('listByContract solo consulta delegados activos del contrato indicado', async () => {
    const expected = [{ dni: '123456', active: true }];
    const chain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(expected),
    };
    delegateModel.find.mockReturnValue(chain);

    await expect(service.listByContract(contractId)).resolves.toBe(expected);

    expect(delegateModel.find).toHaveBeenCalledWith({
      'authorizedContracts.contractId': new Types.ObjectId(contractId),
      active: true,
    });
    expect(chain.populate).toHaveBeenCalledWith(
      'userId',
      'dni votingLocationId votingTableId',
    );
  });

  it('getAuthorizedContracts documenta delegado autorizado, inactivo y fuera de scope', async () => {
    delegateModel.findOne.mockResolvedValueOnce({
      active: true,
      authorizedContracts: [
        {
          contractId: new Types.ObjectId(contractId),
          clientId: new Types.ObjectId(clientId),
          clientRole: 'GOVERNOR',
        },
        {
          contractId: new Types.ObjectId(otherContractId),
          clientId: new Types.ObjectId(),
          clientRole: 'MAYOR',
        },
      ],
    });

    await expect(service.getAuthorizedContracts('123456')).resolves.toEqual([
      {
        contractId,
        clientId,
        clientRole: 'GOVERNOR',
      },
      expect.objectContaining({
        contractId: otherContractId,
        clientRole: 'MAYOR',
      }),
    ]);

    delegateModel.findOne.mockResolvedValueOnce(null);
    await expect(service.getAuthorizedContracts('999999')).resolves.toEqual([]);
  });

  it('isAuthorizedForContract devuelve false para contrato ajeno o delegado inactivo', async () => {
    delegateModel.countDocuments.mockResolvedValue(0);

    await expect(
      service.isAuthorizedForContract('123456', otherContractId),
    ).resolves.toBe(false);

    expect(delegateModel.countDocuments).toHaveBeenCalledWith({
      dni: '123456',
      'authorizedContracts.contractId': new Types.ObjectId(otherContractId),
      active: true,
    });
  });

  it('removeFromContract lanza NotFoundException si el delegado no existe', async () => {
    delegateModel.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      service.removeFromContract('000000', contractId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
