import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contract } from '../schemas/contract.schema';
import { Delegate } from '../schemas/delegate.schema';
import { Attestation } from '../../attestation/schemas/attestation.schema';
import { Ballot } from '../../ballot/schemas/ballot.schema';
import { BallotComparison } from '../../attestation/schemas/ballot-comparison.schema';

/**
 * UC4: Reporte del Alcalde/Gobernador
 * Actividad de delegados por mesas/recintos
 */
@Injectable()
export class ClientReportsService {
  private readonly logger = new Logger(ClientReportsService.name);

  constructor(
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    @InjectModel(Delegate.name) private delegateModel: Model<Delegate>,
    @InjectModel(Attestation.name) private attestationModel: Model<Attestation>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
    @InjectModel(BallotComparison.name)
    private ballotComparisonModel: Model<BallotComparison>,
  ) {}

  /**
   * UC4: Reporte de actividad de delegados
   */
  async getDelegateActivityReport(params: {
    contractId: string;
    electionId: string;
    groupBy?: 'delegate' | 'location' | 'table';
  }) {
    const contract = await this.contractModel.findById(params.contractId).lean();
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    // Obtener delegados autorizados
    const delegates = await this.delegateModel
      .find({
        'authorizedContracts.contractId': new Types.ObjectId(params.contractId),
        active: true,
      })
      .lean();

    const delegateUserIds = delegates.map((d) => d.userId);
    this.logger.debug(
      `[delegate-activity] electionId=${params.electionId} contractId=${params.contractId} delegates=${delegates.length} department=${contract.departmentName ?? 'null'} municipality=${contract.municipalityName ?? 'null'}`,
    );

    const attestations = await this.getContractAttestations({
      contract,
      contractId: params.contractId,
      electionId: params.electionId,
      delegateUserIds,
      includeUser: true,
    });

    // Agrupar según el parámetro
    switch (params.groupBy) {
      case 'delegate':
        return this.groupByDelegate(attestations, delegates);
      case 'location':
        return this.groupByLocation(attestations, delegates);
      case 'table':
        return this.groupByTable(attestations, delegates);
      default:
        return this.groupByDelegate(attestations, delegates);
    }
  }

  /**
   * Agrupar por delegado
   */
  private groupByDelegate(attestations: any[], delegates: any[]) {
    const delegateMap = new Map();

    // Inicializar todos los delegados (incluso sin actividad)
    delegates.forEach((d) => {
      delegateMap.set(d.dni, {
        dni: d.dni,
        name: d.name || 'Sin nombre',
        totalAttestations: 0,
        tablesAttested: new Set(),
        locations: new Set(),
        support: 0,
        against: 0,
        lastActivity: null,
      });
    });

    // Agregar actividad
    attestations.forEach((att) => {
      const delegate = delegateMap.get(att.dni);
      if (delegate) {
        delegate.totalAttestations++;
        delegate.tablesAttested.add(att.tableCode);
        if (att.location?.electoralLocationName) {
          delegate.locations.add(att.location.electoralLocationName);
        }
        if (att.support) {
          delegate.support++;
        } else {
          delegate.against++;
        }
        if (!delegate.lastActivity || att.createdAt > delegate.lastActivity) {
          delegate.lastActivity = att.createdAt;
        }
      }
    });

    // Convertir Sets a arrays y contar
    const result = Array.from(delegateMap.values()).map((d) => ({
      ...d,
      tablesCount: d.tablesAttested.size,
      locationsCount: d.locations.size,
      tablesAttested: Array.from(d.tablesAttested),
      locations: Array.from(d.locations),
    }));

    return {
      groupBy: 'delegate',
      totalDelegates: delegates.length,
      activeDelegates: result.filter((d) => d.totalAttestations > 0).length,
      data: result.sort((a, b) => b.totalAttestations - a.totalAttestations),
    };
  }

