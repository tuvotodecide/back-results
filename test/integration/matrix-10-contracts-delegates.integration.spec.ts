import { Types } from 'mongoose';
import { DelegatesService } from '@/modules/contracts/services/delegates.service';

type Authorization = {
  contractId: Types.ObjectId;
  clientId: Types.ObjectId;
  clientRole: 'MAYOR' | 'GOVERNOR';
  addedAt: Date;
  addedBy: Types.ObjectId;
};

type StoredDelegate = {
  dni: string;
  active: boolean;
  authorizedContracts: Authorization[];
  save: jest.Mock<Promise<StoredDelegate>, []>;
};

describe('MX-10 | integración focal de delegados', () => {
  const clientId = new Types.ObjectId();
  const firstContractId = new Types.ObjectId();
  const secondContractId = new Types.ObjectId();
  const superadminId = new Types.ObjectId();

  it('[MX-10][DEL-MUL-P1-004][INTEGRACION] persiste una autorización diferente conservando cliente y rol por contrato', async () => {
    const stored: StoredDelegate = {
      dni: '1234567',
      active: true,
      authorizedContracts: [
        {
          contractId: firstContractId,
          clientId,
          clientRole: 'GOVERNOR',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          addedBy: superadminId,
        },
      ],
      save: jest.fn(),
    };
    stored.save.mockResolvedValue(stored);
    const delegateModel = {
      findOne: jest.fn().mockResolvedValue(stored),
    };
    const contractModel = {
      findById: jest.fn().mockResolvedValue({
        _id: secondContractId,
        clientId,
        clientRole: 'MAYOR',
      }),
    };
    const usersService = {
      findOrCreateByDni: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };
    const service = new DelegatesService(
      delegateModel as never,
      contractModel as never,
      usersService as never,
    );

    await service.addDelegate({
      dni: stored.dni,
      contractId: secondContractId.toString(),
      superadminId: superadminId.toString(),
    });

    expect(stored.save).toHaveBeenCalledTimes(1);
    expect(stored.authorizedContracts).toHaveLength(2);
    expect(stored.authorizedContracts[1]).toEqual(
      expect.objectContaining({
        contractId: secondContractId,
        clientId,
        clientRole: 'MAYOR',
        addedBy: superadminId,
      }),
    );
    expect(stored.authorizedContracts[0].contractId).toEqual(firstContractId);
  });

  it('[MX-10][DEL-REM-P0-006][INTEGRACION] elimina sólo la autorización solicitada y deja persistida la autorización restante', async () => {
    const stored: StoredDelegate = {
      dni: '1234567',
      active: true,
      authorizedContracts: [
        {
          contractId: firstContractId,
          clientId,
          clientRole: 'GOVERNOR',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          addedBy: superadminId,
        },
        {
          contractId: secondContractId,
          clientId,
          clientRole: 'MAYOR',
          addedAt: new Date('2026-01-02T00:00:00.000Z'),
          addedBy: superadminId,
        },
      ],
      save: jest.fn(),
    };
    stored.save.mockResolvedValue(stored);
    const delegateModel = {
      updateOne: jest.fn().mockImplementation(
        async (_filter: { dni: string }, update: { $pull: { authorizedContracts: { contractId: Types.ObjectId } } }) => {
          stored.authorizedContracts = stored.authorizedContracts.filter(
            (authorization) => !authorization.contractId.equals(update.$pull.authorizedContracts.contractId),
          );
          return { matchedCount: 1 };
        },
      ),
    };
    const service = new DelegatesService(delegateModel as never, {} as never, {} as never);

    await service.removeFromContract(stored.dni, firstContractId.toString());

    expect(delegateModel.updateOne).toHaveBeenCalledWith(
      { dni: stored.dni },
      { $pull: { authorizedContracts: { contractId: firstContractId } } },
    );
    expect(stored.authorizedContracts).toEqual([
      expect.objectContaining({ contractId: secondContractId, clientRole: 'MAYOR' }),
    ]);
  });
});
