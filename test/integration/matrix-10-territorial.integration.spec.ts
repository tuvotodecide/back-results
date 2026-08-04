import { Types } from 'mongoose';
import { ElectoralLocationService } from '@/modules/geographic/services/electoral-location.service';

describe('MX-10 | territorial integración focal', () => {
  const electoralSeatId = new Types.ObjectId();

  it('[MX-10][TER-LST-P1-005][INTEGRACION] recupera el recinto con jerarquía, coordenadas y circunscripción sin alterarlo', async () => {
    const location = {
      _id: new Types.ObjectId(),
      code: 'REC-1',
      name: 'Recinto Central',
      coordinates: { latitude: -16.5, longitude: -68.1 },
      circunscripcion: { number: 1, type: 'Uninominal', name: 'Circunscripción 1' },
      electoralSeatId: {
        name: 'Asiento',
        municipalityId: { name: 'Municipio', provinceId: { name: 'Provincia', departmentId: { name: 'La Paz' } } },
      },
    };
    const query = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([location]),
    };
    const locationModel = { find: jest.fn().mockReturnValue(query), countDocuments: jest.fn().mockResolvedValue(1) };
    const dependencies = [locationModel, {}, {}, {}, {}] as unknown as ConstructorParameters<typeof ElectoralLocationService>;
    const service = new ElectoralLocationService(...dependencies);

    const result = await service.findAll({ electoralSeatId: electoralSeatId.toString(), page: 1, limit: 10 });

    expect(result.data).toEqual([location]);
    expect(result.data[0].electoralSeatId).toMatchObject({
      municipalityId: { provinceId: { departmentId: { name: 'La Paz' } } },
    });
    expect(result.data[0].coordinates).toEqual({ latitude: -16.5, longitude: -68.1 });
    expect(result.data[0].circunscripcion).toEqual(expect.objectContaining({ number: 1, type: 'Uninominal' }));
  });

  it('[MX-10][TER-NEW-P0-005][INTEGRACION] persiste el recinto con su asiento y transforma sus coordenadas a GeoJSON', async () => {
    const stored = { toObject: jest.fn().mockReturnValue({ code: 'REC-1', electoralSeatId, geo: { type: 'Point', coordinates: [-68.1, -16.5] } }) };
    const locationModel = { create: jest.fn().mockResolvedValue(stored) };
    const dependencies = [locationModel, {}, {}, {}, {}] as unknown as ConstructorParameters<typeof ElectoralLocationService>;
    const service = new ElectoralLocationService(...dependencies);

    const result = await service.create({
      fid: '1', code: 'REC-1', name: 'Recinto', electoralSeatId,
      address: 'Dirección', district: 'Distrito', zone: 'Zona',
      circunscripcion: { number: 1, type: 'Uninominal', name: 'Circunscripción 1' },
      coordinates: { latitude: -16.5, longitude: -68.1 }, active: true,
    });

    expect(locationModel.create).toHaveBeenCalledWith(expect.objectContaining({ electoralSeatId, geo: { type: 'Point', coordinates: [-68.1, -16.5] } }));
    expect(result).toEqual(expect.objectContaining({ code: 'REC-1', electoralSeatId }));
  });
});