  /**
   * Agrupar por ubicación (recinto)
   */
  private groupByLocation(attestations: any[], delegates?: any[]) {
    // Crear mapa de delegados para obtener nombres
    const delegateInfoMap = new Map<string, any>();
    if (delegates) {
      delegates.forEach((d) => {
        delegateInfoMap.set(d.dni, {
          dni: d.dni,
          name: d.name || 'Sin nombre',
          phone: d.phone,
          email: d.email,
        });
      });
    }

    const locationMap = new Map();

    attestations.forEach((att) => {
      const locName = att.location?.electoralLocationName || 'Sin ubicación';
      if (!locationMap.has(locName)) {
        locationMap.set(locName, {
          location: locName,
          department: att.location?.department,
          municipality: att.location?.municipality,
          delegateDetails: new Map<string, any>(),
          tables: new Set(),
          totalAttestations: 0,
          support: 0,
          against: 0,
        });
      }
      const loc = locationMap.get(locName);

      // Agregar o actualizar delegado
      if (!loc.delegateDetails.has(att.dni)) {
        const info = delegateInfoMap.get(att.dni) || { dni: att.dni };
        loc.delegateDetails.set(att.dni, {
          dni: att.dni,
          name: info.name || 'Sin nombre',
          phone: info.phone || null,
          email: info.email || null,
          attestationsCount: 0,
        });
      }
      loc.delegateDetails.get(att.dni).attestationsCount++;

      loc.tables.add(att.tableCode);
      loc.totalAttestations++;
      if (att.support) {
        loc.support++;
      } else {
        loc.against++;
      }
    });

    const result = Array.from(locationMap.values()).map((loc) => ({
      location: loc.location,
      department: loc.department,
      municipality: loc.municipality,
      totalAttestations: loc.totalAttestations,
      support: loc.support,
      against: loc.against,
      delegatesCount: loc.delegateDetails.size,
      tablesCount: loc.tables.size,
      delegates: Array.from(loc.delegateDetails.values()),
      tables: Array.from(loc.tables),
    }));

    return {
      groupBy: 'location',
      totalLocations: result.length,
      data: result.sort((a, b) => b.totalAttestations - a.totalAttestations),
    };
  }

  /**
   * Agrupar por mesa
   */
  private groupByTable(attestations: any[], delegates?: any[]) {
    // Crear mapa de delegados para obtener nombres
    const delegateInfoMap = new Map<string, any>();
    if (delegates) {
      delegates.forEach((d) => {
        delegateInfoMap.set(d.dni, {
          dni: d.dni,
          name: d.name || 'Sin nombre',
          phone: d.phone,
          email: d.email,
        });
      });
    }

    const tableMap = new Map();

    attestations.forEach((att) => {
      const tableCode = att.tableCode;
      if (!tableMap.has(tableCode)) {
        tableMap.set(tableCode, {
          tableCode,
          tableNumber: att.tableNumber || null,
          location: att.location?.electoralLocationName,
          municipality: att.location?.municipality,
          department: att.location?.department,
          ballotId: att.ballotId?.toString() || null,
          attestationDetails: [],
          totalAttestations: 0,
          support: 0,
          against: 0,
          firstAttestation: att.createdAt,
          lastAttestation: att.createdAt,
        });
      }
      const table = tableMap.get(tableCode);

      // Agregar detalle del atestiguamiento
      const delegateInfo = delegateInfoMap.get(att.dni) || { dni: att.dni };
      table.attestationDetails.push({
        dni: att.dni,
        delegateName: delegateInfo.name || 'Sin nombre',
        delegatePhone: delegateInfo.phone || null,
        delegateEmail: delegateInfo.email || null,
        support: att.support,
        attestedAt: att.createdAt,
        ballotId: att.ballotId?.toString() || null,
      });

      table.totalAttestations++;
      if (att.support) {
        table.support++;
      } else {
        table.against++;
      }
      if (att.createdAt < table.firstAttestation) {
        table.firstAttestation = att.createdAt;
      }
      if (att.createdAt > table.lastAttestation) {
        table.lastAttestation = att.createdAt;
      }
    });

    const result = Array.from(tableMap.values()).map((table) => {
      // Extraer DNIs únicos de delegados
      const uniqueDelegates = [
        ...new Map(
          table.attestationDetails.map((a: any) => [a.dni, a]),
        ).values(),
      ].map((a: any) => ({
        dni: a.dni,
        name: a.delegateName,
        phone: a.delegatePhone,
        email: a.delegateEmail,
      }));

      return {
        tableCode: table.tableCode,
        tableNumber: table.tableNumber,
        location: table.location,
        municipality: table.municipality,
        department: table.department,
        ballotId: table.ballotId,
        totalAttestations: table.totalAttestations,
        support: table.support,
        against: table.against,
        firstAttestation: table.firstAttestation,
        lastAttestation: table.lastAttestation,
        delegatesCount: uniqueDelegates.length,
        delegates: uniqueDelegates,
        attestationDetails: table.attestationDetails,
      };
    });

    return {
      groupBy: 'table',
      totalTables: result.length,
      data: result.sort((a, b) => b.totalAttestations - a.totalAttestations),
    };
  }

