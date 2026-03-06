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
    private readonly accessService: InstitutionalVotingAccessService,
    private readonly notificationsService: InstitutionalVotingNotificationsService,
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
    this.assertDraftState(event, 'editar el evento');

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
    this.assertDraftState(event, 'editar cargos');

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
    this.assertDraftState(event, 'eliminar cargos');

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
    this.assertDraftState(event, 'editar opciones');

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
    this.assertDraftState(event, 'actualizar candidatos');

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
    this.assertDraftState(event, 'eliminar opciones');

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

  async publishEvent(eventId: string, requester: any) {
    const event = await this.accessService.getEventOrThrow(eventId);
    await this.accessService.assertTenantWriteAccess(event.tenantId, requester);

    const [rolesCount, optionsCount, currentPadron, hasWindows] = await Promise.all([
      this.eventRoleModel.countDocuments({ eventId: event._id }),
      this.votingOptionModel.countDocuments({ eventId: event._id, active: true }),
      this.padronVersionModel.exists({ eventId: event._id, isCurrent: true }),
      Promise.resolve(
        Boolean(event.votingStart && event.votingEnd && event.resultsPublishAt),
      ),
    ]);

    const pending: string[] = [];
    if (rolesCount === 0) pending.push('cargos');
    if (optionsCount === 0) pending.push('opciones');
    if (!currentPadron) pending.push('padron');
    if (!hasWindows) pending.push('horarios');

    if (pending.length > 0) {
      throw new BadRequestException({
        message: 'Faltan precondiciones para publicar',
        pending,
      });
    }

    event.state = 'PUBLISHED';
    await event.save();
    await this.notificationsService.notifyConvocationIfEligible(event);

    return {
      id: String(event._id),
      state: event.state,
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

  private assertDraftState(event: VotingEventDocument, action: string) {
    if (event.state !== 'DRAFT') {
      throw new BadRequestException(`Solo se permite ${action} cuando el evento esta en DRAFT`);
    }
  }
}
