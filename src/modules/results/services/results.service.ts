/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ballot, BallotDocument } from '../../ballot/schemas/ballot.schema';
import { ElectoralTable } from '../../geographic/schemas/electoral-table.schema';
import {
  Department,
  DepartmentDocument,
} from '../../geographic/schemas/department.schema';
import {
  Municipality,
  MunicipalityDocument,
} from '../../geographic/schemas/municipality.schema';
import {
  Province,
  ProvinceDocument,
} from '../../geographic/schemas/province.schema';
import {
  ElectoralSeat,
  ElectoralSeatDocument,
} from '../../geographic/schemas/electoral-seat.schema';
import {
  ElectoralLocation,
  ElectoralLocationDocument,
} from '../../geographic/schemas/electoral-location.schema';
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
import {
  LiveEffectiveBallot,
  LiveEffectiveBallotDocument,
} from '../schemas/live-effective-ballot.schema';
import { LiveProjectionService } from './live-projection.service';

@Injectable()
export class ResultsService implements OnModuleInit {
  private readonly logger = new Logger(ResultsService.name);
  // Auto-switch with env control:
  // - Tests force disabled for deterministic e2e behavior.
  // - Non-test runtime follows LIVE_PROJECTION (default true).
  private readonly useLiveProjection =
    String(process.env.LP ?? 'true').toLowerCase() === 'true' &&
    process.env.NODE_ENV !== 'test' &&
    !process.env.JEST_WORKER_ID;
  private readonly totalTablesCache = new Map<
    string,
    { value: number; expiresAt: number }
  >();
  private readonly totalTablesCacheMs = Number(
    process.env.TOTAL_TABLES_CACHE_MS || '120000',
  );
  private readonly totalTablesMaxTimeMs = Number(
    process.env.TS || '8000',
  );
  constructor(
    @InjectModel(Ballot.name) private ballotModel: Model<BallotDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTable>,
    @InjectModel(Department.name)
    private departmentModel: Model<DepartmentDocument>,
    @InjectModel(Municipality.name)
    private municipalityModel: Model<MunicipalityDocument>,
    @InjectModel(Province.name)
    private provinceModel: Model<ProvinceDocument>,
    @InjectModel(ElectoralSeat.name)
    private electoralSeatModel: Model<ElectoralSeatDocument>,
    @InjectModel(ElectoralLocation.name)
    private electoralLocationModel: Model<ElectoralLocationDocument>,
    private electionConfigService: ElectionConfigService,
    @Optional()
    @InjectModel(LiveEffectiveBallot.name)
    private liveEffectiveBallotModel?: Model<LiveEffectiveBallotDocument>,
    @Optional()
    private liveProjectionService?: LiveProjectionService,
  ) {}
  /**
   * Helper para detectar si un string es un ObjectId válido
   */
  private isObjectId(value: string): boolean {
    return Types.ObjectId.isValid(value) && /^[a-fA-F0-9]{24}$/.test(value);
  }

  /**
   * Resuelve un departmentId a nombre del departamento
   */
  private async resolveDepartmentName(
    departmentIdOrName: string,
  ): Promise<string> {
    if (!this.isObjectId(departmentIdOrName)) {
      return departmentIdOrName; // Ya es un nombre
    }
    try {
      const dept = await this.departmentModel
        .findById(departmentIdOrName)
        .lean();
      return dept?.name ?? departmentIdOrName;
    } catch {
      return departmentIdOrName;
    }
  }

  /**
   * Resuelve un municipalityId a nombre del municipio
   */
  private async resolveMunicipalityName(
    municipalityIdOrName: string,
  ): Promise<string> {
    if (!this.isObjectId(municipalityIdOrName)) {
      return municipalityIdOrName; // Ya es un nombre
    }
    try {
      const muni = await this.municipalityModel
        .findById(municipalityIdOrName)
        .lean();
      return muni?.name ?? municipalityIdOrName;
    } catch {
      return municipalityIdOrName;
    }
  }

