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
  ElectoralSeat,
  ElectoralSeatDocument,
} from '../schemas/electoral-seat.schema';
import {
  CreateElectoralSeatDto,
  UpdateElectoralSeatDto,
} from '../dto/electoral-seat.dto';
import { GeographicQueryDto } from '../dto/query.dto';
import { MunicipalityService } from './municipality.service';
import { LoggerService } from '../../../core/services/logger.service';

@Injectable()
export class ElectoralSeatService {
  constructor(
    @InjectModel(ElectoralSeat.name)
    private electoralSeatModel: Model<ElectoralSeatDocument>,
    private municipalityService: MunicipalityService,
    private logger: LoggerService,
  ) {}

  async create(createDto: CreateElectoralSeatDto): Promise<ElectoralSeat> {
    await this.municipalityService.findOne(createDto.municipalityId);

    try {
      const electoralSeat = new this.electoralSeatModel({
        ...createDto,
        municipalityId: new Types.ObjectId(createDto.municipalityId),
      });
      const saved = await electoralSeat.save();

      this.logger.log(
        `Asiento electoral creado: ${saved.name}`,
        'ElectoralSeatService',
      );
      return saved;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El asiento electoral con ID de localización '${createDto.idLoc}' ya existe en este municipio`,
        );
      }
      throw error;
    }
  }

  async findAll(
    query: GeographicQueryDto & {
      municipalityId?: string;
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
      municipalityId,
      provinceId,
      departmentId,
    } = query;
    const skip = (page - 1) * limit;

    const filters: any = {};
    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { idLoc: { $regex: search, $options: 'i' } },
      ];
    }
    if (active !== undefined) {
      filters.active = active === 'true';
    }
    if (municipalityId) {
      filters.municipalityId = municipalityId;
    }

    // Si se filtra por provincia o departamento, encontrar los municipios correspondientes
    if ((provinceId || departmentId) && !municipalityId) {
      let municipalities: any[] = [];
      if (departmentId) {
        municipalities =
          await this.municipalityService.findByDepartment(departmentId);
      } else if (provinceId) {
        municipalities =
          await this.municipalityService.findByProvince(provinceId);
      }
      const municipalityIds = municipalities.map((m: any) => m._id);
      filters.municipalityId = { $in: municipalityIds };
    }

    const [electoralSeats, total] = await Promise.all([
      this.electoralSeatModel
        .find(filters)
        .populate({
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
        })
        .sort({ [String(sort)]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.electoralSeatModel.countDocuments(filters),
    ]);

    return {
      data: electoralSeats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string | Types.ObjectId): Promise<ElectoralSeatDocument> {
    const electoralSeat = await this.electoralSeatModel
      .findById(id)
      .populate({
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
      })
      .exec();

    if (!electoralSeat) {
      throw new NotFoundException(
        `Asiento electoral con ID ${id.toString()} no encontrado`,
      );
    }
    return electoralSeat;
  }

  async findByIdLoc(idLoc: string): Promise<ElectoralSeat> {
    const electoralSeat = await this.electoralSeatModel
      .findOne({ idLoc })
      .populate({
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
      })
      .exec();

    if (!electoralSeat) {
      throw new NotFoundException(
        `Asiento electoral con ID de localización '${idLoc}' no encontrado`,
      );
    }
    return electoralSeat;
  }

  async findByMunicipality(
    municipalityId: string | Types.ObjectId,
  ): Promise<ElectoralSeat[]> {
    const response = await this.municipalityService.findOne(municipalityId);

    return this.electoralSeatModel
      .find({ municipalityId: response._id, active: true })
      .sort({ name: 1 })
      .exec();
  }

  async findByProvince(
    provinceId: string | Types.ObjectId,
  ): Promise<ElectoralSeat[]> {
    const municipalities =
      await this.municipalityService.findByProvince(provinceId);
    const municipalityIds = municipalities.map((m: any) => m._id);

    return this.electoralSeatModel
      .find({ municipalityId: { $in: municipalityIds }, active: true })
      .populate('municipalityId', 'name')
      .sort({ name: 1 })
      .exec();
  }

  async findByDepartment(
    departmentId: Types.ObjectId,
  ): Promise<ElectoralSeat[]> {
    const municipalities =
      await this.municipalityService.findByDepartment(departmentId);
    const municipalityIds = municipalities.map((m: any) => m._id);

    return this.electoralSeatModel
      .find({ municipalityId: { $in: municipalityIds }, active: true })
      .populate({
        path: 'municipalityId',
        populate: {
          path: 'provinceId',
          select: 'name',
        },
        select: 'name provinceId',
      })
      .sort({ name: 1 })
      .exec();
  }

  async update(
    id: string | Types.ObjectId,
    updateDto: UpdateElectoralSeatDto,
  ): Promise<ElectoralSeat> {
    if (updateDto.municipalityId) {
      await this.municipalityService.findOne(updateDto.municipalityId);
    }

    try {
      const electoralSeat = await this.electoralSeatModel
        .findByIdAndUpdate(id, updateDto, { new: true })
        .populate({
          path: 'municipalityId',
          populate: {
            path: 'provinceId',
            select: 'name',
          },
          select: 'name provinceId',
        })
        .exec();

      if (!electoralSeat) {
        throw new NotFoundException(
          `Asiento electoral con ID ${id.toString()} no encontrado`,
        );
      }

      this.logger.log(
        `Asiento electoral actualizado: ${electoralSeat.name}`,
        'ElectoralSeatService',
      );
      return electoralSeat;
    } catch (error) {
      if (error.code === 11000) {
        throw new ConflictException(
          `El asiento electoral con ID de localización '${updateDto.idLoc}' ya existe en este municipio`,
        );
      }
      throw error;
    }
  }

  async remove(id: string | Types.ObjectId): Promise<void> {
    const result = await this.electoralSeatModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(
        `Asiento electoral con ID ${id.toString()} no encontrado`,
      );
    }

    this.logger.log(
      `Asiento electoral eliminado: ${result.name}`,
      'ElectoralSeatService',
    );
  }

  async activate(id: string): Promise<ElectoralSeat> {
    return this.update(id, { active: true });
  }

  async deactivate(id: string): Promise<ElectoralSeat> {
    return this.update(id, { active: false });
  }

  async getStatistics() {
    const stats = await this.electoralSeatModel.aggregate([
      { $match: { active: true } },
      {
        $lookup: {
          from: 'municipalities',
          localField: 'municipalityId',
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
      {
        $group: {
          _id: {
            department: '$department.name',
            municipality: '$municipality.name',
          },
          count: { $sum: 1 },
          electoralSeats: { $push: '$name' },
        },
      },
      {
        $group: {
          _id: '$_id.department',
          municipalities: {
            $push: {
              name: '$_id.municipality',
              count: '$count',
            },
          },
          totalCount: { $sum: '$count' },
        },
      },
      {
        $project: {
          department: '$_id',
          municipalities: 1,
          totalCount: 1,
          _id: 0,
        },
      },
      { $sort: { totalCount: -1 } },
    ]);

    const total = await this.electoralSeatModel.countDocuments({
      active: true,
    });

    return {
      total,
      byDepartment: stats,
      timestamp: new Date().toISOString(),
    };
  }

  private normalizeName(s: string): string {
    return (s ?? '').trim().replace(/\s+/g, ' ');
  }

  private isDupKey(err: any): boolean {
    return (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      !!err && (err.code === 11000 || (err?.message ?? '').includes('E11000'))
    );
  }

  async ensureByName(
    municipalityId: Types.ObjectId,
    name: string,
  ): Promise<ElectoralSeatDocument> {
    const n = this.normalizeName(name);
    if (!municipalityId) throw new Error('municipalityId is required');
    if (!n) throw new Error('Electoral seat name is required');

    const found = await this.electoralSeatModel
      .findOne({ municipalityId, name: n })
      .exec();
    if (found) return found;

    try {
      return await this.electoralSeatModel.create({
        municipalityId,
        name: n,
        active: true,
      });
    } catch (e) {
      if (this.isDupKey(e)) {
        const again = await this.electoralSeatModel
          .findOne({ municipalityId, name: n })
          .exec();
        if (again) return again;
      }
      this.logger.error(`ensureByName error: ${e?.message ?? e}`);
      throw e;
    }
  }

  /**
   * Upsert masivo por municipio. Retorna Map name->doc.
   */
  async bulkEnsureByMunicipality(
    municipalityId: Types.ObjectId,
    names: string[],
  ): Promise<Map<string, ElectoralSeatDocument>> {
    if (!municipalityId) throw new Error('municipalityId is required');
    if (!names?.length) return new Map();

    const normalizedUnique = [
      ...new Set(names.map((s) => this.normalizeName(s)).filter(Boolean)),
    ];
    if (!normalizedUnique.length) return new Map();

    const ops = normalizedUnique.map((name) => ({
      updateOne: {
        filter: { municipalityId, name },
        update: { $setOnInsert: { municipalityId, name, active: true } },
        upsert: true,
      },
    }));

    if (ops.length) {
      try {
        await this.electoralSeatModel.bulkWrite(ops, { ordered: false });
      } catch (e) {
        if (!this.isDupKey(e))
          this.logger.warn(`bulkEnsureByMunicipality: ${e?.message ?? e}`);
      }
    }

    const docs = await this.electoralSeatModel
      .find({ municipalityId, name: { $in: normalizedUnique } })
      .exec();

    const map = new Map<string, ElectoralSeatDocument>();
    for (const d of docs) map.set(d.name, d);
    return map;
  }

  /**
   * Lookup masivo (sin creación). Retorna Map name->doc.
   */
  async mapByNames(
    municipalityId: Types.ObjectId,
    names: string[],
  ): Promise<Map<string, ElectoralSeatDocument>> {
    if (!municipalityId || !names?.length) return new Map();

    const normalizedUnique = [
      ...new Set(names.map((s) => this.normalizeName(s)).filter(Boolean)),
    ];
    if (!normalizedUnique.length) return new Map();

    const docs = await this.electoralSeatModel
      .find({ municipalityId, name: { $in: normalizedUnique } })
      .exec();

    const map = new Map<string, ElectoralSeatDocument>();
    for (const d of docs) map.set(d.name, d);
    return map;
  }
}
