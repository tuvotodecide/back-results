/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Ballot, BallotDocument } from '../../ballot/schemas/ballot.schema';
import { ElectoralTable } from '../../geographic/schemas/electoral-table.schema';
import {
  QuickCountResponseDto,
  LocationResultsResponseDto,
  RegistrationProgressResponseDto,
  CircunscripcionResponseDto,
  HeatMapResponseDto,
  SystemStatisticsResponseDto,
  ElectionTypeFilterDto,
  LocationFilterDto,
  CircunscripcionFilterDto,
} from '../dto/results.dto';

@Injectable()
export class ResultsService {
  constructor(
    @InjectModel(Ballot.name) private ballotModel: Model<BallotDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
  ) {}

  /**
   * Obtiene el conteo rápido nacional (solo votos presidenciales)
   */
  /**
   * Obtiene el conteo rápido nacional (solo votos presidenciales)
   * Actualizado para usar la nueva estructura votes.parties
   */
  async getQuickCount(): Promise<QuickCountResponseDto> {
    // TODO: implementar publicación en cache

    const results = await this.ballotModel.aggregate([
      {
        $match: {
          status: 'processed',
        },
      },
      {
        // Ahora descomponemos votes.parties.partyVotes en lugar de votes.partyVotes
        $unwind: '$votes.parties.partyVotes',
      },
      {
        $group: {
          _id: '$votes.parties.partyVotes.partyId',
          totalVotes: { $sum: '$votes.parties.partyVotes.votes' },
          departments: { $addToSet: '$location.department' },
        },
      },
      {
        $project: {
          _id: 0,
          partyId: '$_id',
          totalVotes: 1,
          departmentsCovered: { $size: '$departments' },
        },
      },
      {
        $sort: { totalVotes: -1 },
      },
    ]);

    // Calcular totales generales usando votes.parties
    const totalValidVotes = await this.ballotModel.aggregate([
      { $match: { status: 'processed' } },
      { $group: { _id: null, total: { $sum: '$votes.parties.validVotes' } } },
    ]);

    const totalNullVotes = await this.ballotModel.aggregate([
      { $match: { status: 'processed' } },
      { $group: { _id: null, total: { $sum: '$votes.parties.nullVotes' } } },
    ]);

    const totalBlankVotes = await this.ballotModel.aggregate([
      { $match: { status: 'processed' } },
      { $group: { _id: null, total: { $sum: '$votes.parties.blankVotes' } } },
    ]);

    const grandTotal =
      (totalValidVotes[0]?.total || 0) +
      (totalNullVotes[0]?.total || 0) +
      (totalBlankVotes[0]?.total || 0);

    // Agregar porcentajes a cada partido
    const resultsWithPercentages = results.map((party) => ({
      ...party,
      percentage:
        grandTotal > 0
          ? ((party.totalVotes / grandTotal) * 100).toFixed(2)
          : '0.00',
    }));

    // TODO: Publicar en cache

    return {
      results: resultsWithPercentages,
      summary: {
        validVotes: totalValidVotes[0]?.total || 0,
        nullVotes: totalNullVotes[0]?.total || 0,
        blankVotes: totalBlankVotes[0]?.total || 0,
        totalVotes: grandTotal,
        tablesProcessed: await this.ballotModel.countDocuments({
          status: 'processed',
        }),
      },
      lastUpdate: new Date(),
    };
  }

