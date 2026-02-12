import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UsersService } from '@/modules/users/services/users.service';
import { ElectoralTableService } from '@/modules/geographic/services/electoral-table.service';
import { ElectionConfigService } from '@/modules/elections/services/election-config.service';
import {
  CompareWorksheetDto,
  CompareWorksheetResponseDto,
  CreateWorksheetFromIpfsDto,
  RetryWorksheetFromIpfsDto,
  WorksheetCompareStatus,
  WorksheetVotesDto,
} from '../dto/worksheet.dto';
import {
  Worksheet,
  WorksheetDocument,
  WorksheetStatus,
} from '../schemas/worksheet.schema';

interface OpenSeaMetadata {
  image?: string;
  data?: {
    tableCode?: string;
    tableNumber?: string;
    locationId?: string;
    image?: string;
    votes?: WorksheetVotesDto;
  };
}

interface WorksheetExtractedData {
  tableCode?: string;
  tableNumber?: string;
  locationId?: string;
  image?: string;
  votes?: WorksheetVotesDto;
}

interface VoteDifference {
  field: string;
  worksheetValue: number | null;
  ballotValue: number | null;
}

@Injectable()
export class WorksheetService {
  constructor(
    @InjectModel(Worksheet.name)
    private readonly worksheetModel: Model<WorksheetDocument>,
    private readonly usersService: UsersService,
    private readonly electoralTableService: ElectoralTableService,
    private readonly electionConfigService: ElectionConfigService,
  ) {}

  async createFromIpfs(dto: CreateWorksheetFromIpfsDto): Promise<Worksheet> {
    return this.processFromIpfs(dto, false);
  }

  async retryFailedFromIpfs(dto: RetryWorksheetFromIpfsDto): Promise<Worksheet> {
    return this.processFromIpfs(dto, true);
  }

  async getStatusByTable(
    dni: string,
    electionId: string,
    tableCode: string,
  ): Promise<Worksheet | null> {
    const normalizedDni = this.normalizeDni(dni);
    const normalizedTableCode = this.normalizeTableCode(tableCode);
    const electionObjectId = await this.resolveElectionId(electionId);

    return this.worksheetModel
      .findOne({
        dni: normalizedDni,
        electionId: electionObjectId,
        tableCode: normalizedTableCode,
      })
      .lean();
  }

  async compareAgainstWorksheet(
    dto: CompareWorksheetDto,
  ): Promise<CompareWorksheetResponseDto> {
    const normalizedDni = this.normalizeDni(dto.dni);
    const normalizedTableCode = this.normalizeTableCode(dto.tableCode);
    const electionObjectId = await this.resolveElectionId(dto.electionId);

    const worksheet = await this.worksheetModel.findOne({
      dni: normalizedDni,
      electionId: electionObjectId,
      tableCode: normalizedTableCode,
    });

    if (!worksheet) {
      return {
        status: WorksheetCompareStatus.NOT_FOUND,
        differences: [],
      };
    }

    if (worksheet.status !== WorksheetStatus.UPLOADED || !worksheet.votes) {
      return {
        status: WorksheetCompareStatus.NOT_AVAILABLE,
        worksheetStatus: worksheet.status,
        differences: [],
      };
    }

    const differences = this.compareVotes(worksheet.votes as any, dto.votes);

    return {
      status:
        differences.length > 0
          ? WorksheetCompareStatus.MISMATCH
          : WorksheetCompareStatus.MATCH,
      worksheetStatus: worksheet.status,
      differences,
    };
  }

