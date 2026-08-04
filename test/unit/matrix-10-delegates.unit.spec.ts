import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';

describe('MX-10 | delegados unitario focal', () => {
  const contractId = new Types.ObjectId().toString();
  const clientId = new Types.ObjectId();
  const superadminId = new Types.ObjectId().toString();

  const buildService = () => {
    const delegateModel = { create: jest.fn(), findOne: jest.fn(), updateOne: jest.fn(), countDocuments: jest.fn(), find: jest.fn() };
    const contractModel = { findById: jest.fn() };
    const usersService = { findOrCreateByDni: jest.fn() };
    return {
      service: new DelegatesService(
        ...([delegateModel, contractModel, usersService] as unknown as ConstructorParameters<typeof DelegatesService>),
      ),
      delegateModel,
      contractModel,
      usersService,
    };
  };

  it('[MX-10][DEL-UPL-P0-001][UNITARIA] procesa columnas CSV, conserva filas válidas y informa el DNI ausente', async () => {
    const { service, delegateModel, contractModel, usersService } = buildService();
    contractModel.findById.mockResolvedValue({ clientId, clientRole: 'GOVERNOR' });
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue(null);
    delegateModel.create.mockResolvedValue({});

    const result = await service.uploadDelegatesCsv({
      csvContent: 'dni,name,phone,email\n1234567,Ana,70000000,ana@example.test\n,Sin DNI,1,sin@example.test\n',
      contractId,
      superadminId,
    });

    expect(result).toMatchObject({ added: 1, updated: 0, errors: [expect.objectContaining({ row: 3, error: 'DNI requerido' })] });
    expect(delegateModel.create).toHaveBeenCalledWith(expect.objectContaining({ dni: '1234567', name: 'Ana', phone: '70000000', email: 'ana@example.test' }));
  });

  it('[MX-10][DEL-ADD-P0-002][UNITARIA] crea el delegado con los datos permitidos y su autorización contractual', async () => {
    const { service, delegateModel, contractModel, usersService } = buildService();
    contractModel.findById.mockResolvedValue({ clientId, clientRole: 'GOVERNOR' });
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue(null);
    delegateModel.create.mockResolvedValue({ dni: '1234567' });

    await service.addDelegate({ dni: '1234567', contractId, superadminId, name: 'Ana', phone: '70000000', email: 'ana@example.test' });

    expect(delegateModel.create).toHaveBeenCalledWith(expect.objectContaining({
      dni: '1234567', name: 'Ana', phone: '70000000', email: 'ana@example.test',
      authorizedContracts: [expect.objectContaining({ contractId: new Types.ObjectId(contractId), clientId, clientRole: 'GOVERNOR' })],
    }));
  });

  it('[MX-10][DEL-DUP-P0-003][UNITARIA] rechaza una autorización contractual que ya existe para el DNI', async () => {
    const { service, contractModel, delegateModel, usersService } = buildService();
    contractModel.findById.mockResolvedValue({ clientId, clientRole: 'GOVERNOR' });
    usersService.findOrCreateByDni.mockResolvedValue({ _id: new Types.ObjectId() });
    delegateModel.findOne.mockResolvedValue({ authorizedContracts: [{ contractId: new Types.ObjectId(contractId) }] });

    await expect(service.addDelegate({ dni: '1234567', contractId, superadminId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('[MX-10][DEL-AUT-P0-007][UNITARIA] responde autorización sólo para el DNI activo vinculado al contrato consultado', async () => {
    const { service, delegateModel } = buildService();
    delegateModel.countDocuments.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(service.isAuthorizedForContract('1234567', contractId)).resolves.toBe(true);
    await expect(service.isAuthorizedForContract('0000000', contractId)).resolves.toBe(false);
    expect(delegateModel.countDocuments).toHaveBeenLastCalledWith({ dni: '0000000', 'authorizedContracts.contractId': new Types.ObjectId(contractId), active: true });
  });

  it('[MX-10][DEL-REM-P0-006][UNITARIA] quita sólo el contrato indicado y devuelve NotFound si no hay delegado', async () => {
    const { service, delegateModel } = buildService();
    delegateModel.updateOne.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 });

    await expect(service.removeFromContract('1234567', contractId)).resolves.toBeUndefined();
    expect(delegateModel.updateOne).toHaveBeenCalledWith({ dni: '1234567' }, { $pull: { authorizedContracts: { contractId: new Types.ObjectId(contractId) } } });
    await expect(service.removeFromContract('inexistente', contractId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
