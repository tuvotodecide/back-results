/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ElectoralLocation,
  ElectoralLocationDocument,
} from '../schemas/electoral-location.schema';
import {
  CreateElectoralLocationDto,
  UpdateElectoralLocationDto,
} from '../dto/electoral-location.dto';
import { LocationQueryDto } from '../dto/query.dto';
import { ElectoralSeatService } from './electoral-seat.service';
import { LoggerService } from '../../../core/services/logger.service';
import {
  ElectoralTable,
  ElectoralTableDocument,
} from '../schemas/electoral-table.schema';
import { Ballot, BallotDocument } from '../../ballot/schemas/ballot.schema';

@Injectable()
export class ElectoralLocationService {
  constructor(
    @InjectModel(ElectoralLocation.name)
    private locationModel: Model<ElectoralLocationDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTableDocument>,
    @InjectModel(Ballot.name)
    private readonly ballotModel: Model<BallotDocument>,
    private electoralSeatService: ElectoralSeatService,
    private logger: LoggerService,
  ) {}

  async onModuleInit() {
    await this.locationModel.collection.createIndex({ geo: '2dsphere' });
  }

  async create(dto: CreateElectoralLocationDto) {
    const { coordinates, electoralSeatId } = dto;
    if (!coordinates) throw new BadRequestException('coordinates es requerido');

    const { longitude, latitude } = coordinates;
    const doc = await this.locationModel.create({
      ...dto,
      electoralSeatId: new Types.ObjectId(electoralSeatId),
      geo: { type: 'Point', coordinates: [longitude, latitude] }, // [lng, lat]
    });
    return doc.toObject();
  }

  async findAll(query: LocationQueryDto) {
    console.log('Ingresa FindAll');

    const {
      page = 1,
      limit = 10,
      sort,
      order,
      search,
      active,
      electoralSeatId,
      circunscripcionType,
    } = query;

    const skip = (page - 1) * limit;

    const filters: any = {};
    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }
    console.log({ search });
    if (active !== undefined) {
      filters.active = active === 'true';
    }
    if (electoralSeatId) {
      filters.electoralSeatId = new Types.ObjectId(electoralSeatId);
    }
    if (circunscripcionType) {
      filters['circunscripcion.type'] = circunscripcionType;
    }
    console.log({ filters });

    const [locations, total] = await Promise.all([
      this.locationModel
        .find(filters)
        .populate({
          path: 'electoralSeatId',
          populate: {
            path: 'municipalityId',
            populate: {
              path: 'provinceId',
              populate: {
                path: 'departmentId',
                select: 'name',
              },
              select: 'name departmentId',
            },
            select: 'name provinceId',
          },
          select: 'name municipalityId',
        })
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.locationModel.countDocuments(filters),
    ]);

    return {
      data: locations,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(
    id: string | Types.ObjectId,
  ): Promise<ElectoralLocationDocument> {
    const location = await this.locationModel
      .findById(id)
      .populate({
        path: 'electoralSeatId',
        populate: {
          path: 'municipalityId',
          populate: {
            path: 'provinceId',
            populate: {
              path: 'departmentId',
              select: 'name',
            },
            select: 'name departmentId',
          },
          select: 'name provinceId',
        },
        select: 'name municipalityId',
      })
      .exec();

    if (!location) {
      throw new NotFoundException(
        `Recinto electoral con ID ${id.toString()} no encontrado`,
      );
    }
    return location;
  }

  async findOneWithTables(id: string | Types.ObjectId) {
    const location = await this.findOne(id);
    const tables = await this.electoralTableModel
      .find({
        electoralLocationId: location.id,
        active: true,
      })
      .sort({ tableNumber: 1 })
      .exec();

    return {
      ...location.toObject(),
      tables,
      tablesCount: tables.length,
    };
  }

  async findByCode(code: string): Promise<ElectoralLocation> {
    const location = await this.locationModel
      .findOne({ code })
      .populate({
        path: 'electoralSeatId',
        populate: {
          path: 'municipalityId',
          populate: {
            path: 'provinceId',
            populate: {
              path: 'departmentId',
              select: 'name',
            },
            select: 'name departmentId',
          },
          select: 'name provinceId',
        },
        select: 'name municipalityId',
      })
      .exec();

    if (!location) {
      throw new NotFoundException(
        `Recinto electoral con código '${code}' no encontrado`,
      );
    }
    return location;
  }
  haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371000; // radio tierra en metros
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async findNearby(lat: number, lng: number, maxDistance = 1000) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat/lng inválidos');
    }

