import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateVotingEventDto } from '../../dto/create-voting-event.dto';
import { CreateEventNewsDto } from '../../dto/event-news.dto';
import { CreateEventRoleDto } from '../../dto/event-role.dto';
import { normalizeCarnet } from '../../utils/carnet-normalizer';
import { UpdateEventRoleDto } from '../../dto/update-event-role.dto';
import { UpdateOptionCandidatesDto } from '../../dto/update-option-candidates.dto';
import { UpdateVotingEventDto } from '../../dto/update-voting-event.dto';
import { UpdateVotingOptionDto } from '../../dto/update-voting-option.dto';
import { CreateVotingOptionDto } from '../../dto/voting-option.dto';
import {
  ComparisonReport,
  ComparisonReportDocument,
} from '../../schemas/comparison-report.schema';
import {
  EventResultsSnapshot,
  EventResultsSnapshotDocument,
} from '../../schemas/event-results-snapshot.schema';
import { EventRole, EventRoleDocument } from '../../schemas/event-role.schema';
import { PadronEntry, PadronEntryDocument } from '../../schemas/padron-entry.schema';
import { PadronVersion, PadronVersionDocument } from '../../schemas/padron-version.schema';
import { Participation, ParticipationDocument } from '../../schemas/participation.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';
import {
  VotingOption,
  VotingOptionDocument,
} from '../../schemas/voting-option.schema';
import { InstitutionalVotingAccessService } from '../core/institutional-voting-access.service';
import { InstitutionalVotingNotificationsService } from '../notifications/institutional-voting-notifications.service';
import { ConfigService } from '@nestjs/config';
import { VoteReaderService } from '../core/vote-reader.service';
import { User, UserDocument } from '@/modules/users/schemas/user.schema';
import { PadronUsersService } from '../core/padron-users.service';
import { shuffle } from '@/utils/array.util';