  private async processFromIpfs(
    dto: CreateWorksheetFromIpfsDto,
    retryOnlyFailed: boolean,
  ): Promise<Worksheet> {
    const normalizedDni = this.normalizeDni(dto.dni);
    const electionObjectId = await this.resolveElectionId(dto.electionId);
    const normalizedTableCodeFallback = this.normalizeTableCode(dto.tableCode);

    let existing: WorksheetDocument | null = null;
    if (normalizedTableCodeFallback) {
      existing = await this.worksheetModel.findOne({
        dni: normalizedDni,
        electionId: electionObjectId,
        tableCode: normalizedTableCodeFallback,
      });
    }

    if (retryOnlyFailed) {
      if (!normalizedTableCodeFallback) {
        throw new BadRequestException('tableCode es requerido para reintentar');
      }
      if (!existing) {
        throw new NotFoundException(
          'No existe hoja de trabajo fallida para reintentar',
        );
      }
      if (existing.status !== WorksheetStatus.FAILED) {
        throw new BadRequestException(
          `Solo se puede reintentar una hoja en estado ${WorksheetStatus.FAILED}`,
        );
      }
    }

    try {
      const ipfsMetadata = await this.fetchFromIpfs(dto.ipfsUri);
      const extractedData = this.extractWorksheetData(ipfsMetadata);
      const mergedData = this.mergeWorksheetData(extractedData, dto);

      const normalizedTableCode = this.normalizeTableCode(mergedData.tableCode);
      if (!normalizedTableCode) {
        throw new BadRequestException(
          'No se pudo determinar el tableCode de la hoja de trabajo',
        );
      }

      const user = await this.usersService.findOrCreateByDni(normalizedDni);

      existing =
        existing ??
        (await this.worksheetModel.findOne({
          dni: normalizedDni,
          electionId: electionObjectId,
          tableCode: normalizedTableCode,
        }));

      if (existing && !retryOnlyFailed) {
        if (existing.status === WorksheetStatus.UPLOADED) {
          throw new ConflictException(
            'La hoja de trabajo ya fue subida para esta mesa y elección',
          );
        }
        if (existing.status === WorksheetStatus.PENDING) {
          throw new ConflictException(
            'La hoja de trabajo ya está pendiente de subida',
          );
        }
      }

      if (retryOnlyFailed && (!existing || existing.status !== WorksheetStatus.FAILED)) {
        throw new BadRequestException(
          'La hoja de trabajo no está en estado fallido para reintento',
        );
      }

      await this.validateWorksheetData(mergedData, electionObjectId);

      const now = new Date();
      const payload: Partial<Worksheet> = {
        userId: user._id,
        dni: normalizedDni,
        electionId: electionObjectId,
        tableCode: normalizedTableCode,
        tableNumber: mergedData.tableNumber,
        electoralLocationId: this.asObjectId(mergedData.locationId),
        votes: mergedData.votes as any,
        image: mergedData.image,
        ipfsUri: dto.ipfsUri,
        ipfsCid: this.extractCidFromUri(dto.ipfsUri),
        recordId: dto.recordId,
        tableIdIpfs: dto.tableIdIpfs,
        nftLink: dto.nftLink,
        status: WorksheetStatus.UPLOADED,
        errorMessage: undefined,
        lastAttemptAt: now,
        uploadedAt: now,
      };

      if (existing) {
        existing.userId = payload.userId as Types.ObjectId;
        existing.dni = payload.dni as string;
        existing.electionId = payload.electionId as Types.ObjectId;
        existing.tableCode = payload.tableCode as string;
        existing.tableNumber = payload.tableNumber;
        existing.electoralLocationId = payload.electoralLocationId;
        existing.votes = payload.votes as any;
        existing.image = payload.image;
        existing.ipfsUri = payload.ipfsUri as string;
        existing.ipfsCid = payload.ipfsCid;
        existing.recordId = payload.recordId;
        existing.tableIdIpfs = payload.tableIdIpfs;
        existing.nftLink = payload.nftLink;
        existing.status = WorksheetStatus.UPLOADED;
        existing.errorMessage = undefined;
        existing.lastAttemptAt = now;
        existing.uploadedAt = now;
        if (retryOnlyFailed || existing.retryCount > 0) {
          existing.retryCount = (existing.retryCount ?? 0) + 1;
        }
        return existing.save();
      }

      const created = new this.worksheetModel({
        ...payload,
        retryCount: 0,
      });
      return created.save();
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      await this.saveFailedAttempt(
        dto,
        normalizedDni,
        electionObjectId,
        existing,
        this.parseErrorMessage(error),
      );
      throw error;
    }
  }

