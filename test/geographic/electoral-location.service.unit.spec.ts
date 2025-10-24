import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { Ballot } from '@/modules/ballot/schemas/ballot.schema';
import { LoggerService } from '@/core/services/logger.service';
import { chain, rejectChain } from '../utils/chain';
import { ElectoralSeatService } from '@/modules/geographic/services/electoral-seat.service';

const oid = () => new Types.ObjectId();

describe('ElectoralLocationService (unit)', () => {
  let svc: ElectoralLocationService;

  const locCol = { createIndex: jest.fn().mockResolvedValue(true) };

  const locationModel: any = Object.assign(
    jest.fn(), // constructor no usado aquí
    {
      collection: locCol,
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      populate: jest.fn(),
      aggregate: jest.fn(),
    },
  );

  const tableModel = {
    find: jest.fn(),
  };

  const ballotModel = {
    find: jest.fn(),
  };
  const seatSvc = { findOne: jest.fn(), resolveByIdOrCode: jest.fn() };

  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        ElectoralLocationService,
        {
          provide: getModelToken(ElectoralLocation.name),
          useValue: locationModel,
        },
        { provide: getModelToken(ElectoralTable.name), useValue: tableModel },
        { provide: getModelToken(Ballot.name), useValue: ballotModel },
        { provide: ElectoralSeatService, useValue: seatSvc }, // ← ¡esto!
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();
    svc = mod.get(ElectoralLocationService);
  });

  it('LOC-SVC-001 onModuleInit crea índice 2dsphere', async () => {
    await svc.onModuleInit();
    expect(locCol.createIndex).toHaveBeenCalledWith({ geo: '2dsphere' });
  });

  it('LOC-SVC-002 create: arma geo point y guarda', async () => {
    const seatId = oid();
    (locationModel.create as jest.Mock).mockResolvedValue({
      toObject: () => ({ name: 'X', electoralSeatId: seatId }),
    });
    const out = await svc.create({
      fid: '1',
      code: 'C',
      name: 'X',
      electoralSeatId: seatId as any,
      address: 'A',
      district: 'D',
      zone: 'Z',
      circunscripcion: { number: 1, type: 'Especial', name: 'E' },
      coordinates: { latitude: -17.3, longitude: -66.1 },
      active: true,
    });
    expect(out.name).toBe('X');
    expect(locationModel.create).toHaveBeenCalled();
  });

  it('LOC-SVC-003 findOne: 404 si no existe', async () => {
    locationModel.findById.mockReturnValue(chain(null));
    await expect(svc.findOne(oid().toString())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('LOC-SVC-004 findByCode: 404 si no existe', async () => {
    locationModel.findOne.mockReturnValue(chain(null));
    await expect(svc.findByCode('NOPE')).rejects.toThrow(/no encontrado/i);
  });

  it('LOC-SVC-005 resolveByIdOrCode: elige rama correcta', async () => {
    const doc = { _id: oid(), name: 'L' };
    locationModel.findById.mockReturnValue(chain(doc));
    await expect(
      svc.resolveByIdOrCode({ locationId: doc._id.toString() }),
    ).resolves.toBe(doc as any);
  });

  it('LOC-SVC-006 update: coordinates inválidas → 400', async () => {
    locationModel.findByIdAndUpdate = jest
      .fn()
      .mockReturnValue(
        rejectChain(new BadRequestException('Coordenadas inválidas')),
      );
    await expect(
      svc.update(oid().toString(), {
        coordinates: { latitude: 999 as any, longitude: 0 } as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('LOC-SVC-007 findNearby: integra geosearch + populate + tables + ballots', async () => {
    const lat = -17.3,
      lng = -66.1;
    const L1 = { _id: oid(), geo: { coordinates: [lng, lat] }, name: 'R1' };
    // $near
    locationModel.find.mockReturnValue({
      select: () => ({
        limit: () => ({ lean: () => ({ exec: () => Promise.resolve([L1]) }) }),
      }),
    });

    // populate jerarquía
    (locationModel.populate as jest.Mock).mockResolvedValue([
      {
        ...L1,
        electoralSeatId: {
          _id: oid(),
          name: 'Seat',
          municipalityId: { provinceId: { departmentId: {} } },
        },
      },
    ]);

    // tables / ballots
    tableModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          electoralLocationId: L1._id,
          _id: oid(),
          tableNumber: 1,
          tableCode: 'T-1',
        },
      ]),
    });
    ballotModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(), 
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          electoralLocationId: L1._id,
          _id: oid(),
          tableNumber: 1,
          tableCode: 'T-1',
        },
        {
          electoralLocationId: L1._id,
          _id: oid(),
          tableNumber: 2,
          tableCode: 'T-2',
        },
      ]),
    });

    const out = await svc.findNearby(lat, lng, 1500);
    expect(out.count).toBe(1);
    expect(out.data[0].tables.length).toBe(1);
    expect(out.data[0].ballots.length).toBe(2);
    expect(typeof out.data[0].distance).toBe('number');
  });

  it('LOC-SVC-008 remove: 404 si no existe', async () => {
    locationModel.findByIdAndDelete = jest.fn().mockReturnValue(chain(null));
    await expect(svc.remove(oid())).rejects.toThrow(NotFoundException);
  });

  it('LOC-SVC-009 getStatistics: retorna totales/byType', async () => {
    locationModel.aggregate.mockResolvedValue([
      { type: 'Especial', count: 2, distinctDistricts: 1, distinctZones: 1 },
    ]);
    locationModel.countDocuments.mockResolvedValue(2);
    const out = await svc.getStatistics();
    expect(out.total).toBe(2);
    expect(out.byType[0].type).toBe('Especial');
  });
});
