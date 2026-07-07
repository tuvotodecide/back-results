import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  ParticipationAnalyticsResponseDto,
  ParticipationAnalyticsStatus,
  CreateParticipationReportDto,
  ParticipationReportData,
  ParticipationReportVoter,
} from '../../dto/participation-analytics.dto';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import {
  PadronVersion,
  PadronVersionDocument,
} from '../../schemas/padron-version.schema';
import {
  Participation,
  ParticipationDocument,
} from '../../schemas/participation.schema';
import { VotingEvent } from '../../schemas/voting-event.schema';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { ParticipationReportPdfService } from './participation-report-pdf.service';

const MAX_MODAL_SCREENSHOT_BYTES = 5 * 1024 * 1024;
const MAX_MODAL_SCREENSHOT_BASE64_LENGTH = Math.ceil((MAX_MODAL_SCREENSHOT_BYTES / 3)) * 4;
const MAX_MODAL_SCREENSHOT_RAW_LENGTH = MAX_MODAL_SCREENSHOT_BASE64_LENGTH + 64;

@Injectable()
export class ParticipationAnalyticsService {
  constructor(
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(Participation.name)
    private readonly participationModel: Model<ParticipationDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly reportPdfService: ParticipationReportPdfService,
  ) {}

  async getAnalytics(
    eventId: string,
    requester: any,
  ): Promise<ParticipationAnalyticsResponseDto> {
    const reportData = await this.buildReportData(eventId, requester, false);
    const { participants, pending, generatedAt, ...analytics } = reportData;
    void participants;
    void pending;
    void generatedAt;
    return analytics;
  }

  async downloadParticipationReport(
    eventId: string,
    requester: any,
    payload: CreateParticipationReportDto,
  ) {
    const reportData = await this.buildReportData(eventId, requester, true);
    const modalScreenshot = this.decodeModalScreenshot(payload);
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = this.reportPdfService.buildPdf(reportData, modalScreenshot);
    } catch {
      throw new BadRequestException('La captura del modal no es una imagen válida.');
    }

