import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { CreateHistoryDto } from '../dto/create-history.dto';
import { FindHistoryDto } from '../dto/find-history.dto';
import { History, HistoryDocument } from '../schemas/history.schema';

@Injectable()
export class HistoryService {
  constructor(
    @InjectModel(History.name) private historyModel: Model<HistoryDocument>,
    private readonly configService: ConfigService,
  ) {}

  async create(createHistoryDto: CreateHistoryDto) {
    const history = new this.historyModel({
      ...createHistoryDto,
      roledUserId: createHistoryDto.roledUserId
        ? new Types.ObjectId(createHistoryDto.roledUserId)
        : undefined,
      institutionId: createHistoryDto.institutionId
        ? new Types.ObjectId(createHistoryDto.institutionId)
        : undefined,
      electionId: createHistoryDto.electionId
        ? new Types.ObjectId(createHistoryDto.electionId)
        : undefined,
    });

    const saved = await history.save();

    return {
      success: true,
      data: saved,
    };
  }

  async findAll(query: FindHistoryDto) {
    const {
      page = 1,
      limit = 10,
      txHash,
      operationKey,
      operationName,
      type,
      roledUserId,
      institutionId,
      electionId,
      registerDateFrom,
      registerDateTo,
    } = query;

    const filters: Record<string, any> = {};

    if (txHash) filters.txHash = txHash;
    if (operationKey) filters.operationKey = operationKey;
    if (operationName) filters.operationName = operationName;
    if (type) filters.type = type;
    if (roledUserId) filters.roledUserId = new Types.ObjectId(roledUserId);
    if (institutionId) filters.institutionId = new Types.ObjectId(institutionId);
    if (electionId) filters.electionId = new Types.ObjectId(electionId);

    if (registerDateFrom || registerDateTo) {
      filters.registerDate = {};
      if (registerDateFrom) filters.registerDate.$gte = new Date(registerDateFrom);
      if (registerDateTo) filters.registerDate.$lte = new Date(registerDateTo);
    }

    const skip = (page - 1) * limit;

    const [items, totalitems] = await Promise.all([
      this.historyModel
        .find(filters)
        .sort({ registerDate: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.historyModel.countDocuments(filters),
    ]);

    return {
      success: true,
      data: {
        totalitems,
        limit,
        page,
        totalPages: Math.ceil(totalitems / limit),
        items,
      },
    };
  }

  async findOne(id: string) {
    const history = await this.historyModel.findById(id).exec();

    if (!history) {
      throw new NotFoundException(`History con ID ${id} no encontrado`);
    }

    return {
      success: true,
      data: history,
    };
  }

  getContracts() {
    return {
      success: true,
      data: this.configService.get('app.contracts'),
    };
  }
}
