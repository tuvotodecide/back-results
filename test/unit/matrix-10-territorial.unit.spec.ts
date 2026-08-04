import { validate } from 'class-validator';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CreateDepartmentDto } from '@/modules/geographic/dto/department.dto';
import { CreateProvinceDto } from '@/modules/geographic/dto/province.dto';
import { CreateMunicipalityDto } from '@/modules/geographic/dto/municipality.dto';
import { CreateElectoralSeatDto } from '@/modules/geographic/dto/electoral-seat.dto';
import {
  CircunscripcionDto,
  CoordinatesDto,
  CreateElectoralLocationDto,
} from '@/modules/geographic/dto/electoral-location.dto';
import { CreateElectoralTableDto } from '@/modules/geographic/dto/electoral-table.dto';
import { DepartmentService } from '@/modules/geographic/services/department.service';

const errorsFor = async (dto: object) => validate(dto);

describe('MX-10 | territorial unitario focal', () => {
  it('[MX-10][TER-JER-P0-001][UNITARIA] exige el padre inmediato al crear una provincia', async () => {
    const dto = new CreateProvinceDto();
    dto.name = 'Murillo';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('departmentId');
  });

  it('[MX-10][TER-NEW-P0-001][UNITARIA] rechaza un departamento sin nombre', async () => {
    const dto = new CreateDepartmentDto();
    dto.name = '';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('name');
  });

  it('[MX-10][TER-NEW-P0-002][UNITARIA] rechaza una provincia sin departamento', async () => {
    const dto = new CreateProvinceDto();
    dto.name = 'Murillo';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('departmentId');
  });

  it('[MX-10][TER-NEW-P0-003][UNITARIA] rechaza un municipio sin provincia', async () => {
    const dto = new CreateMunicipalityDto();
    dto.name = 'La Paz';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('provinceId');
  });

  it('[MX-10][TER-NEW-P0-004][UNITARIA] rechaza un asiento sin municipio e identificador de localidad', async () => {
    const dto = new CreateElectoralSeatDto();
    dto.name = 'Alto Ipaguazu';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['idLoc', 'municipalityId']),
    );
  });

  it('[MX-10][TER-NEW-P0-005][UNITARIA] rechaza un recinto sin asiento, coordenadas y circunscripción', async () => {
    const dto = new CreateElectoralLocationDto();
    dto.fid = '1';
    dto.code = 'REC-1';
    dto.name = 'Recinto';
    dto.address = 'Dirección';
    dto.district = 'Distrito';
    dto.zone = 'Zona';

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['electoralSeatId', 'circunscripcion', 'coordinates']),
    );
  });

  it('[MX-10][TER-NEW-P0-005][UNITARIA] acepta coordenadas y circunscripción anidadas válidas', async () => {
    const dto = new CreateElectoralLocationDto();
    dto.fid = '1';
    dto.code = 'REC-1';
    dto.name = 'Recinto';
    dto.electoralSeatId = new Types.ObjectId();
    dto.address = 'Dirección';
    dto.district = 'Distrito';
    dto.zone = 'Zona';
    dto.circunscripcion = Object.assign(new CircunscripcionDto(), {
      number: 1,
      type: 'Uninominal' as const,
      name: 'Circunscripción 1',
    });
    dto.coordinates = Object.assign(new CoordinatesDto(), {
      latitude: -16.5,
      longitude: -68.1,
    });

    await expect(errorsFor(dto)).resolves.toEqual([]);
  });

  it('[MX-10][TER-NEW-P0-005][UNITARIA] rechaza coordenadas fuera de los límites geográficos', async () => {
    const dto = new CreateElectoralLocationDto();
    dto.fid = '1';
    dto.code = 'REC-1';
    dto.name = 'Recinto';
    dto.electoralSeatId = new Types.ObjectId();
    dto.address = 'Dirección';
    dto.district = 'Distrito';
    dto.zone = 'Zona';
    dto.circunscripcion = Object.assign(new CircunscripcionDto(), {
      number: 1,
      type: 'Uninominal' as const,
      name: 'Circunscripción 1',
    });
    dto.coordinates = Object.assign(new CoordinatesDto(), {
      latitude: 91,
      longitude: -68.1,
    });

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('coordinates');
  });

  it('[MX-10][TER-NEW-P0-005][UNITARIA] rechaza una circunscripción presente pero vacía', async () => {
    const dto = new CreateElectoralLocationDto();
    dto.fid = '1';
    dto.code = 'REC-1';
    dto.name = 'Recinto';
    dto.electoralSeatId = new Types.ObjectId();
    dto.address = 'Dirección';
    dto.district = 'Distrito';
    dto.zone = 'Zona';
    dto.circunscripcion = new CircunscripcionDto();
    dto.coordinates = Object.assign(new CoordinatesDto(), {
      latitude: -16.5,
      longitude: -68.1,
    });

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toContain('circunscripcion');
  });

  it('[MX-10][TER-NEW-P0-006][UNITARIA] rechaza una mesa sin recinto, número y código', async () => {
    const dto = new CreateElectoralTableDto();

    const errors = await errorsFor(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['tableNumber', 'tableCode', 'electoralLocationId']),
    );
  });

  it('[MX-10][TER-DEL-P0-001][UNITARIA] elimina físicamente y reporta el identificador territorial inexistente', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const id = new Types.ObjectId();
    const departmentModel = {
      findByIdAndDelete: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: id, name: 'La Paz' }) }),
    };
    const dependencies = [departmentModel, logger] as unknown as ConstructorParameters<typeof DepartmentService>;
    const service = new DepartmentService(...dependencies);

    await expect(service.remove(id)).resolves.toBeUndefined();
    expect(departmentModel.findByIdAndDelete).toHaveBeenCalledWith(id);

    departmentModel.findByIdAndDelete.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.remove(id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
