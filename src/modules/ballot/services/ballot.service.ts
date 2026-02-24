/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ballot, BallotDocument } from '../schemas/ballot.schema';
import {
  CreateBallotFromIpfsDto,
  BallotQueryDto,
  BallotStatsDto,
  OpenSeaMetadata,
  BallotDataFromIpfs,
  VotingCategoryData,
} from '../dto/ballot.dto';
import { ElectoralLocationService } from '../../geographic/services/electoral-location.service';
import { ElectoralTableService } from '../../geographic/services/electoral-table.service';
import { PoliticalPartyService } from '../../political/services/political-party.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import {
  ElectoralTable,
  ElectoralTableDocument,
} from '@/modules/geographic/schemas/electoral-table.schema';
import { LoggerService } from '../../../core/services/logger.service';
import { TableCodeValidationService } from '@/modules/table-code-validation/services/table-code-validation.service';

@Injectable()
export class BallotService {
  constructor(
    @InjectModel(Ballot.name) private ballotModel: Model<BallotDocument>,
    @InjectModel(ElectoralTable.name)
    private electoralTableModel: Model<ElectoralTableDocument>,
    private electoralLocationService: ElectoralLocationService,
    private electoralTableService: ElectoralTableService,
    private politicalPartyService: PoliticalPartyService,
    private electionConfigService: ElectionConfigService,
    private tableCodeValidationService: TableCodeValidationService,
    private logger: LoggerService,
  ) {}
  private async getDepartmentNameById(departmentId: string): Promise<string> {
    const dept = await this.ballotModel.db
      .collection('departments')
      .findOne({ _id: new Types.ObjectId(departmentId) });
    if (!dept) throw new BadRequestException('Departamento no encontrado');
    return dept.name;
  }

  private async getMunicipalityNameById(
    municipalityId: string,
  ): Promise<string> {
    const mun = await this.ballotModel.db
      .collection('municipalities')
      .findOne({ _id: new Types.ObjectId(municipalityId) });
    if (!mun) throw new BadRequestException('Municipio no encontrado');
    return mun.name;
  }
  async createFromIpfs(createDto: CreateBallotFromIpfsDto): Promise<Ballot> {
    try {
      const ipfsData = await this.fetchFromIpfs(createDto.ipfsUri);
      const electionId = await this.resolveElectionId(
        createDto.electionId,
        true,
      );
      const ballotData = this.extractBallotData(ipfsData);
      const observationData = this.resolveObservationData(createDto, ballotData);
      await this.validateBallotData(ballotData, electionId);

      const locationDetails = await this.getLocationDetails(
        ballotData.locationId,
      );

      const cid = this.extractCidFromUri(createDto.ipfsUri);
      const maxVersion = await this.getMaxVersionForTable(
        ballotData.tableCode,
        electionId,
      );
      const version = createDto.version ?? (maxVersion ? maxVersion + 1 : 1);

      const ballot = new this.ballotModel({
        electionId,
        tableNumber: ballotData.tableNumber,
        tableCode: ballotData.tableCode,
        electoralLocationId: ballotData.locationId,
        location: locationDetails,
        votes: ballotData.votes,
        image: ballotData.image,
        ipfsUri: createDto.ipfsUri,
        ipfsCid: cid,
        recordId: createDto.recordId,
        tableIdIpfs: createDto.tableIdIpfs,
        hasObservation: observationData.hasObservation,
        observationText: observationData.observationText,
        status: 'processed',
        version,
      });

      const savedBallot = await ballot.save();
      await this.tableCodeValidationService.ensurePending(
        electionId,
        ballotData.tableCode,
      );
      return savedBallot;
    } catch (error) {
      throw error;
    }
  }

  async previousValidate(createDto: CreateBallotFromIpfsDto): Promise<boolean> {
    try {
      const ipfsData = await this.fetchFromIpfs(createDto.ipfsUri);

      const ballotData = this.extractBallotData(ipfsData);
      this.resolveObservationData(createDto, ballotData);
      // CORREGIDO: electionId ahora es requerido
      const eid = await this.resolveElectionId(createDto.electionId, true);
      await this.validateBallotData(ballotData, eid);

      return true;
    } catch (error) {
      throw error;
    }
  }