  /**
   * Resumen ejecutivo para el cliente
   */
  async getExecutiveSummary(params: {
    contractId: string;
    electionId: string;
  }) {
    const contract = await this.contractModel.findById(params.contractId).lean();
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    // Total de delegados autorizados
    const totalDelegates = await this.delegateModel.countDocuments({
      'authorizedContracts.contractId': new Types.ObjectId(params.contractId),
      active: true,
    });

    const delegates = await this.delegateModel
      .find({
        'authorizedContracts.contractId': new Types.ObjectId(params.contractId),
        active: true,
      })
      .lean();

    const delegateUserIds = delegates.map((d) => d.userId);
    this.logger.debug(
      `[executive-summary] electionId=${params.electionId} contractId=${params.contractId} delegates=${delegates.length} department=${contract.departmentName ?? 'null'} municipality=${contract.municipalityName ?? 'null'}`,
    );
    const attestations = await this.getContractAttestations({
      contract,
      contractId: params.contractId,
      electionId: params.electionId,
      delegateUserIds,
      includeUser: true,
    });

    const activeDelegates = new Set(
      attestations.map((att: any) => String(att.userId)),
    );
    const uniqueTables = new Set(
      attestations.map((att: any) => att.tableCode).filter(Boolean),
    );
    const uniqueLocations = new Set(
      attestations
        .map((att: any) => att.location?.electoralLocationName)
        .filter(Boolean),
    );
    const totalAttestations = attestations.length;

    return {
      contract: {
        id: contract._id.toString(),
        clientRole: contract.clientRole,
        territory: {
          departmentName: contract.departmentName,
          municipalityName: contract.municipalityName,
        },
      },
      summary: {
        totalDelegatesAuthorized: totalDelegates,
        activeDelegates: activeDelegates.size,
        participationRate:
          totalDelegates > 0
            ? ((activeDelegates.size / totalDelegates) * 100).toFixed(2) + '%'
            : '0%',
        totalAttestations,
        uniqueTablesAttested: uniqueTables.size,
        uniqueLocationsAttested: uniqueLocations.size,
        avgAttestationsPerDelegate:
          activeDelegates.size > 0
            ? (totalAttestations / activeDelegates.size).toFixed(2)
            : '0',
      },
    };
  }

  async getAuditMatchReport(params: {
    contractId: string;
    electionId: string;
    department?: string;
    province?: string;
    municipality?: string;
    electoralSeat?: string;
    electoralLocation?: string;
    tableCode?: string;
  }) {
    const contract = await this.contractModel.findById(params.contractId).lean();
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    const delegates = await this.delegateModel
      .find({
        'authorizedContracts.contractId': new Types.ObjectId(params.contractId),
        active: true,
      })
      .lean();

    const delegateUserIds = delegates.map((d) => d.userId);
    this.logger.debug(
      `[audit-match] electionId=${params.electionId} contractId=${params.contractId} delegates=${delegates.length} department=${contract.departmentName ?? 'null'} municipality=${contract.municipalityName ?? 'null'}`,
    );
    const rows = await this.getContractAttestations({
      contract,
      contractId: params.contractId,
      electionId: params.electionId,
      delegateUserIds,
      includeUser: true,
      extraProjection: {
        version: '$ballot.version',
        delegateName: '$user.name',
        delegateDni: '$user.dni',
      },
    });

    const filteredRows = rows.filter((row: any) => {
      if (params.department && row.location?.department !== params.department)
        return false;
      if (params.province && row.location?.province !== params.province)
        return false;
      if (
        params.municipality &&
        row.location?.municipality !== params.municipality
      )
        return false;
      if (
        params.electoralSeat &&
        row.location?.electoralSeat !== params.electoralSeat
      )
        return false;
      if (
        params.electoralLocation &&
        row.location?.electoralLocationName !== params.electoralLocation
      )
        return false;
      if (params.tableCode && row.tableCode !== params.tableCode) return false;
      return true;
    });

    const byBallot = new Map<string, any>();
    for (const row of filteredRows) {
      const key = String(row.ballotId);
      if (!byBallot.has(key)) {
        byBallot.set(key, {
          ballotId: key,
          tableCode: row.tableCode,
          mesa: row.tableNumber || row.tableCode,
          recinto: row.location?.electoralLocationName || 'Sin ubicación',
          version: row.version ?? null,
          delegates: new Map<string, string>(),
        });
      }
      const item = byBallot.get(key);
      item.delegates.set(
        String(row.delegateDni || row.delegateName || key),
        row.delegateName || row.delegateDni || 'Sin nombre',
      );
    }

    const ballotIds = Array.from(byBallot.keys())
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const comparisons = ballotIds.length
      ? await this.ballotComparisonModel
          .find({ ballotId: { $in: ballotIds } })
          .lean()
          .exec()
      : [];

    const comparisonMap = new Map(
      comparisons.map((comparison: any) => [
        String(comparison.ballotId),
        comparison,
      ]),
    );

    const details = Array.from(byBallot.values())
      .map((item) => {
        const comparison = comparisonMap.get(item.ballotId);
        const status = String(comparison?.status || 'PENDING');
        return {
          _id: item.ballotId,
          ballotId: item.ballotId,
          recinto: item.recinto,
          mesa: item.mesa,
          tableCode: item.tableCode,
          version: item.version,
          testigo: Array.from(item.delegates.values()).join(', '),
          auditoria: this.mapAuditStatusLabel(status),
          comparisonStatus: status,
          comparedAt: comparison?.comparedAt ?? null,
          mismatches: comparison?.mismatches ?? [],
        };
      })
      .sort((a, b) => a.recinto.localeCompare(b.recinto) || a.mesa.localeCompare(b.mesa));

    const observados = details.filter(
      (item) => item.comparisonStatus === 'MISMATCH',
    ).length;

    return {
      observados,
      sinObservaciones: details.filter(
        (item) => item.comparisonStatus === 'MATCH',
      ).length,
      pendientes: details.filter(
        (item) => item.comparisonStatus !== 'MATCH' && item.comparisonStatus !== 'MISMATCH',
      ).length,
      total: details.length,
      details,
    };
  }

