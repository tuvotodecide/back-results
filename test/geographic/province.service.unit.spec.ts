import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProvinceService } from '@/modules/geographic/services/province.service';
import { Province } from '@/modules/geographic/schemas/province.schema';
import { DepartmentService } from '@/modules/geographic/services/department.service';
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
  fn.findById = jest.fn();
  fn.findByIdAndUpdate = jest.fn();
  fn.findByIdAndDelete = jest.fn();
  fn.countDocuments = jest.fn();
  fn.findOne = jest.fn();
  fn.bulkWrite = jest.fn();
  return fn;
};

describe('ProvinceService (unit)', () => {
  let svc: ProvinceService;
  const model = mkModelCtor();
  const deptSvc = { findOne: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ProvinceService,
        { provide: getModelToken(Province.name), useValue: model },
        { provide: DepartmentService, useValue: deptSvc },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(ProvinceService);
  });

  it('PROV-SVC-001 create: verifica department y crea, dup -> 409', async () => {
    deptSvc.findOne.mockResolvedValue({ _id: oid() });
    const out:any = await svc.create({ name: 'X', departmentId: oid() as any } as any);
    expect(out._id).toBeDefined();

    (model as any).mockImplementationOnce(() => ({
      save: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
    }));
    await expect(svc.create({ name: 'X', departmentId: oid() as any } as any))
      .rejects.toThrow(ConflictException);
  });

  it('PROV-SVC-002 findAll: pagina y filtra', async () => {
    model.find.mockReturnValue(chain([{ name: 'Y' }]));
    model.countDocuments.mockReturnValue(chain(1));
    const r = await svc.findAll({ page: 1, limit: 10, search: 'Y', active: 'true' } as any);
    expect(r.pagination.total).toBe(1);
  });

  it('PROV-SVC-003 findOne: 404 si no existe', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne('nope')).rejects.toThrow(NotFoundException);
  });

  it('PROV-SVC-004 update: dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(svc.update(oid().toString(), { name: 'Z' })).rejects.toThrow(ConflictException);
  });

  it('PROV-SVC-005 remove: 404 si no existe', async () => {
    model.findByIdAndDelete.mockReturnValue(chain(null));
    await expect(svc.remove(oid())).rejects.toThrow(NotFoundException);
  });

  it('PROV-SVC-006 ensureByName: maneja carrera (dup) y re-lee', async () => {
    model.findOne
      .mockReturnValueOnce(chain(null)) // no existe
      .mockReturnValueOnce(chain({ _id: 'P1', name: 'Tarija' })); // re-lee
    model.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    const out = await svc.ensureByName(' Tarija ', oid());
    expect(out.name).toBe('Tarija');
  });
});
