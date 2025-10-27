import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DepartmentService } from '@/modules/geographic/services/department.service';
import { Department } from '@/modules/geographic/schemas/department.schema';
import { LoggerService } from '@/core/services/logger.service';
import { chain, rejectChain } from '../utils/chain';

describe('DepartmentService', () => {
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
  it('crear dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });

    model.mockImplementationOnce((doc: any) => ({
      ...doc,
      save: jest.fn().mockRejectedValue(dup),
    }));

    await expect(svc.create({ name: 'Pando', active: true })).rejects.toThrow(
      ConflictException,
    );
  });

  it('findAll: aplica filtros', async () => {
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

  it('findOne: 404 si no existe', async () => {
    model.findById.mockReturnValue(chain(null));
    await expect(svc.findOne('id')).rejects.toThrow(NotFoundException);
  });

  it('update: dup 11000 → 409', async () => {
    const dup = Object.assign(new Error('dup'), { code: 11000 });
    model.findByIdAndUpdate.mockReturnValue(rejectChain(dup));
    await expect(svc.update('id', { name: 'X' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('remove: 404 si no existe', async () => {
    model.findByIdAndDelete.mockReturnValue(chain(null));
    await expect(svc.remove('id')).rejects.toThrow(NotFoundException);
  });

  it('ensureByName: crea o re-lee si hay carrera', async () => {
    model.findOne.mockReturnValueOnce(chain(null));

    model.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );

    model.findOne.mockReturnValueOnce(chain({ _id: 'D1', name: 'Santa Cruz' }));

    const out = await svc.ensureByName(' Santa   Cruz ');
    expect(out.name).toBe('Santa Cruz');
  });

  it('bulkEnsure: hace bulk y retorna mapa', async () => {
    model.bulkWrite.mockResolvedValue({ ok: 1 });
    model.find.mockReturnValue(chain([{ name: 'Beni' }, { name: 'Pando' }]));
    const map = await svc.bulkEnsure(['Beni', 'Pando', 'Beni']);
    expect(map.get('Beni')).toBeDefined();
    expect(map.get('Pando')).toBeDefined();
  });
});
