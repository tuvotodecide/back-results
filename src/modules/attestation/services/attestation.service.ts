/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Attestation,
  AttestationDocument,
} from '../schemas/attestation.schema';
import { Ballot, BallotDocument } from '../../ballot/schemas/ballot.schema';
import {
  CreateAttestationBulkDto,
  CreateAttestationItemDto,
  BulkAttestationResponseDto,
  AttestationResponseDto,
} from '../dto/attestation.dto';

@Injectable()
export class AttestationService {
  constructor(
    @InjectModel(Attestation.name)
    private attestationModel: Model<AttestationDocument>,
    @InjectModel(Ballot.name)
    private ballotModel: Model<BallotDocument>,
  ) {}

  /**
   * Crear múltiples attestations de forma bulk
   */
  async createBulk(
    createDto: CreateAttestationBulkDto,
  ): Promise<BulkAttestationResponseDto> {
    const created: AttestationResponseDto[] = [];
    const errors: Array<{
      index: number;
      error: string;
      data: CreateAttestationItemDto;
    }> = [];

    for (let i = 0; i < createDto.attestations.length; i++) {
      const attestationData = createDto.attestations[i];

      try {
        // Validar que el ballot existe
        await this.validateBallotExists(attestationData.ballotId.toString());

        // Validar que el usuario no haya attestado este ballot antes (si idUser está presente)
        if (attestationData.idUser) {
          await this.validateUserNotAttested(
            attestationData.ballotId.toString(),
            attestationData.idUser,
          );
        }

        // Crear la attestation
        const attestation = new this.attestationModel({
          support: attestationData.support,
          ballotId: new Types.ObjectId(attestationData.ballotId),
          idUser: attestationData.idUser,
          typeUser: attestationData.typeUser,
        });

        const savedAttestation = await attestation.save();
        created.push(this.mapToResponseDto(savedAttestation));
      } catch (error) {
        errors.push({
          index: i,
          error: error.message,
          data: attestationData,
        });
      }
    }

    return {
      created,
      errors,
      summary: {
        total: createDto.attestations.length,
        successful: created.length,
        failed: errors.length,
      },
    };
  }

  /**
   * Obtener todas las attestations de un ballot específico
   */
  async findByBallot(ballotId: string): Promise<AttestationResponseDto[]> {
    if (!Types.ObjectId.isValid(ballotId)) {
      throw new BadRequestException('ID de ballot inválido');
    }

    const attestations = await this.attestationModel
      .find({ ballotId: new Types.ObjectId(ballotId) })
      .sort({ createdAt: -1 })
      .exec();

    return attestations.map((attestation) =>
      this.mapToResponseDto(attestation),
    );
  }

  /**
   * Obtener todas las attestations con paginación
   */
  async findAll(
    page = 1,
    limit = 10,
    ballotId?: string,
    typeUser?: string,
    support?: boolean,
  ): Promise<{
    data: AttestationResponseDto[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;
    const filter: any = {};

    if (ballotId && Types.ObjectId.isValid(ballotId)) {
      filter.ballotId = new Types.ObjectId(ballotId);
    }

    if (typeUser) {
      filter.typeUser = typeUser;
    }

    if (typeof support === 'boolean') {
      filter.support = support;
    }

    const [data, total] = await Promise.all([
      this.attestationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('ballotId', 'tableCode tableNumber location.department')
        .exec(),
      this.attestationModel.countDocuments(filter),
    ]);

    return {
      data: data.map((attestation) => this.mapToResponseDto(attestation)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Eliminar una attestation
   */
  async remove(id: string | Types.ObjectId): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID de attestation inválido');
    }

    const result = await this.attestationModel.deleteOne({
      _id: new Types.ObjectId(id),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException('Attestation no encontrada');
    }
  }

  /**
   * Obtener la version con más apoyo para un tableCode específico
   */
  async getMostSupportedVersion(tableCode: string): Promise<{
    ballotId: string;
    version: number;
    supportCount: number;
    totalAttestations: number;
  } | null> {
    const result = await this.ballotModel.aggregate([
      {
        $match: { tableCode },
      },
      {
        $lookup: {
          from: 'attestations',
          localField: '_id',
          foreignField: 'ballotId',
          as: 'attestations',
        },
      },
      {
        $addFields: {
          supportCount: {
            $size: {
              $filter: {
                input: '$attestations',
                cond: { $eq: ['$$this.support', true] },
              },
            },
          },
          totalAttestations: { $size: '$attestations' },
        },
      },
      {
        $sort: { supportCount: -1, version: -1 },
      },
      {
        $limit: 1,
      },
    ]);

    if (result.length === 0) {
      return null;
    }

    const ballot = result[0];
    return {
      ballotId: ballot._id.toString(),
      version: ballot.version,
      supportCount: ballot.supportCount,
      totalAttestations: ballot.totalAttestations,
    };
  }

  // Métodos privados
  private async validateBallotExists(
    ballotId: string | Types.ObjectId,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(ballotId)) {
      throw new BadRequestException('ID de ballot inválido');
    }

    const ballotExists = await this.ballotModel.exists({
      _id: new Types.ObjectId(ballotId),
    });

    if (!ballotExists) {
      throw new BadRequestException('El ballot especificado no existe');
    }
  }

  private async validateUserNotAttested(
    ballotId: string | Types.ObjectId,
    idUser: string,
  ): Promise<void> {
    const existingAttestation = await this.attestationModel.exists({
      ballotId: new Types.ObjectId(ballotId),
      idUser,
    });

    if (existingAttestation) {
      throw new BadRequestException('El usuario ya ha attestado este ballot');
    }
  }

  private mapToResponseDto(
    attestation: AttestationDocument,
  ): AttestationResponseDto {
    return {
      _id: (attestation._id as Types.ObjectId).toString(),
      support: attestation.support,
      ballotId: attestation.ballotId.toString(),
      idUser: attestation.idUser,
      typeUser: attestation.typeUser,
      createdAt: attestation.createdAt,
      updatedAt: attestation.updatedAt,
    };
  }
}
