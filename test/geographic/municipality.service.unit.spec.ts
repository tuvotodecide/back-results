import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MunicipalityService } from '@/modules/geographic/services/municipality.service';
import { Municipality } from '@/modules/geographic/schemas/municipality.schema';
import { ProvinceService } from '@/modules/geographic/services/province.service';
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

describe('MunicipalityService (unit)', () => {
  let svc: MunicipalityService;
  const model = mkModelCtor();
  const provSvc = { findOne: jest.fn(), findByDepartment: jest.fn() };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        MunicipalityService,
        { provide: getModelToken(Municipality.name), useValue: model },
        { provide: ProvinceService, useValue: provSvc },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(MunicipalityService);
  });

  it('MUN-SVC-001 create: verifica provincia y dup -> 409', async () => {
    provSvc.findOne.mockResolvedValue({ _id: oid() });
    await expect(svc.create({ name: 'A', provinceId: oid() as any } as any)).resolves.toBeTruthy();
    (model as any).mockImplementationOnce(() => ({
      save: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
    }));
    await expect(svc.create({ name: 'A', provinceId: oid() as any } as any))
      .rejects.toThrow(ConflictException);
  });

  it('MUN-SVC-002 findAll: con departmentId usa ProvinceService.findByDepartment', async () => {
    provSvc.findByDepartment.mockResolvedValue([{ _id: oid() }]);
    model.find.mockReturnValue(chain([{ name: 'B' }]));
    model.countDocuments.mockReturnValue(chain(1));
    const r = await svc.findAll({ page: 1, limit: 5, departmentId: oid() } as any);
    expect(r.pagination.total).toBe(1);
    expect(provSvc.findByDepartment).toHaveBeenCalled();
  });

  it('MUN-SVC-003 findOne: 404', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne('x')).rejects.toThrow(NotFoundException);
  });

  it('MUN-SVC-004 update: dup → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(svc.update('id', { name: 'C' })).rejects.toThrow(ConflictException);
  });

  it('MUN-SVC-005 remove: 404', async () => {
    model.findByIdAndDelete.mockReturnValue(chain(null));
    await expect(svc.remove('id')).rejects.toThrow(NotFoundException);
  });

  it('MUN-SVC-006 ensureByName: maneja carrera', async () => {
    model.findOne.mockReturnValueOnce(chain(null));
    model.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    model.findOne.mockReturnValueOnce(chain({ _id: 'M1', name: 'Cercado' }));
    const out = await svc.ensureByName(oid(), '  Cercado  ');
    expect(out.name).toBe('Cercado');
  });

  it('MUN-SVC-007 bulkEnsureByProvince: bulk + mapa', async () => {
    model.bulkWrite.mockResolvedValue({ ok: 1 });
    model.find.mockReturnValue(chain([{ name: 'X' }, { name: 'Y' }]));
    const map = await svc.bulkEnsureByProvince(oid(), ['X', 'Y', 'X']);
    expect(map.get('X')).toBeDefined();
    expect(map.get('Y')).toBeDefined();
  });

  it('MUN-SVC-008 mapByNames: retorna mapa simple', async () => {
    model.find.mockReturnValue(chain([{ name: 'Tarija' }]));
    const map = await svc.mapByNames(oid(), ['Tarija']);
    expect(map.get('Tarija')).toBeDefined();
  });
});
