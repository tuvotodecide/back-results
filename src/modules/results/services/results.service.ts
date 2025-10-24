/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';

@Injectable()
export class ResultsService implements OnModuleInit {
  private readonly logger = new Logger(ResultsService.name);
  constructor(
    @InjectModel(Ballot.name) private ballotModel: Model<BallotDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    private electionConfigService: ElectionConfigService,
  ) {}
  private buildLocationMatch(filters?: LocationFilterDto) {
    const match: any = {};
    if (!filters) return match;
    if (filters.department) match['location.department'] = filters.department;
    if (filters.province) match['location.province'] = filters.province;
    if (filters.municipality)
      match['location.municipality'] = filters.municipality;
    if (filters.electoralSeat)
      match['location.electoralSeat'] = filters.electoralSeat;
    if (filters.electoralLocation)
      match['location.electoralLocationName'] = filters.electoralLocation;
    if (filters.tableCode) match['tableCode'] = filters.tableCode;
    return match;
  }

  private hasAnyLocationFilter(filters?: LocationFilterDto): boolean {
    if (!filters) return false;
    return Boolean(
      filters.department ||
        filters.province ||
        filters.municipality ||
        filters.electoralSeat ||
        filters.electoralLocation ||
        filters.tableCode,
    );
  }

  private parseSingleElectionId(eid?: string): string | undefined {
    if (!eid) return undefined;
    const ids = eid
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const valid = ids.filter(Types.ObjectId.isValid);
    return valid.length === 1 ? valid[0] : undefined;
  }

  private async currentElectionMatch(electionId?: string) {
    if (electionId) {
      const parts = electionId
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const ids = parts
        .filter((part) => Types.ObjectId.isValid(part))
        .map((part) => new Types.ObjectId(part));
      if (ids.length === 0) return {};
      return ids.length === 1
        ? { electionId: ids[0] }
        : { electionId: { $in: ids } };
    }
    const actives = await this.electionConfigService.getActiveConfigs();
    if (!actives?.length) return {};
    return {
      electionId: {
        $in: actives.map((active) => new Types.ObjectId(active.id)),
      },
    };
  }

  // private buildLocationTableQuery(filters?: LocationFilterDto) {
  //   const match: any = {};
  //   const query: any[] = [
  //     {
  //       $lookup: {
  //         from: 'electoral_locations',
  //         localField: 'electoralLocationId',
  //         foreignField: '_id',
  //         as: 'location',
  //       },
  //     },
  //     {
  //       $unwind: '$location',
  //     },
  //     {
  //       $lookup: {
  //         from: 'electoral_seats',
  //         localField: 'location.electoralSeatId',
  //         foreignField: '_id',
  //         as: 'seat',
  //       },
  //     },
  //     {
  //       $unwind: '$seat',
  //     },
  //     {
  //       $lookup: {
  //         from: 'municipalities',
  //         localField: 'seat.municipalityId',
  //         foreignField: '_id',
  //         as: 'municipality',
  //       },
  //     },
  //     {
  //       $unwind: '$municipality',
  //     },
  //     {
  //       $lookup: {
  //         from: 'provinces',
  //         localField: 'municipality.provinceId',
  //         foreignField: '_id',
  //         as: 'province',
  //       },
  //     },
  //     {
  //       $unwind: '$province',
  //     },
  //     {
  //       $lookup: {
  //         from: 'departments',
  //         localField: 'province.departmentId',
  //         foreignField: '_id',
  //         as: 'department',
  //       },
  //     },
  //     {
  //       $unwind: '$department',
  //     },
  //     {
  //       $match: match,
  //     },
  //   ];
  //   if (!filters) return query;
  //   if (filters.department) match['department.name'] = filters.department;
  //   if (filters.province) match['province.name'] = filters.province;
  //   if (filters.municipality) match['municipality.name'] = filters.municipality;
  //   if (filters.electoralSeat) match['seat.name'] = filters.electoralSeat;
  //   if (filters.electoralLocation)
  //     match['location.name'] = filters.electoralLocation;
  //   if (filters.tableCode) match['tableCode'] = filters.tableCode;

  //   return query;
  // }

