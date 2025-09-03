import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import { UpdateVotePlaceDto, VotePlaceResponseDto } from '../dto/update-vote-place.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    @InjectModel(ElectoralLocation.name)
    private electoralLocationModel: Model<ElectoralLocation>,
  ) {}

  async findByDni(dni: string): Promise<UserDocument> {
    const user = await this.userModel.findOne({ dni }).exec();
    if (!user) {
      throw new NotFoundException(`Usuario con DNI ${dni} no encontrado`);
    }
    return user;
  }

  async findOrCreateByDni(dni: string): Promise<UserDocument> {
    try {
      const user = await this.userModel
        .findOneAndUpdate(
          { dni },
          { $setOnInsert: { dni, active: true } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .orFail()
        .exec();

      return user as UserDocument;
    } catch (e: any) {
      if (e?.code === 11000) {
        return this.userModel.findOne({ dni }).orFail().exec();
      }
      throw e;
    }
  }

  async updateVotePlaceByDni(
    dni: string,
    dto: UpdateVotePlaceDto,
  ): Promise<VotePlaceResponseDto> {
    if (!dni) throw new BadRequestException('DNI requerido');

    const user = await this.findOrCreateByDni(dni);

    const update: Partial<UserDocument> = {};
    let locationId: Types.ObjectId | null | undefined = undefined;
    let tableId: Types.ObjectId | null | undefined = undefined;

    // 1) Resolver locationId si viene
    if (dto.locationId) {
      const locId = new Types.ObjectId(dto.locationId);
      const exists = await this.electoralLocationModel.exists({ _id: locId });
      if (!exists) throw new NotFoundException('Recinto no encontrado');
      locationId = locId;
    }

    // 2) Resolver tableId si viene tableId o tableCode
    if (dto.tableId || dto.tableCode) {
      const table = await (dto.tableId
        ? this.electoralTableModel.findById(dto.tableId).lean()
        : this.electoralTableModel
            .findOne({ tableCode: dto.tableCode })
            .lean());

      if (!table) throw new NotFoundException('Mesa no encontrada');

      // Si te interesa validar que coincida con locationId cuando ambos vienen:
      if (locationId) {
        // muchos esquemas guardan reference como "locationId"
        const tLoc: any =
          (table as any).locationId || (table as any).electoralLocationId;
        if (tLoc && !new Types.ObjectId(tLoc).equals(locationId)) {
          throw new BadRequestException(
            'La mesa seleccionada no pertenece al recinto indicado',
          );
        }
      }

      tableId = table._id as Types.ObjectId;

      // Si no vino locationId, intenta inferirlo de la mesa
      if (!locationId) {
        const inferredLoc: any =
          (table as any).locationId || (table as any).electoralLocationId;
        if (inferredLoc) locationId = new Types.ObjectId(inferredLoc);
      }
    }

    // Si viene locationId pero NO viene mesa, y el usuario tenía una mesa de otro recinto, la limpiamos
    if (typeof locationId !== 'undefined' && !tableId && user.votingTableId) {
      try {
        const prev = await this.electoralTableModel
          .findById(user.votingTableId)
          .lean();
        const prevLoc: any =
          prev &&
          ((prev as any).locationId || (prev as any).electoralLocationId);
        if (prevLoc && !new Types.ObjectId(prevLoc).equals(locationId)) {
          update.votingTableId = null;
        }
      } catch {}
    }

    if (typeof locationId !== 'undefined') update.votingLocationId = locationId;
    if (typeof tableId !== 'undefined') update.votingTableId = tableId;

    await this.userModel.updateOne({ _id: user._id }, { $set: update });

    // Responder con detalles poblados
    const fresh = await this.userModel
      .findById(user._id)
      .populate('votingLocationId', 'name address code')
      .populate('votingTableId', 'tableCode tableNumber')
      .lean();

    return {
      userId: user._id.toString(),
      dni: user.dni,
      location: fresh?.votingLocationId
        ? {
            _id: (fresh.votingLocationId as any)._id.toString(),
            name: (fresh.votingLocationId as any).name,
            address: (fresh.votingLocationId as any).address,
            code: (fresh.votingLocationId as any).code,
          }
        : null,
      table: fresh?.votingTableId
        ? {
            _id: (fresh.votingTableId as any)._id.toString(),
            tableCode: (fresh.votingTableId as any).tableCode,
            tableNumber: (fresh.votingTableId as any).tableNumber,
          }
        : null,
    };
  }

  async getVotePlaceByDni(dni: string): Promise<VotePlaceResponseDto> {
    if (!dni) throw new BadRequestException('DNI requerido');

    const user = await this.findOrCreateByDni(dni);
    const fresh = await this.userModel
      .findById(user._id)
      .populate('votingLocationId', 'name address code')
      .populate('votingTableId', 'tableCode tableNumber')
      .lean();

    return {
      userId: user._id.toString(),
      dni: user.dni,
      location: fresh?.votingLocationId
        ? {
            _id: (fresh.votingLocationId as any)._id.toString(),
            name: (fresh.votingLocationId as any).name,
            address: (fresh.votingLocationId as any).address,
            code: (fresh.votingLocationId as any).code,
          }
        : null,
      table: fresh?.votingTableId
        ? {
            _id: (fresh.votingTableId as any)._id.toString(),
            tableCode: (fresh.votingTableId as any).tableCode,
            tableNumber: (fresh.votingTableId as any).tableNumber,
          }
        : null,
    };
  }
}
