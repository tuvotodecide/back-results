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
import { CreateVotingOptionDto } from '../../dto/voting-option.dto';
import { EventRole, EventRoleDocument } from '../../schemas/event-role.schema';
import { PadronVersion, PadronVersionDocument } from '../../schemas/padron-version.schema';
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
}