  private async saveFailedAttempt(
    dto: CreateWorksheetFromIpfsDto,
    dni: string,
    electionId: Types.ObjectId,
    existing: WorksheetDocument | null,
    errorMessage: string,
  ): Promise<void> {
    const normalizedTableCode = this.normalizeTableCode(
      existing?.tableCode ?? dto.tableCode,
    );
    if (!normalizedTableCode) return;

    const user = await this.usersService.findOrCreateByDni(dni);
    const now = new Date();

    if (existing && existing.status === WorksheetStatus.UPLOADED) {
      return;
    }

    const payload: Partial<Worksheet> = {
      userId: user._id,
      dni,
      electionId,
      tableCode: normalizedTableCode,
      tableNumber: dto.tableNumber ?? existing?.tableNumber,
      electoralLocationId:
        this.asObjectId(dto.locationId) ?? existing?.electoralLocationId,
      votes: (dto.votes as any) ?? existing?.votes,
      image: dto.image ?? existing?.image,
      ipfsUri: dto.ipfsUri ?? existing?.ipfsUri,
      ipfsCid: dto.ipfsUri ? this.tryExtractCid(dto.ipfsUri) : existing?.ipfsCid,
      recordId: dto.recordId ?? existing?.recordId,
      tableIdIpfs: dto.tableIdIpfs ?? existing?.tableIdIpfs,
      nftLink: dto.nftLink ?? existing?.nftLink,
      status: WorksheetStatus.FAILED,
      errorMessage,
      lastAttemptAt: now,
      uploadedAt: existing?.uploadedAt,
    };

    if (existing) {
      existing.userId = payload.userId as Types.ObjectId;
      existing.dni = payload.dni as string;
      existing.electionId = payload.electionId as Types.ObjectId;
      existing.tableCode = payload.tableCode as string;
      existing.tableNumber = payload.tableNumber;
      existing.electoralLocationId = payload.electoralLocationId;
      existing.votes = payload.votes as any;
      existing.image = payload.image;
      existing.ipfsUri = payload.ipfsUri as string;
      existing.ipfsCid = payload.ipfsCid;
      existing.recordId = payload.recordId;
      existing.tableIdIpfs = payload.tableIdIpfs;
      existing.nftLink = payload.nftLink;
      existing.status = WorksheetStatus.FAILED;
      existing.errorMessage = errorMessage;
      existing.lastAttemptAt = now;
      existing.retryCount = (existing.retryCount ?? 0) + 1;
      await existing.save();
      return;
    }

    try {
      await this.worksheetModel.create({
        ...payload,
        retryCount: 0,
      });
    } catch (createError: any) {
      if (createError?.code === 11000) {
        await this.worksheetModel.updateOne(
          { dni, electionId, tableCode: normalizedTableCode },
          {
            $set: {
              status: WorksheetStatus.FAILED,
              errorMessage,
              lastAttemptAt: now,
              ipfsUri: payload.ipfsUri,
            },
            $inc: { retryCount: 1 },
          },
        );
      } else {
        throw createError;
      }
    }
  }

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
            if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
              break;
            }
          } catch {}
        }
      }

      if (!(text.trim().startsWith('{') || text.trim().startsWith('['))) {
        throw new Error('Respuesta no JSON desde IPFS');
      }

      return JSON.parse(text) as OpenSeaMetadata;
    } catch {
      throw new BadRequestException('Error al obtener datos de IPFS');
    }
  }

  private extractWorksheetData(metadata: OpenSeaMetadata): WorksheetExtractedData {
    if (!metadata.data) {
      throw new BadRequestException(
        'Formato de metadata inválido: no se encontró el campo data',
      );
    }

    return {
      tableCode: metadata.data.tableCode,
      tableNumber: metadata.data.tableNumber,
      locationId: metadata.data.locationId,
      image: metadata.image ?? metadata.data.image,
      votes: metadata.data.votes,
    };
  }

  private mergeWorksheetData(
    extracted: WorksheetExtractedData,
    dto: CreateWorksheetFromIpfsDto,
  ): WorksheetExtractedData {
    return {
      tableCode: extracted.tableCode ?? dto.tableCode,
      tableNumber: extracted.tableNumber ?? dto.tableNumber,
      locationId: extracted.locationId ?? dto.locationId,
      image: extracted.image ?? dto.image,
      votes: extracted.votes ?? dto.votes,
    };
  }

  private async validateWorksheetData(
    data: WorksheetExtractedData,
    electionId: Types.ObjectId,
  ): Promise<void> {
    const errors: string[] = [];

    if (!data.tableCode) {
      errors.push('tableCode es requerido');
    }
    if (!data.tableNumber) {
      errors.push('tableNumber es requerido');
    }
    if (!data.votes || (!data.votes.parties && !data.votes.deputies)) {
      errors.push('Debe incluir al menos una categoría de votos');
    }

    if (data.votes?.parties) {
      errors.push(...this.validateVotingCategory(data.votes.parties, 'parties'));
    }
    if (data.votes?.deputies) {
      errors.push(...this.validateVotingCategory(data.votes.deputies, 'deputies'));
    }

    try {
      await this.electionConfigService.findOne(electionId.toString());
    } catch {
      errors.push('La elección indicada no existe');
    }

    try {
      const table = await this.electoralTableService.findByTableCode(
        data.tableCode ?? '',
      );
      if (data.locationId) {
        const tableLocationId = String((table as any).electoralLocationId ?? '');
        if (tableLocationId && tableLocationId !== String(data.locationId)) {
          errors.push(
            'La mesa seleccionada no pertenece al recinto indicado en la hoja',
          );
        }
      }
    } catch {
      errors.push('TABLE_NOT_FOUND_OR_MISMATCH');
    }

    if (errors.length > 0) {
      throw new BadRequestException(`Errores de validación: ${errors.join(', ')}`);
    }
  }

  private validateVotingCategory(
    category: {
      validVotes: number;
      nullVotes: number;
      blankVotes: number;
      partyVotes: Array<{ partyId: string; votes: number }>;
    },
    categoryName: string,
  ): string[] {
    const errors: string[] = [];

    if (typeof category.validVotes !== 'number' || category.validVotes < 0) {
      errors.push(`validVotes inválido en ${categoryName}`);
    }
    if (typeof category.nullVotes !== 'number' || category.nullVotes < 0) {
      errors.push(`nullVotes inválido en ${categoryName}`);
    }
    if (typeof category.blankVotes !== 'number' || category.blankVotes < 0) {
      errors.push(`blankVotes inválido en ${categoryName}`);
    }

    if (!Array.isArray(category.partyVotes)) {
      errors.push(`partyVotes inválido en ${categoryName}`);
      return errors;
    }

    let partyVotesTotal = 0;
    category.partyVotes.forEach((item, idx) => {
      if (!item.partyId || typeof item.partyId !== 'string') {
        errors.push(`partyId inválido en ${categoryName}, posición ${idx}`);
      }
      if (typeof item.votes !== 'number' || item.votes < 0) {
        errors.push(`votes inválido en ${categoryName}, posición ${idx}`);
      }
      partyVotesTotal += Number(item.votes || 0);
    });

    if (partyVotesTotal !== category.validVotes) {
      errors.push(
        `Suma de partyVotes (${partyVotesTotal}) no coincide con validVotes (${category.validVotes}) en ${categoryName}`,
      );
    }

    return errors;
  }

  private compareVotes(
    worksheetVotes: WorksheetVotesDto,
    ballotVotes: WorksheetVotesDto,
  ): VoteDifference[] {
    const differences: VoteDifference[] = [];
    const categories: Array<'parties' | 'deputies'> = ['parties', 'deputies'];
    const summaryFields: Array<'validVotes' | 'nullVotes' | 'blankVotes' | 'totalVotes'> = [
      'validVotes',
      'nullVotes',
      'blankVotes',
      'totalVotes',
    ];

    for (const category of categories) {
      const worksheetCategory = worksheetVotes?.[category];
      const ballotCategory = ballotVotes?.[category];

      if (!worksheetCategory && !ballotCategory) continue;

      if (!worksheetCategory || !ballotCategory) {
        differences.push({
          field: category,
          worksheetValue: worksheetCategory ? 1 : null,
          ballotValue: ballotCategory ? 1 : null,
        });
        continue;
      }

      for (const field of summaryFields) {
        const worksheetValue = this.toComparableNumber(
          (worksheetCategory as any)[field],
        );
        const ballotValue = this.toComparableNumber((ballotCategory as any)[field]);

        if (field === 'totalVotes' && worksheetValue === null && ballotValue === null) {
          continue;
        }

        if (worksheetValue !== ballotValue) {
          differences.push({
            field: `${category}.${field}`,
            worksheetValue,
            ballotValue,
          });
        }
      }

      const worksheetByParty = new Map<string, number>();
      const ballotByParty = new Map<string, number>();

      for (const item of worksheetCategory.partyVotes ?? []) {
        const key = String(item.partyId).trim();
        worksheetByParty.set(key, Number(item.votes ?? 0));
      }

      for (const item of ballotCategory.partyVotes ?? []) {
        const key = String(item.partyId).trim();
        ballotByParty.set(key, Number(item.votes ?? 0));
      }

      const allPartyIds = new Set<string>([
        ...worksheetByParty.keys(),
        ...ballotByParty.keys(),
      ]);

      for (const partyId of allPartyIds) {
        const worksheetValue = worksheetByParty.get(partyId) ?? 0;
        const ballotValue = ballotByParty.get(partyId) ?? 0;

        if (worksheetValue !== ballotValue) {
          differences.push({
            field: `${category}.partyVotes.${partyId}`,
            worksheetValue,
            ballotValue,
          });
        }
      }
    }

    return differences;
  }

  private async resolveElectionId(electionId: string): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(electionId)) {
      throw new BadRequestException('electionId inválido');
    }

    await this.electionConfigService.findOne(electionId);
    return new Types.ObjectId(electionId);
  }

  private normalizeDni(dni: string): string {
    return String(dni ?? '').trim();
  }

  private normalizeTableCode(tableCode?: string): string {
    const value = String(tableCode ?? '').trim();
    return value || '';
  }

  private asObjectId(value?: string): Types.ObjectId | undefined {
    if (!value) return undefined;
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
  }

  private parseErrorMessage(error: any): string {
    if (typeof error?.message === 'string' && error.message.length > 0) {
      return error.message;
    }
    return 'Error no controlado al procesar la hoja de trabajo';
  }

  private toComparableNumber(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private tryExtractCid(uri: string): string | undefined {
    try {
      return this.extractCidFromUri(uri);
    } catch {
      return undefined;
    }
  }

  private extractCidFromUri(uri: string): string {
    const patterns = [
      /ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/,
      /gateway\.pinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
      /([Qm][a-zA-Z0-9]{44,})/,
      /([a-z0-9]{46,})/i,
    ];

    for (const pattern of patterns) {
      const match = uri.match(pattern);
      if (match) return match[1];
    }

    throw new BadRequestException('No se pudo extraer CID de la URI');
  }
}
