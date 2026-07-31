import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DepartmentService } from '@/modules/geographic/services/department.service';
import { ProvinceService } from '@/modules/geographic/services/province.service';
import { MunicipalityService } from '@/modules/geographic/services/municipality.service';

const chainResolved = <T>(value: T) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

const logger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const buildConstructableModel = () => {
  const save = jest.fn();
  const Model = jest.fn().mockImplementation((payload) => ({
    ...payload,
    save,
  }));
  return Object.assign(Model, {
    save,
    create: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    findOne: jest.fn(),
    bulkWrite: jest.fn(),
  });
};

describe('MX-10 | Administración territorial, contratos y delegados | Backend Results | Territorios', () => {
  it('[TER-LST-P1-001][TER-NEW-P0-001][TER-CON-P0-003][TER-ERR-P1-004] lista y protege departamentos contra duplicidad y recursos inexistentes', async () => {
    const departmentModel = buildConstructableModel();
    const service = new DepartmentService(departmentModel as never, logger as never);

    departmentModel.find.mockReturnValue(chainResolved([{ name: 'La Paz', active: true }]));
    departmentModel.countDocuments.mockResolvedValue(1);

    const listed = await service.findAll({ page: 1, limit: 10, search: 'La' });
    expect(listed.data).toEqual([expect.objectContaining({ name: 'La Paz' })]);
    expect(departmentModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.any(Object) }),
    );

    departmentModel.save.mockRejectedValueOnce({ code: 11000 });
    await expect(service.create({ name: 'La Paz', active: true })).rejects.toBeInstanceOf(
      ConflictException,
    );

    departmentModel.findById.mockReturnValueOnce(chainResolved(null));
    await expect(service.findOne('64e000000000000000000001')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('[TER-LST-P1-002][TER-LST-P1-003][TER-JER-P0-001][TER-NEW-P0-002][TER-NEW-P0-003] conserva jerarquía departamento-provincia-municipio', async () => {
    const provinceModel = buildConstructableModel();
    const departmentService = { findOne: jest.fn() };
    const provinceService = new ProvinceService(
      provinceModel as never,
      departmentService as never,
      logger as never,
    );
    const departmentId = new Types.ObjectId().toString();

    departmentService.findOne.mockResolvedValue({ _id: departmentId, name: 'La Paz' });
    provinceModel.save.mockResolvedValue({
      name: 'Murillo',
      departmentId: new Types.ObjectId(departmentId),
      active: true,
    });

    await provinceService.create({
      name: 'Murillo',
      departmentId: new Types.ObjectId(departmentId),
      active: true,
    });
    expect(departmentService.findOne).toHaveBeenCalledWith(
      new Types.ObjectId(departmentId),
    );
    expect(provinceModel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Murillo',
        departmentId: new Types.ObjectId(departmentId),
        active: true,
      }),
    );

    const municipalityModel = buildConstructableModel();
    const provinceLookup = { findOne: jest.fn() };
    const municipalityService = new MunicipalityService(
      municipalityModel as never,
      provinceLookup as never,
      logger as never,
    );
    const provinceId = new Types.ObjectId().toString();
    provinceLookup.findOne.mockResolvedValue({ _id: provinceId, departmentId });
    municipalityModel.save.mockResolvedValue({
      name: 'La Paz',
      provinceId: new Types.ObjectId(provinceId),
      active: true,
    });

    await municipalityService.create({
      name: 'La Paz',
      provinceId: new Types.ObjectId(provinceId),
      active: true,
    });
    expect(provinceLookup.findOne).toHaveBeenCalledWith(
      new Types.ObjectId(provinceId),
    );
    expect(municipalityModel).toHaveBeenCalledWith(
      expect.objectContaining({
        provinceId: new Types.ObjectId(provinceId),
      }),
    );
  });
});