  async getMaxVersionForTable(
    tableCode: string,
    electionId: Types.ObjectId,
  ): Promise<number> {
    const maxBallot = await this.ballotModel
      .findOne({ electionId, tableCode })
      .sort({ version: -1 })
      .exec();
    return maxBallot?.version ?? 0;
  }
  private async resolveElectionId(
    electionId: string | undefined,
    require: true,
  ): Promise<Types.ObjectId>;
  private async resolveElectionId(
    electionId?: string,
    require?: false,
  ): Promise<Types.ObjectId | undefined>;

  private async resolveElectionId(
    electionId?: string,
    require = false,
  ): Promise<Types.ObjectId | undefined> {
    if (electionId !== undefined) {
      if (!Types.ObjectId.isValid(electionId)) {
        throw new BadRequestException('electionId inválido');
      }
      return new Types.ObjectId(electionId);
    }

    // Soportar múltiples activas (una por tipo). Si hay >1 activas en total,
    // exigir electionId explícito para evitar ambigüedad.
    const actives = await this.electionConfigService.getActiveConfigs();
    if (actives.length === 0) {
      if (require) {
        throw new NotFoundException('No hay configuración electoral activa');
      }
      return undefined;
    }
    if (actives.length > 1) {
      // Igual al criterio del PreliminaryResultsGuard
      throw new BadRequestException(
        'Hay varias elecciones activas; envíe electionId',
      );
    }
    return new Types.ObjectId(actives[0].id);
  }
  // private async fetchFromIpfs(ipfsUri: string): Promise<OpenSeaMetadata> {
  //   try {
  //     const response = await fetch(ipfsUri);
  //     const data = await response.json();
  //     return data as unknown as OpenSeaMetadata;
  //   } catch (error) {
  //     console.log('Error al obtener datos de IPFS:', error);
  //     throw new BadRequestException('Error al obtener datos de IPFS');
  //   }
  // }

  private async fetchFromIpfs(ipfsUri: string): Promise<OpenSeaMetadata> {
    try {
      let response = await fetch(ipfsUri, {
        headers: { accept: 'application/json' },
      } as any);
      let text = await response.text();

      const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
      if (!isJson) {
        const cid = this.extractCidFromUri(ipfsUri);
        const gateways = [
          `https://ipfs.io/ipfs/${cid}`,
          `https://cloudflare-ipfs.com/ipfs/${cid}`,
          `https://gateway.pinata.cloud/ipfs/${cid}`,
        ];

        for (const url of gateways) {
          try {
            response = await fetch(url, {
              headers: { accept: 'application/json' },
            } as any);
            text = await response.text();
            if (text.trim().startsWith('{') || text.trim().startsWith('['))
              break;
          } catch {}
        }
      }
      if (!(text.trim().startsWith('{') || text.trim().startsWith('['))) {
        throw new Error('Respuesta no-JSON de los gateways de IPFS');
      }

      const data = JSON.parse(text);
      return data as unknown as OpenSeaMetadata;
    } catch (error) {
      throw new BadRequestException('Error al obtener datos de IPFS');
    }
  }

  private extractBallotData(metadata: OpenSeaMetadata): BallotDataFromIpfs {
    // Buscar el atributo que contiene 'data'
    if (!metadata.data) {
      throw new BadRequestException(
        'Formato de metadata invalido: no se encontro campo data',
      );
    }

    if (!metadata.image) {
      throw new BadRequestException(
        'Formato de metadata invalido: no se encontro campo image',
      );
    }
    const rawData = metadata.data;
    const normalizedTableCode = String(rawData.tableCode ?? '').trim();
    const normalizedTableNumber =
      String(rawData.tableNumber ?? '').trim() || normalizedTableCode;
    const normalizedLocationId = String(rawData.locationId ?? '').trim();

    // Mapear la estructura de datos desde IPFS al formato esperado
    const ballotData: BallotDataFromIpfs = {
      tableCode: normalizedTableCode,
      tableNumber: normalizedTableNumber,
      locationId: normalizedLocationId,
      image: metadata.image,
      votes: {} as any,
      hasObservation: rawData.hasObservation,
      observationText: rawData.observationText,
    };

    if (rawData.votes?.parties) {
      ballotData.votes.parties = {
        validVotes: rawData.votes.parties.validVotes,
        nullVotes: rawData.votes.parties.nullVotes,
        blankVotes: rawData.votes.parties.blankVotes,
        partyVotes: rawData.votes.parties.partyVotes.map((pv: any) => ({
          partyId: pv.partyId,
          votes: pv.votes,
        })),
      };
    }

    if (rawData.votes?.deputies) {
      ballotData.votes.deputies = {
        validVotes: rawData.votes.deputies.validVotes,
        nullVotes: rawData.votes.deputies.nullVotes,
        blankVotes: rawData.votes.deputies.blankVotes,
        partyVotes: rawData.votes.deputies.partyVotes.map((pv: any) => ({
          partyId: pv.partyId,
          votes: pv.votes,
        })),
      };
    }

    return ballotData;
  }

