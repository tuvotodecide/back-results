import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import {
  ComparisonReport,
  ComparisonReportDocument,
} from '../../schemas/comparison-report.schema';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '../../schemas/padron-version.schema';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';

const ENABLED_HEADER = 'habilitado';

type ParsedPadronRow = {
  carnetNorm: string;
  enabled: boolean;
};

@Injectable()
export class PadronService {
  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
  ) {}

  async importPadron(eventId: string, csvContent: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

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
    let rows = hasHeader ? lines.slice(1) : lines;

    const seen = new Set<string>();
    const validEntries: ParsedPadronRow[] = [];
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
        carnetNorm: normalized,
        enabled,
      });
    }

    const digest = createHash('sha256').update(csvContent).digest('hex');

    await this.padronVersionModel.updateMany(
      { eventId: event._id, isCurrent: true },
      { $set: { isCurrent: false } },
    );

    const version = await this.padronVersionModel.create({
      eventId: event._id,
      tenantId: event.tenantId,
      createdBy: new Types.ObjectId(requester.sub),
      fileDigest: digest,
      totals: {
        validCount: validEntries.length,
        duplicateCount: duplicates,
        invalidCount: invalid,
      },
      isCurrent: true,
    });

    if (validEntries.length > 0) {
      await this.padronEntryModel.insertMany(
        validEntries.map((entry) => ({
          padronVersionId: version._id,
          eventId: event._id,
          carnetNorm: entry.carnetNorm,
          enabled: entry.enabled,
        })),
        { ordered: false },
      );
    }

    await this.comparisonReportModel.create({
      eventId: event._id,
      padronVersionId: version._id,
      status: 'PENDING',
    });

    return {
      padronVersionId: String(version._id),
      fileDigest: version.fileDigest,
      createdAt: version.createdAt,
      createdBy: String(version.createdBy),
      tenantId: String(version.tenantId),
      totals: version.totals,
      isCurrent: version.isCurrent,
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
      data: versions.map((v) => ({
        padronVersionId: String(v._id),
        fileDigest: v.fileDigest,
        createdAt: v.createdAt,
        createdBy: String(v.createdBy),
        totals: v.totals,
        isCurrent: v.isCurrent,
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
    };
  }

  async downloadPadronCsv(eventId: string, requester: any, padronVersionId?: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    const eventObjectId = new Types.ObjectId(String(event._id));

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

    const found = await this.padronEntryModel.findOne({
      padronVersionId: currentVersion._id,
      carnetNorm,
    }, { enabled: 1 }).lean();

    return {
      status: found ? (found.enabled === false ? 'DISABLED' : 'ELIGIBLE') : 'NOT_ELIGIBLE',
      normalizedCarnet: carnetNorm,
      referenceVersion: String(currentVersion._id),
    };
  }

  async checkPublicEligibility(eventId: string, carnet: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
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

    const found = await this.padronEntryModel.findOne({
      padronVersionId: currentVersion._id,
      carnetNorm,
    }, { enabled: 1 }).lean();

    return {
      status: found ? (found.enabled === false ? 'DISABLED' : 'ELIGIBLE') : 'NOT_ELIGIBLE',
      referenceVersion: String(currentVersion._id),
    };
  }

  private parseEnabledValue(value: string, hasEnabledColumn: boolean): boolean | null {
    if (!hasEnabledColumn) {
      return true;
    }

    const normalized = String(value ?? '').trim().toLowerCase();
    if (['1', 'true', 'si', 'sí', 'habilitado', 'activo'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'deshabilitado', 'inactivo'].includes(normalized)) {
      return false;
    }
    return null;
  }

  async updateComparisonReportStatus(
    eventId: string,
    status: 'PENDING' | 'OK' | 'FAILED',
    requester: any,
    padronVersionId?: string,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    const eventObjectId = new Types.ObjectId(String(event._id));
    const version = await this.resolvePadronVersion(eventObjectId, padronVersionId);
    if (!version) throw new NotFoundException('No existe padron vigente');

    await this.comparisonReportModel.updateOne(
      { padronVersionId: version._id },
      { $set: { status } },
      { upsert: true },
    );

    return { eventId, padronVersionId: String(version._id), status };
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
}