    // 1) Búsqueda geoespacial ([lng, lat]) → limit 10 para replicar el pipeline anterior
    const base = await this.locationModel
      .find({
        active: true,
        geo: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: maxDistance,
          },
        },
      })
      .select(
        // incluye TODO lo que el $project original dejaba pasar
        '_id fid code name address district zone coordinates circunscripcion active electoralSeatId geo',
      )
      .limit(10)
      .lean()
      .exec();

    // Si no hay resultados, responde en el mismo formato
    if (base.length === 0) {
      return {
        data: [],
        query: { latitude: lat, longitude: lng, maxDistance, unit: 'meters' },
        count: 0,
      };
    }

    const ids = base.map((d) => d._id as Types.ObjectId);

    // 2) Enriquecimiento jerárquico vía populate (seat → municipality → province → department)
    const populated = await this.locationModel.populate(base, {
      path: 'electoralSeatId',
      select: 'name municipalityId',
      populate: {
        path: 'municipalityId',
        select: 'name provinceId',
        populate: {
          path: 'provinceId',
          select: 'name departmentId',
          populate: {
            path: 'departmentId',
            select: 'name',
          },
        },
      },
    });

    // 3) Traer tables/ballots por lote (mismo orden/proyección que en tu pipeline)
    const tablesRaw = await this.electoralTableModel
      .find({ electoralLocationId: { $in: ids } })
      .select('_id tableNumber tableCode electoralLocationId')
      .sort({ tableNumber: 1 })
      .lean()
      .exec();

    const ballotsRaw = await this.ballotModel
      .find({ electoralLocationId: { $in: ids } })
      .select('_id tableNumber tableCode electoralLocationId')
      .sort({ tableNumber: 1 })
      .lean()
      .exec();

    // 4) Agrupar tablas/boletas por location
    const tablesByLoc = new Map<string, any[]>();
    for (const t of tablesRaw) {
      const k = String(t.electoralLocationId);
      const arr = tablesByLoc.get(k) ?? [];
      // proyecta como en el $project del pipeline
      arr.push({
        _id: t._id,
        tableNumber: t.tableNumber,
        tableCode: t.tableCode,
      });
      tablesByLoc.set(k, arr);
    }

    const ballotsByLoc = new Map<string, any[]>();
    for (const b of ballotsRaw) {
      const k = String(b.electoralLocationId);
      const arr = ballotsByLoc.get(k) ?? [];
      arr.push({
        _id: b._id,
        tableNumber: b.tableNumber,
        tableCode: b.tableCode,
      });
      ballotsByLoc.set(k, arr);
    }

    const data = populated.map((loc: any) => {
      const [locLng, locLat] = loc.geo?.coordinates ?? [undefined, undefined];
      const distance =
        Number.isFinite(locLat) && Number.isFinite(locLng)
          ? Math.round(this.haversineMeters(lat, lng, locLat, locLng))
          : undefined;

      const seat = loc.electoralSeatId || {};
      const mun = seat.municipalityId || {};
      const prov = mun.provinceId || {};
      const dept = prov.departmentId || {};

      const tables = tablesByLoc.get(String(loc._id)) ?? [];
      const ballots = ballotsByLoc.get(String(loc._id)) ?? [];

      return {
        _id: loc._id,
        fid: loc.fid,
        code: loc.code,
        name: loc.name,
        address: loc.address,
        district: loc.district,
        zone: loc.zone,
        coordinates: loc.coordinates,
        circunscripcion: loc.circunscripcion,
        active: loc.active,
        distance, // metros
        electoralSeat: {
          _id: seat._id,
          name: seat.name,
          municipality: {
            _id: mun._id,
            name: mun.name,
            province: {
              _id: prov._id,
              name: prov.name,
              department: {
                _id: dept._id,
                name: dept.name,
              },
            },
          },
        },
        tables,
        ballots,
        tableCount: tables.length,
      };
    });

    return {
      data,
      query: { latitude: lat, longitude: lng, maxDistance, unit: 'meters' },
      count: data.length,
    };
  }

  async findByCircunscripcion(
    type: string,
    number?: number,
  ): Promise<ElectoralLocation[]> {
    const filters: any = { 'circunscripcion.type': type, active: true };
    if (number) {
      filters['circunscripcion.number'] = number;
    }

    return this.locationModel
      .find(filters)
      .populate('electoralSeatId', 'name')
      .sort({ 'circunscripcion.number': 1, name: 1 })
      .exec();
  }

  async findByElectoralSeat(
    electoralSeatId: string | Types.ObjectId,
  ): Promise<ElectoralLocation[]> {
    const response = await this.electoralSeatService.findOne(electoralSeatId);

    return this.locationModel
      .find({
        electoralSeatId: response._id,
        active: true,
      })
      .sort({ name: 1 })
      .exec();
  }

  async update(id: string, dto: UpdateElectoralLocationDto) {
    const updateDoc: any = { ...dto };

    if (dto.coordinates) {
      const { longitude, latitude } = dto.coordinates;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        throw new BadRequestException(
          'coordinates.longitude/latitude inválidos',
        );
      }
      updateDoc.geo = { type: 'Point', coordinates: [longitude, latitude] };
    }

    const updated = await this.locationModel
      .findByIdAndUpdate(
        id,
        { $set: updateDoc },
        {
          new: true,
          runValidators: true,
          context: 'query',
          validateModifiedOnly: true,
          setDefaultsOnInsert: false,
        },
      )
      .exec();

    if (!updated) throw new NotFoundException('Recinto no encontrado');
    return updated.toObject();
  }

  async remove(id: string | Types.ObjectId): Promise<void> {
    const result = await this.locationModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(
        `Recinto electoral con ID ${id.toString()} no encontrado`,
      );
    }

    this.logger.log(
      `Recinto electoral eliminado: ${result.name}`,
      'ElectoralLocationService',
    );
  }

  async getStatistics() {
    const stats = await this.locationModel.aggregate([
      { $match: { active: true } },
      {
        $group: {
          _id: '$circunscripcion.type',
          count: { $sum: 1 },
          districts: { $addToSet: '$district' },
          zones: { $addToSet: '$zone' },
        },
      },
      {
        $project: {
          type: '$_id',
          count: 1,
          distinctDistricts: { $size: '$districts' },
          distinctZones: { $size: '$zones' },
          _id: 0,
        },
      },
    ]);

    const total = await this.locationModel.countDocuments({ active: true });

    return {
      total,
      byType: stats,
      timestamp: new Date().toISOString(),
    };
  }

  async findOneWithHierarchy(id: string): Promise<any> {
    const result = await this.locationModel
      .aggregate([
        { $match: { _id: new Types.ObjectId(id) } },
        {
          $lookup: {
            from: 'electoral_seats',
            localField: 'electoralSeatId',
            foreignField: '_id',
            as: 'electoralSeat',
          },
        },
        { $unwind: '$electoralSeat' },
        {
          $lookup: {
            from: 'municipalities',
            localField: 'electoralSeat.municipalityId',
            foreignField: '_id',
            as: 'municipality',
          },
        },
        { $unwind: '$municipality' },
        {
          $lookup: {
            from: 'provinces',
            localField: 'municipality.provinceId',
            foreignField: '_id',
            as: 'province',
          },
        },
        { $unwind: '$province' },
        {
          $lookup: {
            from: 'departments',
            localField: 'province.departmentId',
            foreignField: '_id',
            as: 'department',
          },
        },
        { $unwind: '$department' },
      ])
      .exec();

    if (!result || result.length === 0) {
      throw new NotFoundException('Recinto electoral no encontrado');
    }

    return result[0];
  }

  async findNearestLocation(
    latitude: number,
    longitude: number,
    maxDistance: number = 5000,
  ): Promise<any> {
    const result = await this.locationModel
      .aggregate([
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [latitude, longitude], // MongoDB usa [lng, lat]
            },
            distanceField: 'distance',
            maxDistance: maxDistance,
            spherical: true,
            query: { active: true },
          },
        },
        { $limit: 1 },
      ])
      .exec();

    if (!result || result.length === 0) {
      return null;
    }

    return result[0];
  }
}
