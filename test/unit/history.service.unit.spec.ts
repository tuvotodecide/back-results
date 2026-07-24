import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { HistoryService } from '@/modules/history/services/history.service';
import { History } from '@/modules/history/schemas/history.schema';
import { HistoryOperationKey, HistoryType } from '@/modules/history/dto/create-history.dto';
import { chain } from '../utils/chain';
import { ethers } from 'ethers';

const oid = () => new Types.ObjectId();

const mkModelCtor = () => {
  const fn: any = jest.fn().mockImplementation((doc) => ({
    ...doc,
    save: jest.fn().mockResolvedValue({ ...doc, _id: oid() }),
  }));
  fn.find = jest.fn();
  fn.findById = jest.fn();
  fn.countDocuments = jest.fn();
  return fn;
};

const contractsConfig = {
  tvdToken: { address: '0xtoken', txHash: '0xtokenTx' },
  coreVesting: { address: '0xcore', txHash: '0xcoreTx' },
  institutionalVesting: { address: '0xinst', txHash: '0xinstTx' },
  incentiveCampaigns: { address: '0xincentive', txHash: '0xincentiveTx' },
  electoralCredits: { address: '0xcredits', txHash: '0xcreditsTx' },
  voteManager: { address: '0xvote', txHash: '0xvoteTx' },
};
const configValues: Record<string, unknown> = {
  'app.contracts': contractsConfig,
  'app.blockchain.chain': 'base-sepolia',
};

