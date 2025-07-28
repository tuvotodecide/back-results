/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Department, DepartmentDocument } from '../schemas/department.schema';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from '../dto/department.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { LoggerService } from '../../../core/services/logger.service';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectModel(Department.name)
    private departmentModel: Model<DepartmentDocument>,
    private logger: LoggerService,
  ) {}

  async create(createDto: CreateDepartmentDto): Promise<Department> {
    try {
      const department = new this.departmentModel(createDto);
      const saved = await department.save();

      this.logger.log(
        `Departamento creado: ${saved.name}`,
        'DepartmentService',
      );
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El departamento '${createDto.name}' ya existe`,
        );
      }
      throw error;
    }
  }

  async findAll(query: GeographicQueryDto) {
    const { page = 1, limit = 10, sort, order, search, active } = query;
    const skip = (page - 1) * limit;

    // Construir filtros
    const filters: any = {};
    if (search) {
      filters.name = { $regex: search, $options: 'i' };
    }
    if (active !== undefined) {
      filters.active = active === 'true';
    }

    // Ejecutar consulta
    const [departments, total] = await Promise.all([
      this.departmentModel
        .find(filters)
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.departmentModel.countDocuments(filters),
    ]);

    return {
      data: departments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<DepartmentDocument> {
    const department = await this.departmentModel.findById(id).exec();
    if (!department) {
      throw new NotFoundException(`Departamento con ID ${id} no encontrado`);
    }
    return department;
  }

  async findByName(name: string): Promise<Department> {
    const department = await this.departmentModel.findOne({ name }).exec();
    if (!department) {
      throw new NotFoundException(`Departamento '${name}' no encontrado`);
    }
    return department;
  }

  async update(
    id: string,
    updateDto: UpdateDepartmentDto,
  ): Promise<Department> {
    try {
      const department = await this.departmentModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .exec();

      if (!department) {
        throw new NotFoundException(`Departamento con ID ${id} no encontrado`);
      }

      this.logger.log(
        `Departamento actualizado: ${department.name}`,
        'DepartmentService',
      );
      return department;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El departamento '${updateDto.name}' ya existe`,
        );
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const result = await this.departmentModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Departamento con ID ${id} no encontrado`);
    }

    this.logger.log(
      `Departamento eliminado: ${result.name}`,
      'DepartmentService',
    );
  }

  async activate(id: string): Promise<Department> {
    return this.update(id, { active: true });
  }

  async deactivate(id: string): Promise<Department> {
    return this.update(id, { active: false });
  }
}
