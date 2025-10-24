import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DepartmentService } from '@/modules/geographic/services/department.service';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { LoggerService } from '@/core/services/logger.service';
import { chain, rejectChain } from '../utils/chain';

describe('DepartmentService (unit)', () => {
  let svc: DepartmentService;

  const mkDeptModelCtor = () => {
    const fn: any = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn(), // lo seteamos por test cuando haga falta
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

  let model: any;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    model = mkDeptModelCtor();

    const mod = await Test.createTestingModule({
      providers: [
        DepartmentService,
        { provide: getModelToken(Department.name), useValue: model },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(DepartmentService);
  });
  it('DEP-SVC-001 create: dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });

    model.mockImplementationOnce((doc: any) => ({
      ...doc,
      save: jest.fn().mockRejectedValue(dup),
    }));

    await expect(svc.create({ name: 'Pando', active: true })).rejects.toThrow(
      ConflictException,
    );
  });

  it('DEP-SVC-002 findAll: aplica filtros y pagina', async () => {
    model.find.mockReturnValue(chain([{ name: 'La Paz' }]));
    model.countDocuments.mockReturnValue(chain(1));
    const out = await svc.findAll({
      page: 1,
      limit: 10,
      sort: 'name',
      order: 'asc',
      search: 'La',
      active: 'true',
    } as any);
    expect(out.pagination.total).toBe(1);
  });

  it('DEP-SVC-003 findOne: 404 si no existe', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne('id')).rejects.toThrow(NotFoundException);
  });

  it('DEP-SVC-004 update: dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(svc.update('id', { name: 'X' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('DEP-SVC-005 remove: 404 si no existe', async () => {
    model.findByIdAndDelete.mockReturnValue(chain(null));
    await expect(svc.remove('id')).rejects.toThrow(NotFoundException);
  });

  it('DEP-SVC-006 ensureByName: crea o re-lee si hay carrera', async () => {
    // 1) No existe inicialmente
    model.findOne.mockReturnValueOnce(chain(null));
    // 2) create corre pero hay carrera -> dup
    model.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    // 3) Re-lee y encuentra
    model.findOne.mockReturnValueOnce(chain({ _id: 'D1', name: 'Santa Cruz' }));

    const out = await svc.ensureByName(' Santa   Cruz ');
    expect(out.name).toBe('Santa Cruz');
  });

  it('DEP-SVC-007 bulkEnsure: hace bulk y retorna mapa', async () => {
    model.bulkWrite.mockResolvedValue({ ok: 1 });
    model.find.mockReturnValue(chain([{ name: 'Beni' }, { name: 'Pando' }]));
    const map = await svc.bulkEnsure(['Beni', 'Pando', 'Beni']);
    expect(map.get('Beni')).toBeDefined();
    expect(map.get('Pando')).toBeDefined();
  });
});