  private resolveObservationData(
    createDto: CreateBallotFromIpfsDto,
    ballotData: BallotDataFromIpfs,
  ): {
    hasObservation: boolean;
    observationText?: string;
  } {
    const candidateTextRaw = createDto.observationText ?? ballotData.observationText;
    const candidateText = this.normalizeObservationText(candidateTextRaw);

    let hasObservation: boolean;
    if (typeof createDto.hasObservation === 'boolean') {
      hasObservation = createDto.hasObservation;
    } else if (typeof ballotData.hasObservation === 'boolean') {
      hasObservation = ballotData.hasObservation;
    } else {
      hasObservation = this.isObservationFromText(candidateTextRaw);
    }

    if (hasObservation && !candidateText) {
      throw new BadRequestException(
        'observationText es obligatorio cuando hasObservation=true',
      );
    }

    if (!hasObservation) {
      return {
        hasObservation: false,
      };
    }

    return {
      hasObservation: true,
      observationText: candidateText,
    };
  }

  private normalizeObservationText(text?: string): string | undefined {
    if (!text) return undefined;
    const normalized = String(text).trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private isObservationFromText(text?: string): boolean {
    const normalized = this.normalizeComparableText(text);
    if (!normalized) return false;
    return normalized !== 'correyvale';
  }

  private normalizeComparableText(text?: string): string {
    if (!text) return '';
    return String(text)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .trim();
  }

  private async validateBallotData(
    data: BallotDataFromIpfs,
    electionId?: Types.ObjectId,
  ): Promise<void> {
    const errors: string[] = [];

    // Validar estructura básica
    if (!data.tableCode || !data.locationId) {
      errors.push('Faltan campos básicos: tableCode o locationId');
    }

    // Validar estructura de votos
    if (!data.votes || (!data.votes.parties && !data.votes.deputies)) {
      errors.push('Debe enviar al menos una categoría de votos');
    } else {
      // Validar votos de presidentes
      if (data.votes.parties) {
        const partiesErrors = this.validateVotingCategory(
          data.votes.parties,
          'presidentes',
        );
        errors.push(...partiesErrors);
      }

      // Validar votos de diputados
      if (data.votes.deputies) {
        const deputiesErrors = this.validateVotingCategory(
          data.votes.deputies,
          'diputados',
        );
        errors.push(...deputiesErrors);
      }
    }

    // Validar que el recinto electoral existe
    try {
      await this.electoralLocationService.findOne(data.locationId);
    } catch (error) {
      errors.push('El recinto electoral especificado no existe');
    }

    // Validar partidos con filtrado territorial
    try {
      const partyIds = [
        ...(data.votes?.parties?.partyVotes ?? []).map((pv) => pv.partyId),
        ...(data.votes?.deputies?.partyVotes ?? []).map((pv) => pv.partyId),
      ];
      const uniqueIds = Array.from(new Set(partyIds)).filter(Boolean);

      if (uniqueIds.length > 0 && electionId) {
        // Obtener detalles de la ubicación para validación territorial
        const location =
          await this.electoralLocationService.findOneWithHierarchy(
            data.locationId,
          );

        const departmentId = location.department?._id
          ? String(location.department._id)
          : undefined;
        const municipalityId = location.municipality?._id
          ? String(location.municipality._id)
          : undefined;

        // Validar que los partidos estén habilitados para esta elección Y territorio
        const ok =
          await this.politicalPartyService.validatePartyIdsForElection(
            electionId,
            uniqueIds,
            departmentId,
            municipalityId,
          );

        if (!ok) {
          const territoryName = municipalityId
            ? `municipio ${location.municipality?.name}`
            : departmentId
              ? `departamento ${location.department?.name}`
              : 'nivel nacional';
          errors.push(
            `Uno o más partidos no están habilitados para esta elección en ${territoryName}`,
          );
        }
      } else if (uniqueIds.length > 0 && !electionId) {
        // Fallback: validar solo que los partidos existan (sin elección específica)
        const ok = await this.politicalPartyService.validatePartyIds(uniqueIds);
        if (!ok) errors.push('IDs de partido inválidos o inactivos');
      }
    } catch (error) {
      errors.push(
        `Error validando IDs de partido: ${error.message || 'desconocido'}`,
      );
    }

    if (errors.length > 0) {
      throw new BadRequestException(
        `Errores de validación: ${errors.join(', ')}`,
      );
    }
  }

  private validateVotingCategory(
    category: VotingCategoryData,
    categoryName: string,
  ): string[] {
    const errors: string[] = [];

    // Validar campos numéricos
    if (typeof category.validVotes !== 'number' || category.validVotes < 0) {
      errors.push(`Votos válidos inválidos en ${categoryName}`);
    }

    if (typeof category.nullVotes !== 'number' || category.nullVotes < 0) {
      errors.push(`Votos nulos inválidos en ${categoryName}`);
    }

    if (typeof category.blankVotes !== 'number' || category.blankVotes < 0) {
      errors.push(`Votos en blanco inválidos en ${categoryName}`);
    }

    // Validar votos por partido
    if (!Array.isArray(category.partyVotes)) {
      errors.push(`Lista de votos por partido inválida en ${categoryName}`);
    } else {
      category.partyVotes.forEach((partyVote, index) => {
        if (!partyVote.partyId || typeof partyVote.partyId !== 'string') {
          errors.push(
            `ID de partido inválido en ${categoryName}, posición ${index}`,
          );
        }
        if (typeof partyVote.votes !== 'number' || partyVote.votes < 0) {
          errors.push(
            `Votos de partido inválidos en ${categoryName}, posición ${index}`,
          );
        }
      });
    }

    // Validar consistencia de datos
    const totalPartyVotes = category.partyVotes.reduce(
      (sum, pv) => sum + pv.votes,
      0,
    );
    if (totalPartyVotes !== category.validVotes) {
      errors.push(
        `La suma de votos por partido (${totalPartyVotes}) no coincide con votos válidos (${category.validVotes}) en ${categoryName}`,
      );
    }

    return errors;
  }

  /**
   * Obtener todas las versiones de un acta por tableCode
   */
  async findVersionsByTableCode(
    tableCode: string,
    electionId?: string,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ) {
    const eid = await this.resolveElectionId(electionId, true);
    const filter: any = { electionId: eid, tableCode };

    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      filter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      filter['location.municipality'] = munName;
    }
    return this.ballotModel
      .find(filter)
      .sort({ version: -1, createdAt: -1 })
      .populate('electoralLocationId', 'name code address')
      .exec();
  }

