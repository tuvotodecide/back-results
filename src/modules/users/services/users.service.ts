import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { ElectoralTable } from '@/modules/geographic/schemas/electoral-table.schema';
import { ElectoralLocation } from '@/modules/geographic/schemas/electoral-location.schema';
import {
  UpdateVotePlaceDto,
  VotePlaceResponseDto,
} from '../dto/update-vote-place.dto';
import {
  AttestParticipationDto,
  AttestParticipationResponseDto,
} from '../dto/attest-participation.dto';

import { encodeFunctionData } from 'viem';
import participationAbi from '@/abi/participation.json';
import { availableNetworks } from '@/api/params';
import { executeOperation } from '@/api/account';
import { normalizeCarnet } from '@/modules/institutional-voting/utils/carnet-normalizer';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    @InjectModel(ElectoralLocation.name)
    private electoralLocationModel: Model<ElectoralLocation>,
    private readonly configService: ConfigService,
  ) {}

  async findByDni(dni: string): Promise<UserDocument> {
    const normalizedDni = this.normalizeDni(dni);
    const user = await this.userModel.findOne({ dni: normalizedDni }).exec();
    if (!user) {
      throw new NotFoundException(`Usuario con DNI ${normalizedDni} no encontrado`);
    }
    return user;
  }

  async findOrCreateByDni(dni: string): Promise<UserDocument> {
    const normalizedDni = this.normalizeDni(dni);
    try {
      const user = await this.userModel
        .findOneAndUpdate(
          { dni: normalizedDni },
          { $setOnInsert: { dni: normalizedDni, active: true } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .orFail()
        .exec();

      return user as UserDocument;
    } catch (e: any) {
      if (e?.code === 11000) {
        return this.userModel.findOne({ dni: normalizedDni }).orFail().exec();
      }
      throw e;
    }
  }

  private normalizeDni(dni: string): string {
    const normalized = normalizeCarnet(dni);
    if (normalized) {
      return normalized;
    }

    const fallback = String(dni ?? '').trim();
    if (!fallback) {
      throw new BadRequestException('DNI inválido');
    }

    return fallback;
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

    if (dto.locationId) {
      const locId = new Types.ObjectId(dto.locationId);
      const exists = await this.electoralLocationModel.exists({ _id: locId });
      if (!exists) throw new NotFoundException('Recinto no encontrado');
      locationId = locId;
    }

    if (dto.tableId || dto.tableCode) {
      const table = await (dto.tableId
        ? this.electoralTableModel.findById(dto.tableId).lean()
        : this.electoralTableModel
            .findOne({ tableCode: dto.tableCode })
            .lean());

      if (!table) throw new NotFoundException('Mesa no encontrada');

      if (locationId) {
        const tLoc: any =
          (table as any).locationId || (table as any).electoralLocationId;
        if (tLoc && !new Types.ObjectId(tLoc).equals(locationId)) {
          throw new BadRequestException(
            'La mesa seleccionada no pertenece al recinto indicado',
          );
        }
      }

      tableId = table._id as Types.ObjectId;

      if (!locationId) {
        const inferredLoc: any =
          (table as any).locationId || (table as any).electoralLocationId;
        if (inferredLoc) locationId = new Types.ObjectId(inferredLoc);
      }
    }

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

  async attestParticipationNft(
    dni: string,
    dto: AttestParticipationDto,
  ): Promise<AttestParticipationResponseDto> {
    if (!dni) throw new BadRequestException('DNI requerido');

    const user = await this.findOrCreateByDni(dni);

    const { txHash, chainId, contractAddress } =
      await this.executeParticipationOperation(dto.account, dto.imageUrl);

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $push: {
          participationCertificates: {
            imageUrl: dto.imageUrl,
            txHash,
            chainId,
            contractAddress,
            electionId: dto.electionId ?? null,
            createdAt: new Date(),
          },
        },
      },
    );

    return {
      userId: user._id.toString(),
      dni: user.dni,
      imageUrl: dto.imageUrl,
      txHash,
      chainId,
      contractAddress,
      electionId: dto.electionId ?? null,
      ipfsUri: dto.ipfsUri ?? null,
      actaImageUrl: dto.actaImageUrl ?? null,
    };
  }

  async listParticipationCertificatesByDni(dni: string) {
    if (!dni) throw new BadRequestException('DNI requerido');

    const user = await this.findOrCreateByDni(dni);

    return {
      userId: user._id.toString(),
      dni: user.dni,
      certificates: user.participationCertificates ?? [],
    };
  }

  private async executeParticipationOperation(
    accountAddress: string,
    imageUrl: string,
  ): Promise<{
    txHash: string;
    chainId: number;
    contractAddress: string;
  }> {
    const privateKey = this.configService.get<string>(
      'app.blockchain.participationPrivateKey',
    );
    const chainKey = this.configService.get<string>(
      'app.blockchain.operationChainKey',
    );

    if (!privateKey) {
      throw new InternalServerErrorException(
        'NFT_PARTICIPATION_PRIVATE_KEY no configurado',
      );
    }

    const network = (availableNetworks as any)[chainKey ?? ''];
    if (!network || !network.participationNft) {
      throw new InternalServerErrorException(
        `Red o participationNft no configurados para ${chainKey}`,
      );
    }

    const callData = {
      to: network.participationNft as `0x${string}`,
      value: BigInt(0),
      data: encodeFunctionData({
        abi: participationAbi as any,
        functionName: 'safeMint',
        args: [accountAddress as `0x${string}`, imageUrl],
      }),
    };

    const { receipt } = await executeOperation(
      privateKey,
      undefined,
      chainKey,
      callData,
    );

    return {
      txHash: receipt.transactionHash as string,
      chainId: network.chain.id,
      contractAddress: network.participationNft,
    };
  }
}