  /**
   * Obtiene resultados por ubicación geográfica
   * Actualizado para manejar tanto presidential como deputies
   */
  async getResultsByLocation(
    filters: LocationFilterDto & ElectionTypeFilterDto,
  ): Promise<LocationResultsResponseDto> {
    // TODO: Verificar cache

    const matchStage: any = { status: 'processed' };

    // Aplicar filtros geográficos
    if (filters.department)
      matchStage['location.department'] = filters.department;
    if (filters.province) matchStage['location.province'] = filters.province;
    if (filters.municipality)
      matchStage['location.municipality'] = filters.municipality;
    if (filters.electoralSeat)
      matchStage['location.electoralSeat'] = filters.electoralSeat;
    if (filters.electoralLocation) {
      matchStage['location.electoralLocationName'] = filters.electoralLocation;
    }
    if (filters.tableCode) {
      matchStage.tableCode = filters.tableCode;
    }

    // Determinar qué campo de votos usar según el tipo de elección
    const votesPath =
      filters.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const results = await this.ballotModel.aggregate([
      { $match: matchStage },
      { $unwind: `$${votesPath}.partyVotes` },
      {
        $group: {
          _id: `$${votesPath}.partyVotes.partyId`,
          totalVotes: { $sum: `$${votesPath}.partyVotes.votes` },
          locations: { $addToSet: '$location' },
        },
      },
      {
        $project: {
          _id: 0,
          partyId: '$_id',
          totalVotes: 1,
          locationsCovered: { $size: '$locations' },
        },
      },
      { $sort: { totalVotes: -1 } },
    ]);

    // Calcular totales usando el path correcto
    const summary = await this.ballotModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          validVotes: { $sum: `$${votesPath}.validVotes` },
          nullVotes: { $sum: `$${votesPath}.nullVotes` },
          blankVotes: { $sum: `$${votesPath}.blankVotes` },
          totalTables: { $addToSet: '$_id' },
        },
      },
    ]);

    const grandTotal = summary[0]
      ? summary[0].validVotes + summary[0].nullVotes + summary[0].blankVotes
      : 0;

    const resultsWithPercentages = results.map((party) => ({
      ...party,
      percentage:
        summary[0]?.validVotes > 0
          ? ((party.totalVotes / summary[0].validVotes) * 100).toFixed(2)
          : '0.00',
    }));

    // TODO: Publicar en cache

    return {
      filters,
      results: resultsWithPercentages,
      summary: {
        validVotes: summary[0]?.validVotes || 0,
        nullVotes: summary[0]?.nullVotes || 0,
        blankVotes: summary[0]?.blankVotes || 0,
        totalVotes: grandTotal,
        tablesProcessed: summary[0]?.totalTables.length || 0,
      },
      lastUpdate: new Date(),
    };
  }

  /**
   * Obtiene el progreso de registro de actas
   * Compara actas registradas vs total de mesas
   */
  async getRegistrationProgress(
    filters?: LocationFilterDto,
  ): Promise<RegistrationProgressResponseDto> {
    // TODO: Verificar cache

    // Construir filtro para mesas
    const tableFilter: any = {};
    if (filters?.department)
      tableFilter['location.department'] = filters.department;
    if (filters?.municipality)
      tableFilter['location.municipality'] = filters.municipality;
    if (filters?.province) tableFilter['location.province'] = filters.province;

    // Total de mesas esperadas
    const totalTables =
      await this.electoralTableModel.countDocuments(tableFilter);

    // Construir filtro para actas registradas
    const ballotFilter: any = { status: { $in: ['processed', 'synced'] } };
    if (filters?.department)
      ballotFilter['location.department'] = filters.department;
    if (filters?.municipality)
      ballotFilter['location.municipality'] = filters.municipality;
    if (filters?.province) ballotFilter['location.province'] = filters.province;

    // Total de actas registradas
    const registeredBallots =
      await this.ballotModel.countDocuments(ballotFilter);

    // Progreso por estado
    const progressByStatus = await this.ballotModel.aggregate([
      { $match: filters ? ballotFilter : {} },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const statusMap = progressByStatus.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    return {
      progress: {
        totalTables,
        registeredBallots,
        percentage:
          totalTables > 0
            ? ((registeredBallots / totalTables) * 100).toFixed(2)
            : '0.00',
        pending: totalTables - registeredBallots,
      },
      byStatus: {
        pending: statusMap.pending || 0,
        processed: statusMap.processed || 0,
        synced: statusMap.synced || 0,
        error: statusMap.error || 0,
      },
      filters,
      lastUpdate: new Date(),
    };
  }

  /**
   * Obtiene estadísticas generales del sistema
   * Este método tampoco se ve afectado ya que solo cuenta actas
   */
  async getSystemStatistics(): Promise<SystemStatisticsResponseDto> {
    // TODO: Verificar caché

    const [totalBallots, ballotsbyStatus, departmentCoverage, recentActivity] =
      await Promise.all([
        // Total de actas
        this.ballotModel.countDocuments(),

        // Actas por estado
        this.ballotModel.aggregate([
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ]),

        // Cobertura por departamento
        this.ballotModel.aggregate([
          { $match: { status: 'processed' } },
          {
            $group: {
              _id: '$location.department',
              ballotCount: { $sum: 1 },
              lastUpdate: { $max: '$updatedAt' },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        // Actividad reciente (últimas 24 horas)
        this.ballotModel.aggregate([
          {
            $match: {
              createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

    const statusMap = ballotsbyStatus.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});

    return {
      summary: {
        totalBallots,
        byStatus: statusMap,
        departmentsCovered: departmentCoverage.length,
      },
      departmentCoverage: departmentCoverage.map((dept) => ({
        department: dept._id,
        ballotCount: dept.ballotCount,
        lastUpdate: dept.lastUpdate,
      })),
      recentActivity: recentActivity.map((activity) => ({
        hour: activity._id,
        count: activity.count,
      })),
      lastUpdate: new Date(),
    };
  }

  /**
   * Método para obtener mapa de calor
   * para usar la nueva estructura de votos
   */
  async getHeatMapData(params: any): Promise<HeatMapResponseDto> {
    // TODO: Verificar cache

    const matchStage: any = { status: 'processed' };

    // Determinar qué campo usar según el tipo de elección
    const votesPath =
      params.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const results = await this.ballotModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$location.department', // o el nivel que necesites
          totalVotes: { $sum: `$${votesPath}.totalVotes` },
          validVotes: { $sum: `$${votesPath}.validVotes` },
          partyVotes: { $push: `$${votesPath}.partyVotes` },
        },
      },
      {
        $project: {
          _id: 0,
          location: '$_id',
          locationType: 'department',
          totalVotes: 1,
          participationRate: 0, // TODO: Implementar cuando tengamos datos del OEP
          partyPercentages: {
            $arrayToObject: {
              $map: {
                input: {
                  $reduce: {
                    input: '$partyVotes',
                    initialValue: [],
                    in: { $concatArrays: ['$$value', '$$this'] },
                  },
                },
                as: 'party',
                in: {
                  k: '$$party.partyId',
                  v: {
                    $round: [
                      {
                        $multiply: [
                          { $divide: ['$$party.votes', '$validVotes'] },
                          100,
                        ],
                      },
                      2,
                    ],
                  },
                },
              },
            },
          },
        },
      },
      { $sort: { location: 1 } },
    ]);

    return {
      data: results,
      electionType: params.electionType,
      lastUpdate: new Date(),
    };
  }

  /**
   * Obtiene resultados agrupados por circunscripción
   * util para visualizar resultados por distritos electorales
   */
  async getResultsByCircunscripcion(
    filters: CircunscripcionFilterDto,
  ): Promise<CircunscripcionResponseDto> {
    // TODO: Verificar cache

    const matchStage: any = { status: 'processed' };

    if (filters.circunscripcionType) {
      matchStage['location.circunscripcion.type'] = filters.circunscripcionType;
    }
    if (filters.circunscripcionNumber) {
      matchStage['location.circunscripcion.number'] =
        filters.circunscripcionNumber;
    }

    // Determinar qué campo usar según el tipo de elección
    const votesPath =
      filters.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const results = await this.ballotModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            circunscripcionNumber: '$location.circunscripcion.number',
            circunscripcionType: '$location.circunscripcion.type',
            circunscripcionName: '$location.circunscripcion.name',
          },
          validVotes: { $sum: `$${votesPath}.validVotes` },
          nullVotes: { $sum: `$${votesPath}.nullVotes` },
          blankVotes: { $sum: `$${votesPath}.blankVotes` },
          partyVotes: {
            $push: `$${votesPath}.partyVotes`,
          },
          tablesCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          circunscripcion: '$_id',
          validVotes: 1,
          nullVotes: 1,
          blankVotes: 1,
          totalVotes: { $add: ['$validVotes', '$nullVotes', '$blankVotes'] },
          partyResults: {
            $map: {
              input: {
                $setUnion: [
                  {
                    $reduce: {
                      input: '$partyVotes',
                      initialValue: [],
                      in: { $concatArrays: ['$$value', '$$this'] },
                    },
                  },
                ],
              },
              as: 'party',
              in: {
                partyId: '$$party.partyId',
                votes: '$$party.votes',
              },
            },
          },
          tablesCount: 1,
        },
      },
      { $sort: { 'circunscripcion.circunscripcionNumber': 1 } },
    ]);

    // TODO: Publicar en cache

    return {
      filters,
      circunscripciones: results,
      lastUpdate: new Date(),
    };
  }
}