  private buildLocationTableQuery(filters?: LocationFilterDto) {
    const stages: any[] = [
      // electoral_tables → electoral_locations
      {
        $lookup: {
          from: 'electoral_locations',
          localField: 'electoralLocationId',
          foreignField: '_id',
          as: 'location',
        },
      },
      { $unwind: '$location' },
    ];

    stages.push({ $match: { active: true } });

    if (filters?.electoralLocation) {
      stages.push({ $match: { 'location.name': filters.electoralLocation } });
    }

    // locations → seats
    stages.push({
      $lookup: {
        from: 'electoral_seats',
        localField: 'location.electoralSeatId',
        foreignField: '_id',
        as: 'seat',
      },
    });
    stages.push({ $unwind: '$seat' });

    if (filters?.electoralSeat) {
      stages.push({ $match: { 'seat.name': filters.electoralSeat } });
    }

    stages.push({
      $lookup: {
        from: 'municipalities',
        localField: 'seat.municipalityId',
        foreignField: '_id',
        as: 'municipality',
      },
    });
    stages.push({ $unwind: '$municipality' });

    if (filters?.municipality) {
      stages.push({ $match: { 'municipality.name': filters.municipality } });
    }

    stages.push({
      $lookup: {
        from: 'provinces',
        localField: 'municipality.provinceId',
        foreignField: '_id',
        as: 'province',
      },
    });
    stages.push({ $unwind: '$province' });

    if (filters?.province) {
      stages.push({ $match: { 'province.name': filters.province } });
    }

    stages.push({
      $lookup: {
        from: 'departments',
        localField: 'province.departmentId',
        foreignField: '_id',
        as: 'department',
      },
    });
    stages.push({ $unwind: '$department' });

    if (filters?.department) {
      stages.push({ $match: { 'department.name': filters.department } });
    }
    if (filters?.tableCode) {
      stages.push({ $match: { tableCode: filters.tableCode } });
    }
    // Si llegó exactamente 1 electionId → excluir mesas observadas para ESA elección
    const oneEid = this.parseSingleElectionId((filters as any)?.electionId);
    if (oneEid) {
      stages.push({ $addFields: { observedKey: oneEid } });
      stages.push({
        $addFields: {
          isObservedByElection: {
            $ifNull: [
              {
                $getField: {
                  input: '$observedByElection',
                  field: '$observedKey',
                },
              },
              false,
            ],
          },
        },
      });
      stages.push({ $match: { isObservedByElection: { $ne: true } } });
    }

    return stages;
  }