  private mapAuditStatusLabel(
    status: string,
  ): 'Sin Obs' | 'No coincide' | 'Pendiente' {
    if (status === 'MATCH') return 'Sin Obs';
    if (status === 'MISMATCH') return 'No coincide';
    return 'Pendiente';
  }

  private buildTerritoryFallbackMatch(contract: any) {
    if (contract.municipalityName) {
      return {
        'ballot.location.municipality': contract.municipalityName,
      };
    }

    if (contract.departmentName) {
      return {
        'ballot.location.department': contract.departmentName,
      };
    }

    return null;
  }

  private async getContractAttestations(params: {
    contract: any;
    contractId: string;
    electionId: string;
    delegateUserIds: Types.ObjectId[];
    includeUser?: boolean;
    extraProjection?: Record<string, any>;
  }) {
    if (params.delegateUserIds.length === 0) {
      this.logger.debug(
        `[client-report-debug] electionId=${params.electionId} contractId=${params.contractId} delegateUserIds=0`,
      );
      return [];
    }

    const contractId = new Types.ObjectId(params.contractId);
    const fallbackMatch = this.buildTerritoryFallbackMatch(params.contract);
    const territoryField = params.contract.municipalityName
      ? 'municipality'
      : params.contract.departmentName
        ? 'department'
        : 'none';
    const territoryValue =
      params.contract.municipalityName || params.contract.departmentName || null;
    const contractScopeMatch = fallbackMatch
      ? {
          $or: [
            {
              isValidForClientReport: true,
              validForContractId: contractId,
            },
            fallbackMatch,
          ],
        }
      : {
          isValidForClientReport: true,
          validForContractId: contractId,
        };

    const pipeline: any[] = [
      {
        $match: {
          userId: { $in: params.delegateUserIds },
          electionId: new Types.ObjectId(params.electionId),
        },
      },
      {
        $lookup: {
          from: 'ballots',
          localField: 'ballotId',
          foreignField: '_id',
          as: 'ballot',
        },
      },
      { $unwind: '$ballot' },
      {
        $addFields: {
          _matchedByFlags: {
            $and: [
              { $eq: ['$isValidForClientReport', true] },
              { $eq: ['$validForContractId', contractId] },
            ],
          },
          _matchedByTerritory:
            territoryField === 'municipality'
              ? {
                  $eq: [
                    '$ballot.location.municipality',
                    params.contract.municipalityName,
                  ],
                }
              : territoryField === 'department'
                ? {
                    $eq: [
                      '$ballot.location.department',
                      params.contract.departmentName,
                    ],
                  }
                : false,
        },
      },
      { $match: contractScopeMatch },
    ];

    if (params.includeUser) {
      pipeline.push(
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
      );
    }

    pipeline.push({
      $project: {
        userId: 1,
        dni: '$user.dni',
        ballotId: '$ballot._id',
        tableCode: '$ballot.tableCode',
        tableNumber: '$ballot.tableNumber',
        location: '$ballot.location',
        createdAt: 1,
        support: 1,
        _matchedByFlags: 1,
        _matchedByTerritory: 1,
        ...(params.extraProjection || {}),
      },
    });

    const rows = await this.attestationModel.aggregate(pipeline).exec();

    const byFlags = rows.filter((row: any) => row._matchedByFlags).length;
    const byTerritory = rows.filter(
      (row: any) => row._matchedByTerritory,
    ).length;
    const fallbackOnly = rows.filter(
      (row: any) => !row._matchedByFlags && row._matchedByTerritory,
    ).length;

    this.logger.debug(
      `[client-report-debug] electionId=${params.electionId} contractId=${params.contractId} territoryField=${territoryField} territoryValue=${territoryValue ?? 'null'} delegateUserIds=${params.delegateUserIds.length} rows=${rows.length} byFlags=${byFlags} byTerritory=${byTerritory} fallbackOnly=${fallbackOnly}`,
    );

    return rows;
  }
}
