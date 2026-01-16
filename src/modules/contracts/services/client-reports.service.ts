import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Contract } from '../schemas/contract.schema';
import { Delegate } from '../schemas/delegate.schema';
import { Attestation } from '../../attestation/schemas/attestation.schema';
import { Ballot } from '../../ballot/schemas/ballot.schema';

/**
 * UC4: Reporte del Alcalde/Gobernador
 * Actividad de delegados por mesas/recintos
 */
@Injectable()
export class ClientReportsService {
  constructor(
    @InjectModel(Contract.name) private contractModel: Model<Contract>,
    @InjectModel(Delegate.name) private delegateModel: Model<Delegate>,
    @InjectModel(Attestation.name) private attestationModel: Model<Attestation>,
    @InjectModel(Ballot.name) private ballotModel: Model<Ballot>,
  ) {}

  /**
   * UC4: Reporte de actividad de delegados
   */
  async getDelegateActivityReport(params: {
    contractId: string;
    electionId: string;
    groupBy?: 'delegate' | 'location' | 'table';
  }) {
    const contract = await this.contractModel.findById(params.contractId);
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

    // Obtener atestiguamientos válidos para este contrato
    const attestations = await this.attestationModel
      .aggregate([
        {
          $match: {
            userId: { $in: delegateUserIds },
            electionId: new Types.ObjectId(params.electionId),
            isValidForClientReport: true,
            validForContractId: new Types.ObjectId(params.contractId),
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
        {
          $unwind: '$ballot',
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $unwind: '$user',
        },
        {
          $project: {
            dni: '$user.dni',
            tableCode: '$ballot.tableCode',
            location: '$ballot.location',
            createdAt: 1,
            support: 1,
          },
        },
      ])
      .exec();

    // Agrupar según el parámetro
    switch (params.groupBy) {
      case 'delegate':
        return this.groupByDelegate(attestations, delegates);
      case 'location':
        return this.groupByLocation(attestations);
      case 'table':
        return this.groupByTable(attestations);
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
        if (
          !delegate.lastActivity ||
          att.createdAt > delegate.lastActivity
        ) {
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
  private groupByLocation(attestations: any[]) {
    const locationMap = new Map();

    attestations.forEach((att) => {
      const locName =
        att.location?.electoralLocationName || 'Sin ubicación';
      if (!locationMap.has(locName)) {
        locationMap.set(locName, {
          location: locName,
          department: att.location?.department,
          municipality: att.location?.municipality,
          delegates: new Set(),
          tables: new Set(),
          totalAttestations: 0,
          support: 0,
          against: 0,
        });
      }
      const loc = locationMap.get(locName);
      loc.delegates.add(att.dni);
      loc.tables.add(att.tableCode);
      loc.totalAttestations++;
      if (att.support) {
        loc.support++;
      } else {
        loc.against++;
      }
    });

    const result = Array.from(locationMap.values()).map((loc) => ({
      ...loc,
      delegatesCount: loc.delegates.size,
      tablesCount: loc.tables.size,
      delegates: Array.from(loc.delegates),
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
  private groupByTable(attestations: any[]) {
    const tableMap = new Map();

    attestations.forEach((att) => {
      const tableCode = att.tableCode;
      if (!tableMap.has(tableCode)) {
        tableMap.set(tableCode, {
          tableCode,
          location: att.location?.electoralLocationName,
          delegates: new Set(),
          totalAttestations: 0,
          support: 0,
          against: 0,
          firstAttestation: att.createdAt,
          lastAttestation: att.createdAt,
        });
      }
      const table = tableMap.get(tableCode);
      table.delegates.add(att.dni);
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

    const result = Array.from(tableMap.values()).map((table) => ({
      ...table,
      delegatesCount: table.delegates.size,
      delegates: Array.from(table.delegates),
    }));

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
    const contract = await this.contractModel.findById(params.contractId);
    if (!contract) {
      throw new NotFoundException('Contrato no encontrado');
    }

    // Total de delegados autorizados
    const totalDelegates = await this.delegateModel.countDocuments({
      'authorizedContracts.contractId': new Types.ObjectId(params.contractId),
      active: true,
    });

    // Delegados con actividad
    const activeDelegates = await this.attestationModel
      .distinct('userId', {
        electionId: new Types.ObjectId(params.electionId),
        isValidForClientReport: true,
        validForContractId: new Types.ObjectId(params.contractId),
      })
      .exec();

    // Total de atestiguamientos
    const totalAttestations = await this.attestationModel.countDocuments({
      electionId: new Types.ObjectId(params.electionId),
      isValidForClientReport: true,
      validForContractId: new Types.ObjectId(params.contractId),
    });

    // Mesas únicas atestiguadas
    const uniqueTables = await this.attestationModel.aggregate([
      {
        $match: {
          electionId: new Types.ObjectId(params.electionId),
          isValidForClientReport: true,
          validForContractId: new Types.ObjectId(params.contractId),
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
      {
        $unwind: '$ballot',
      },
      {
        $group: {
          _id: '$ballot.tableCode',
        },
      },
      {
        $count: 'total',
      },
    ]);

    // Recintos únicos
    const uniqueLocations = await this.attestationModel.aggregate([
      {
        $match: {
          electionId: new Types.ObjectId(params.electionId),
          isValidForClientReport: true,
          validForContractId: new Types.ObjectId(params.contractId),
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
      {
        $unwind: '$ballot',
      },
      {
        $group: {
          _id: '$ballot.location.electoralLocationName',
        },
      },
      {
        $count: 'total',
      },
    ]);

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
        activeDelegates: activeDelegates.length,
        participationRate: totalDelegates > 0
          ? ((activeDelegates.length / totalDelegates) * 100).toFixed(2) + '%'
          : '0%',
        totalAttestations,
        uniqueTablesAttested: uniqueTables[0]?.total || 0,
        uniqueLocationsAttested: uniqueLocations[0]?.total || 0,
        avgAttestationsPerDelegate: activeDelegates.length > 0
          ? (totalAttestations / activeDelegates.length).toFixed(2)
          : '0',
      },
    };
  }
}