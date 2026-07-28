import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { AddCurrentPadronVoterDto } from '../../dto/padron-current-voter.dto';
import {
  BulkDeletePadronStagingEntriesDto,
  CreatePadronStagingEntryDto,
  UpdatePadronStagingEntryDto,
} from '../../dto/padron-staging-entry.dto';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import {
  ComparisonReport,
  ComparisonReportDocument,
} from '../../schemas/comparison-report.schema';
import {
  PadronImportJob,
  PadronImportJobDocument,
  PadronImportError,
} from '../../schemas/padron-import-job.schema';
import {
  PadronStagingEntry,
  PadronStagingEntryDocument,
} from '../../schemas/padron-staging-entry.schema';
import {
  PadronCertificate,
  PadronCertificateDocument,
  PadronCertificateGenerationMode,
} from '../../schemas/padron-certificate.schema';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '../../schemas/padron-version.schema';
import { PadronCertificatePdfService } from '../core/padron-certificate-pdf.service';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import {
  PadronPdfParserService,
  ParsedPadronRow,
} from '../core/padron-pdf-parser.service';
import { PadronGeminiImportService } from '../core/padron-gemini-import.service';
import { InstitutionalVotingNotificationsService } from '../notifications/institutional-voting-notifications.service';
import { IssuerService } from '../core/issuer.service';
import { EnabledSession, EnabledSessionDocument } from '../../schemas/enabled-session.shcema';
import { VoteWritterService } from '../core/vote-writter.service';

const ENABLED_HEADER = 'habilitado';

type NormalizedImportEntry = {
  ciNorm: string;
  enabled: boolean;
  sourceRow?: number | null;
};

type PadronStagingMutationOptions = {
  deferMaterialization?: boolean;
};