  private async resolveProvinceName(provinceIdOrName: string): Promise<string> {
    if (!this.isObjectId(provinceIdOrName)) {
      return provinceIdOrName;
    }
    try {
      const province = await this.provinceModel.findById(provinceIdOrName).lean();
      return province?.name ?? provinceIdOrName;
    } catch {
      return provinceIdOrName;
    }
  }

  private async resolveElectoralSeatName(electoralSeatIdOrName: string): Promise<string> {
    if (!this.isObjectId(electoralSeatIdOrName)) {
      return electoralSeatIdOrName;
    }
    try {
      const seat = await this.electoralSeatModel
        .findById(electoralSeatIdOrName)
        .lean();
      return seat?.name ?? electoralSeatIdOrName;
    } catch {
      return electoralSeatIdOrName;
    }
  }

  private async resolveElectoralLocationName(
    electoralLocationIdOrName: string,
  ): Promise<string> {
    if (!this.isObjectId(electoralLocationIdOrName)) {
      return electoralLocationIdOrName;
    }
    try {
      const location = await this.electoralLocationModel
        .findById(electoralLocationIdOrName)
        .lean();
      return location?.name ?? electoralLocationIdOrName;
    } catch {
      return electoralLocationIdOrName;
    }
  }

  private async buildLocationMatch(filters?: LocationFilterDto) {
    const match: any = {};
    if (!filters) return match;

    // Resolver department: puede venir como ObjectId o como nombre
    if (filters.department) {
      const deptName = await this.resolveDepartmentName(filters.department);
      match['location.department'] = deptName;
    }
    if (filters.province) {
      const provName = await this.resolveProvinceName(filters.province);
      match['location.province'] = provName;
    }

    // Resolver municipality: puede venir como ObjectId o como nombre
    if (filters.municipality) {
      const muniName = await this.resolveMunicipalityName(filters.municipality);
      match['location.municipality'] = muniName;
    }
    if (filters.electoralSeat) {
      const seatName = await this.resolveElectoralSeatName(filters.electoralSeat);
      match['location.electoralSeat'] = seatName;
    }
    if (filters.electoralLocation) {
      const locationName = await this.resolveElectoralLocationName(
        filters.electoralLocation,
      );
      match['location.electoralLocationName'] = locationName;
    }
    if (filters.tableCode) match['tableCode'] = filters.tableCode;

    // También manejar departmentId explícito
    if (filters.departmentId) {
      const deptName = await this.resolveDepartmentName(filters.departmentId);
      match['location.department'] = deptName;
    }
    if (filters.provinceId) {
      const provName = await this.resolveProvinceName(filters.provinceId);
      match['location.province'] = provName;
    }
    // También manejar municipalityId explícito
    if (filters.municipalityId) {
      const muniName = await this.resolveMunicipalityName(filters.municipalityId);
      match['location.municipality'] = muniName;
    }
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

  private totalTablesCacheKey(filters?: LocationFilterDto & { electionId?: string }) {
    const normalize = (v?: string) => (v || '').trim();
    return [
      normalize(filters?.electionId),
      normalize(filters?.department),
      normalize(filters?.departmentId),
      normalize(filters?.province),
      normalize(filters?.provinceId),
      normalize(filters?.municipality),
      normalize(filters?.municipalityId),
      normalize(filters?.electoralSeat),
      normalize(filters?.electoralLocation),
      normalize(filters?.tableCode),
    ].join('|');
  }

  private async getTotalTablesCount(
    filters?: LocationFilterDto & { electionId?: string },
  ): Promise<number | null> {
    const key = this.totalTablesCacheKey(filters);
    const now = Date.now();
    const cached = this.totalTablesCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    let total = 0;
    try {
      const tableQuery = this.buildLocationTableQuery(filters);
      const totalTablesAgg = await this.electoralTableModel
        .aggregate([...tableQuery, { $count: 'n' }])
        .allowDiskUse(true)
        .option({ maxTimeMS: this.totalTablesMaxTimeMs })
        .exec();
      total =
        Array.isArray(totalTablesAgg) && totalTablesAgg[0]?.n
          ? totalTablesAgg[0].n
          : 0;
    } catch (error: any) {
      this.logger.warn(
        `totalTables timeout/fallo para filtros=${key}. maxTimeMS=${this.totalTablesMaxTimeMs}. error=${error?.message ?? error}`,
      );
      return null;
    }

    this.totalTablesCache.set(key, {
      value: total,
      expiresAt: now + this.totalTablesCacheMs,
    });
    return total;
  }

  /**
   * Mapea electionType del query al type de ElectionConfig en BD.
   * presidential/deputies → config 'presidential' (misma acta)
   * departamental/assembly → config 'departamental' (misma acta)
   * municipal/council → config 'municipal' (misma acta)
   */
  private getConfigTypeForElectionType(
    electionType?: string,
  ): string | undefined {
    if (!electionType) return undefined;
    const map: Record<string, string> = {
      presidential: 'presidential',
      deputies: 'presidential',
      departamental: 'departamental',
      assembly: 'departamental',
      municipal: 'municipal',
      council: 'municipal',
    };
    return map[electionType];
  }

  /**
   * Determina qué campo de votos leer del ballot.
   * Principales (presidential, departamental, municipal) → votes.parties
   * Secundarios (deputies, assembly, council) → votes.deputies
   */
  private getVotesPath(electionType?: string): string {
    const secondary = ['deputies', 'assembly', 'council'];
    return electionType && secondary.includes(electionType)
      ? 'votes.deputies'
      : 'votes.parties';
  }

  private async currentElectionMatch(
    electionId?: string,
    electionType?: string,
  ) {
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

    // Cuando hay múltiples elecciones activas simultáneamente,
    // filtrar por el tipo de config que corresponde al electionType
    const configType = this.getConfigTypeForElectionType(electionType);
    const filtered = configType
      ? actives.filter((a) => a.type === configType)
      : actives;

    if (!filtered.length) return {};
    return {
      electionId: {
        $in: filtered.map((active) => new Types.ObjectId(active.id)),
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
    const stages: any[] = [{ $match: { active: true } }];

    if (filters?.tableCode) {
      stages.push({ $match: { tableCode: filters.tableCode } });
    }

    // Si llegó exactamente 1 electionId → excluir mesas observadas para ESA elección.
    // Esto vive en electoral_tables, por lo que no requiere lookups geográficos.
    const oneEid = this.parseSingleElectionId((filters as any)?.electionId);
    if (oneEid) {
      stages.push({ $addFields: { observedKey: oneEid } });
      stages.push({
        $addFields: {
          isObservedByElection: {
            $ifNull: [
              {
                $first: {
                  $map: {
                    input: {
                      $filter: {
                        input: { $objectToArray: '$observedByElection' },
                        as: 'kv',
                        cond: { $eq: ['$$kv.k', '$observedKey'] },
                      },
                    },
                    as: 'kv2',
                    in: '$$kv2.v',
                  },
                },
              },
              false,
            ],
          },
        },
      });
      stages.push({ $match: { isObservedByElection: { $ne: true } } });
    }

    const needsLocationTree = Boolean(
      filters?.electoralLocation ||
        filters?.electoralSeat ||
        filters?.municipality ||
        filters?.municipalityId ||
        filters?.province ||
        filters?.department ||
        filters?.departmentId,
    );

    if (!needsLocationTree) {
      return stages;
    }

    // electoral_tables → electoral_locations
    stages.push({
      $lookup: {
        from: 'electoral_locations',
        localField: 'electoralLocationId',
        foreignField: '_id',
        as: 'location',
      },
    });
    stages.push({ $unwind: '$location' });

    if (filters?.electoralLocation) {
      stages.push(
        this.isObjectId(filters.electoralLocation)
          ? {
              $match: {
                'location._id': new Types.ObjectId(filters.electoralLocation),
              },
            }
          : { $match: { 'location.name': filters.electoralLocation } },
      );
    }

    const needsSeat = Boolean(
      filters?.electoralSeat ||
        filters?.municipality ||
        filters?.municipalityId ||
        filters?.province ||
        filters?.department ||
        filters?.departmentId,
    );

    if (needsSeat) {
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
        stages.push(
          this.isObjectId(filters.electoralSeat)
            ? { $match: { 'seat._id': new Types.ObjectId(filters.electoralSeat) } }
            : { $match: { 'seat.name': filters.electoralSeat } },
        );
      }
    }

    const needsMunicipality = Boolean(
      filters?.municipality ||
        filters?.municipalityId ||
        filters?.province ||
        filters?.department ||
        filters?.departmentId,
    );

    if (needsMunicipality) {
      stages.push({
        $lookup: {
          from: 'municipalities',
          localField: 'seat.municipalityId',
          foreignField: '_id',
          as: 'municipality',
        },
      });
      stages.push({ $unwind: '$municipality' });

      if (filters?.municipalityId) {
        stages.push({
          $match: {
            'municipality._id': new Types.ObjectId(filters.municipalityId),
          },
        });
      }

      if (filters?.municipality) {
        stages.push({ $match: { 'municipality.name': filters.municipality } });
      }
    }

    const needsProvince = Boolean(
      filters?.province || filters?.department || filters?.departmentId,
    );

    if (needsProvince) {
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
        stages.push(
          this.isObjectId(filters.province)
            ? { $match: { 'province._id': new Types.ObjectId(filters.province) } }
            : { $match: { 'province.name': filters.province } },
        );
      }
    }

    const needsDepartment = Boolean(filters?.department || filters?.departmentId);

    if (needsDepartment) {
      stages.push({
        $lookup: {
          from: 'departments',
          localField: 'province.departmentId',
          foreignField: '_id',
          as: 'department',
        },
      });
      stages.push({ $unwind: '$department' });

      if (filters?.departmentId) {
        stages.push({
          $match: {
            'department._id': new Types.ObjectId(filters.departmentId),
          },
        });
      }

      if (filters?.department) {
        stages.push(
          this.isObjectId(filters.department)
            ? {
                $match: {
                  'department._id': new Types.ObjectId(filters.department),
                },
              }
            : { $match: { 'department.name': filters.department } },
        );
      }
    }

    return stages;
  }

  /**
   * Devuelve un pipeline que filtra:
   * ballots processed/synced
   * solo mesas con caso de atestiguamiento contabilizable
   * (PENDING/CONSENSUAL/CLOSED)
   * solo la versión ganadora (winningBallotId) por mesa
   * dedup por tableCode y vuelve al documento original con $replaceRoot
   */
  private async attestedEffectiveBallotsPipeline(
    locationFilters?: LocationFilterDto,
    electionId?: string,
    mode: 'final' | 'live' = 'final',
    electionType?: string,
  ): Promise<any[]> {
    const eidMatch = await this.currentElectionMatch(electionId, electionType);
    const locMatch = await this.buildLocationMatch(locationFilters);

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
                $first: {
                  $map: {
                    input: {
                      $filter: {
                        input: { $objectToArray: '$table.observedByElection' },
                        as: 'kv',
                        cond: { $eq: ['$$kv.k', '$observedKey'] },
                      },
                    },
                    as: 'kv2',
                    in: '$$kv2.v',
                  },
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
        { $match: { 'case.status': { $in: ['PENDING', 'CONSENSUAL', 'CLOSED'] } } },
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
    electionType?: string,
  ): Promise<QuickCountResponseDto> {
    const base = await this.attestedEffectiveBallotsPipeline(
      undefined,
      electionId,
      mode,
      electionType,
    );

    const votesPath = this.getVotesPath(electionType);

    const agg = await this.ballotModel
      .aggregate([
        ...base,
        {
          $facet: {
            perParty: [
              { $unwind: `$${votesPath}.partyVotes` },
              {
                $group: {
                  _id: `$${votesPath}.partyVotes.partyId`,
                  totalVotes: { $sum: `$${votesPath}.partyVotes.votes` },
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
                  validVotes: { $sum: `$${votesPath}.validVotes` },
                  nullVotes: { $sum: `$${votesPath}.nullVotes` },
                  blankVotes: { $sum: `$${votesPath}.blankVotes` },
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
    const useLiveProjection = this.useLiveProjection;
    const oneEid = this.parseSingleElectionId(filters.electionId);

    if (useLiveProjection && (filters.mode ?? 'final') === 'live' && oneEid) {
      if (!this.liveEffectiveBallotModel || !this.liveProjectionService) {
        this.logger.warn(
          'LIVE_PROJECTION=true pero providers no disponibles. Fallback a pipeline live estándar.',
        );
      } else {
        const meta = await this.liveProjectionService.getMeta(oneEid);
        if (!meta) {
          this.logger.warn(
            `Live projection meta no disponible para electionId=${oneEid}. Fallback temporal a pipeline live estándar.`,
          );
          void this.liveProjectionService.rebuildProjection(oneEid);
        } else {
          return this.getResultsByLocationFromLiveProjection(filters, oneEid);
        }
      }
    }

    const base = await this.attestedEffectiveBallotsPipeline(
      filters,
      filters.electionId,
      filters.mode ?? 'final',
      filters.electionType,
    );

    // Principales (presidential, departamental, municipal) → votes.parties
    // Secundarios (deputies, assembly, council) → votes.deputies
    const votesPath = this.getVotesPath(filters.electionType);

    const facetAggPromise = this.ballotModel
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
    const totalTablesPromise = this.getTotalTablesCount(filters);
    const [facetAgg, totalTablesAgg] = await Promise.all([
      facetAggPromise,
      totalTablesPromise,
    ]);

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

    const totalTables = Number(totalTablesAgg || 0);

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

  private async getResultsByLocationFromLiveProjection(
    filters: (LocationFilterDto & ElectionTypeFilterDto) & { mode?: 'final' | 'live' },
    electionId: string,
  ): Promise<LocationResultsResponseDto> {
    const liveProjectionService = this.liveProjectionService;
    const liveEffectiveBallotModel = this.liveEffectiveBallotModel;
    if (!liveProjectionService || !liveEffectiveBallotModel) {
      throw new Error('Live projection providers are not available');
    }

    await liveProjectionService.ensureProjection(electionId);

    const votesPath = this.getVotesPath(filters.electionType);
    const locMatch = await this.buildLocationMatch(filters);
    const projectionMatch: any = {
      electionId: new Types.ObjectId(electionId),
      ...locMatch,
    };

    const [resultsAgg, summaryAgg] = await Promise.all([
      liveEffectiveBallotModel
        .aggregate([
          { $match: projectionMatch },
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
        ])
        .allowDiskUse(true)
        .exec(),
      liveEffectiveBallotModel
        .aggregate([
          { $match: projectionMatch },
          {
            $group: {
              _id: null,
              validVotes: { $sum: `$${votesPath}.validVotes` },
              nullVotes: { $sum: `$${votesPath}.nullVotes` },
              blankVotes: { $sum: `$${votesPath}.blankVotes` },
              tablesProcessed: { $sum: 1 },
            },
          },
        ])
        .allowDiskUse(true)
        .exec(),
    ]);

    const results = resultsAgg ?? [];
    const summary = summaryAgg[0] ?? {
      validVotes: 0,
      nullVotes: 0,
      blankVotes: 0,
      tablesProcessed: 0,
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

    const hasLocationFilter = this.hasAnyLocationFilter(filters);
    let totalTables = 0;
    if (hasLocationFilter) {
      // In live filtered mode, avoid heavy geographic count pipeline.
      // Effective ballots are 1 per table in projection, so tablesProcessed is
      // the effective total for the selected filtered scope.
      totalTables = summary.tablesProcessed || 0;
    } else {
      const meta = await liveProjectionService.getMeta(electionId);
      if (meta?.totalTables != null) {
        totalTables = Number(meta.totalTables) || 0;
      }
    }
    if (totalTables === 0) {
      const computedTotalTables = await this.getTotalTablesCount(filters);
      if (computedTotalTables == null) {
        totalTables = summary.tablesProcessed || 0;
      } else {
        totalTables = computedTotalTables;
      }
    }

    return {
      filters,
      results: resultsWithPercentages,
      summary: {
        validVotes: summary.validVotes || 0,
        nullVotes: summary.nullVotes || 0,
        blankVotes: summary.blankVotes || 0,
        totalVotes: grandTotal,
        tablesProcessed: summary.tablesProcessed || 0,
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
    electionType?: string,
  ): Promise<RegistrationProgressResponseDto> {
    // Resolver nombres de ubicación (pueden venir como ObjectId o como nombre)
    const resolvedDepartment = filters?.department
      ? await this.resolveDepartmentName(filters.department)
      : undefined;
    const resolvedMunicipality = filters?.municipality
      ? await this.resolveMunicipalityName(filters.municipality)
      : undefined;

    // Construir filtro para mesas
    const tableFilter: any = {};
    if (resolvedDepartment)
      tableFilter['location.department'] = resolvedDepartment;
    if (resolvedMunicipality)
      tableFilter['location.municipality'] = resolvedMunicipality;
    if (filters?.province) tableFilter['location.province'] = filters.province;

    const totalTablesAgg = await this.electoralTableModel
      .aggregate([...this.buildLocationTableQuery(filters), { $count: 'n' }])
      .allowDiskUse(true)
      .exec();
    const totalTables = totalTablesAgg[0]?.n ?? 0;

    // Construir filtro para actas registradas, filtrando por tipo de elección
    const eidMatch = await this.currentElectionMatch(
      filters?.electionId,
      electionType,
    );
    const ballotFilter: any = {
      status: { $in: ['processed', 'synced'] },
      ...eidMatch,
    };
    if (resolvedDepartment)
      ballotFilter['location.department'] = resolvedDepartment;
    if (resolvedMunicipality)
      ballotFilter['location.municipality'] = resolvedMunicipality;
    if (filters?.province) ballotFilter['location.province'] = filters.province;

    // Total de actas registradas
    const registeredBallots =
      await this.ballotModel.countDocuments(ballotFilter);

    // Progreso por estado
    const progressByStatus = await this.ballotModel
      .aggregate([
        { $match: ballotFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .allowDiskUse(true)
      .exec();

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
    const totalBallots = await this.ballotModel.countDocuments();

    const ballotsbyStatus = await this.ballotModel
      .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .allowDiskUse(true)
      .exec();

    const departmentCoverage = await this.ballotModel
      .aggregate([
        { $match: { status: 'processed' } },
        {
          $group: {
            _id: '$location.department',
            ballotCount: { $sum: 1 },
            lastUpdate: { $max: '$updatedAt' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .allowDiskUse(true)
      .exec();

    const recentActivity = await this.ballotModel
      .aggregate([
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
      ])
      .allowDiskUse(true)
      .exec();

    const statusMap = ballotsbyStatus.reduce(
      (acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byStatus = {
      pending: statusMap.pending ?? 0,
      processed: statusMap.processed ?? 0,
      synced: statusMap.synced ?? 0,
      error: statusMap.error ?? 0,
    };

    return {
      summary: {
        totalBallots,
        byStatus,
        departmentsCovered: departmentCoverage.length,
      },
      departmentCoverage: departmentCoverage.map((d: any) => ({
        department: d._id,
        ballotCount: d.ballotCount,
        lastUpdate: d.lastUpdate,
      })),
      recentActivity: recentActivity.map((r: any) => ({
        hour: r._id,
        count: r.count,
      })),
      lastUpdate: new Date(),
    };
  }
  /**
   * Método para obtener mapa de calor
   * para usar la nueva estructura de votos
   */
  async getHeatMapData(params: {
    electionType: string;
    locationType: 'department' | 'municipality' | 'province';
    department?: string;
    electionId?: string;
    mode?: 'final' | 'live';
  }): Promise<HeatMapResponseDto> {
    const locFilters = params.department
      ? { department: params.department }
      : undefined;
    const base = await this.attestedEffectiveBallotsPipeline(
      locFilters as any,
      params.electionId,
      params.mode ?? 'final',
      params.electionType,
    );
    const groupKey =
      params.locationType === 'province'
        ? '$location.province'
        : params.locationType === 'municipality'
          ? '$location.municipality'
          : '$location.department';

    const votesPath = this.getVotesPath(params.electionType);

    const results = await this.ballotModel
      .aggregate([
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
          $addFields: {
            flatPartyVotes: {
              $reduce: {
                input: '$partyVotes',
                initialValue: [],
                in: { $concatArrays: ['$$value', '$$this'] },
              },
            },
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
            partyPercentages: {
              $arrayToObject: {
                $map: {
                  input: {
                    $setUnion: [
                      {
                        $map: {
                          input: '$flatPartyVotes',
                          as: 'p',
                          in: '$$p.partyId',
                        },
                      },
                    ],
                  },
                  as: 'pid',
                  in: {
                    k: '$$pid',
                    v: {
                      $cond: [
                        { $gt: ['$validVotes', 0] },
                        {
                          $round: [
                            {
                              $multiply: [
                                {
                                  $divide: [
                                    {
                                      $sum: {
                                        $map: {
                                          input: {
                                            $filter: {
                                              input: '$flatPartyVotes',
                                              as: 'pp',
                                              cond: {
                                                $eq: ['$$pp.partyId', '$$pid'],
                                              },
                                            },
                                          },
                                          as: 'pp2',
                                          in: '$$pp2.votes',
                                        },
                                      },
                                    },
                                    '$validVotes',
                                  ],
                                },
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
      ])
      .allowDiskUse(true)
      .exec();

    const normalized = (Array.isArray(results) ? results : []).map(
      (res: any) => ({
        ...res,
        partyPercentages: res?.partyPercentages ?? {},
      }),
    );
    return {
      data: normalized,
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
      filters.electionType,
    );
    const votesPath = this.getVotesPath(filters.electionType);

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
        $addFields: {
          flatPartyVotes: {
            $reduce: {
              input: '$partyVotes',
              initialValue: [],
              in: { $concatArrays: ['$$value', '$$this'] },
            },
          },
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
          tablesCount: 1,
          partyResults: {
            $map: {
              input: {
                $setUnion: [
                  {
                    $map: {
                      input: '$flatPartyVotes',
                      as: 'p',
                      in: '$$p.partyId',
                    },
                  },
                ],
              },
              as: 'pid',
              in: {
                partyId: '$$pid',
                votes: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: '$flatPartyVotes',
                          as: 'pp',
                          cond: { $eq: ['$$pp.partyId', '$$pid'] },
                        },
                      },
                      as: 'pp2',
                      in: '$$pp2.votes',
                    },
                  },
                },
              },
            },
          },
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

  /**
   * Obtiene los ballots que realmente cuentan en los resultados
   * Usa el mismo pipeline que getResultsByLocation para garantizar consistencia
   */
  async getCountedBallots(
    filters: (LocationFilterDto & ElectionTypeFilterDto) & {
      mode?: 'final' | 'live';
      page?: number;
      limit?: number;
    },
  ): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    mode: string;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const base = await this.attestedEffectiveBallotsPipeline(
      filters,
      filters.electionId,
      filters.mode ?? 'live',
      filters.electionType,
    );

    // Obtener total de ballots que cuentan
    const countAgg = await this.ballotModel
      .aggregate([...base, { $count: 'total' }])
      .allowDiskUse(true)
      .exec();
    const total = countAgg[0]?.total ?? 0;

    // Obtener ballots con paginación
    const ballots = await this.ballotModel
      .aggregate([
        ...base,
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 1,
            tableCode: 1,
            tableNumber: 1,
            electionId: 1,
            location: 1,
            votes: 1,
            status: 1,
            version: 1,
            createdAt: 1,
            image: 1,
            ipfsUri: 1,
          },
        },
      ])
      .allowDiskUse(true)
      .exec();

    return {
      data: ballots,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      mode: filters.mode ?? 'live',
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
