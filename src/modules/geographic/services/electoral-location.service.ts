/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ConflictException,
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

  async create(
    createDto: CreateElectoralLocationDto,
  ): Promise<ElectoralLocation> {
    // Verificar que el asiento electoral existe
    await this.electoralSeatService.findOne(createDto.electoralSeatId);

    try {
      const location = new this.locationModel({
        ...createDto,
        electoralSeatId: new Types.ObjectId(createDto.electoralSeatId),
      });
      const saved = await location.save();

      this.logger.log(
        `Recinto electoral creado: ${saved.name}`,
        'ElectoralLocationService',
      );
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El código de recinto '${createDto.code}' ya existe`,
        );
      }
      throw error;
    }
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

  async findNearby(lat: number, lng: number, maxDistance = 1000) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat/lng inválidos');
    }

    const base = await this.locationModel
      .find({
        active: true,
        coordinates: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: maxDistance,
          },
        },
      })
      .select('code name address coordinates electoralSeatId')
      .limit(20)
      .lean()
      .exec();

    if (base.length === 0) return [];

    const ids = base.map((d) => d._id as Types.ObjectId);

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

    const tablesAgg = await this.electoralTableModel
      .aggregate([
        { $match: { electoralLocationId: { $in: ids } } },
        { $group: { _id: '$electoralLocationId', count: { $sum: 1 } } },
      ])
      .exec();

    const ballotsAgg = await this.ballotModel
      .aggregate([
        { $match: { electoralLocationId: { $in: ids } } },
        { $group: { _id: '$electoralLocationId', count: { $sum: 1 } } },
      ])
      .exec();

    const tableCount = new Map(tablesAgg.map((r) => [String(r._id), r.count]));
    const ballotCount = new Map(
      ballotsAgg.map((r) => [String(r._id), r.count]),
    );

    // 4) Ensamblar respuesta final
    return populated.map((loc) => ({
      ...loc,
      tablesCount: tableCount.get(String(loc._id)) ?? 0,
      ballotsCount: ballotCount.get(String(loc._id)) ?? 0,
    }));
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

  async update(
    id: string | Types.ObjectId,
    updateDto: UpdateElectoralLocationDto,
  ): Promise<ElectoralLocation> {
    if (updateDto.electoralSeatId) {
      await this.electoralSeatService.findOne(updateDto.electoralSeatId);
    }

    try {
      const location = await this.locationModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('electoralSeatId', 'name')
        .exec();

      if (!location) {
        throw new NotFoundException(
          `Recinto electoral con ID ${id.toString()} no encontrado`,
        );
      }

      this.logger.log(
        `Recinto electoral actualizado: ${location.name}`,
        'ElectoralLocationService',
      );
      return location;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El código de recinto '${updateDto.code}' ya existe`,
        );
      }
      throw error;
    }
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