    return {
      fileName: `participation-report-${reportData.votingId}.pdf`,
      mimeType: 'application/pdf',
      pdfBuffer,
    };
  }

  private async buildReportData(
    eventId: string,
    requester: any,
    includeLists: boolean,
  ): Promise<ParticipationReportData> {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const [tenant, currentVersion] = await Promise.all([
      this.tenantModel.findById(event.tenantId, { name: 1 }).lean(),
      this.padronVersionModel
        .findOne({ eventId: event._id, isCurrent: true }, { _id: 1 })
        .lean(),
    ]);

    const base = this.buildBaseResponse(event, tenant?.name);

    if (!currentVersion) {
      return {
        ...base,
        generatedAt: new Date().toISOString(),
        participants: [],
        pending: [],
      };
    }

    const enabledEntries = await this.padronEntryModel
      .find(
        {
          padronVersionId: currentVersion._id,
          enabled: { $ne: false },
        },
        { _id: 1, carnetNorm: 1 },
      )
      .sort({ carnetNorm: 1, _id: 1 })
      .lean();

    const enabledByCarnet = new Map<string, { id: string; carnetNorm: string }>();
    for (const entry of enabledEntries) {
      const carnetNorm = String(entry.carnetNorm ?? '').trim();
      if (!carnetNorm || enabledByCarnet.has(carnetNorm)) {
        continue;
      }
      enabledByCarnet.set(carnetNorm, {
        id: String(entry._id),
        carnetNorm,
      });
    }

    const participationRows = await this.participationModel
      .find({ eventId: event._id }, { carnetNorm: 1 })
      .lean();
    const participatedCarnets = new Set<string>();
    for (const row of participationRows) {
      const carnetNorm = String(row.carnetNorm ?? '').trim();
      if (enabledByCarnet.has(carnetNorm)) {
        participatedCarnets.add(carnetNorm);
      }
    }

    const totalEnabled = enabledByCarnet.size;
    const totalParticipated = participatedCarnets.size;
    const totalPending = Math.max(0, totalEnabled - totalParticipated);
    const participationPercentage = this.calculatePercentage(
      totalParticipated,
      totalEnabled,
    );

    const data: ParticipationReportData = {
      ...base,
      totalEnabled,
      totalParticipated,
      totalPending,
      participationPercentage,
      generatedAt: new Date().toISOString(),
      participants: [],
      pending: [],
    };

    if (!includeLists) {
      return data;
    }

    const participants: ParticipationReportVoter[] = [];
    const pending: ParticipationReportVoter[] = [];
    for (const entry of enabledByCarnet.values()) {
      if (participatedCarnets.has(entry.carnetNorm)) {
        participants.push({ ...entry, status: 'PARTICIPATED' });
      } else {
        pending.push({ ...entry, status: 'PENDING' });
      }
    }

    return {
      ...data,
      participants,
      pending,
    };
  }

  private buildBaseResponse(
    event: VotingEvent & { _id: Types.ObjectId },
    institutionName?: string,
  ): ParticipationAnalyticsResponseDto {
    const publication = this.resolvePublication(event);
    return {
      votingId: String(event._id),
      votingName: event.name,
      institutionName,
      status: publication.status,
      publishedAt: publication.publishedAt,
      totalEnabled: 0,
      totalParticipated: 0,
      totalPending: 0,
      participationPercentage: 0,
    };
  }

  private resolvePublication(
    event: Pick<VotingEvent, 'state' | 'votingStart' | 'votingEnd' | 'resultsPublishAt'>,
  ): { status: ParticipationAnalyticsStatus; publishedAt: string | null } {
    const now = new Date();
    const resultsPublishAt = event.resultsPublishAt
      ? new Date(event.resultsPublishAt)
      : null;
    const resultsAvailable = Boolean(
      resultsPublishAt &&
        !Number.isNaN(resultsPublishAt.getTime()) &&
        (event.state === 'RESULTS_PUBLISHED' || now >= resultsPublishAt),
    );

    if (resultsAvailable && resultsPublishAt) {
      return {
        status: 'RESULTS_PUBLISHED',
        publishedAt: resultsPublishAt.toISOString(),
      };
    }

    const votingStart = event.votingStart ? new Date(event.votingStart) : null;
    const votingEnd = event.votingEnd ? new Date(event.votingEnd) : null;
    const isActive = Boolean(
      ['OFFICIALLY_PUBLISHED', 'PUBLISHED'].includes(String(event.state || '')) &&
        votingStart &&
        votingEnd &&
        now >= votingStart &&
        now <= votingEnd,
    );
    if (isActive) {
      return { status: 'IN_PROGRESS', publishedAt: null };
    }

    const isFinished = Boolean(
      event.state === 'CLOSED' ||
        (votingEnd && !Number.isNaN(votingEnd.getTime()) && now > votingEnd),
    );
    if (isFinished) {
      return { status: 'FINISHED', publishedAt: null };
    }

    return { status: 'RESULTS_NOT_PUBLISHED', publishedAt: null };
  }

  private calculatePercentage(totalParticipated: number, totalEnabled: number) {
    if (totalEnabled <= 0) {
      return 0;
    }
    return Math.round((totalParticipated / totalEnabled) * 1000) / 10;
  }

  private decodeModalScreenshot(payload?: CreateParticipationReportDto) {
    const raw = String(
      payload?.modalScreenshot ?? payload?.modalScreenshotBase64 ?? '',
    ).trim();

    if (!raw) {
      throw new BadRequestException('La captura del modal es requerida.');
    }

    if (raw.length > MAX_MODAL_SCREENSHOT_RAW_LENGTH) {
      throw new BadRequestException('La captura del modal es demasiado grande.');
    }

    const parsed = this.parseImagePayload(raw);
    if (parsed.buffer.length > MAX_MODAL_SCREENSHOT_BYTES) {
      throw new BadRequestException('La captura del modal es demasiado grande.');
    }

    if (!this.isSupportedImage(parsed.mimeType, parsed.buffer)) {
      throw new BadRequestException('La captura del modal no es una imagen válida.');
    }

    return parsed;
  }

  private parseImagePayload(raw: string): { mimeType: 'image/png' | 'image/jpeg'; buffer: Buffer } {
    const dataUrlPrefix = 'data:';
    let declaredMimeType: 'image/png' | 'image/jpeg' | null = null;
    let base64Payload = raw;

    if (raw.toLowerCase().startsWith(dataUrlPrefix)) {
      const commaIndex = raw.indexOf(',');
      if (commaIndex < 0) {
        throw new BadRequestException('La captura del modal no es base64 válido.');
      }

      const metadata = raw.slice(dataUrlPrefix.length, commaIndex).toLowerCase();
      if (metadata === 'image/png;base64') {
        declaredMimeType = 'image/png';
      } else if (metadata === 'image/jpeg;base64' || metadata === 'image/jpg;base64') {
        declaredMimeType = 'image/jpeg';
      } else {
        throw new BadRequestException('La captura del modal no es una imagen válida.');
      }

      base64Payload = raw.slice(commaIndex + 1);
    }

    const normalizedPayload = this.normalizeBase64Payload(base64Payload);
    const buffer = Buffer.from(normalizedPayload, 'base64');

    if (declaredMimeType) {
      return {
        mimeType: declaredMimeType,
        buffer,
      };
    }

    const mimeType = buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
      ? 'image/png'
      : buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        ? 'image/jpeg'
        : null;

    if (!mimeType) {
      throw new BadRequestException('La captura del modal no es una imagen válida.');
    }

    return { mimeType, buffer };
  }

  private normalizeBase64Payload(payload: string): string {
    let normalized = '';

    for (const char of payload) {
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        continue;
      }

      const code = char.charCodeAt(0);
      const isBase64Char =
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        char === '+' ||
        char === '/' ||
        char === '=';

      if (!isBase64Char) {
        throw new BadRequestException('La captura del modal no es base64 válido.');
      }

      normalized += char;
    }

    if (!normalized || normalized.length % 4 !== 0 || !this.hasValidBase64Padding(normalized)) {
      throw new BadRequestException('La captura del modal no es base64 válido.');
    }

    return normalized;
  }

  private hasValidBase64Padding(payload: string): boolean {
    const firstPaddingIndex = payload.indexOf('=');
    if (firstPaddingIndex < 0) {
      return true;
    }

    for (let index = firstPaddingIndex; index < payload.length; index += 1) {
      if (payload[index] !== '=') {
        return false;
      }
    }

    return payload.length - firstPaddingIndex <= 2;
  }

  private isSupportedImage(mimeType: string, buffer: Buffer) {
    if (mimeType === 'image/png') {
      return buffer.length > 8 && buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }

    if (mimeType === 'image/jpeg') {
      return buffer.length > 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    }

    return false;
  }

  private hasValidBase64Chars(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      const isDigit = code >= 48 && code <= 57;
      const isBase64Symbol = code === 43 || code === 47 || code === 61;
      const isWhitespace = code === 32 || code === 9 || code === 10 || code === 13;
      if (!isUpper && !isLower && !isDigit && !isBase64Symbol && !isWhitespace) {
        return false;
      }
    }
    return true;
  }

  private estimateDecodedBase64Size(value: string) {
    if (!value.length) {
      return 0;
    }

    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return Math.floor((value.length * 3) / 4) - padding;
  }

}
