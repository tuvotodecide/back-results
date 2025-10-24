import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { LoggerService } from '@/core/services/logger.service';
import { chain, rejectChain } from '../utils/chain';

const oid = () => new Types.ObjectId();

const mkModelCtor = () => {
  const fn: any = jest.fn().mockImplementation((doc) => ({
    ...doc,
    save: jest.fn().mockResolvedValue({ ...doc, _id: oid() }),
  }));
  fn.find = jest.fn();
  fn.findOne = jest.fn();
  fn.findById = jest.fn();
  fn.findByIdAndUpdate = jest.fn();
  fn.findByIdAndDelete = jest.fn();
  fn.countDocuments = jest.fn();
  fn.distinct = jest.fn();
  fn.aggregate = jest.fn();
  fn.bulkWrite = jest.fn();
  return fn;
};

describe('ElectoralTableService (unit)', () => {
  let svc: ElectoralTableService;
  const model = mkModelCtor();
  const locationSvc = { findOne: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ElectoralTableService,
        { provide: getModelToken(ElectoralTable.name), useValue: model },
        { provide: ElectoralLocationService, useValue: locationSvc },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(ElectoralTableService);
  });

  it('TAB-SVC-001 create: exige recinto válido', async () => {
    locationSvc.findOne.mockResolvedValue({ _id: oid() });
    const out: any = await svc.create({
      tableNumber: '1',
      tableCode: 'ABC123',
      electoralLocationId: oid() as any,
      active: true,
    });
    expect(out._id).toBeDefined();
    expect(model).toHaveBeenCalled();
  });

  it('TAB-SVC-002 create: conflicto por duplicado tableCode', async () => {
    locationSvc.findOne.mockResolvedValue({ _id: oid() });
    (model as any).mockImplementationOnce(() => ({
      save: jest.fn().mockRejectedValue(
        Object.assign(new Error('dup tableCode'), {
          code: 11000,
          message: 'tableCode dup',
        }),
      ),
    }));
    await expect(
      svc.create({
        tableNumber: '1',
        tableCode: 'ABC123',
        electoralLocationId: oid() as any,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('TAB-SVC-003 findByTableCode: 404 si no existe', async () => {
    model.findOne.mockReturnValue(chain(null));
    await expect(svc.findByTableCode('NOPE')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('TAB-SVC-004 resolveByIdOrCode: elige rama por tableId', async () => {
    const t = { _id: oid(), tableNumber: '1' };
    model.findById.mockReturnValue(chain(t));
    await expect(
      svc.resolveByIdOrCode({ tableId: t._id.toString() }),
    ).resolves.toBe(t as any);
  });

  it('TAB-SVC-005 findWithRecords: arma pipeline y filtra por electionId', async () => {
    model.aggregate.mockResolvedValue([
      { tableNumber: '1', tableCode: 'T-1', ballots: 2 },
    ]);
    const r = await svc.findWithRecords(oid().toString());
    expect(r.count).toBe(1);
  });

  it('TAB-SVC-006 ensureByCodeOrPrecinctAndNumber: con code upsert por tableCode', async () => {
    (model.findOneAndUpdate as any) = jest
      .fn()
      .mockReturnValue(chain({ _id: oid(), tableCode: 'C', tableNumber: '5' }));
    // @ts-ignore acceso directo a método privado
    const out = await svc.ensureByCodeOrPrecinctAndNumber(oid(), {
      code: 'C',
      number: 5,
      habilitados: 0,
      inhabilitados: 0,
    });
    expect(out.tableCode).toBe('C');
  });

  it('TAB-SVC-007 ensureByCodeOrPrecinctAndNumber: sin code upsert por (precinct, number)', async () => {
    (model.findOneAndUpdate as any) = jest
      .fn()
      .mockReturnValue(chain({ _id: oid(), tableNumber: '7' }));
    const out = await svc.ensureByCodeOrPrecinctAndNumber(oid(), {
      number: 7,
      habilitados: 0,
      inhabilitados: 0,
    });
    expect(out.tableNumber).toBe('7');
  });

  it('TAB-SVC-008 bulkUpsertByPrecinct: dedup + retorna mapa', async () => {
    model.bulkWrite.mockResolvedValue({ ok: 1 });
    model.find
      .mockReturnValueOnce(chain([{ _id: oid(), tableCode: 'A' }]))
      .mockReturnValueOnce(
        chain([{ _id: oid(), electoralLocationId: oid(), tableNumber: '2' }]),
      );
    const map = await svc.bulkUpsertByPrecinct(oid(), [
      { code: 'A', number: 1, habilitados: 0, inhabilitados: 0 },
      { number: 2, habilitados: 0, inhabilitados: 0 },
      { number: 2, habilitados: 0, inhabilitados: 0 }, // duplicada, debe dedup
    ]);
    expect(map.get('A')).toBeDefined();
    expect([...map.keys()].some((k) => k.includes(':2'))).toBe(true);
  });

  it('TAB-SVC-009 findOne: 404 si no existe', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne(oid().toString())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('TAB-SVC-010 getStatistics: devuelve summary por aggregate', async () => {
    model.aggregate.mockResolvedValue([
      { totalTables: 10, totalLocations: 5, avgTablesPerLocation: 2 },
    ]);
    model.countDocuments.mockResolvedValue(10);
    model.distinct.mockResolvedValue([oid(), oid()]);
    const out = await svc.getStatistics();
    expect(out.total).toBe(10);
    expect(out.totalLocationsWithTables).toBe(2);
  });

  it('TAB-SVC-011 findByElectoralLocation: verifica que llame a LocationService.findOne', async () => {
    locationSvc.findOne.mockResolvedValue({ _id: oid() });
    model.find.mockReturnValue(chain([{ _id: oid(), tableNumber: '1' }]));
    const res = await svc.findByElectoralLocation(oid().toString());
    expect(res.length).toBe(1);
    expect(locationSvc.findOne).toHaveBeenCalled();
  });

  it('TAB-SVC-012 update: dup 11000 en tableCode → 409', async () => {
    const dup = Object.assign(new Error('tableCode'), {
      code: 11000,
      message: 'tableCode',
    });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(
      svc.update(oid().toString(), { tableCode: 'ZZZ' } as any),
    ).rejects.toThrow(ConflictException);
  });

  it('TAB-SVC-013 activate/deactivate: 404 si no existe', async () => {
    model.findByIdAndUpdate.mockReturnValueOnce(chain(null));
    await expect(svc.activate(oid().toString())).rejects.toThrow(
      NotFoundException,
    );
    model.findByIdAndUpdate.mockReturnValueOnce(chain(null));
    await expect(svc.deactivate(oid().toString())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('TAB-SVC-014 countTotal/countByLocation: delega en count', async () => {
    model.countDocuments.mockReturnValue(chain(3));
    const total = await svc.countTotal();
    expect(total).toBe(3);
    const byLoc = await svc.countByLocation(oid().toString());
    expect(byLoc).toBe(3);
  });

  it('TAB-SVC-015 validateMesaPayload: cases inválidos → reason', () => {
    // @ts-ignore acceso privado
    expect(
      svc.validateMesaPayload({
        number: 0,
        habilitados: 0,
        inhabilitados: 0,
      } as any).ok,
    ).toBe(false);
  });
});
