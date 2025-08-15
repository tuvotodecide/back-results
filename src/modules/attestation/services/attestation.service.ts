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
import { AttestationCase } from '../schemas/attestation-case.schema';
import { UsersService } from '@/modules/users/services/users.service';

type PopulatedUserRef = { _id: Types.ObjectId; dni: string };
type AttestationLean<TUser = Types.ObjectId> = {
  _id: Types.ObjectId;
  support: boolean;
  ballotId: Types.ObjectId;
  isJury: boolean;
  userId: TUser;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AttestationService {
  constructor(
    @InjectModel(Attestation.name)
    private attestationModel: Model<AttestationDocument>,
    @InjectModel(Ballot.name)
    private ballotModel: Model<BallotDocument>,
    @InjectModel(AttestationCase.name)
    private caseModel: Model<AttestationCase>,
    private usersService: UsersService,
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
        await this.validateBallotExists(attestationData.ballotId.toString());

        if (typeof attestationData.isJury !== 'boolean') {
          throw new BadRequestException(
            'isJury es requerido (true=jurado, false=usuario)',
          );
        }
        if (!attestationData.dni) {
          throw new BadRequestException('dni es requerido');
        }

        const user = await this.usersService.findOrCreateByDni(
          attestationData.dni,
        );

        const attestation = new this.attestationModel({
          support: attestationData.support,
          ballotId: new Types.ObjectId(attestationData.ballotId),
          isJury: attestationData.isJury,
          userId: user._id as Types.ObjectId,
        });
        try {
          const savedAttestation = await attestation.save();
          created.push(
            this.mapToResponseDto(savedAttestation.toObject(), user.dni),
          );
        } catch (e: unknown) {
          const message =
            (e as any)?.code === 11000
              ? 'El usuario ya atestiguó este ballot'
              : e instanceof Error
                ? e.message
                : 'Error al guardar attestation';
          errors.push({ index: i, error: message, data: attestationData });
        }
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

  //Obtener todas las attestations de un ballot específico

  async findByBallot(ballotId: string): Promise<AttestationResponseDto[]> {
    if (!Types.ObjectId.isValid(ballotId)) {
      throw new BadRequestException('ID de ballot inválido');
    }

    const attestations = await this.attestationModel
      .find({ ballotId: new Types.ObjectId(ballotId) })
      .sort({ createdAt: -1 })
      .populate<{ userId: PopulatedUserRef }>('userId', 'dni')
      .lean<AttestationLean<PopulatedUserRef>[]>()
      .exec();

    return attestations.map((attestation) =>
      this.mapToResponseDto(attestation, attestation.userId.dni),
    );
  }

  //Obtener todas las attestations con paginación

  async findAll(
    page = 1,
    limit = 10,
    ballotId?: string,
    isJury?: boolean,
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

    if (typeof isJury === 'boolean') filter.isJury = isJury;
    if (typeof support === 'boolean') filter.support = support;

    const [data, total] = await Promise.all([
      this.attestationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('ballotId', 'tableCode tableNumber location.department')
        .populate<{ userId: PopulatedUserRef }>('userId', 'dni')
        .lean<AttestationLean<PopulatedUserRef>[]>() // ← agrega esta línea
        .exec(),
      this.attestationModel.countDocuments(filter),
    ]);
    return {
      data: data.map((attestation) =>
        this.mapToResponseDto(attestation, attestation.userId.dni),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByUserDni(
    dni: string,
    page = 1,
    limit = 10,
    isJury?: boolean,
    support?: boolean,
  ) {
    const user = await this.usersService.findByDni(dni);
    const skip = (page - 1) * limit;
    const filter: any = { userId: user._id };
    if (typeof isJury === 'boolean') filter.isJury = isJury;
    if (typeof support === 'boolean') filter.support = support;

    const [data, total] = await Promise.all([
      this.attestationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('support ballotId isJury createdAt updatedAt')
        .lean<AttestationLean[]>()
        .exec(),
      this.attestationModel.countDocuments(filter),
    ]);

    return {
      user: { id: user._id.toString(), dni: user.dni },
      data: data.map((attestation) =>
        this.mapToResponseDto(attestation, user.dni),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

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

  // Obtener la version con más apoyo para un tableCode específico
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

  // Listar casos por estado y ubicación (para ver "observadas" vs "resueltas") usando $facet
  async listCases(
    page = 1,
    limit = 10,
    status?: 'VERIFYING' | 'CONSENSUAL' | 'CLOSED',
    department?: string,
    province?: string,
    municipality?: string,
  ) {
    const skip = (page - 1) * limit;
    const match: any = {};
    if (status) match.status = status;

    // pipeline base: unir un ballot de la mesa para leer location
    const basePipeline: any[] = [
      { $match: match },
      {
        $lookup: {
          from: 'ballots',
          let: { tcode: '$tableCode' },
          pipeline: [
            { $match: { $expr: { $eq: ['$tableCode', '$$tcode'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
          ],
          as: 'sampleBallot',
        },
      },
      { $addFields: { sampleBallot: { $arrayElemAt: ['$sampleBallot', 0] } } },
    ];

    // filtros por ubicación sobre el ballot unido
    const locFilters: any = {};
    if (department) locFilters['sampleBallot.location.department'] = department;
    if (province) locFilters['sampleBallot.location.province'] = province;
    if (municipality)
      locFilters['sampleBallot.location.municipality'] = municipality;

    const pipeline: any[] = [
      ...basePipeline,
      ...(Object.keys(locFilters).length > 0 ? [{ $match: locFilters }] : []),
      {
        $facet: {
          data: [
            { $sort: { resolvedAt: -1, createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                tableCode: 1,
                status: 1,
                winningBallotId: 1,
                isObserved: { $eq: ['$status', 'VERIFYING'] },
                resolvedAt: 1,
                location: '$sampleBallot.location',
              },
            },
          ],
          meta: [{ $count: 'total' }],
        },
      },
      {
        $project: {
          data: 1,
          total: { $ifNull: [{ $arrayElemAt: ['$meta.total', 0] }, 0] },
        },
      },
    ];

    const agg = await this.caseModel.aggregate(pipeline).exec();
    const { data, total } = agg[0] ?? { data: [], total: 0 };

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
  // Detalle de un caso por mesa (conteos por acta y por rol)
  async getCaseDetail(tableCode: string) {
    const ballots = await this.ballotModel.find({ tableCode }).lean();
    if (ballots.length === 0) {
      throw new NotFoundException('No hay actas para esa mesa');
    }

    const caseDoc = await this.caseModel.findOne({ tableCode }).lean();
    const ballotIds = ballots.map((b) => b._id as Types.ObjectId);

    const counts = await this.attestationModel.aggregate([
      { $match: { ballotId: { $in: ballotIds }, support: true } },
      {
        $group: {
          _id: { ballotId: '$ballotId', isJury: '$isJury' },
          count: { $sum: 1 },
        },
      },
    ]);

    const perBallot: Record<string, { users: number; juries: number }> = {};
    for (const ballot of ballots) {
      perBallot[ballot._id.toString()] = { users: 0, juries: 0 };
    }
    for (const item of counts) {
      const id = (item._id.ballotId as Types.ObjectId).toString();
      if (item._id.isJury) perBallot[id].juries += item.count;
      else perBallot[id].users += item.count;
    }

    return {
      tableCode,
      status: caseDoc?.status ?? 'VERIFYING',
      isObserved: caseDoc?.status === 'VERIFYING',
      winningBallotId: caseDoc?.winningBallotId ?? null,
      resolvedAt: caseDoc?.resolvedAt ?? null,
      ballots: ballots.map((b) => ({
        ballotId: b._id.toString(),
        version: b.version,
        location: b.location,
        supports: perBallot[b._id.toString()],
      })),
      summary: caseDoc?.summary ?? {},
    };
  }

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

  private mapToResponseDto(
    attestation: AttestationLean<Types.ObjectId | PopulatedUserRef>,
    dni: string,
  ): AttestationResponseDto {
    const ballot = attestation.ballotId as any;
    const ballotId =
      ballot && typeof ballot === 'object'
        ? (ballot._id ?? ballot).toString() 
        : String(ballot);
    return {
      _id: (attestation._id as Types.ObjectId).toString(),
      support: attestation.support,
      ballotId,
      dni,
      isJury: attestation.isJury,
      createdAt: attestation.createdAt,
      updatedAt: attestation.updatedAt,
    };
  }
}
