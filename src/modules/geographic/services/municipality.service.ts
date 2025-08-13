/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Municipality,
  MunicipalityDocument,
} from '../schemas/municipality.schema';
import {
  CreateMunicipalityDto,
  UpdateMunicipalityDto,
} from '../dto/municipality.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { ProvinceService } from './province.service';
import { LoggerService } from '../../../core/services/logger.service';

@Injectable()
export class MunicipalityService {
  constructor(
    @InjectModel(Municipality.name)
    private municipalityModel: Model<MunicipalityDocument>,
    private provinceService: ProvinceService,
    private logger: LoggerService,
  ) {}

  async create(createDto: CreateMunicipalityDto): Promise<Municipality> {
    // Verificar que la provincia existe
    await this.provinceService.findOne(createDto.provinceId);

    try {
      // const municipality = new this.municipalityModel(createDto);
      const municipality = new this.municipalityModel({
        ...createDto,
        provinceId: new Types.ObjectId(createDto.provinceId),
      });

      const saved = await municipality.save();

      this.logger.log(`Municipio creado: ${saved.name}`, 'MunicipalityService');
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El municipio '${createDto.name}' ya existe en esta provincia`,
        );
      }
      throw error;
    }
  }

  async findAll(
    query: GeographicQueryDto & {
      provinceId?: string;
      departmentId?: Types.ObjectId;
    },
  ) {
    const {
      page = 1,
      limit = 10,
      sort,
      order,
      search,
      active,
      provinceId,
      departmentId,
    } = query;
    const skip = (page - 1) * limit;

    const filters: any = {};
    if (search) {
      filters.name = { $regex: search, $options: 'i' };
    }
    if (active !== undefined) {
      filters.active = active === 'true';
    }
    if (provinceId) {
      filters.provinceId = new Types.ObjectId(provinceId);
    }

    // Si se filtra por departamento, primero encontrar las provincias de ese departamento
    if (departmentId && !provinceId) {
      const provinces =
        await this.provinceService.findByDepartment(departmentId);
      const provinceIds = provinces.map(
        (p: any) => p._id?.toString?.() ?? p.id,
      );
      filters.provinceId = { $in: provinceIds };
    }

    const [municipalities, total] = await Promise.all([
      this.municipalityModel
        .find(filters)
        .populate({
          path: 'provinceId',
          populate: {
            path: 'departmentId',
            select: 'name',
          },
          select: 'name departmentId',
        })
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.municipalityModel.countDocuments(filters),
    ]);

    return {
      data: municipalities,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string | Types.ObjectId): Promise<MunicipalityDocument> {
    const municipality = await this.municipalityModel
      .findById(id)
      .populate({
        path: 'provinceId',
        populate: {
          path: 'departmentId',
          select: 'name',
        },
        select: 'name departmentId',
      })
      .exec();

    if (!municipality) {
      throw new NotFoundException(
        `Municipio con ID ${id.toString()} no encontrado`,
      );
    }
    return municipality;
  }

  async findByProvince(
    provinceId: string | Types.ObjectId,
  ): Promise<Municipality[]> {
    const response = await this.provinceService.findOne(provinceId);

    return this.municipalityModel
      .find({ provinceId: response._id, active: true })
      .sort({ name: 1 })
      .exec();
  }

  async findByDepartment(
    departmentId: Types.ObjectId,
  ): Promise<Municipality[]> {
    const provinces = await this.provinceService.findByDepartment(departmentId);
    const provinceIds = provinces.map((p: any) => p._id ?? p.id);

    return this.municipalityModel
      .find({ provinceId: { $in: provinceIds }, active: true })
      .populate('provinceId', 'name')
      .sort({ name: 1 })
      .exec();
  }

  async update(
    id: string | Types.ObjectId,
    updateDto: UpdateMunicipalityDto,
  ): Promise<Municipality> {
    if (updateDto.provinceId) {
      await this.provinceService.findOne(updateDto.provinceId);
    }

    try {
      const municipality = await this.municipalityModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate({
          path: 'provinceId',
          populate: {
            path: 'departmentId',
            select: 'name',
          },
          select: 'name departmentId',
        })
        .exec();

      if (!municipality) {
        throw new NotFoundException(
          `Municipio con ID ${id.toString()} no encontrado`,
        );
      }

      this.logger.log(
        `Municipio actualizado: ${municipality.name}`,
        'MunicipalityService',
      );
      return municipality;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El municipio '${updateDto.name}' ya existe en esta provincia`,
        );
      }
      throw error;
    }
  }

  async remove(id: string | Types.ObjectId): Promise<void> {
    const result = await this.municipalityModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(
        `Municipio con ID ${id.toString()} no encontrado`,
      );
    }

    this.logger.log(
      `Municipio eliminado: ${result.name}`,
      'MunicipalityService',
    );
  }

  async activate(id: string): Promise<Municipality> {
    return this.update(id, { active: true });
  }

  async deactivate(id: string): Promise<Municipality> {
    return this.update(id, { active: false });
  }

  async getStatistics() {
    const stats = await this.municipalityModel.aggregate([
      { $match: { active: true } },
      {
        $lookup: {
          from: 'provinces',
          localField: 'provinceId',
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
      {
        $group: {
          _id: '$department.name',
          count: { $sum: 1 },
          municipalities: { $push: '$name' },
        },
      },
      {
        $project: {
          department: '$_id',
          count: 1,
          _id: 0,
        },
      },
      { $sort: { count: -1 } },
    ]);

    const total = await this.municipalityModel.countDocuments({ active: true });

    return {
      total,
      byDepartment: stats,
      timestamp: new Date().toISOString(),
    };
  }
}
