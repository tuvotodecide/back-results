/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ElectoralTable,
  ElectoralTableDocument,
} from '../schemas/electoral-table.schema';
import {
  CreateElectoralTableDto,
  UpdateElectoralTableDto,
  ElectoralTableQueryDto,
} from '../dto/electoral-table.dto';
import { LoggerService } from '../../../core/services/logger.service';

@Injectable()
export class ElectoralTableService {
  constructor(
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTableDocument>,
    private logger: LoggerService,
  ) {}

  async create(createDto: CreateElectoralTableDto): Promise<ElectoralTable> {
    try {
      const table = new this.electoralTableModel(createDto);
      const saved = await table.save();

      this.logger.log(
        `Mesa electoral creada: ${saved.tableNumber} en recinto ${createDto.electoralLocationId}`,
        'ElectoralTableService',
      );
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        if (error.message.includes('tableCode')) {
          throw new ConflictException(
            `El código de mesa '${createDto.tableCode}' ya existe`,
          );
        }
        if (error.message.includes('electoralLocationId_1_tableNumber_1')) {
          throw new ConflictException(
            `Ya existe una mesa con número '${createDto.tableNumber}' en este recinto`,
          );
        }
      }
      throw error;
    }
  }

  async findAll(query: ElectoralTableQueryDto) {
    const {
      page = 1,
      limit = 10,
      sort = 'tableNumber',
      order = 'asc',
      search,
      active,
      electoralLocationId,
    } = query;
    const skip = (page - 1) * limit;

    const filters: any = {};
    if (search) {
      filters.$or = [
        { tableNumber: { $regex: search, $options: 'i' } },
        { tableCode: { $regex: search, $options: 'i' } },
      ];
    }
    if (active !== undefined) {
      filters.active = active === 'true';
    }
    if (electoralLocationId) {
      filters.electoralLocationId = electoralLocationId;
    }

    const [tables, total] = await Promise.all([
      this.electoralTableModel
        .find(filters)
        .populate('electoralLocationId', 'name code address')
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.electoralTableModel.countDocuments(filters),
    ]);

    return {
      data: tables,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string | Types.ObjectId): Promise<ElectoralTableDocument> {
    const table = await this.electoralTableModel
      .findById(id)
      .populate('electoralLocationId', 'name code address')
      .exec();

    if (!table) {
      throw new NotFoundException(`Mesa electoral con ID ${id} no encontrada`);
    }
    return table;
  }

  async findByElectoralLocation(
    electoralLocationId: string | Types.ObjectId,
  ): Promise<ElectoralTable[]> {
    return this.electoralTableModel
      .find({
        electoralLocationId,
        active: true,
      })
      .sort({ tableNumber: 1 })
      .exec();
  }

  async findByLocation(
    electoralLocationId: string | Types.ObjectId,
  ): Promise<ElectoralTable[]> {
    return this.findByElectoralLocation(electoralLocationId);
  }

  async findByTableCode(tableCode: string): Promise<ElectoralTable> {
    const table = await this.electoralTableModel
      .findOne({ tableCode })
      .populate({
        path: 'electoralLocationId',
        select: 'name code address',
      })
      .exec();

    if (!table) {
      throw new NotFoundException(
        `Mesa electoral con código '${tableCode}' no encontrada`,
      );
    }
    return table;
  }

  async update(
    id: string | Types.ObjectId,
    updateDto: UpdateElectoralTableDto,
  ): Promise<ElectoralTable> {
    try {
      const table = await this.electoralTableModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate('electoralLocationId', 'name code')
        .exec();

      if (!table) {
        throw new NotFoundException(
          `Mesa electoral con ID ${id} no encontrada`,
        );
      }

      this.logger.log(
        `Mesa electoral actualizada: ${table.tableNumber}`,
        'ElectoralTableService',
      );
      return table;
    } catch (error) {
      if (error.code === 11000) {
        if (error.message.includes('tableCode')) {
          throw new ConflictException(
            `El código de mesa '${updateDto.tableCode}' ya existe`,
          );
        }
        if (error.message.includes('electoralLocationId_1_tableNumber_1')) {
          throw new ConflictException(
            `Ya existe una mesa con número '${updateDto.tableNumber}' en este recinto`,
          );
        }
      }
      throw error;
    }
  }

  async remove(id: string | Types.ObjectId): Promise<void> {
    const result = await this.electoralTableModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`Mesa electoral con ID ${id} no encontrada`);
    }

    this.logger.log(
      `Mesa electoral eliminada: ${result.tableNumber}`,
      'ElectoralTableService',
    );
  }

  async activate(id: string | Types.ObjectId): Promise<ElectoralTable> {
    const table = await this.electoralTableModel
      .findByIdAndUpdate(id, { active: true }, { new: true })
      .exec();

    if (!table) {
      throw new NotFoundException(`Mesa electoral con ID ${id} no encontrada`);
    }

    this.logger.log(
      `Mesa electoral activada: ${table.tableNumber}`,
      'ElectoralTableService',
    );
    return table;
  }

  async deactivate(id: string | Types.ObjectId): Promise<ElectoralTable> {
    const table = await this.electoralTableModel
      .findByIdAndUpdate(id, { active: false }, { new: true })
      .exec();

    if (!table) {
      throw new NotFoundException(`Mesa electoral con ID ${id} no encontrada`);
    }

    this.logger.log(
      `Mesa electoral desactivada: ${table.tableNumber}`,
      'ElectoralTableService',
    );
    return table;
  }

  async getStatistics() {
    const stats = await this.electoralTableModel.aggregate([
      { $match: { active: true } },
      {
        $group: {
          _id: '$electoralLocationId',
          tableCount: { $sum: 1 },
          tableNumbers: { $push: '$tableNumber' },
        },
      },
      {
        $lookup: {
          from: 'electoral_locations',
          localField: '_id',
          foreignField: '_id',
          as: 'location',
        },
      },
      {
        $unwind: '$location',
      },
      {
        $project: {
          locationName: '$location.name',
          locationCode: '$location.code',
          tableCount: 1,
          tableNumbers: 1,
        },
      },
      {
        $sort: { tableCount: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    const [totalTables, activeTables] = await Promise.all([
      this.electoralTableModel.countDocuments(),
      this.electoralTableModel.countDocuments({ active: true }),
    ]);

    return {
      totalTables,
      activeTables,
      inactiveTables: totalTables - activeTables,
      topLocations: stats,
    };
  }
}