  private async getLocationDetails(locationId: string): Promise<any> {
    try {
      const location =
        await this.electoralLocationService.findOneWithHierarchy(locationId);

      return {
        department: location.department.name,
        province: location.province.name,
        municipality: location.municipality.name,
        electoralSeat: location.electoralSeat.name,
        electoralLocationName: location.name,
        district: location.district,
        zone: location.zone,
        circunscripcion: {
          number: location.circunscripcion.number,
          type: location.circunscripcion.type,
          name: location.circunscripcion.name,
        },
      };
    } catch (error) {
      throw new NotFoundException('Recinto electoral no encontrado');
    }
  }

  private extractCidFromUri(uri: string): string {
    // Extraer CID de diferentes formatos de URI IPFS
    const patterns = [
      /ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/,
      /gateway\.pinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
      /([Qm][a-zA-Z0-9]{44,})/,
      /([a-z0-9]{46,})/i, // CIDv1
    ];

    for (const pattern of patterns) {
      const match = uri.match(pattern);
      if (match) {
        return match[1];
      }
    }

    throw new BadRequestException('No se pudo extraer CID de la URI');
  }

  async findAll(
    query: BallotQueryDto,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ): Promise<{
    data: Ballot[];
    total: number;
    page: number;
    pages: number;
  }> {
    const filter: any = {};
    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      filter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      filter['location.municipality'] = munName;
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.department) {
      filter['location.department'] = query.department;
    }

    if (query.province) {
      filter['location.province'] = query.province;
    }

    if (query.municipality) {
      filter['location.municipality'] = query.municipality;
    }

    if (query.circunscripcionType) {
      filter['location.circunscripcion.type'] = query.circunscripcionType;
    }
    const eid = await this.resolveElectionId(query.electionId);
    if (eid) filter.electionId = eid;

