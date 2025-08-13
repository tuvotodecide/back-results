/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Province, ProvinceDocument } from '../schemas/province.schema';
import { CreateProvinceDto, UpdateProvinceDto } from '../dto/province.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { DepartmentService } from './department.service';
import { LoggerService } from '../../../core/services/logger.service';

@Injectable()
export class ProvinceService {
  constructor(
    @InjectModel(Province.name) private provinceModel: Model<ProvinceDocument>,
    private departmentService: DepartmentService,
    private logger: LoggerService,
  ) {}

  async create(createDto: CreateProvinceDto): Promise<Province> {
    await this.departmentService.findOne(createDto.departmentId);

    try {
      const province = new this.provinceModel({
        ...createDto,
        departmentId: new Types.ObjectId(createDto.departmentId),
      });

      const saved = await province.save();

      this.logger.log(`Provincia creada: ${saved.name}`, 'ProvinceService');
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `La provincia '${createDto.name}' ya existe en este departamento`,
        );
      }
      throw error;
    }
  }

  async findAll(query: GeographicQueryDto & { departmentId?: Types.ObjectId }) {
    const {
      page = 1,
      limit = 10,
      sort,
      order,
      search,
      active,
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
    if (departmentId) {
      filters.departmentId = new Types.ObjectId(departmentId);
    }

    const [provinces, total] = await Promise.all([
      this.provinceModel
        .find(filters)
        .populate('departmentId', 'name')
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.provinceModel.countDocuments(filters),
    ]);

    return {
      data: provinces,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string | Types.ObjectId): Promise<ProvinceDocument> {
    const province = await this.provinceModel
      .findById(id)
      .populate('departmentId', 'name')
      .exec();

    if (!province) {
      throw new NotFoundException(
        `Provincia con ID ${id.toString()} no encontrada`,
      );
    }
    return province;
  }

  async findByDepartment(departmentId: Types.ObjectId): Promise<Province[]> {
    const response = await this.departmentService.findOne(departmentId);
    console.log({ response });

    return this.provinceModel
      .find({ departmentId: response._id, active: true })
      .sort({ name: 1 })
      .exec();
  }

  async update(
    id: string | Types.ObjectId,
    updateDto: UpdateProvinceDto,
  ): Promise<Province> {
    if (updateDto.departmentId) {
      await this.departmentService.findOne(updateDto.departmentId);
    }

    try {
      const province = await this.provinceModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('departmentId', 'name')
        .exec();

      if (!province) {
        throw new NotFoundException(
          `Provincia con ID ${id.toString()} no encontrada`,
        );
      }

      this.logger.log(
        `Provincia actualizada: ${province.name}`,
        'ProvinceService',
      );
      return province;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `La provincia '${updateDto.name}' ya existe en este departamento`,
        );
      }
      throw error;
    }
  }

  async remove(id: string | Types.ObjectId): Promise<void> {
    const result = await this.provinceModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(
        `Provincia con ID ${id.toString()} no encontrada`,
      );
    }

    this.logger.log(`Provincia eliminada: ${result.name}`, 'ProvinceService');
  }
}