  /**
   * Devuelve un pipeline que filtra:
   * ballots processed/synced
   * solo mesas con caso de atestiguamiento resuelto (CONSENSUAL/CLOSED)
   * solo la versión ganadora (winningBallotId) por mesa
   * dedup por tableCode y vuelve al documento original con $replaceRoot
   */
  private async attestedEffectiveBallotsPipeline(
    locationFilters?: LocationFilterDto,
    electionId?: string,
    mode: 'final' | 'live' = 'final',
  ): Promise<any[]> {
    const eidMatch = await this.currentElectionMatch(electionId);
    const locMatch = this.buildLocationMatch(locationFilters);

    const baseMatch: any = {
      status: { $in: ['processed', 'synced'] },
      ...eidMatch,
      ...locMatch,
    };

    // Lookup de caso por mesa/elección
    const attachCase = [
      {
        $lookup: {
          from: 'attestation_cases',
          let: { tcode: '$tableCode', eid: '$electionId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$tableCode', '$$tcode'] },
                    { $eq: ['$electionId', '$$eid'] },
                  ],
                },
              },
            },
          ],
          as: 'case',
        },
      },
      { $addFields: { case: { $arrayElemAt: ['$case', 0] } } },
    ];

    // Lookup mesa y flag de observación POR elección
    const attachTable = [
      {
        $lookup: {
          from: 'electoral_tables',
          localField: 'tableCode',
          foreignField: 'tableCode',
          as: 'table',
        },
      },
      { $addFields: { table: { $arrayElemAt: ['$table', 0] } } },
      { $addFields: { observedKey: { $toString: '$electionId' } } },
      {
        $addFields: {
          isObservedByElection: {
            $ifNull: [
              {
                $getField: {
                  input: '$table.observedByElection',
                  field: '$observedKey',
                },
              },
              false,
            ],
          },
        },
      },
      { $match: { 'table.active': true, isObservedByElection: { $ne: true } } },
    ];

    if (mode === 'final') {
      return [
        { $match: { ...baseMatch, valuable: true } },
        ...attachCase,
        { $match: { 'case.status': { $in: ['CONSENSUAL', 'CLOSED'] } } },
        { $match: { $expr: { $eq: ['$_id', '$case.winningBallotId'] } } },
        ...attachTable,
        { $sort: { tableCode: 1, version: -1, createdAt: -1 } },
        { $group: { _id: '$tableCode', doc: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$doc' } },
      ];
    }

    // MODO LIVE:
    return [
      { $match: baseMatch },
      { $sort: { createdAt: -1, version: -1 } },
      {
        $group: {
          _id: '$tableCode',
          countVersions: { $sum: 1 },
          doc: { $first: '$$ROOT' },
        },
      },
      { $match: { countVersions: 1 } },
      { $replaceRoot: { newRoot: '$doc' } },
      ...attachTable,
    ];
  }

  async getQuickCount(
    electionId?: string,
    mode: 'final' | 'live' = 'final',
  ): Promise<QuickCountResponseDto> {
    const base = await this.attestedEffectiveBallotsPipeline(
      undefined,
      electionId,
      mode,
    );

    const agg = await this.ballotModel
      .aggregate([
        ...base,
        {
          $facet: {
            perParty: [
              { $unwind: '$votes.parties.partyVotes' },
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
              { $sort: { totalVotes: -1 } },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  validVotes: { $sum: '$votes.parties.validVotes' },
                  nullVotes: { $sum: '$votes.parties.nullVotes' },
                  blankVotes: { $sum: '$votes.parties.blankVotes' },
                  tablesProcessed: { $addToSet: '$tableCode' },
                },
              },
            ],
          },
        },
        {
          $project: {
            results: '$perParty',
            summary: {
              $ifNull: [
                { $arrayElemAt: ['$totals', 0] },
                {
                  validVotes: 0,
                  nullVotes: 0,
                  blankVotes: 0,
                  tablesProcessed: [],
                },
              ],
            },
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    const results = agg[0]?.results ?? [];
    const summaryAgg =
      agg[0]?.summary ??
      ({
        validVotes: 0,
        nullVotes: 0,
        blankVotes: 0,
        tablesProcessed: [],
      } as any);

    const grandTotal =
      (summaryAgg.validVotes || 0) +
      (summaryAgg.nullVotes || 0) +
      (summaryAgg.blankVotes || 0);

    const denValid = summaryAgg.validVotes || 0;

    const resultsWithPercentages = results.map((party: any) => ({
      ...party,
      percentage:
        denValid > 0
          ? ((party.totalVotes / denValid) * 100).toFixed(2)
          : '0.00',
    }));

    return {
      results: resultsWithPercentages,
      summary: {
        validVotes: summaryAgg.validVotes || 0,
        nullVotes: summaryAgg.nullVotes || 0,
        blankVotes: summaryAgg.blankVotes || 0,
        totalVotes: grandTotal,
        tablesProcessed: (summaryAgg.tablesProcessed || []).length,
      },
      lastUpdate: new Date(),
    };
  }

  /**
   * Obtiene resultados por ubicación geográfica
   * Actualizado para manejar tanto presidential como deputies
   */
  // async getResultsByLocation(
  //   filters: LocationFilterDto & ElectionTypeFilterDto,
  // ): Promise<LocationResultsResponseDto> {
  //   // TODO: Verificar cache

  //   const base = await this.attestedEffectiveBallotsPipeline(
  //     filters,
  //     filters.electionId,
  //   );
  //   const tableQuery = this.buildLocationTableQuery(filters);

  //   // Determinar qué campo de votos usar según el tipo de elección
  //   const votesPath =
  //     filters.electionType === 'presidential'
  //       ? 'votes.parties'
  //       : 'votes.deputies';

  //   const results = await this.ballotModel.aggregate([
  //     ...base,
  //     { $unwind: `$${votesPath}.partyVotes` },
  //     {
  //       $group: {
  //         _id: `$${votesPath}.partyVotes.partyId`,
  //         totalVotes: { $sum: `$${votesPath}.partyVotes.votes` },
  //         locations: { $addToSet: '$location' },
  //       },
  //     },
  //     {
  //       $project: {
  //         _id: 0,
  //         partyId: '$_id',
  //         totalVotes: 1,
  //         locationsCovered: { $size: '$locations' },
  //       },
  //     },
  //     { $sort: { totalVotes: -1 } },
  //   ]);

  //   const [summary, totalTables] = await Promise.all([
  //     // Calcular totales usando el path correcto
  //     this.ballotModel.aggregate([
  //       ...base,
  //       {
  //         $group: {
  //           _id: null,
  //           validVotes: { $sum: `$${votesPath}.validVotes` },
  //           nullVotes: { $sum: `$${votesPath}.nullVotes` },
  //           blankVotes: { $sum: `$${votesPath}.blankVotes` },
  //           totalTables: { $addToSet: '$_id' },
  //         },
  //       },
  //     ]),
  //     //Calcular total de mesas
  //     this.electoralTableModel.aggregate(tableQuery),
  //   ]);

  //   const grandTotal = summary[0]
  //     ? summary[0].validVotes + summary[0].nullVotes + summary[0].blankVotes
  //     : 0;

  //   const resultsWithPercentages = results.map((party) => ({
  //     ...party,
  //     percentage:
  //       summary[0]?.validVotes > 0
  //         ? ((party.totalVotes / summary[0].validVotes) * 100).toFixed(2)
  //         : '0.00',
  //   }));

  //   // TODO: Publicar en cache

  //   return {
  //     filters,
  //     results: resultsWithPercentages,
  //     summary: {
  //       validVotes: summary[0]?.validVotes || 0,
  //       nullVotes: summary[0]?.nullVotes || 0,
  //       blankVotes: summary[0]?.blankVotes || 0,
  //       totalVotes: grandTotal,
  //       tablesProcessed: summary[0]?.totalTables.length || 0,
  //       totalTables: totalTables.length,
  //     },
  //     lastUpdate: new Date(),
  //   };
  // }
  async getResultsByLocation(
    filters: (LocationFilterDto & ElectionTypeFilterDto) & {
      mode?: 'final' | 'live';
    },
  ): Promise<LocationResultsResponseDto> {
    const base = await this.attestedEffectiveBallotsPipeline(
      filters,
      filters.electionId,
      filters.mode ?? 'final',
    );
    const tableQuery = this.buildLocationTableQuery(filters);

    const votesPath =
      filters.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const facetAgg = await this.ballotModel
      .aggregate([
        ...base,
        {
          $facet: {
            results: [
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
            ],
            summary: [
              {
                $group: {
                  _id: null,
                  validVotes: { $sum: `$${votesPath}.validVotes` },
                  nullVotes: { $sum: `$${votesPath}.nullVotes` },
                  blankVotes: { $sum: `$${votesPath}.blankVotes` },
                  totalTables: { $addToSet: '$tableCode' },
                },
              },
            ],
          },
        },
        {
          $project: {
            results: 1,
            summary: {
              $ifNull: [
                { $arrayElemAt: ['$summary', 0] },
                { validVotes: 0, nullVotes: 0, blankVotes: 0, totalTables: [] },
              ],
            },
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    const results = facetAgg[0]?.results ?? [];
    const summary = facetAgg[0]?.summary ?? {
      validVotes: 0,
      nullVotes: 0,
      blankVotes: 0,
      totalTables: [],
    };

    const grandTotal =
      (summary.validVotes || 0) +
      (summary.nullVotes || 0) +
      (summary.blankVotes || 0);

    const resultsWithPercentages = results.map((party: any) => ({
      ...party,
      percentage:
        summary.validVotes > 0
          ? ((party.totalVotes / summary.validVotes) * 100).toFixed(2)
          : '0.00',
    }));

    const totalTablesAgg = await this.electoralTableModel
      .aggregate([...tableQuery, { $count: 'n' }])
      .allowDiskUse(true)
      .exec();
    const totalTables =
      Array.isArray(totalTablesAgg) && totalTablesAgg[0]?.n
        ? totalTablesAgg[0].n
        : 0;

    return {
      filters,
      results: resultsWithPercentages,
      summary: {
        validVotes: summary.validVotes || 0,
        nullVotes: summary.nullVotes || 0,
        blankVotes: summary.blankVotes || 0,
        totalVotes: grandTotal,
        tablesProcessed: (summary.totalTables || []).length,
        totalTables,
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

    const totalTablesAgg = await this.electoralTableModel
      .aggregate([...this.buildLocationTableQuery(filters), { $count: 'n' }])
      .allowDiskUse(true)
      .exec();
    const totalTables = totalTablesAgg[0]?.n ?? 0;

    // Construir filtro para actas registradas
    const eidMatch = await this.currentElectionMatch(filters?.electionId);
    const ballotFilter: any = {
      status: { $in: ['processed', 'synced'] },
      ...eidMatch,
    };
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
  async getHeatMapData(params: {
    electionType: 'presidential' | 'deputies';
    locationType: 'department' | 'municipality' | 'province';
    department?: string;
    electionId?: string;
    mode?: 'final' | 'live';
  }): Promise<HeatMapResponseDto> {
    // TODO: Verificar cache
    const locFilters = params.department
      ? { department: params.department }
      : undefined;
    const base = await this.attestedEffectiveBallotsPipeline(
      locFilters as any,
      params.electionId,
      params.mode ?? 'final',
    );
    const groupKey =
      params.locationType === 'province'
        ? '$location.province'
        : params.locationType === 'municipality'
          ? '$location.municipality'
          : '$location.department';

    // Determinar qué campo usar según el tipo de elección
    const votesPath =
      params.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const results = await this.ballotModel.aggregate([
      ...base,
      {
        $group: {
          _id: groupKey,
          validVotes: { $sum: `$${votesPath}.validVotes` },
          nullVotes: { $sum: `$${votesPath}.nullVotes` },
          blankVotes: { $sum: `$${votesPath}.blankVotes` },
          partyVotes: { $push: `$${votesPath}.partyVotes` },
        },
      },
      {
        $project: {
          _id: 0,
          location: '$_id',
          locationType: params.locationType ?? 'department',
          validVotes: 1,
          nullVotes: 1,
          blankVotes: 1,
          totalVotes: { $add: ['$validVotes', '$nullVotes', '$blankVotes'] },
          participationRate: 0,
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
                    $cond: [
                      { $gt: ['$validVotes', 0] },
                      {
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
                      0,
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
    filters: CircunscripcionFilterDto & { mode?: 'final' | 'live' },
  ): Promise<CircunscripcionResponseDto> {
    const base = await this.attestedEffectiveBallotsPipeline(
      filters,
      filters.electionId,
      filters.mode ?? 'final',
    );
    // Determinar qué campo usar según el tipo de elección
    const votesPath =
      filters.electionType === 'presidential'
        ? 'votes.parties'
        : 'votes.deputies';

    const matchStage: any = {};
    if (filters.circunscripcionType) {
      matchStage['location.circunscripcion.type'] = filters.circunscripcionType;
    }
    if (filters.circunscripcionNumber) {
      matchStage['location.circunscripcion.number'] =
        filters.circunscripcionNumber;
    }

    const results = await this.ballotModel.aggregate([
      ...base,
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
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
  async onModuleInit() {
    const BLOCKING = true;

    const doWarmup = async () => {
      try {
        this.logger.log('Warm-up inicial de ResultsService...');
        const active = await this.electionConfigService
          .getActiveConfig()
          .catch(() => null);
        const electionId = active?.id;

        const p1 = this.getQuickCount(electionId);
        const p2 = this.getResultsByLocation({
          electionType: 'presidential',
          electionId,
        } as any);
        const p3 = this.getRegistrationProgress({ electionId } as any);
        const p4 = this.getSystemStatistics();
        const p5 = this.getHeatMapData({
          electionType: 'presidential',
          locationType: 'department',
          electionId,
        });

        await Promise.allSettled([p1, p2, p3, p4, p5]);

        await Promise.allSettled([
          this.ballotModel.createIndexes(),
          this.electoralTableModel.createIndexes(),
          this.ballotModel
            .aggregate([{ $limit: 1 }])
            .allowDiskUse(true)
            .exec(),
          this.electoralTableModel
            .aggregate([{ $limit: 1 }])
            .allowDiskUse(true)
            .exec(),
        ]);

        this.logger.log('Warm-up completado');
      } catch (e) {
        this.logger.warn(
          'Warm-up falló (continuamos igual): ' + (e as Error).message,
        );
      }
    };

    if (BLOCKING) {
      await doWarmup();
    } else {
      setTimeout(() => {
        void doWarmup();
      }, 0);
    }
  }
}
