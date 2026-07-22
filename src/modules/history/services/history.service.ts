import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { ClientSession, Model, Types } from 'mongoose';
import { CreateHistoryDto, HistoryOperationKey, HistoryOperationRelatedFn } from '../dto/create-history.dto';
import { FindHistoryDto } from '../dto/find-history.dto';
import { History, HistoryDocument } from '../schemas/history.schema';
import { ethers, formatEther, LogDescription } from 'ethers';
import { availableNetworks } from '@/api/params';

@Injectable()
export class HistoryService {
  private readonly provider: ethers.JsonRpcProvider;

  constructor(
    @InjectModel(History.name) private historyModel: Model<HistoryDocument>,
    private readonly configService: ConfigService,
  ) {
    const chain = this.configService.get<string>('app.blockchain.chain')!;
    const {bundler} = availableNetworks[chain];
    this.provider = new ethers.JsonRpcProvider(bundler);
  }

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

  async createWithSession(createHistoryDto: CreateHistoryDto, session: ClientSession) {
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

    const saved = await history.save({ session });

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

    const itemsWithAmounts = await this.getRelatedAmounts(items);

    return {
      success: true,
      data: {
        totalitems,
        limit,
        page,
        totalPages: Math.ceil(totalitems / limit),
        items: itemsWithAmounts,
      },
    };
  }

  async getRelatedAmounts(items: HistoryDocument[]) {
    const promises = items.map(async (item) => {
      const keys = Object.keys(HistoryOperationKey).filter(
        (key) => HistoryOperationKey[key] === item.operationName
      );
      const amountParam = await this.getAmountParamFromOp(keys[0], item.txHash);

      if (!amountParam) return item;
      return {
        _id: item._id,
        operationName: item.operationName,
        description: item.description,
        type: item.type,
        registerDate: item.registerDate,
        roledUserId: item.roledUserId,
        institutionId: item.institutionId,
        electionId: item.electionId,
        relatedAmount: amountParam
      }
    });

    return Promise.all(promises);
  }

  async getAmountParamFromOp(opKey: string, txHash: string) {
    const relatedFn = HistoryOperationRelatedFn[opKey];
    if(!relatedFn) {
      return null;
    }

    const iface = new ethers.Interface(relatedFn.fn);

    if(relatedFn.isEvent) {
      const receipt = await this.provider.getTransactionReceipt(txHash);
      if (!receipt) return null;

      for (const log of receipt.logs) {
        let parsed: LogDescription | null;
        try {
          parsed = iface.parseLog(log);
        } catch {
          continue; // log from a different contract/event, skip
        }

        if (!parsed) return null;
        return formatEther(parsed.args[relatedFn.amountParam]);
      }
    } else {
      const tx = await this.provider.getTransaction(txHash);
      if (!tx) return null;

      const decoded = iface.parseTransaction({ data: tx.data, value: tx.value });
      if (!decoded) return null;

      return formatEther(decoded.args[relatedFn.amountParam]);
    }
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
