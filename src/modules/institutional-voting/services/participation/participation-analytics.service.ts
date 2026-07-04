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
    const dataUrlMatch = raw.match(/^data:(image\/(?:png|jpeg|jpg));base64,([a-z0-9+/=\s]+)$/i);
    if (dataUrlMatch) {
      const mimeType = dataUrlMatch[1].toLowerCase() === 'image/jpg'
        ? 'image/jpeg'
        : (dataUrlMatch[1].toLowerCase() as 'image/png' | 'image/jpeg');
      return {
        mimeType,
        buffer: Buffer.from(dataUrlMatch[2].replace(/\s+/g, ''), 'base64'),
      };
    }

    if (!/^[a-z0-9+/=\s]+$/i.test(raw)) {
      throw new BadRequestException('La captura del modal no es base64 válido.');
    }

    const buffer = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
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

}