@Injectable()
export class PadronService {
  private readonly materializationLocks = new Map<string, Promise<void>>();

  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    @InjectModel(PadronImportJob.name)
    private readonly padronImportJobModel: Model<PadronImportJobDocument>,
    @InjectModel(PadronStagingEntry.name)
    private readonly padronStagingEntryModel: Model<PadronStagingEntryDocument>,
    @InjectModel(PadronCertificate.name)
    private readonly padronCertificateModel: Model<PadronCertificateDocument>,
    @InjectModel(EnabledSession.name)
    private readonly enabledSessionModel: Model<EnabledSessionDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly padronCertificatePdfService: PadronCertificatePdfService,
    private readonly padronPdfParserService: PadronPdfParserService,
    private readonly padronGeminiImportService: PadronGeminiImportService,
    private readonly notificationsService: InstitutionalVotingNotificationsService,
    private readonly issuerService: IssuerService,
    private readonly voteWritterService: VoteWritterService,
  ) {}

  private async withMaterializationLock<T>(
    eventId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.materializationLocks.get(eventId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => undefined).then(() => current);

    this.materializationLocks.set(eventId, chained);
    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      release();
      if (this.materializationLocks.get(eventId) === chained) {
        this.materializationLocks.delete(eventId);
      }
    }
  }

  async uploadPadronFile(eventId: string, file: any, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    await this.assertStructuralEditableState(event, 'subir el padrón');
    this.padronPdfParserService.validateSourceFile(file);

    if (!requester?.sub) {
      throw new ForbiddenException('Usuario no identificado');
    }

    const sourceType = this.padronPdfParserService.getSourceType(file);

    await this.padronImportJobModel.updateMany(
      { eventId: event._id, isActiveDraft: true },
      { $set: { isActiveDraft: false } },
    );

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const importJob = await this.padronImportJobModel.create({
      eventId: event._id,
      tenantId: event.tenantId,
      createdBy: new Types.ObjectId(requester.sub),
      sourceType,
      status: 'PROCESSING',
      isActiveDraft: true,
      originalFileName: file.originalname,
      originalFileMimeType: file.mimetype,
      originalFileSize: file.size,
      originalFileSha256: sha256,
      originalFileContentBase64: file.buffer.toString('base64'),
      summary: {
        parsedCount: 0,
        validCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        stagingCount: 0,
        enabledCount: 0,
        disabledCount: 0,
        missingIdentityCount: 0,
      },
    });

    try {
      const parserResult = await this.padronPdfParserService.parseDocument({
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      });

      const normalized = this.normalizeImportedRows(parserResult.rows);
      const mergedErrors: PadronImportError[] = [
        ...parserResult.errors.map((error) => ({
          code: error.code,
          message: error.message,
          rowIndex: error.rowIndex ?? null,
          rawValue: error.rawValue ?? null,
        })),
        ...normalized.errors,
      ];

      if (normalized.entries.length) {
        const importJobId = this.toObjectId(importJob._id);
        const eventObjectId = this.toObjectId(event._id);
        const tenantObjectId = this.toObjectId(event.tenantId);
        await this.padronStagingEntryModel.insertMany(
          normalized.entries.map((entry) => ({
            importJobId,
            eventId: eventObjectId,
            tenantId: tenantObjectId,
            ciNorm: entry.ciNorm,
            enabled: entry.enabled,
            sourceKind: 'PARSED',
            sourceRow: entry.sourceRow ?? null,
            createdBy: new Types.ObjectId(requester.sub),
            lastEditedBy: new Types.ObjectId(requester.sub),
          })),
          { ordered: false },
        );
      }

      await this.padronImportJobModel.updateOne(
        { _id: importJob._id },
        {
          $set: {
            status: this.resolveImportJobStatus(normalized.entries.length, mergedErrors.length),
            parserProvider: parserResult.provider,
            parserModel: parserResult.model,
            parserUsedFallback: parserResult.usedFallback,
            processedAt: new Date(),
            importErrors: mergedErrors,
            summary: {
              parsedCount: parserResult.rows.length,
              validCount: normalized.entries.length,
              duplicateCount: normalized.duplicateCount,
              invalidCount: normalized.invalidCount,
              stagingCount: normalized.entries.length,
              enabledCount: normalized.entries.filter((entry) => entry.enabled).length,
              disabledCount: normalized.entries.filter((entry) => !entry.enabled).length,
              missingIdentityCount: 0,
            },
          },
        },
      );

      await this.refreshImportJobSummary(importJob._id);
    } catch (error: any) {
      await this.padronImportJobModel.updateOne(
        { _id: importJob._id },
        {
          $set: {
            status: 'FAILED',
            parserProvider: 'local-fallback',
            parserUsedFallback: true,
            processedAt: new Date(),
            importErrors: [
              {
                code: 'PARSER_ERROR',
                message: String(error?.message ?? error ?? 'Error procesando PDF'),
              },
            ],
          },
        },
      );
    }

    return this.getPadronImport(eventId, String(importJob._id), requester);
  }

  async uploadPadronPdf(eventId: string, file: any, requester: any) {
    return this.uploadPadronFile(eventId, file, requester);
  }

  async analyzePadronWithGemini(eventId: string, file: any, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    await this.assertStructuralEditableState(event, 'analizar el padrón');
    this.padronPdfParserService.validateSourceFile(file);

    if (!requester?.sub) {
      throw new ForbiddenException('Usuario no identificado');
    }

    return this.padronGeminiImportService.analyzeDocument(file);
  }

  async getPadronImport(eventId: string, importJobId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    if (!Types.ObjectId.isValid(importJobId)) {
      throw new BadRequestException('importJobId invalido');
    }

    const importJob = await this.padronImportJobModel
      .findOne({
        _id: new Types.ObjectId(importJobId),
        eventId: event._id,
      })
      .lean();

    if (!importJob) {
      throw new NotFoundException('Importación de padrón no encontrada');
    }

    const stagingCount = await this.padronStagingEntryModel.countDocuments({
      importJobId: importJob._id,
    });

    return this.mapImportJob(importJob, stagingCount);
  }

  async listPadronStaging(eventId: string, requester: any, page = 1, limit = 50) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const importJob = await this.getOrCreateEditableDraftFromCurrentVersion(event, requester);
    if (!importJob) {
      return {
        importJob: null,
        data: [],
        page: safePage,
        limit: safeLimit,
        total: 0,
        totalPages: 0,
        editingRules: this.buildPadronEditingRules(event),
      };
    }

    const [rows, total] = await Promise.all([
      this.padronStagingEntryModel
        .find({ importJobId: importJob._id })
        .sort({ ciNorm: 1, _id: 1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.padronStagingEntryModel.countDocuments({ importJobId: importJob._id }),
    ]);

    const data = rows.map((row) => this.mapStagingEntry(row));
    const dids = await this.issuerService.getDidsByDnis(data.map((entry) => entry.ci));

    return {
      importJob: this.mapImportJob(importJob, total),
      data: data.map((entry) => ({
        ...entry,
        hasIdentity: dids.some((did) => did.dni === entry.ci),
      })),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      editingRules: this.buildPadronEditingRules(event),
    };
  }

  async addPadronStagingEntry(
    eventId: string,
    dto: CreatePadronStagingEntryDto,
    requester: any,
    options: PadronStagingMutationOptions = {},
  ) {
    const { event, importJob } = await this.getEditableActiveImportJobContext(
      eventId,
      requester,
      'agregar entradas al staging del padrón',
    );

    const ciNorm = normalizeCarnet(dto.ci);
    if (!ciNorm) {
      throw new BadRequestException('CI inválido');
    }

    const existing = await this.padronStagingEntryModel.exists({
      importJobId: importJob._id,
      ciNorm,
    });
    if (existing) {
      throw new BadRequestException('Ya existe un empadronado con ese CI en el staging');
    }

    const created = await this.padronStagingEntryModel.create({
      importJobId: this.toObjectId(importJob._id),
      eventId: this.toObjectId(event._id),
      tenantId: this.toObjectId(event.tenantId),
      ciNorm,
      enabled: dto.enabled !== false,
      sourceKind: 'MANUAL',
      createdBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
      lastEditedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
    });

    await this.refreshImportJobSummary(importJob._id);
    if (!options.deferMaterialization) {
      await this.materializeAndNotifyConvocationUpdateIfNeeded(eventId, requester, event);
    }

    return this.mapStagingEntry(created.toObject());
  }

  async updatePadronStagingEntry(
    eventId: string,
    entryId: string,
    dto: UpdatePadronStagingEntryDto,
    requester: any,
    options: PadronStagingMutationOptions = {},
  ) {
    const { event, importJob } = await this.getEditableActiveImportJobContext(
      eventId,
      requester,
      'editar entradas del staging del padrón',
    );

    if (!Types.ObjectId.isValid(entryId)) {
      throw new BadRequestException('entryId invalido');
    }

    const entry = await this.padronStagingEntryModel.findOne({
      _id: new Types.ObjectId(entryId),
      importJobId: importJob._id,
    });

    if (!entry) {
      throw new NotFoundException('Entrada de staging no encontrada');
    }

    if (dto.ci !== undefined) {
      const ciNorm = normalizeCarnet(dto.ci);
      if (!ciNorm) {
        throw new BadRequestException('CI inválido');
      }

      const duplicate = await this.padronStagingEntryModel.exists({
        importJobId: importJob._id,
        ciNorm,
        _id: { $ne: entry._id },
      });
      if (duplicate) {
        throw new BadRequestException('Ya existe un empadronado con ese CI en el staging');
      }

      entry.ciNorm = ciNorm;
    }

    if (dto.enabled !== undefined) {
      entry.enabled = dto.enabled;
    }

    if (requester?.sub) {
      entry.lastEditedBy = new Types.ObjectId(requester.sub);
    }

    await entry.save();
    await this.refreshImportJobSummary(importJob._id);
    if (!options.deferMaterialization) {
      await this.materializeAndNotifyConvocationUpdateIfNeeded(eventId, requester, event);
    }

    return this.mapStagingEntry(entry.toObject());
  }

  async deletePadronStagingEntry(
    eventId: string,
    entryId: string,
    requester: any,
    options: PadronStagingMutationOptions = {},
  ) {
    const { event, importJob } = await this.getEditableActiveImportJobContext(
      eventId,
      requester,
      'eliminar entradas del staging del padrón',
    );

    if (!Types.ObjectId.isValid(entryId)) {
      throw new BadRequestException('entryId invalido');
    }

    const deleted = await this.padronStagingEntryModel.findOneAndDelete({
      _id: new Types.ObjectId(entryId),
      importJobId: importJob._id,
    });

    if (!deleted) {
      throw new NotFoundException('Entrada de staging no encontrada');
    }

    await this.refreshImportJobSummary(importJob._id);
    if (!options.deferMaterialization) {
      await this.materializeAndNotifyConvocationUpdateIfNeeded(eventId, requester, event);
    }

    return {
      id: String(deleted._id),
      deleted: true,
    };
  }

  async bulkDeletePadronStagingEntries(
    eventId: string,
    dto: BulkDeletePadronStagingEntriesDto,
    requester: any,
  ) {
    const { event, importJob } = await this.getEditableActiveImportJobContext(
      eventId,
      requester,
      'eliminar registros del padrón',
    );

    const entryIds = Array.from(
      new Set(
        (dto.entryIds ?? [])
          .map((entryId) => String(entryId ?? '').trim())
          .filter((entryId) => entryId.length > 0),
      ),
    );

    if (!entryIds.length) {
      throw new BadRequestException('Selecciona al menos un registro para eliminar.');
    }

    if (entryIds.some((entryId) => !Types.ObjectId.isValid(entryId))) {
      throw new BadRequestException('No se pudieron validar todos los registros seleccionados.');
    }

    const objectIds = entryIds.map((entryId) => new Types.ObjectId(entryId));
    const [matchedEntries, totalBeforeDelete] = await Promise.all([
      this.padronStagingEntryModel
        .find(
          {
            _id: { $in: objectIds },
            importJobId: importJob._id,
          },
          { _id: 1 },
        )
        .lean(),
      this.padronStagingEntryModel.countDocuments({ importJobId: importJob._id }),
    ]);

    if (matchedEntries.length !== objectIds.length) {
      throw new BadRequestException('No se pudieron validar todos los registros seleccionados.');
    }

    if (totalBeforeDelete - objectIds.length <= 0) {
      throw new BadRequestException('No se puede eliminar todos los registros del padrón.');
    }

    const deleteResult = await this.padronStagingEntryModel.deleteMany({
      _id: { $in: objectIds },
      importJobId: importJob._id,
    });
    const deletedCount = Number(deleteResult?.deletedCount ?? 0);

    if (deletedCount !== objectIds.length) {
      throw new BadRequestException('No se pudieron eliminar todos los registros seleccionados.');
    }

    await this.refreshImportJobSummary(importJob._id);

    let materialized = false;
    if (event?.convocationNotifiedAt) {
      const synchronized = await this.materializeActiveDraftVersion(eventId, requester, {
        comparisonStatus: 'OK',
        deactivateDraft: false,
        markConfirmed: false,
        certificateMode: 'ON_CONFIRMATION',
      });
      materialized = Boolean(synchronized);
    }

    return {
      requestedCount: entryIds.length,
      deletedCount,
      materialized,
      convocationNotification: {
        newlyNotified: 0,
      },
    };
  }

  async removeUnregisteredStagingEntriesForOfficialPublication(
    eventId: string,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    await this.assertStructuralEditableState(
      event,
      'preparar el padrón para la publicación oficial',
    );

    const importJob = await this.getActiveImportJob(event._id);
    if (!importJob) {
      return {
        removedCount: 0,
        remainingCount: 0,
      };
    }

    const entries = await this.padronStagingEntryModel
      .find({ importJobId: importJob._id }, { _id: 1, ciNorm: 1 })
      .lean();

    if (!entries.length) {
      throw new BadRequestException('No hay registros del padrón para publicar.');
    }

    const dids = await this.issuerService.getDidsByDnis(
      entries
        .map((entry) => String(entry.ciNorm ?? '').trim())
        .filter((ci) => ci.length > 0),
    );
    const registeredDniSet = new Set(
      dids
        .map((did) => String(did?.dni ?? '').trim())
        .filter((dni) => dni.length > 0),
    );
    const unregisteredEntries = entries.filter(
      (entry) => !registeredDniSet.has(String(entry.ciNorm ?? '').trim()),
    );

    if (!unregisteredEntries.length) {
      await this.refreshImportJobSummary(importJob._id);
      return {
        removedCount: 0,
        remainingCount: entries.length,
      };
    }

    if (entries.length - unregisteredEntries.length <= 0) {
      throw new BadRequestException(
        'No se puede publicar oficialmente porque todos los registros del padrón están no registrados. Debe quedar al menos un registro registrado en el padrón.',
      );
    }

    const objectIds = unregisteredEntries.map((entry) => entry._id);
    const deleteResult = await this.padronStagingEntryModel.deleteMany({
      _id: { $in: objectIds },
      importJobId: importJob._id,
    });
    const removedCount = Number(deleteResult?.deletedCount ?? 0);

    if (removedCount !== objectIds.length) {
      throw new BadRequestException(
        'No se pudieron eliminar los registros no registrados antes de publicar.',
      );
    }

    await this.refreshImportJobSummary(importJob._id);

    return {
      removedCount,
      remainingCount: entries.length - removedCount,
    };
  }

  async addCurrentPadronVoter(
    eventId: string,
    dto: AddCurrentPadronVoterDto,
    requester: any,
  ) {
    await this.getEventForVotingPadronChange(
      eventId,
      requester,
      'agregar nuevos habilitados al padrón en modo limitado',
    );

    void dto;

    throw new BadRequestException(
      'Después de la publicación oficial no se permite agregar nuevos votantes al padrón vigente',
    );
  }

  async enableCurrentPadronVoter(eventId: string, voterId: string, requester: any) {
    const event = await this.getEventForVotingPadronChange(
      eventId,
      requester,
      'habilitar deshabilitados del padrón en modo limitado',
    );

    if (!this.accessService.canEnableExistingPadronEntriesPostPublication(event)) {
      throw new BadRequestException(
        'La habilitación manual desde la tabla está desactivada para esta votación',
      );
    }

    if (!Types.ObjectId.isValid(voterId)) {
      throw new BadRequestException('voterId invalido');
    }

    const currentVersion = await this.resolveCurrentPadronVersionDoc(event._id as Types.ObjectId);
    const voter = await this.padronEntryModel.findOne({
      _id: new Types.ObjectId(voterId),
      padronVersionId: currentVersion._id,
    });

    if (!voter) {
      throw new NotFoundException('Votante no encontrado en el padrón vigente');
    }

    if (voter.enabled === true) {
      return {
        id: String(voter._id),
        padronVersionId: String(currentVersion._id),
        carnetNorm: voter.carnetNorm,
        enabled: true,
        mode: 'VOTING_LIMITED',
      };
    }

    const dids = await this.issuerService.getDidsByDnis([voter.carnetNorm]);
    if (dids.length !== 1 || dids[0].dni !== voter.carnetNorm) {
      throw new NotFoundException('No se encontró al usuario registrado en el servicio de identidad');
    }

    const nullifiers = await this.voteWritterService.addNewVoters(1);
    const credentialData = await this.issuerService.issueCredential(
      dids,
      event._id.toString(),
      nullifiers,
    );

    await this.enabledSessionModel.insertOne({
      eventId: event._id,
      dni: voter.carnetNorm,
      sessionToken: credentialData[voter.carnetNorm].credentialData,
    });

    voter.enabled = true;
    await voter.save();
    await this.invalidateCurrentPadronCertificate(currentVersion._id);
    await this.notificationsService.notifyPadronAvailabilityEnabledForUser(
      event,
      voter.carnetNorm,
      'ENABLED_DURING_VOTING',
    );

    return {
      id: String(voter._id),
      padronVersionId: String(currentVersion._id),
      carnetNorm: voter.carnetNorm,
      enabled: true,
      mode: 'VOTING_LIMITED',
    };
  }

  async confirmPadronStaging(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    const shouldNotifyIncremental = Boolean(event?.convocationNotifiedAt);
    const comparisonStatus = shouldNotifyIncremental ? 'OK' : 'PENDING';

    const synchronized = await this.materializeActiveDraftVersion(eventId, requester, {
      comparisonStatus,
      deactivateDraft: true,
      markConfirmed: true,
      certificateMode: 'ON_CONFIRMATION',
    });

    if (!synchronized) {
      throw new NotFoundException('No existe un staging activo de padrón para este evento');
    }

    if (shouldNotifyIncremental) {
      await this.notificationsService.notifyConvocationIfEligible(synchronized.event);
    }

    return {
      importJobId: String(synchronized.importJob._id),
      padronVersionId: String(synchronized.version._id),
      state: 'CONFIRMED',
      totals: synchronized.version.totals,
      comparisonStatus,
      sourceType: synchronized.version.sourceType ?? 'PDF_IMPORT',
      certificate: this.mapCertificateMetadata(synchronized.certificate),
    };
  }

  private async materializeAndNotifyConvocationUpdateIfNeeded(
    eventId: string,
    requester: any,
    event: any,
  ) {
    if (!event?.convocationNotifiedAt) {
      return;
    }

    const synchronized = await this.materializeActiveDraftVersion(eventId, requester, {
      comparisonStatus: 'OK',
      deactivateDraft: false,
      markConfirmed: false,
      certificateMode: 'ON_CONFIRMATION',
    });

    if (!synchronized) {
      return;
    }

    await this.notificationsService.notifyConvocationIfEligible(synchronized.event);
  }

  async materializeActiveDraftVersion(
    eventId: string,
    requester: any,
    options: {
      comparisonStatus?: 'PENDING' | 'OK' | 'FAILED';
      deactivateDraft?: boolean;
      markConfirmed?: boolean;
      certificateMode?: PadronCertificateGenerationMode;
    } = {},
  ) {
    return this.withMaterializationLock(eventId, () =>
      this.materializeActiveDraftVersionUnlocked(eventId, requester, options),
    );
  }

  private async materializeActiveDraftVersionUnlocked(
    eventId: string,
    requester: any,
    options: {
      comparisonStatus?: 'PENDING' | 'OK' | 'FAILED';
      deactivateDraft?: boolean;
      markConfirmed?: boolean;
      certificateMode?: PadronCertificateGenerationMode;
    } = {},
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const importJob = await this.getActiveImportJob(event._id);
    if (!importJob) {
      return null;
    }

    if (importJob.status === 'PROCESSING') {
      throw new BadRequestException('El padrón todavía se está procesando');
    }

    if (importJob.status === 'FAILED') {
      throw new BadRequestException('El staging activo del padrón tiene errores y no puede materializarse');
    }

    if (!requester?.sub) {
      throw new ForbiddenException('Usuario no identificado');
    }

    await this.refreshImportJobSummary(importJob._id);

    const entries = await this.padronStagingEntryModel
      .find({ importJobId: importJob._id })
      .sort({ ciNorm: 1, _id: 1 })
      .lean();

    if (!entries.length) {
      throw new BadRequestException('No se puede materializar un staging vacío');
    }

    const digest = createHash('sha256')
      .update(entries.map((entry) => `${entry.ciNorm},${entry.enabled ? '1' : '0'}`).join('\n'))
      .digest('hex');
    const currentVersionBeforeMaterialize = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    const version = await this.createCurrentPadronVersion({
      eventId: this.toObjectId(event._id),
      tenantId: this.toObjectId(event.tenantId),
      createdBy: new Types.ObjectId(requester.sub),
      fileDigest: digest,
      entries: entries.map((entry) => ({
        ciNorm: entry.ciNorm,
        enabled: entry.enabled !== false,
      })),
      totals: {
        validCount: entries.length,
        duplicateCount: 0,
        invalidCount: 0,
      },
      comparisonStatus: options.comparisonStatus ?? 'OK',
      sourceType:
        importJob.sourceType === 'IMAGE'
          ? 'IMAGE_IMPORT'
          : importJob.sourceType === 'SYSTEM'
            ? currentVersionBeforeMaterialize?.sourceType ?? 'PDF_IMPORT'
            : 'PDF_IMPORT',
      importJobId: this.toObjectId(importJob._id),
      sourceFileName: importJob.originalFileName,
      sourceFileMimeType: importJob.originalFileMimeType,
      sourceFileSha256: importJob.originalFileSha256,
      parserProvider: importJob.parserProvider,
      parserModel: importJob.parserModel ?? null,
    });

    const importJobSet: Record<string, unknown> = {
      confirmedPadronVersionId: this.toObjectId(version._id),
    };

    if (options.markConfirmed) {
      importJobSet.status = 'CONFIRMED';
      importJobSet.confirmedAt = new Date();
    }

    if (options.deactivateDraft) {
      importJobSet.isActiveDraft = false;
    }

    await this.padronImportJobModel.updateOne(
      { _id: importJob._id },
      {
        $set: importJobSet,
      },
    );

    const certificate = await this.ensurePadronCertificateForVersion(
      event,
      version,
      requester,
      options.certificateMode ?? 'ON_CONFIRMATION',
    );

    return { event, importJob, version, certificate };
  }

  async getPadronSummary(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    const activeImportJob = await this.getOrCreateEditableDraftFromCurrentVersion(event, requester);

    const currentComparison = currentVersion
      ? await this.comparisonReportModel
          .findOne({ padronVersionId: currentVersion._id }, { status: 1 })
          .lean()
      : null;

    const currentCertificate = currentVersion
      ? await this.padronCertificateModel
          .findOne({ padronVersionId: currentVersion._id })
          .lean()
      : null;

    const stagingCount = activeImportJob
      ? await this.padronStagingEntryModel.countDocuments({ importJobId: activeImportJob._id })
      : 0;

    return {
      eventId: String(event._id),
      eventState: event.state,
      editingRules: this.buildPadronEditingRules(event),
      allowPostPublicationPadronEnable:
        event.allowPostPublicationPadronEnable !== false,
      currentVersion: currentVersion
        ? {
            padronVersionId: String(currentVersion._id),
            createdAt: currentVersion.createdAt ?? null,
            createdBy: String(currentVersion.createdBy),
            totals: currentVersion.totals,
            sourceType: currentVersion.sourceType ?? 'CSV_LEGACY',
            importJobId: currentVersion.importJobId ? String(currentVersion.importJobId) : null,
            comparisonStatus: currentComparison?.status ?? 'PENDING',
            certificate: currentCertificate
              ? this.mapCertificateMetadata(currentCertificate)
              : {
                  exists: false,
                  materializable: true,
                },
          }
        : null,
      activeDraft: activeImportJob
        ? this.mapImportJob(activeImportJob, stagingCount)
        : null,
    };
  }

  async importPadron(eventId: string, csvContent: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    await this.assertStructuralEditableState(event, 'importar el padrón');

    if (!requester?.sub) {
      throw new ForbiddenException('Usuario no identificado');
    }

    const lines = String(csvContent)
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim());

    if (lines.length === 0) {
      throw new BadRequestException('CSV vacio');
    }

    const headerColumns = lines[0].split(',').map((cell) => cell.trim().toLowerCase());
    const hasHeader = ['carnet', 'dni'].includes(headerColumns[0]);
    const hasEnabledColumn = headerColumns[1] === ENABLED_HEADER;
    const rows = hasHeader ? lines.slice(1) : lines;

    const seen = new Set<string>();
    const validEntries: { ciNorm: string; enabled: boolean }[] = [];
    let duplicates = 0;
    let invalid = 0;

    for (const raw of rows) {
      if (!raw) continue;
      const [rawCarnet = '', rawEnabled = ''] = raw.split(',');
      const normalized = normalizeCarnet(rawCarnet);
      if (!normalized) {
        invalid++;
        continue;
      }

      const enabled = this.parseEnabledValue(rawEnabled, hasEnabledColumn);
      if (enabled === null) {
        invalid++;
        continue;
      }

      if (seen.has(normalized)) {
        duplicates++;
        continue;
      }

      seen.add(normalized);
      validEntries.push({
        ciNorm: normalized,
        enabled,
      });
    }

    const digest = createHash('sha256').update(csvContent).digest('hex');
    const comparisonStatus =
      validEntries.length > 0 && duplicates === 0 && invalid === 0 ? 'OK' : 'PENDING';

    const version = await this.createCurrentPadronVersion({
      eventId: this.toObjectId(event._id),
      tenantId: this.toObjectId(event.tenantId),
      createdBy: new Types.ObjectId(requester.sub),
      fileDigest: digest,
      entries: validEntries,
      totals: {
        validCount: validEntries.length,
        duplicateCount: duplicates,
        invalidCount: invalid,
      },
      comparisonStatus,
      sourceType: 'CSV_LEGACY',
      sourceFileName: 'legacy-upload.csv',
      sourceFileMimeType: 'text/csv',
      sourceFileSha256: digest,
      parserProvider: 'legacy-csv',
      parserModel: null,
    });

    const certificate = await this.ensurePadronCertificateForVersion(
      event,
      version,
      requester,
      'ON_CONFIRMATION',
    );

    return {
      padronVersionId: String(version._id),
      fileDigest: version.fileDigest,
      createdAt: version.createdAt,
      createdBy: String(version.createdBy),
      tenantId: String(version.tenantId),
      totals: version.totals,
      isCurrent: version.isCurrent,
      sourceType: version.sourceType ?? 'CSV_LEGACY',
      certificate: this.mapCertificateMetadata(certificate),
    };
  }

  async getPadronCertificateMetadata(eventId: string, requester: any, padronVersionId?: string) {
    const { event, version } = await this.getCertificateVersionContext(eventId, requester, padronVersionId);

    if (!version) {
      return {
        exists: false,
        eventId: String(event._id),
        padronVersionId: null,
        materializable: false,
        reason: 'NO_CONFIRMED_PADRON_VERSION',
      };
    }

    const certificate = await this.padronCertificateModel
      .findOne({ padronVersionId: version._id })
      .lean();

    if (!certificate) {
      return {
        exists: false,
        eventId: String(event._id),
        padronVersionId: String(version._id),
        sourceType: version.sourceType ?? 'CSV_LEGACY',
        totals: version.totals,
        materializable: true,
        reason: 'PADRON_CERTIFICATE_NOT_MATERIALIZED',
      };
    }

    return this.mapCertificateMetadata(certificate);
  }

  async materializePadronCertificate(
    eventId: string,
    requester: any,
    padronVersionId?: string,
    forceRegenerate = false,
  ) {
    const { event, version } = await this.getCertificateVersionContext(eventId, requester, padronVersionId);
    if (!version) {
      throw new NotFoundException('No existe una versión confirmada de padrón para materializar constancia');
    }

    const certificate = await this.ensurePadronCertificateForVersion(
      event,
      version,
      requester,
      forceRegenerate ? 'REGENERATED' : 'ON_DEMAND',
      forceRegenerate,
    );

    return this.mapCertificateMetadata(certificate);
  }

  async downloadPadronCertificate(eventId: string, requester: any, padronVersionId?: string) {
    const { event, version } = await this.getCertificateVersionContext(eventId, requester, padronVersionId);
    if (!version) {
      throw new NotFoundException('No existe una versión confirmada de padrón para descargar constancia');
    }

    const certificate = await this.padronCertificateModel
      .findOne(
        { padronVersionId: version._id },
        {
          eventId: 1,
          tenantId: 1,
          padronVersionId: 1,
          generatedAt: 1,
          generationMode: 1,
          fileName: 1,
          mimeType: 1,
          fileSha256: 1,
          fileSize: 1,
          sourceType: 1,
          totalCount: 1,
          enabledCount: 1,
          disabledCount: 1,
          storageKind: 1,
          pdfContentBase64: 1,
        },
      )
      .lean();

    if (!certificate?.pdfContentBase64) {
      throw new NotFoundException('La constancia PDF del padrón aún no está materializada');
    }

    return {
      fileName: certificate.fileName,
      mimeType: certificate.mimeType,
      pdfBuffer: Buffer.from(certificate.pdfContentBase64, 'base64'),
      metadata: this.mapCertificateMetadata(certificate),
    };
  }

  async listPadronVersions(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const versions = await this.padronVersionModel
      .find({ eventId: new Types.ObjectId(eventId) })
      .sort({ createdAt: -1 })
      .lean();

    return {
      data: versions.map((version) => ({
        padronVersionId: String(version._id),
        fileDigest: version.fileDigest,
        createdAt: version.createdAt,
        createdBy: String(version.createdBy),
        totals: version.totals,
        isCurrent: version.isCurrent,
        sourceType: version.sourceType ?? 'CSV_LEGACY',
        importJobId: version.importJobId ? String(version.importJobId) : null,
      })),
      total: versions.length,
    };
  }

  async listCurrentPadronVoters(
    eventId: string,
    requester: any,
    page = 1,
    limit = 50,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const skip = (safePage - 1) * safeLimit;

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    if (!currentVersion) {
      return {
        data: [],
        page: safePage,
        limit: safeLimit,
        total: 0,
        totalPages: 0,
        padronVersionId: null,
        editingRules: this.buildPadronEditingRules(event),
      };
    }

    const [rows, total] = await Promise.all([
      this.padronEntryModel
        .find(
          { padronVersionId: currentVersion._id },
          { _id: 1, carnetNorm: 1, enabled: 1, createdAt: 1 },
        )
        .sort({ carnetNorm: 1, _id: 1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.padronEntryModel.countDocuments({ padronVersionId: currentVersion._id }),
    ]);

    return {
      data: rows.map((row) => ({
        id: String(row._id),
        carnetNorm: row.carnetNorm,
        enabled: row.enabled !== false,
        createdAt: (row as any).createdAt ?? null,
      })),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      padronVersionId: String(currentVersion._id),
      editingRules: this.buildPadronEditingRules(event),
    };
  }

  async getCurrentPadronSummary(
    eventId: string,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    if (!currentVersion) {
      return {
        total: 0,
        enabledToVote: 0,
        disabledToVote: 0,
        editingRules: this.buildPadronEditingRules(event),
      };
    }

    const [total, enabledToVote, disabledToVote] = await Promise.all([
      this.padronEntryModel.countDocuments({ padronVersionId: currentVersion._id }),
      this.padronEntryModel.countDocuments({ padronVersionId: currentVersion._id, enabled: true }),
      this.padronEntryModel.countDocuments({ padronVersionId: currentVersion._id, enabled: false }),
    ]);

    return {
      total,
      enabledToVote,
      disabledToVote,
      editingRules: this.buildPadronEditingRules(event),
    };
  }

  async downloadPadronCsv(eventId: string, requester: any, padronVersionId?: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    const eventObjectId = this.toObjectId(event._id);

    const version = await this.resolvePadronVersion(eventObjectId, padronVersionId);

    const rows = await this.padronEntryModel
      .find(
        { padronVersionId: version._id },
        { carnetNorm: 1, enabled: 1, _id: 0 },
      )
      .sort({ carnetNorm: 1 })
      .lean();

    const csvLines = [
      `carnet,${ENABLED_HEADER}`,
      ...rows.map((row) => `${row.carnetNorm},${row.enabled === false ? 'no' : 'si'}`),
    ];

    return {
      fileName: `padron-${String(version._id)}.csv`,
      csvContent: `\uFEFF${csvLines.join('\n')}`,
      padronVersionId: String(version._id),
      isCurrent: version.isCurrent === true,
    };
  }

  async downloadPadronPdf(eventId: string, requester: any, padronVersionId?: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    if (!this.accessService.isOfficialPublicationConfirmed(event)) {
      throw new BadRequestException(
        'El padrón en PDF solo está disponible después de la publicación oficial',
      );
    }

    const eventObjectId = this.toObjectId(event._id);
    const version = await this.resolvePadronVersion(eventObjectId, padronVersionId);

    const rows = await this.padronEntryModel
      .find(
        { padronVersionId: version._id },
        { carnetNorm: 1, enabled: 1, _id: 0 },
      )
      .sort({ carnetNorm: 1 })
      .lean();

    const totalCount = rows.length;
    const enabledCount = rows.filter((row) => row.enabled !== false).length;
    const disabledCount = totalCount - enabledCount;
    const pdfBuffer = this.padronCertificatePdfService.buildPadronListPdf({
      eventName: event.name,
      generatedAt: new Date(),
      padronVersionId: String(version._id),
      statusLabel: version.isCurrent === true ? 'Padrón vigente' : 'Versión histórica',
      totalCount,
      enabledCount,
      disabledCount,
      entries: rows.map((row) => ({
        ci: row.carnetNorm,
        enabled: row.enabled !== false,
      })),
    });

    return {
      fileName: `padron-${String(version._id)}.pdf`,
      pdfBuffer,
      padronVersionId: String(version._id),
      isCurrent: version.isCurrent === true,
    };
  }

  async checkEligibility(eventId: string, carnet: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    const carnetNorm = normalizeCarnet(carnet);

    if (!carnetNorm) {
      throw new BadRequestException('carnet invalido');
    }

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    if (!currentVersion) {
      return {
        status: 'NOT_ELIGIBLE',
        normalizedCarnet: carnetNorm,
        referenceVersion: null,
      };
    }

    const found = await this.padronEntryModel.findOne(
      {
        padronVersionId: currentVersion._id,
        carnetNorm,
      },
      { enabled: 1 },
    ).lean();

    return {
      status: found ? (found.enabled === false ? 'DISABLED' : 'ELIGIBLE') : 'NOT_ELIGIBLE',
      normalizedCarnet: carnetNorm,
      referenceVersion: String(currentVersion._id),
    };
  }

  async checkPublicEligibility(eventId: string, carnet: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    if (
      ['DRAFT', 'READY_FOR_REVIEW'].includes(event.state) &&
      this.accessService.hasPublicationWindowExpired(event)
    ) {
      event.state = 'PUBLICATION_EXPIRED';
      event.publicationExpiredAt = new Date();
      event.publicationConfirmed = false;
      await event.save();
    }

    if (
      ![
        'READY_FOR_REVIEW',
        'OFFICIALLY_PUBLISHED',
        'PUBLISHED',
        'CLOSED',
        'RESULTS_PUBLISHED',
      ].includes(event.state)
    ) {
      return {
        status: 'PUBLIC_CHECK_DISABLED',
        referenceVersion: null,
      };
    }
    if (!event.publicEligibilityEnabled) {
      return {
        status: 'PUBLIC_CHECK_DISABLED',
        referenceVersion: null,
      };
    }

    const carnetNorm = normalizeCarnet(carnet);

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();

    if (!currentVersion) {
      return {
        status: 'ROLL_IN_VALIDATION',
        referenceVersion: null,
      };
    }

    const reportOk = await this.comparisonReportModel.exists({
      padronVersionId: currentVersion._id,
      status: 'OK',
    });

    if (!reportOk) {
      return {
        status: 'ROLL_IN_VALIDATION',
        referenceVersion: String(currentVersion._id),
      };
    }

    const found = await this.padronEntryModel.findOne(
      {
        padronVersionId: currentVersion._id,
        carnetNorm,
      },
      { enabled: 1 },
    ).lean();

    return {
      status: found ? (found.enabled === false ? 'DISABLED' : 'ELIGIBLE') : 'NOT_ELIGIBLE',
      referenceVersion: String(currentVersion._id),
    };
  }

  async updateComparisonReportStatus(
    eventId: string,
    status: 'PENDING' | 'OK' | 'FAILED',
    requester: any,
    padronVersionId?: string,
  ) {
    this.accessService.assertGlobalAdminAccess(requester, 'aprobar o rechazar el padrón');
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.assertStructuralEditableState(event, 'actualizar la validación del padrón');
    const eventObjectId = this.toObjectId(event._id);
    const version = await this.resolvePadronVersion(eventObjectId, padronVersionId);

    await this.comparisonReportModel.updateOne(
      { padronVersionId: version._id },
      { $set: { status } },
      { upsert: true },
    );

    return { eventId, padronVersionId: String(version._id), status };
  }

  private async createCurrentPadronVersion(params: {
    eventId: Types.ObjectId;
    tenantId: Types.ObjectId;
    createdBy: Types.ObjectId;
    fileDigest: string;
    entries: { ciNorm: string; enabled: boolean }[];
    totals: {
      validCount: number;
      duplicateCount: number;
      invalidCount: number;
    };
    comparisonStatus: 'PENDING' | 'OK' | 'FAILED';
    sourceType: 'CSV_LEGACY' | 'PDF_IMPORT' | 'IMAGE_IMPORT';
    importJobId?: Types.ObjectId;
    sourceFileName?: string | null;
    sourceFileMimeType?: string | null;
    sourceFileSha256?: string | null;
    parserProvider?: string | null;
    parserModel?: string | null;
  }) {
    await this.padronVersionModel.updateMany(
      { eventId: params.eventId, isCurrent: true },
      { $set: { isCurrent: false } },
    );

    const version = await this.padronVersionModel.create({
      eventId: params.eventId,
      tenantId: params.tenantId,
      createdBy: params.createdBy,
      fileDigest: params.fileDigest,
      sourceType: params.sourceType,
      importJobId: params.importJobId ?? null,
      sourceFileName: params.sourceFileName ?? null,
      sourceFileMimeType: params.sourceFileMimeType ?? null,
      sourceFileSha256: params.sourceFileSha256 ?? null,
      parserProvider: params.parserProvider ?? null,
      parserModel: params.parserModel ?? null,
      totals: params.totals,
      isCurrent: true,
    });

    if (params.entries.length > 0) {
      await this.padronEntryModel.insertMany(
        params.entries.map((entry) => ({
          padronVersionId: version._id,
          eventId: params.eventId,
          carnetNorm: entry.ciNorm,
          enabled: entry.enabled,
        })),
        { ordered: false },
      );
    }

    await this.comparisonReportModel.updateOne(
      { padronVersionId: version._id },
      {
        $set: {
          eventId: params.eventId,
          padronVersionId: version._id,
          status: params.comparisonStatus,
        },
      },
      { upsert: true },
    );

    return version;
  }

  private normalizeImportedRows(rows: ParsedPadronRow[]) {
    const seen = new Set<string>();
    const entries: NormalizedImportEntry[] = [];
    const errors: PadronImportError[] = [];
    let duplicateCount = 0;
    let invalidCount = 0;

    for (const row of rows) {
      const ciNorm = normalizeCarnet(row.ci);
      if (!ciNorm) {
        invalidCount++;
        errors.push({
          code: 'INVALID_CI',
          message: 'No se pudo normalizar el CI',
          rowIndex: row.sourceRow ?? null,
          rawValue: row.ci,
        });
        continue;
      }

      if (seen.has(ciNorm)) {
        duplicateCount++;
        errors.push({
          code: 'DUPLICATE_CI',
          message: 'CI duplicado en el padrón importado',
          rowIndex: row.sourceRow ?? null,
          rawValue: row.ci,
        });
        continue;
      }

      seen.add(ciNorm);
      entries.push({
        ciNorm,
        enabled: row.enabled !== false,
        sourceRow: row.sourceRow ?? null,
      });
    }

    if (!entries.length) {
      errors.push({
        code: 'EMPTY_STAGING',
        message: 'El staging quedó vacío luego del procesamiento del PDF',
      });
    }

    return { entries, errors, duplicateCount, invalidCount };
  }

  private resolveImportJobStatus(validCount: number, errorCount: number) {
    if (validCount <= 0) return 'FAILED' as const;
    if (errorCount > 0) return 'PARSED_WITH_ERRORS' as const;
    return 'PARSED' as const;
  }

  private parseEnabledValue(value: string, hasEnabledColumn: boolean): boolean | null {
    if (!hasEnabledColumn) {
      return true;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'habilitado', 'activo'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'deshabilitado', 'inhabilitado', 'inactivo'].includes(normalized)) {
      return false;
    }
    return null;
  }

  private async getEditableActiveImportJobContext(
    eventId: string,
    requester: any,
    action: string,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    await this.assertStructuralEditableState(event, action);

    const importJob = await this.getOrCreateEditableDraftFromCurrentVersion(event, requester);
    if (!importJob) {
      throw new NotFoundException('No existe un staging activo de padrón para este evento');
    }

    if (importJob.status === 'PROCESSING' || importJob.status === 'CONFIRMED') {
      throw new BadRequestException('El staging activo no admite edición en su estado actual');
    }

    return { event, importJob };
  }

  private async getActiveImportJob(eventId: Types.ObjectId) {
    return this.padronImportJobModel
      .findOne({ eventId, isActiveDraft: true })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
  }

  private async getOrCreateEditableDraftFromCurrentVersion(event: any, requester?: any) {
    let importJob = await this.getActiveImportJob(event._id);

    if (!this.accessService.canFullyEditEvent(event)) {
      if (importJob) {
        await this.padronImportJobModel.updateOne(
          { _id: importJob._id },
          { $set: { isActiveDraft: false } },
        );
      }
      return null;
    }

    if (importJob) {
      return importJob;
    }

    const currentVersion = await this.padronVersionModel
      .findOne({ eventId: event._id, isCurrent: true })
      .lean();
    if (!currentVersion) {
      return null;
    }

    try {
      const createdBy =
        requester?.sub && Types.ObjectId.isValid(requester.sub)
          ? new Types.ObjectId(requester.sub)
          : currentVersion.createdBy;

      const createdImportJob = await this.padronImportJobModel.create({
        eventId: event._id,
        tenantId: event.tenantId,
        createdBy,
        sourceType: 'SYSTEM',
        status: 'PARSED',
        isActiveDraft: true,
        originalFileName: currentVersion.sourceFileName ?? `draft-from-${String(currentVersion._id)}.json`,
        originalFileMimeType: currentVersion.sourceFileMimeType ?? 'application/json',
        originalFileSize: 0,
        originalFileSha256: currentVersion.fileDigest,
        parserProvider: 'system-clone',
        parserModel: null,
        parserUsedFallback: true,
      summary: {
        parsedCount: currentVersion.totals?.validCount ?? 0,
        validCount: currentVersion.totals?.validCount ?? 0,
        duplicateCount: currentVersion.totals?.duplicateCount ?? 0,
        invalidCount: currentVersion.totals?.invalidCount ?? 0,
        stagingCount: currentVersion.totals?.validCount ?? 0,
        enabledCount: 0,
        disabledCount: 0,
        missingIdentityCount: 0,
      },
        processedAt: new Date(),
      });

      const entries = await this.padronEntryModel
        .find({ padronVersionId: currentVersion._id }, { carnetNorm: 1, enabled: 1 })
        .sort({ carnetNorm: 1, _id: 1 })
        .lean();

      if (entries.length) {
        await this.padronStagingEntryModel.insertMany(
          entries.map((entry) => ({
            importJobId: createdImportJob._id,
            eventId: event._id,
            tenantId: event.tenantId,
            ciNorm: entry.carnetNorm,
            enabled: entry.enabled !== false,
            sourceKind: 'CLONED',
            createdBy,
            lastEditedBy: createdBy,
          })),
          { ordered: false },
        );
      }

      await this.refreshImportJobSummary(createdImportJob._id);
    } catch (error: any) {
      if (error?.code !== 11000) {
        throw error;
      }
    }

    importJob = await this.getActiveImportJob(event._id);
    return importJob;
  }

  private async refreshImportJobSummary(importJobId: Types.ObjectId) {
    const [job, entries] = await Promise.all([
      this.padronImportJobModel.findById(importJobId).lean(),
      this.padronStagingEntryModel.find({ importJobId }, { enabled: 1, ciNorm: 1 }).lean(),
    ]);

    if (!job) {
      throw new NotFoundException('Importación de padrón no encontrada');
    }

    const stagingCount = entries.length;
    const currentErrorCount = Array.isArray(job.importErrors) ? job.importErrors.length : 0;
    const dids =
      stagingCount > 0
        ? await this.issuerService.getDidsByDnis(
            entries
              .map((entry) => String(entry.ciNorm ?? '').trim())
              .filter((ci) => ci.length > 0),
          )
        : [];
    const didSet = new Set(
      dids
        .map((did) => String(did?.dni ?? '').trim())
        .filter((dni) => dni.length > 0),
    );
    const missingIdentityEntries = entries.filter(
      (entry) => !didSet.has(String(entry.ciNorm ?? '').trim()),
    );
    const missingIdentityCount = missingIdentityEntries.length;
    const enabledMissingIdentityIds = missingIdentityEntries
      .filter((entry) => entry.enabled !== false)
      .map((entry) => entry._id)
      .filter(Boolean);
    if (enabledMissingIdentityIds.length > 0) {
      await this.padronStagingEntryModel.updateMany(
        { _id: { $in: enabledMissingIdentityIds }, importJobId },
        { $set: { enabled: false } },
      );
    }
    const normalizedEntries = entries.map((entry) => {
      const ciNorm = String(entry.ciNorm ?? '').trim();
      return {
        ...entry,
        enabled: didSet.has(ciNorm) && entry.enabled !== false,
      };
    });
    const enabledCount = normalizedEntries.filter((entry) => entry.enabled).length;
    const disabledCount = stagingCount - enabledCount;
    const recalculatedStatus = this.resolveImportJobStatus(stagingCount, currentErrorCount);

    await this.padronImportJobModel.updateOne(
      { _id: importJobId },
      {
        $set: {
          status: recalculatedStatus,
          summary: {
            parsedCount: stagingCount,
            validCount: stagingCount,
            duplicateCount: 0,
            invalidCount: 0,
            stagingCount,
            enabledCount,
            disabledCount,
            missingIdentityCount,
          },
        },
      },
    );
  }

  private mapImportJob(importJob: any, stagingCount?: number) {
    return {
      importJobId: String(importJob._id),
      eventId: String(importJob.eventId),
      tenantId: String(importJob.tenantId),
      sourceType: importJob.sourceType,
      status: importJob.status,
      isActiveDraft: importJob.isActiveDraft === true,
      originalFile: {
        fileName: importJob.originalFileName,
        mimeType: importJob.originalFileMimeType,
        size: importJob.originalFileSize,
        sha256: importJob.originalFileSha256,
      },
      parser: {
        provider: importJob.parserProvider ?? 'local-fallback',
        model: importJob.parserModel ?? null,
        usedFallback: importJob.parserUsedFallback !== false,
      },
      summary: {
        parsedCount: importJob.summary?.parsedCount ?? 0,
        validCount: importJob.summary?.validCount ?? 0,
        duplicateCount: importJob.summary?.duplicateCount ?? 0,
        invalidCount: importJob.summary?.invalidCount ?? 0,
        stagingCount: stagingCount ?? importJob.summary?.stagingCount ?? 0,
        enabledCount: importJob.summary?.enabledCount ?? 0,
        disabledCount: importJob.summary?.disabledCount ?? 0,
        missingIdentityCount: importJob.summary?.missingIdentityCount ?? 0,
      },
      errors: (importJob.importErrors ?? []).map((error: any) => ({
        code: error.code,
        message: error.message,
        rowIndex: error.rowIndex ?? null,
        rawValue: error.rawValue ?? null,
      })),
      processedAt: importJob.processedAt ?? null,
      confirmedAt: importJob.confirmedAt ?? null,
      confirmedPadronVersionId: importJob.confirmedPadronVersionId
        ? String(importJob.confirmedPadronVersionId)
        : null,
      createdAt: importJob.createdAt ?? null,
      updatedAt: importJob.updatedAt ?? null,
    };
  }

  private mapStagingEntry(entry: any) {
    return {
      id: String(entry._id),
      importJobId: String(entry.importJobId),
      ci: entry.ciNorm,
      enabled: entry.enabled !== false,
      sourceKind: entry.sourceKind,
      sourceRow: entry.sourceRow ?? null,
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }

  private mapCertificateMetadata(certificate: any) {
    return {
      exists: true,
      certificateId: String(certificate._id),
      eventId: String(certificate.eventId),
      padronVersionId: String(certificate.padronVersionId),
      generatedAt: certificate.generatedAt ?? certificate.createdAt ?? null,
      generationMode: certificate.generationMode,
      fileName: certificate.fileName,
      mimeType: certificate.mimeType,
      fileSha256: certificate.fileSha256,
      fileSize: certificate.fileSize,
      sourceType: certificate.sourceType,
      totals: {
        totalCount: certificate.totalCount,
        enabledCount: certificate.enabledCount,
        disabledCount: certificate.disabledCount,
      },
      storageKind: certificate.storageKind,
      materializable: true,
    };
  }

  private async getCertificateVersionContext(
    eventId: string,
    requester: any,
    padronVersionId?: string,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    let version: any = null;
    if (padronVersionId) {
      if (!Types.ObjectId.isValid(padronVersionId)) {
        throw new BadRequestException('padronVersionId invalido');
      }
      version = await this.padronVersionModel
        .findOne({
          _id: new Types.ObjectId(padronVersionId),
          eventId: event._id,
        })
        .lean();
      if (!version) {
        throw new NotFoundException('No existe la version de padron solicitada');
      }
    } else {
      version = await this.padronVersionModel
        .findOne({ eventId: event._id, isCurrent: true })
        .lean();
    }

    return { event, version };
  }

  private async ensurePadronCertificateForVersion(
    event: any,
    version: any,
    requester: any,
    generationMode: PadronCertificateGenerationMode,
    forceRegenerate = false,
  ) {
    const existing = await this.padronCertificateModel.findOne({ padronVersionId: version._id });
    if (existing && !forceRegenerate) {
      return existing.toObject ? existing.toObject() : existing;
    }

    const entries = await this.padronEntryModel
      .find(
        { padronVersionId: version._id },
        { carnetNorm: 1, enabled: 1, _id: 0 },
      )
      .sort({ carnetNorm: 1, _id: 1 })
      .lean();

    if (!entries.length) {
      throw new BadRequestException('No se puede generar constancia PDF sin entradas confirmadas de padrón');
    }

    const enabledCount = entries.filter((entry) => entry.enabled !== false).length;
    const disabledCount = entries.length - enabledCount;
    const generatedAt = new Date();
    const pdfBuffer = this.padronCertificatePdfService.buildPdf({
      eventName: event.name,
      eventId: String(event._id),
      generatedAt,
      padronVersionId: String(version._id),
      sourceType: version.sourceType ?? 'CSV_LEGACY',
      totalCount: entries.length,
      enabledCount,
      disabledCount,
      entries: entries.map((entry) => ({
        ci: entry.carnetNorm,
        enabled: entry.enabled !== false,
      })),
    });
    const fileSha256 = createHash('sha256').update(pdfBuffer).digest('hex');
    const fileName = `padron-constancia-${String(version._id)}.pdf`;

    const payload = {
      eventId: event._id,
      tenantId: event.tenantId,
      padronVersionId: version._id,
      generatedBy: requester?.sub ? new Types.ObjectId(requester.sub) : null,
      generationMode,
      mimeType: 'application/pdf',
      fileName,
      fileSha256,
      fileSize: pdfBuffer.length,
      sourceType: version.sourceType ?? 'CSV_LEGACY',
      totalCount: entries.length,
      enabledCount,
      disabledCount,
      generatedAt,
      storageKind: 'INLINE_BASE64' as const,
      pdfContentBase64: pdfBuffer.toString('base64'),
    };

    if (existing) {
      await this.padronCertificateModel.updateOne(
        { _id: existing._id },
        { $set: payload },
      );
      const updated = await this.padronCertificateModel.findById(existing._id).lean();
      if (!updated) {
        throw new NotFoundException('No se pudo recuperar la constancia PDF regenerada');
      }
      return updated;
    }

    return this.padronCertificateModel.create(payload);
  }

  private async assertStructuralEditableState(event: any, action: string) {
    if (
      ['DRAFT', 'READY_FOR_REVIEW'].includes(event.state) &&
      this.accessService.hasPublicationWindowExpired(event)
    ) {
      event.state = 'PUBLICATION_EXPIRED';
      event.publicationExpiredAt = new Date();
      event.publicationConfirmed = false;
      await event.save();
    }

    if (!this.accessService.canFullyEditEvent(event)) {
      if (action === 'eliminar registros del padrón') {
        throw new BadRequestException(
          'No se pueden eliminar registros porque el padrón ya no está en una etapa editable.',
        );
      }

      throw new BadRequestException(
        `Solo se permite ${action} antes de la publicación oficial y mientras falten más de ${this.accessService.getOfficialPublicationLeadHours()} horas para el inicio de la votación`,
      );
    }
  }

  private buildPadronEditingRules(event: any) {
    const canEditEverything = this.accessService.canFullyEditEvent(event);
    const canEditDuringVoting = this.accessService.canModifyPadronDuringVoting(event);
    const canEditPadronInLimitedMode =
      this.accessService.canEnableExistingPadronEntriesPostPublication(event);

    return {
      canEditEverything,
      canEditDuringVoting,
      canEditPadronInLimitedMode,
      mode: canEditEverything ? 'FULL' : canEditDuringVoting ? 'VOTING_LIMITED' : 'READ_ONLY',
      fullEditDeadline: event.publishDeadline ?? null,
      dateValidationMinHours: this.accessService.getCreateLeadHours(),
      officialPublicationCutoffHours: this.accessService.getOfficialPublicationLeadHours(),
    };
  }

  private async getEventForVotingPadronChange(eventId: string, requester: any, action: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    if (!this.accessService.canModifyPadronDuringVoting(event)) {
      throw new BadRequestException(
        `Solo se permite ${action} después de la publicación oficial y hasta el cierre de la votación`,
      );
    }

    return event;
  }

  private async resolveCurrentPadronVersionDoc(eventId: Types.ObjectId) {
    const currentVersion = await this.padronVersionModel.findOne({
      eventId,
      isCurrent: true,
    });

    if (!currentVersion) {
      throw new NotFoundException('No existe padrón vigente');
    }

    return currentVersion;
  }

  private async invalidateCurrentPadronCertificate(padronVersionId: Types.ObjectId) {
    await this.padronCertificateModel.deleteMany({ padronVersionId });
  }

  private async resolvePadronVersion(eventObjectId: Types.ObjectId, padronVersionId?: string) {
    if (padronVersionId) {
      if (!Types.ObjectId.isValid(padronVersionId)) {
        throw new BadRequestException('padronVersionId invalido');
      }

      const version = await this.padronVersionModel.findOne({
        _id: new Types.ObjectId(padronVersionId),
        eventId: eventObjectId,
      });

      if (!version) {
        throw new NotFoundException('No existe la version de padron solicitada');
      }

      return version;
    }

    const currentVersion = await this.padronVersionModel.findOne({
      eventId: eventObjectId,
      isCurrent: true,
    });

    if (!currentVersion) {
      throw new NotFoundException('No existe padron vigente');
    }

    return currentVersion;
  }

  private toObjectId(value: Types.ObjectId | string): Types.ObjectId {
    return value instanceof Types.ObjectId ? value : new Types.ObjectId(String(value));
  }
}
