import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectoralSeatService } from '@/modules/geographic/services/electoral-seat.service';
import { ElectoralSeat } from '@/modules/geographic/schemas/electoral-seat.schema';
import { MunicipalityService } from '@/modules/geographic/services/municipality.service';
import { LoggerService } from '@/core/services/logger.service';
import { chain, rejectChain } from '../utils/chain';

const oid = () => new Types.ObjectId();

const mkModelCtor = () => {
  const fn: any = jest.fn().mockImplementation((doc) => ({
    ...doc,
    save: jest.fn().mockResolvedValue({ ...doc, _id: oid() }),
  }));
  fn.create = jest.fn();
  fn.find = jest.fn();
  fn.findOne = jest.fn();
  fn.findById = jest.fn();
  fn.findByIdAndUpdate = jest.fn();
  fn.findByIdAndDelete = jest.fn();
  fn.countDocuments = jest.fn();
  fn.aggregate = jest.fn();
  fn.bulkWrite = jest.fn();
  return fn;
};

describe('ElectoralSeatService', () => {
  let svc: ElectoralSeatService;
  const model = mkModelCtor();
  const munSvc = {
    findOne: jest.fn(),
    findByProvince: jest.fn(),
    findByDepartment: jest.fn(),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ElectoralSeatService,
        { provide: getModelToken(ElectoralSeat.name), useValue: model },
        { provide: MunicipalityService, useValue: munSvc },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(ElectoralSeatService);
  });

  it('create: verifica municipio y dup -> 409', async () => {
    munSvc.findOne.mockResolvedValue({ _id: oid() });
    const out:any = await svc.create({ idLoc: '1', name: 'A', municipalityId: oid() as any } as any);
    expect(out._id).toBeDefined();

    (model as any).mockImplementationOnce(() => ({
      save: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
    }));
    await expect(svc.create({ idLoc: '1', name: 'A', municipalityId: oid() as any } as any))
      .rejects.toThrow(ConflictException);
  });

  it('findAll: con departmentId/provinceId arma filtros llamando a MunicipalityService', async () => {
    munSvc.findByDepartment.mockResolvedValue([{ _id: oid() }]);
    model.find.mockReturnValue(chain([{ name: 'S1' }]));
    model.countDocuments.mockReturnValue(chain(1));
    const r = await svc.findAll({ page: 1, limit: 10, departmentId: oid() } as any);
    expect(r.pagination.total).toBe(1);
    expect(munSvc.findByDepartment).toHaveBeenCalled();
  });

  it('findOne: 404', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne(oid())).rejects.toThrow(NotFoundException);
  });

  it('update: dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(svc.update(oid(), { name: 'X' } as any)).rejects.toThrow(ConflictException);
  });

  it('remove: 404', async () => {
    model.findByIdAndDelete.mockReturnValue(chain(null));
    await expect(svc.remove(oid())).rejects.toThrow(NotFoundException);
  });

  it('findByMunicipality / findByProvince / findByDepartment', async () => {
    munSvc.findOne.mockResolvedValue({ _id: oid() });
    munSvc.findByProvince.mockResolvedValue([{ _id: oid() }]);
    munSvc.findByDepartment.mockResolvedValue([{ _id: oid() }]);
    model.find.mockReturnValue(chain([{ name: 'S1' }]));
    await expect(svc.findByMunicipality(oid())).resolves.toHaveLength(1);
    await expect(svc.findByProvince(oid())).resolves.toHaveLength(1);
    await expect(svc.findByDepartment(oid() as any)).resolves.toHaveLength(1);
  });

  it('ensureByName: maneja dup y re-lee', async () => {
    model.findOne.mockReturnValueOnce(chain(null));
    model.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    model.findOne.mockReturnValueOnce(chain({ _id: 'E1', name: 'Centro' }));
    const out = await svc.ensureByName(oid(), '  Centro  ');
    expect(out.name).toBe('Centro');
  });

  it('bulkEnsureByMunicipality y mapByNames: ok', async () => {
    model.bulkWrite.mockResolvedValue({ ok: 1 });
    model.find.mockReturnValue(chain([{ name: 'Alto' }, { name: 'Bajo' }]));
    const map = await svc.bulkEnsureByMunicipality(oid(), ['Alto', 'Bajo', 'Alto']);
    expect(map.get('Alto')).toBeDefined();

    model.find.mockReturnValue(chain([{ name: 'Norte' }]));
    const map2 = await svc.mapByNames(oid(), ['Norte']);
    expect(map2.get('Norte')).toBeDefined();
  });
});