describe('HistoryService (unit)', () => {
  let svc: HistoryService;
  const model = mkModelCtor();
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => configValues[key]);
    const mod = await Test.createTestingModule({
      providers: [
        HistoryService,
        { provide: getModelToken(History.name), useValue: model },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();
    svc = mod.get(HistoryService);
  });

  describe('create', () => {
    it('crea un history y responde {success, data}', async () => {
      const dto: any = {
        txHash: '0x123',
        operationName: HistoryOperationKey.setTvdPerCredit,
        type: HistoryType.MULTISIG,
        registerDate: new Date().toISOString(),
      };

      const out = await svc.create(dto);

      expect(out.success).toBe(true);
      expect(out.data).toBeDefined();
      expect((out.data as any)._id).toBeDefined();
    });

    it('convierte roledUserId, institutionId y electionId a ObjectId', async () => {
      const roledUserId = oid().toString();
      const institutionId = oid().toString();
      const electionId = oid().toString();

      await svc.create({
        txHash: '0x123',
        operationName: HistoryOperationKey.setTvdPerCredit,
        type: HistoryType.MULTISIG,
        registerDate: new Date().toISOString(),
        roledUserId,
        institutionId,
        electionId,
      } as any);

      const callArg = model.mock.calls[0][0];
      expect(callArg.roledUserId).toBeInstanceOf(Types.ObjectId);
      expect(callArg.roledUserId.toString()).toBe(roledUserId);
      expect(callArg.institutionId).toBeInstanceOf(Types.ObjectId);
      expect(callArg.electionId).toBeInstanceOf(Types.ObjectId);
    });

    it('no setea ids opcionales cuando no vienen en el dto', async () => {
      await svc.create({
        txHash: '0x123',
        operationName: HistoryOperationKey.setTvdPerCredit,
        type: HistoryType.MULTISIG,
        registerDate: new Date().toISOString(),
      } as any);

      const callArg = model.mock.calls[0][0];
      expect(callArg.roledUserId).toBeUndefined();
      expect(callArg.institutionId).toBeUndefined();
      expect(callArg.electionId).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('pagina y responde {success, data: {totalitems, limit, page, totalPages, items}}', async () => {
      const items = [{ txHash: '0x1' }, { txHash: '0x2' }];
      model.find.mockReturnValue(chain(items));
      model.countDocuments.mockReturnValue(chain(2));

      const out = await svc.findAll({ page: 1, limit: 10 } as any);

      expect(out.success).toBe(true);
      expect(out.data.items).toEqual(items);
      expect(out.data.totalitems).toBe(2);
      expect(out.data.page).toBe(1);
      expect(out.data.limit).toBe(10);
      expect(out.data.totalPages).toBe(1);
    });

    it('aplica filtros por campos indexados', async () => {
      model.find.mockReturnValue(chain([]));
      model.countDocuments.mockReturnValue(chain(0));

      const roledUserId = oid().toString();
      const institutionId = oid().toString();

      await svc.findAll({
        page: 1,
        limit: 10,
        txHash: '0xabc',
        operationName: HistoryOperationKey.setTvdPerCredit,
        type: HistoryType.OWNER,
        roledUserId,
        institutionId,
      } as any);

      const filters = model.find.mock.calls[0][0];
      expect(filters.txHash).toBe('0xabc');
      expect(filters.operationName).toBe(HistoryOperationKey.setTvdPerCredit);
      expect(filters.type).toBe(HistoryType.OWNER);
      expect(filters.roledUserId).toBeInstanceOf(Types.ObjectId);
      expect(filters.institutionId).toBeInstanceOf(Types.ObjectId);
    });

    it('aplica filtro de rango para registerDate', async () => {
      model.find.mockReturnValue(chain([]));
      model.countDocuments.mockReturnValue(chain(0));

      await svc.findAll({
        page: 1,
        limit: 10,
        registerDateFrom: '2026-01-01T00:00:00.000Z',
        registerDateTo: '2026-12-31T23:59:59.000Z',
      } as any);

      const filters = model.find.mock.calls[0][0];
      expect(filters.registerDate.$gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(filters.registerDate.$lte).toEqual(new Date('2026-12-31T23:59:59.000Z'));
    });

    it('calcula skip a partir de page y limit', async () => {
      model.find.mockReturnValue(chain([]));
      model.countDocuments.mockReturnValue(chain(0));

      const queryChain = chain([]);
      model.find.mockReturnValue(queryChain);

      await svc.findAll({ page: 3, limit: 5 } as any);

      expect(queryChain.skip).toHaveBeenCalledWith(10);
      expect(queryChain.limit).toHaveBeenCalledWith(5);
    });

    it('agrega relatedAmount decimal desde una transaccion asociada sin perder precision', async () => {
      const iface = new ethers.Interface(['function setTvdPerCredit(uint256 newRate)']);
      const item: any = {
        _id: oid(),
        txHash: '0xrate',
        operationName: HistoryOperationKey.setTvdPerCredit,
        type: HistoryType.MULTISIG,
        registerDate: new Date('2026-01-01T00:00:00.000Z'),
      };
      (svc as any).provider.getTransaction = jest.fn().mockResolvedValue({
        data: iface.encodeFunctionData('setTvdPerCredit', [
          3000000000000000000n,
        ]),
        value: 0n,
      });

      await expect(svc.getRelatedAmounts([item])).resolves.toEqual([
        expect.objectContaining({
          txHash: '0xrate',
          relatedAmount: '3.0',
        }),
      ]);
    });

    it('agrega relatedAmount desde receipt cuando la operacion viene de evento', async () => {
      const iface = new ethers.Interface([
        'event TopUp(address indexed institution, uint256 electionId, uint256 creditsPurchased, uint256 tvdLocked)',
      ]);
      const item: any = {
        _id: oid(),
        txHash: '0xtopup',
        operationName: HistoryOperationKey.createElection,
        type: HistoryType.AUTOMATED,
        registerDate: new Date('2026-01-01T00:00:00.000Z'),
      };
      const event = iface.encodeEventLog(iface.getEvent('TopUp')!, [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        1n,
        3n,
        3000000000000000000n,
      ]);
      (svc as any).provider.getTransactionReceipt = jest.fn().mockResolvedValue({
        logs: [{ topics: event.topics, data: event.data }],
      });

      await expect(svc.getRelatedAmounts([item])).resolves.toEqual([
        expect.objectContaining({
          txHash: '0xtopup',
          relatedAmount: '3.0',
        }),
      ]);
    });

    it('mantiene compatible un historial anterior sin relatedAmount', async () => {
      const item: any = {
        _id: oid(),
        txHash: '0xlegacy',
        operationName: HistoryOperationKey.addMultisigOwner,
        type: HistoryType.MULTISIG,
        registerDate: new Date('2026-01-01T00:00:00.000Z'),
      };

      await expect(svc.getRelatedAmounts([item])).resolves.toEqual([item]);
    });
  });

  describe('findOne', () => {
    it('responde {success, data} cuando existe', async () => {
      const doc = { _id: oid(), txHash: '0x1' };
      model.findById.mockReturnValue(chain(doc));

      const out = await svc.findOne(doc._id.toString());

      expect(out.success).toBe(true);
      expect(out.data).toEqual(doc);
    });

    it('lanza NotFoundException si no existe', async () => {
      model.findById.mockReturnValue(chain(null));
      await expect(svc.findOne(oid().toString())).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContracts', () => {
    it('responde {success, data} leyendo app.contracts desde ConfigService', () => {
      const out = svc.getContracts();
      expect(configService.get).toHaveBeenCalledWith('app.contracts');
      expect(out.success).toBe(true);
      expect(out.data).toEqual(contractsConfig);
    });
  });
});