@Injectable()
export class VotingEventsService {
  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(EventRole.name)
    private readonly eventRoleModel: Model<EventRoleDocument>,
    @InjectModel(VotingOption.name)
    private readonly votingOptionModel: Model<VotingOptionDocument>,
    @InjectModel(PadronVersion.name)
    private readonly padronVersionModel: Model<PadronVersionDocument>,
    @InjectModel(PadronEntry.name)
    private readonly padronEntryModel: Model<PadronEntryDocument>,
    @InjectModel(ComparisonReport.name)
    private readonly comparisonReportModel: Model<ComparisonReportDocument>,
    @InjectModel(Participation.name)
    private readonly participationModel: Model<ParticipationDocument>,
    @InjectModel(EventResultsSnapshot.name)
    private readonly resultsSnapshotModel: Model<EventResultsSnapshotDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly notificationsService: InstitutionalVotingNotificationsService,
    private readonly configService: ConfigService,
    private readonly voteReaderService: VoteReaderService,
    private readonly padronUsersService: PadronUsersService,
  ) {}

  async createEvent(dto: CreateVotingEventDto, requester: any) {
    const tenant = await this.accessService.getTenantOrThrow(dto.tenantId);
    await this.accessService.assertTenantWriteAccess(tenant._id as Types.ObjectId, requester);

    const { votingStart, votingEnd, resultsPublishAt } = this.accessService.parseAndValidateDates(
      dto.votingStart,
      dto.votingEnd,
      dto.resultsPublishAt,
      false,
    );

    const created = await this.votingEventModel.create({
      tenantId: new Types.ObjectId(dto.tenantId),
      name: dto.name,
      objective: dto.objective,
      votingStart,
      votingEnd,
      resultsPublishAt,
      state: 'DRAFT',
      publicEligibilityEnabled: true,
    });

    return {
      id: String(created._id),
      tenantId: String(created.tenantId),
      name: created.name,
      objective: created.objective,
      votingStart: created.votingStart,
      votingEnd: created.votingEnd,
      resultsPublishAt: created.resultsPublishAt,
      state: created.state,
    };
  }

  async listEvents(requester: any, tenantId?: string) {
    const readableTenantIds = await this.accessService.resolveReadableTenantIds(
      requester,
      tenantId,
    );

    if (!readableTenantIds.length) {
      return { data: [] };
    }

    const events = await this.votingEventModel
      .find({ tenantId: { $in: readableTenantIds } })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    return {
      data: events.map((event) => ({
        id: String(event._id),
        tenantId: String(event.tenantId),
        name: event.name,
        objective: event.objective,
        state: event.state,
        votingStart: event.votingStart ?? null,
        votingEnd: event.votingEnd ?? null,
        resultsPublishAt: event.resultsPublishAt ?? null,
        publicEligibilityEnabled: Boolean(event.publicEligibilityEnabled),
      })),
    };
  }

  async getPublicLanding(tenantId?: string, limit = 10, carnet?: string) {
    const now = new Date();
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const query: Record<string, unknown> = {
      state: { $in: ['PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'] },
    };

    if (tenantId) {
      if (!Types.ObjectId.isValid(tenantId)) {
        throw new BadRequestException('tenantId invalido');
      }
      query.tenantId = new Types.ObjectId(tenantId);
    }

    let events = await this.votingEventModel
      .find(query)
      .sort({ votingStart: 1, _id: 1 })
      .lean();

    const carnetNorm = carnet ? normalizeCarnet(carnet) : '';
    if (carnet && !carnetNorm) {
      throw new BadRequestException('carnet invalido');
    }

    if (carnetNorm) {
      events = await this.filterPublicLandingEventsByCarnet(events, carnetNorm);
    }

    const mapped = events.map((event) => {
      const isUpcoming = Boolean(
        event.state === 'PUBLISHED' && event.votingStart && now < event.votingStart,
      );
      const isActive = Boolean(
        event.state === 'PUBLISHED' &&
          event.votingStart &&
          event.votingEnd &&
          now >= event.votingStart &&
          now <= event.votingEnd,
      );
      const isResults = Boolean(
        event.state === 'RESULTS_PUBLISHED' ||
          (event.resultsPublishAt && now >= event.resultsPublishAt),
      );

      return {
        id: String(event._id),
        tenantId: String(event.tenantId),
        name: event.name,
        objective: event.objective,
        state: event.state,
        votingStart: event.votingStart ?? null,
        votingEnd: event.votingEnd ?? null,
        resultsPublishAt: event.resultsPublishAt ?? null,
        publicEligibilityEnabled: Boolean(event.publicEligibilityEnabled),
        phase: isResults ? 'RESULTS' : isActive ? 'ACTIVE' : isUpcoming ? 'UPCOMING' : 'OTHER',
      };
    });

    const upcoming = mapped.filter((e) => e.phase === 'UPCOMING').slice(0, safeLimit);
    const active = mapped.filter((e) => e.phase === 'ACTIVE').slice(0, safeLimit);
    const results = mapped
      .filter((e) => e.phase === 'RESULTS')
      .sort((a, b) => {
        const left = a.resultsPublishAt ? new Date(a.resultsPublishAt).getTime() : 0;
        const right = b.resultsPublishAt ? new Date(b.resultsPublishAt).getTime() : 0;
        return right - left;
      })
      .slice(0, safeLimit);

    return {
      upcoming,
      active,
      results,
      totals: {
        upcoming: upcoming.length,
        active: active.length,
        results: results.length,
      },
    };
  }

  private async filterPublicLandingEventsByCarnet(events: any[], carnetNorm: string) {
    const eligibleEvents = events.filter((event) => event.publicEligibilityEnabled !== false);
    if (!eligibleEvents.length) {
      return [];
    }

    const eventIds = eligibleEvents.map((event) => event._id);
    const currentVersions = await this.padronVersionModel
      .find({ eventId: { $in: eventIds }, isCurrent: true }, { _id: 1, eventId: 1 })
      .lean();

    if (!currentVersions.length) {
      return [];
    }

    const versionIds = currentVersions.map((version) => version._id);
    const okReports = await this.comparisonReportModel
      .find({ padronVersionId: { $in: versionIds }, status: 'OK' }, { padronVersionId: 1 })
      .lean();

    const okVersionIds = new Set(okReports.map((report) => String(report.padronVersionId)));
    const activeVersions = currentVersions.filter((version) =>
      okVersionIds.has(String(version._id)),
    );

    if (!activeVersions.length) {
      return [];
    }

    const padronEntries = await this.padronEntryModel
      .find(
        {
          padronVersionId: { $in: activeVersions.map((version) => version._id) },
          carnetNorm,
        },
        { padronVersionId: 1 },
      )
      .lean();

    if (!padronEntries.length) {
      return [];
    }

    const allowedVersionIds = new Set(
      padronEntries.map((entry) => String(entry.padronVersionId)),
    );
    const allowedEventIds = new Set(
      activeVersions
        .filter((version) => allowedVersionIds.has(String(version._id)))
        .map((version) => String(version.eventId)),
    );

    return eligibleEvents.filter((event) => allowedEventIds.has(String(event._id)));
  }

  async getPublicEventDetail(eventId: string) {
    const event = await this.accessService.getEventOrThrow(eventId);
    if (event.state === 'DRAFT') {
      throw new NotFoundException('Evento no disponible publicamente');
    }

    const [roles, options] = await Promise.all([
      this.eventRoleModel.find({ eventId: event._id }).sort({ createdAt: 1, _id: 1 }).lean(),
      this.votingOptionModel
        .find({ eventId: event._id, active: { $ne: false } })
        .sort({ createdAt: 1, _id: 1 })
        .lean(),
    ]);

    const now = new Date();
    const isUpcoming = Boolean(
      event.state === 'PUBLISHED' && event.votingStart && now < event.votingStart,
    );
    const isActive = Boolean(
      event.state === 'PUBLISHED' &&
        event.votingStart &&
        event.votingEnd &&
        now >= event.votingStart &&
        now <= event.votingEnd,
    );
    const isResults = Boolean(
      event.state === 'RESULTS_PUBLISHED' ||
        (event.resultsPublishAt && now >= event.resultsPublishAt),
    );

    const resultsAvailable = Boolean(event.resultsPublishAt && now >= event.resultsPublishAt);
    let results = [];
    if (resultsAvailable) {
      results = await this.voteReaderService.getResults(String(event._id));
    }

    return {
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: event.name,
      objective: event.objective,
      state: event.state,
      phase: isResults ? 'RESULTS' : isActive ? 'ACTIVE' : isUpcoming ? 'UPCOMING' : 'OTHER',
      votingStart: event.votingStart ?? null,
      votingEnd: event.votingEnd ?? null,
      resultsPublishAt: event.resultsPublishAt ?? null,
      publicEligibilityEnabled: Boolean(event.publicEligibilityEnabled),
      resultsAvailable,
      roles: roles.map((role) => ({
        id: String(role._id),
        name: role.name,
        maxWinners: role.maxWinners,
      })),
      options: options.map((option) => ({
        id: String(option._id),
        name: option.name,
        color: option.color,
        logoUrl: option.logoUrl ?? null,
        candidates: option.candidates ?? [],
        active: option.active,
      })),
      results,
    };
  }

  async checkPublicEligibilityAcrossEvents(carnet: string, tenantId?: string) {
    const carnetNorm = normalizeCarnet(carnet);
    if (!carnetNorm) {
      throw new BadRequestException('carnet invalido');
    }

    const now = new Date();
    const query: Record<string, unknown> = {
      state: { $in: ['PUBLISHED', 'CLOSED', 'RESULTS_PUBLISHED'] },
    };

    if (tenantId) {
      if (!Types.ObjectId.isValid(tenantId)) {
        throw new BadRequestException('tenantId invalido');
      }
      query.tenantId = new Types.ObjectId(tenantId);
    }

    const events = await this.votingEventModel.find(query).lean();
    if (!events.length) {
      return {
        carnet: carnetNorm,
        events: [],
      };
    }

    const eventIds = events.map((event) => event._id);
    const versions = await this.padronVersionModel
      .find(
        { eventId: { $in: eventIds }, isCurrent: true },
        { _id: 1, eventId: 1 },
      )
      .lean();
    const versionByEventId = new Map(versions.map((v) => [String(v.eventId), v]));
    const versionIds = versions.map((v) => v._id);

    const reportRows = versionIds.length
      ? await this.comparisonReportModel
          .find(
            { padronVersionId: { $in: versionIds }, status: 'OK' },
            { padronVersionId: 1 },
          )
          .lean()
      : [];
    const okVersionIdSet = new Set(reportRows.map((row) => String(row.padronVersionId)));

    const eligibleRows = okVersionIdSet.size
      ? await this.padronEntryModel
          .find(
            {
              padronVersionId: { $in: Array.from(okVersionIdSet, (id) => new Types.ObjectId(id)) },
              carnetNorm,
            },
            { padronVersionId: 1, enabled: 1 },
          )
          .lean()
      : [];
    const eligibilityByVersionId = new Map(
      eligibleRows.map((row) => [String(row.padronVersionId), row.enabled !== false]),
    );

    const mapped = events.map((event) => {
      const eventId = String(event._id);
      const version = versionByEventId.get(eventId);
      const referenceVersion = version ? String(version._id) : null;
      const reportOk = version ? okVersionIdSet.has(String(version._id)) : false;
      const versionEligibility = version ? eligibilityByVersionId.get(String(version._id)) : undefined;
      const inPadron = typeof versionEligibility !== 'undefined';

      const isUpcoming = Boolean(
        event.state === 'PUBLISHED' && event.votingStart && now < event.votingStart,
      );
      const isActive = Boolean(
        event.state === 'PUBLISHED' &&
          event.votingStart &&
          event.votingEnd &&
          now >= event.votingStart &&
          now <= event.votingEnd,
      );
      const isResults = Boolean(
        event.state === 'RESULTS_PUBLISHED' ||
          (event.resultsPublishAt && now >= event.resultsPublishAt),
      );

      let status = 'PUBLIC_CHECK_DISABLED';
      if (event.publicEligibilityEnabled) {
        if (!version || !reportOk) {
          status = 'ROLL_IN_VALIDATION';
        } else {
          status = !inPadron ? 'NOT_ELIGIBLE' : versionEligibility ? 'ELIGIBLE' : 'DISABLED';
        }
      }

      return {
        eventId,
        tenantId: String(event.tenantId),
        name: event.name,
        state: event.state,
        phase: isResults ? 'RESULTS' : isActive ? 'ACTIVE' : isUpcoming ? 'UPCOMING' : 'OTHER',
        status,
        eligible: status === 'ELIGIBLE',
        referenceVersion,
      };
    });

    return {
      carnet: carnetNorm,
      events: mapped.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    };
  }

  async getEventDetail(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const [roles, options] = await Promise.all([
      this.eventRoleModel.find({ eventId: event._id }).sort({ createdAt: 1, _id: 1 }).lean(),
      this.votingOptionModel.find({ eventId: event._id }).sort({ createdAt: 1, _id: 1 }).lean(),
    ]);

    return {
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: event.name,
      objective: event.objective,
      state: event.state,
      votingStart: event.votingStart ?? null,
      votingEnd: event.votingEnd ?? null,
      resultsPublishAt: event.resultsPublishAt ?? null,
      publicEligibilityEnabled: Boolean(event.publicEligibilityEnabled),
      roles: roles.map((role) => ({
        id: String(role._id),
        name: role.name,
        maxWinners: role.maxWinners,
      })),
      options: options.map((option) => ({
        id: String(option._id),
        name: option.name,
        color: option.color,
        logoUrl: option.logoUrl ?? null,
        candidates: option.candidates ?? [],
        active: option.active,
      })),
    };
  }

  async updateEvent(eventId: string, dto: UpdateVotingEventDto, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'editar el evento');

    if (dto.name !== undefined) {
      event.name = dto.name.trim();
    }

    if (dto.objective !== undefined) {
      event.objective = dto.objective.trim();
    }

    await event.save();

    return {
      id: String(event._id),
      tenantId: String(event.tenantId),
      name: event.name,
      objective: event.objective,
      state: event.state,
    };
  }

  async deleteEvent(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftState(event, 'eliminar el evento');

    const versions = await this.padronVersionModel
      .find({ eventId: event._id }, { _id: 1 })
      .lean();
    const versionIds = versions.map((v) => v._id);

    await Promise.all([
      this.eventRoleModel.deleteMany({ eventId: event._id }),
      this.votingOptionModel.deleteMany({ eventId: event._id }),
      this.padronEntryModel.deleteMany({ eventId: event._id }),
      this.padronVersionModel.deleteMany({ eventId: event._id }),
      this.participationModel.deleteMany({ eventId: event._id }),
      this.resultsSnapshotModel.deleteMany({ eventId: event._id }),
      this.votingEventModel.deleteOne({ _id: event._id }),
      versionIds.length
        ? this.comparisonReportModel.deleteMany({ padronVersionId: { $in: versionIds } })
        : Promise.resolve(),
    ]);

    return {
      id: String(event._id),
      deleted: true,
    };
  }

  async createRole(eventId: string, dto: CreateEventRoleDto, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'crear cargos');

    const normalizedName = this.accessService.normalizeName(dto.name);

    try {
      const created = await this.eventRoleModel.create({
        eventId: event._id,
        name: dto.name.trim(),
        normalizedName,
        maxWinners: dto.maxWinners || 1,
      });

      return {
        id: String(created._id),
        eventId: String(created.eventId),
        name: created.name,
        maxWinners: created.maxWinners,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Ya existe un cargo con ese nombre en el evento');
      }
      throw error;
    }
  }

  async listRoles(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const roles = await this.eventRoleModel
      .find({ eventId: event._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return {
      data: roles.map((role) => ({
        id: String(role._id),
        eventId: String(role.eventId),
        name: role.name,
        maxWinners: role.maxWinners,
      })),
    };
  }

  async updateRole(eventId: string, roleId: string, dto: UpdateEventRoleDto, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'editar cargos');

    if (!Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('roleId invalido');
    }

    const role = await this.eventRoleModel.findOne({
      _id: new Types.ObjectId(roleId),
      eventId: event._id,
    });

    if (!role) {
      throw new NotFoundException('Cargo no encontrado');
    }

    const previousName = role.name;

    if (dto.name !== undefined) {
      role.name = dto.name.trim();
      role.normalizedName = this.accessService.normalizeName(dto.name);
    }

    if (dto.maxWinners !== undefined) {
      role.maxWinners = dto.maxWinners;
    }

    try {
      await role.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Ya existe un cargo con ese nombre en el evento');
      }
      throw error;
    }

    if (dto.name !== undefined && previousName !== role.name) {
      await this.votingOptionModel.updateMany(
        { eventId: event._id, 'candidates.roleName': previousName },
        { $set: { 'candidates.$[candidate].roleName': role.name } },
        {
          arrayFilters: [{ 'candidate.roleName': previousName }],
        },
      );
    }

    return {
      id: String(role._id),
      eventId: String(role.eventId),
      name: role.name,
      maxWinners: role.maxWinners,
    };
  }

  async deleteRole(eventId: string, roleId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'eliminar cargos');

    if (!Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('roleId invalido');
    }

    const role = await this.eventRoleModel.findOne({
      _id: new Types.ObjectId(roleId),
      eventId: event._id,
    });

    if (!role) {
      throw new NotFoundException('Cargo no encontrado');
    }

    const usedByCandidate = await this.votingOptionModel.exists({
      eventId: event._id,
      'candidates.roleName': role.name,
      active: true,
    });

    if (usedByCandidate) {
      throw new ConflictException('No se puede eliminar el cargo porque esta en uso por candidatos');
    }

    await this.eventRoleModel.deleteOne({ _id: role._id });

    return {
      id: String(role._id),
      deleted: true,
    };
  }

  async createOption(eventId: string, dto: CreateVotingOptionDto, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'crear opciones');

    const normalizedName = this.accessService.normalizeName(dto.name);

    try {
      const created = await this.votingOptionModel.create({
        eventId: event._id,
        tenantId: event.tenantId,
        name: dto.name.trim(),
        normalizedName,
        color: dto.color,
        logoUrl: dto.logoUrl,
        candidates: dto.candidates || [],
        active: true,
      });

      return {
        id: String(created._id),
        eventId: String(created.eventId),
        name: created.name,
        color: created.color,
        logoUrl: created.logoUrl,
        candidates: created.candidates,
        active: created.active,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Ya existe una opcion con ese nombre en el evento');
      }
      throw error;
    }
  }

  async listOptions(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const options = await this.votingOptionModel
      .find({ eventId: event._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    return {
      data: options.map((option) => ({
        id: String(option._id),
        eventId: String(option.eventId),
        name: option.name,
        color: option.color,
        logoUrl: option.logoUrl ?? null,
        candidates: option.candidates ?? [],
        active: option.active,
      })),
    };
  }

  async updateOption(
    eventId: string,
    optionId: string,
    dto: UpdateVotingOptionDto,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'editar opciones');

    if (!Types.ObjectId.isValid(optionId)) {
      throw new BadRequestException('optionId invalido');
    }

    const option = await this.votingOptionModel.findOne({
      _id: new Types.ObjectId(optionId),
      eventId: event._id,
    });

    if (!option) {
      throw new NotFoundException('Opcion no encontrada');
    }

    if (dto.name !== undefined) {
      option.name = dto.name.trim();
      option.normalizedName = this.accessService.normalizeName(dto.name);
    }

    if (dto.color !== undefined) {
      option.color = dto.color;
    }

    if (dto.logoUrl !== undefined) {
      option.logoUrl = dto.logoUrl;
    }

    try {
      await option.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('Ya existe una opcion con ese nombre en el evento');
      }
      throw error;
    }

    return {
      id: String(option._id),
      eventId: String(option.eventId),
      name: option.name,
      color: option.color,
      logoUrl: option.logoUrl ?? null,
      candidates: option.candidates ?? [],
      active: option.active,
    };
  }

  async replaceOptionCandidates(
    eventId: string,
    optionId: string,
    dto: UpdateOptionCandidatesDto,
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'actualizar candidatos');

    if (!Types.ObjectId.isValid(optionId)) {
      throw new BadRequestException('optionId invalido');
    }

    const roleNames = await this.eventRoleModel.find({ eventId: event._id }, { name: 1 }).lean();
    const allowedRoles = new Set(
      roleNames.map((role) => this.accessService.normalizeName(role.name)),
    );

    const invalidRole = dto.candidates.find(
      (candidate) => !allowedRoles.has(this.accessService.normalizeName(candidate.roleName)),
    );

    if (invalidRole) {
      throw new BadRequestException(`roleName invalido en candidato: ${invalidRole.roleName}`);
    }

    const updated = await this.votingOptionModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(optionId), eventId: event._id },
        { $set: { candidates: dto.candidates } },
        { new: true },
      )
      .lean();

    if (!updated) {
      throw new NotFoundException('Opcion no encontrada');
    }

    return {
      id: String(updated._id),
      eventId: String(updated.eventId),
      candidates: updated.candidates ?? [],
      active: updated.active,
    };
  }

  async deactivateOption(eventId: string, optionId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'desactivar opciones');

    const updated = await this.votingOptionModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(optionId), eventId: new Types.ObjectId(eventId) },
        { $set: { active: false } },
        { new: true },
      )
      .lean();

    if (!updated) {
      throw new NotFoundException('Opcion no encontrada');
    }

    return {
      id: String(updated._id),
      active: updated.active,
    };
  }

  async deleteOption(eventId: string, optionId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    this.assertDraftEditable(event, 'eliminar opciones');

    if (!Types.ObjectId.isValid(optionId)) {
      throw new BadRequestException('optionId invalido');
    }

    const deleted = await this.votingOptionModel.findOneAndDelete({
      _id: new Types.ObjectId(optionId),
      eventId: event._id,
    });

    if (!deleted) {
      throw new NotFoundException('Opcion no encontrada');
    }

    return {
      id: String(deleted._id),
      deleted: true,
    };
  }

  async updateSchedule(
    eventId: string,
    payload: { votingStart?: string; votingEnd?: string; resultsPublishAt?: string },
    requester: any,
  ) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);
    const now = Date.now();
    const startsInMoreThan24Hours =
      event.votingStart instanceof Date &&
      event.votingStart.getTime() - now >= 24 * 60 * 60 * 1000;

    if (event.state !== 'DRAFT' && !(event.state === 'PUBLISHED' && startsInMoreThan24Hours)) {
      throw new BadRequestException(
        'Solo se permite editar el cronograma en DRAFT o hasta 24 horas antes del inicio cuando la votacion ya fue publicada',
      );
    }

    const { votingStart, votingEnd, resultsPublishAt } = this.accessService.parseAndValidateDates(
      payload.votingStart,
      payload.votingEnd,
      payload.resultsPublishAt,
      true,
    );

    event.votingStart = votingStart;
    event.votingEnd = votingEnd;
    event.resultsPublishAt = resultsPublishAt;
    await event.save();

    return {
      id: String(event._id),
      votingStart: event.votingStart,
      votingEnd: event.votingEnd,
      resultsPublishAt: event.resultsPublishAt,
    };
  }

  async publishEvent(eventId: string, nullifiers: string[], requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const [rolesCount, optionsCount, currentPadron, hasWindows] = await Promise.all([
      this.eventRoleModel.countDocuments({ eventId: event._id }),
      this.votingOptionModel.countDocuments({ eventId: event._id, active: true }),
      this.padronVersionModel.findOne({ eventId: event._id, isCurrent: true }).lean(),
      Promise.resolve(
        Boolean(event.votingStart && event.votingEnd && event.resultsPublishAt),
      ),
    ]);

    const convotatedUsers = await this.padronUsersService.getPadronUsersFromEvent(event, {
      includeDisabled: true,
    });
    const enoughtNullifiers = convotatedUsers.length <= nullifiers.length;

    const comparisonReportOk = currentPadron
      ? await this.comparisonReportModel.exists({
          padronVersionId: currentPadron._id,
          status: 'OK',
        })
      : false;

    const pending: string[] = [];
    if (rolesCount === 0) pending.push('cargos');
    if (optionsCount === 0) pending.push('opciones');
    if (!currentPadron) {
      pending.push('padron');
    } else {
      if (Number(currentPadron?.totals?.validCount ?? 0) <= 0) {
        pending.push('padron');
      }
      if (Number(currentPadron?.totals?.invalidCount ?? 0) > 0) {
        pending.push('padron_invalid');
      }
      if (!comparisonReportOk) {
        pending.push('padron_validation');
      }
      if (!enoughtNullifiers) {
        pending.push('nullifiers');
      }
    }
    if (!hasWindows) pending.push('horarios');

    if (pending.length > 0) {
      throw new BadRequestException({
        message: 'Faltan precondiciones para publicar',
        pending,
      });
    }

    event.state = 'PUBLISHED';
    event.publicEligibilityEnabled = true;
    await event.save();

    if(event.convocationNotifiedAt) {
      return {
        id: String(event._id),
        state: event.state,
      };
    }

    let userCredentials: Record<string, Record<string, string>> = {};
    let shuffledNullifiers = shuffle(nullifiers);
    if (convotatedUsers.length > 0) {
      convotatedUsers.forEach((user, index) => {
        const perUserData: Record<string, string> = {
          eligible: user.enabled ? 'true' : 'false',
        };
        if (user.enabled) {
          perUserData.nullifier = shuffledNullifiers[index];
        }
        userCredentials[String(user.dni)] = perUserData;
      });
    }
    await this.notificationsService.notifyConvocationIfEligible(event, userCredentials);

    return {
      id: String(event._id),
      state: event.state,
      nullifiers,
    };
  }

  async setPublicEligibility(eventId: string, enabled: boolean, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    event.publicEligibilityEnabled = Boolean(enabled);
    await event.save();

    return {
      id: String(event._id),
      publicEligibilityEnabled: event.publicEligibilityEnabled,
    };
  }

  async publishNews(eventId: string, dto: CreateEventNewsDto, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const out = await this.notificationsService.notifyNewsToCurrentPadron(event, {
      title: dto.title,
      body: dto.body,
      imageUrl: dto.imageUrl,
      link: dto.link,
    });

    return {
      eventId,
      sent: out.sent ?? 0,
      skipped: (out as any).skipped ?? null,
    };
  }

  private assertDraftEditable(event: VotingEventDocument, action: string) {
    this.assertDraftState(event, action);
  }

  private assertDraftState(event: VotingEventDocument, action: string) {
    if (event.state !== 'DRAFT') {
      throw new BadRequestException(`Solo se permite ${action} cuando el evento esta en DRAFT`);
    }
  }
}