    const page = query.page || 1;
    const limit = query.limit || 200;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.ballotModel
        .find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .exec(),
      this.ballotModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async getStats(
    electionId?: string,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ): Promise<BallotStatsDto> {
    const territorialFilter: any = {};

    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      territorialFilter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      territorialFilter['location.municipality'] = munName;
    }

    const eid = await this.resolveElectionId(electionId);
    const eidFilter = eid ? { electionId: eid } : {};

    const baseFilter = { ...eidFilter, ...territorialFilter };
    const totalTables = await this.electoralTableService.countTotal();
    const [processed, pending, synced, error] = await Promise.all([
      this.ballotModel.countDocuments({ ...baseFilter, status: 'processed' }),
      this.ballotModel.countDocuments({ ...baseFilter, status: 'pending' }),
      this.ballotModel.countDocuments({ ...baseFilter, status: 'synced' }),
      this.ballotModel.countDocuments({ ...baseFilter, status: 'error' }),
    ]);

    const processedTotal = processed + synced;
    const completionPercentage =
      totalTables > 0
        ? Math.round((processedTotal / totalTables) * 10000) / 100
        : 0;

    return {
      totalTables,
      processedTables: processedTotal,
      pendingTables: pending,
      syncedTables: synced,
      errorTables: error,
      completionPercentage,
    };
  }

  async findOne(
    id: string,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ): Promise<Ballot> {
    const filter: any = { _id: new Types.ObjectId(id) };

    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      filter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      filter['location.municipality'] = munName;
    }

    const ballot = await this.ballotModel.findOne(filter).exec();
    if (!ballot) {
      throw new NotFoundException('Acta no encontrada');
    }
    return ballot;
  }

  async findByTableCode(
    tableCode: string,
    electionId?: string,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ) {
    const eid = await this.resolveElectionId(electionId, true);

    const filter: any = { electionId: eid, tableCode };

    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      filter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      filter['location.municipality'] = munName;
    }
    const ballots = await this.ballotModel.find(filter).exec();
    if (!ballots?.length) throw new NotFoundException('Acta no encontrada');
    return ballots;
  }

  async findByNearestLocation(
    latitude: number,
    longitude: number,
    maxDistance: number = 5000,
    electionId?: string,
    userDepartmentId?: string,
    userMunicipalityId?: string,
    userRole?: string,
  ): Promise<{
    location: any;
    ballots: Ballot[];
    stats: any;
  }> {
    // 1. Encontrar el recinto electoral más cercano
    const nearestLocation =
      await this.electoralLocationService.findNearestLocation(
        latitude,
        longitude,
        maxDistance,
      );

    if (!nearestLocation) {
      throw new NotFoundException(
        `No se encontró ningún recinto electoral en un radio de ${maxDistance} metros`,
      );
    }

    const eid = await this.resolveElectionId(electionId, true);
    const filter: any = {
      electoralLocationId: nearestLocation._id.toString(),
      electionId: eid,
    };

    if (userDepartmentId && userRole === 'GOVERNOR') {
      const deptName = await this.getDepartmentNameById(userDepartmentId);
      filter['location.department'] = deptName;
    }

    if (userMunicipalityId && userRole === 'MAYOR') {
      const munName = await this.getMunicipalityNameById(userMunicipalityId);
      filter['location.municipality'] = munName;
    }
    const ballots = await this.ballotModel
      .find(filter)
      .sort({ tableNumber: 1 })
      .exec();
    if (!ballots.length && (userDepartmentId || userMunicipalityId)) {
      throw new NotFoundException('No tiene acceso a actas de este recinto');
    }
    const totalTables = await this.electoralTableService.countByLocation(
      nearestLocation._id.toString(),
    );

    const processedTables = ballots.filter(
      (b) => b.status === 'processed' || b.status === 'synced',
    ).length;

    const completionPercentage =
      totalTables > 0
        ? Math.round((processedTables / totalTables) * 10000) / 100
        : 0;

    return {
      location: {
        _id: nearestLocation._id,
        name: nearestLocation.name,
        address: nearestLocation.address,
        district: nearestLocation.district,
        zone: nearestLocation.zone,
        distance: nearestLocation.distance,
        coordinates: {
          latitude: nearestLocation.coordinates.latitude,
          longitude: nearestLocation.coordinates.longitude,
        },
      },
      ballots,
      stats: {
        totalTables,
        processedTables,
        completionPercentage,
      },
    };
  }
}

