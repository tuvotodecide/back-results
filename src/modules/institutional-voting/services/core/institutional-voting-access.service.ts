import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InstitutionalTenant,
  InstitutionalTenantDocument,
} from '@/modules/institutional-tenants/schemas/institutional-tenant.schema';
import {
  TenantAdminAssignment,
  TenantAdminAssignmentDocument,
} from '@/modules/institutional-tenants/schemas/tenant-admin-assignment.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';

@Injectable()
export class InstitutionalVotingAccessService {
  private readonly createLeadHours = 12;
  private readonly officialPublicationLeadHours = 6;

  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
  ) {}

  async getEventOrThrow(eventId: string) {
    if (!Types.ObjectId.isValid(eventId)) {
      throw new BadRequestException('eventId inválido');
    }

    const event = await this.votingEventModel.findById(eventId);
    if (!event) throw new NotFoundException('Evento no encontrado');
    return event;
  }

  async assertTenantWriteAccess(tenantId: Types.ObjectId, requester: any) {
    const isAdmin = requester?.role === 'ADMIN';
    if (isAdmin) return;

    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!requesterId) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }

    const assignment = await this.assignmentModel
      .findOne({
        tenantId,
        userId: new Types.ObjectId(requesterId),
        active: true,
        $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
      })
      .lean();

    if (!assignment) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }
  }

  assertGlobalAdminAccess(requester: any, action = 'realizar esta acción') {
    if (requester?.role !== 'ADMIN') {
      throw new ForbiddenException(`Solo un administrador global puede ${action}`);
    }
  }

  async resolveReadableTenantIds(requester: any, tenantIdFilter?: string): Promise<Types.ObjectId[]> {
    const isAdmin = requester?.role === 'ADMIN';
    const requesterId = requester?.sub ? String(requester.sub) : '';

    if (tenantIdFilter) {
      const tenant = await this.getTenantOrThrow(tenantIdFilter);
      const tenantId = tenant._id as Types.ObjectId;

      if (isAdmin) {
        return [tenantId];
      }

      if (!requesterId) {
        throw new ForbiddenException('No autorizado para consultar este tenant');
      }

      const assignment = await this.assignmentModel
        .findOne({
          tenantId,
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        })
        .lean();

      if (!assignment) {
        throw new ForbiddenException('No autorizado para consultar este tenant');
      }

      return [tenantId];
    }

    if (isAdmin) {
      const tenants = await this.tenantModel.find({ active: true }, { _id: 1 }).lean();
      return tenants.map((t) => t._id as Types.ObjectId);
    }

    if (!requesterId) {
      throw new ForbiddenException('No autorizado para consultar eventos');
    }

    const assignments = await this.assignmentModel
      .find(
        {
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        { tenantId: 1 },
      )
      .lean();

    if (!assignments.length) {
      return [];
    }

    const assignedTenantIds = assignments.map((a) => a.tenantId as Types.ObjectId);
    const activeTenants = await this.tenantModel
      .find(
        {
          _id: { $in: assignedTenantIds },
          active: true,
        },
        { _id: 1 },
      )
      .lean();

    return activeTenants.map((t) => t._id as Types.ObjectId);
  }

  async getTenantOrThrow(tenantId: string) {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('tenantId inválido');
    }

    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.active) {
      throw new NotFoundException('Tenant no encontrado o inactivo');
    }

    return tenant;
  }

  parseAndValidateDates(
    votingStartRaw?: string,
    votingEndRaw?: string,
    resultsPublishRaw?: string,
    minimumLeadHours?: number,
  ): {
    votingStart?: Date;
    votingEnd?: Date;
    resultsPublishAt?: Date;
  } {
    if (!votingStartRaw && !votingEndRaw && !resultsPublishRaw) {
      return {};
    }

    if (!votingStartRaw || !votingEndRaw || !resultsPublishRaw) {
      throw new BadRequestException('Debe enviar votingStart, votingEnd y resultsPublishAt');
    }

    const votingStart = new Date(votingStartRaw);
    const votingEnd = new Date(votingEndRaw);
    const resultsPublishAt = new Date(resultsPublishRaw);

    if (
      Number.isNaN(votingStart.getTime()) ||
      Number.isNaN(votingEnd.getTime()) ||
      Number.isNaN(resultsPublishAt.getTime())
    ) {
      throw new BadRequestException('Fechas inválidas');
    }

    if (votingStart >= votingEnd) {
      throw new BadRequestException('votingStart debe ser anterior a votingEnd');
    }

    if (resultsPublishAt <= votingEnd) {
      throw new BadRequestException('resultsPublishAt debe ser mayor a votingEnd');
    }
    
    if (typeof minimumLeadHours === 'number') {
      const now = Date.now();
      const diff = votingStart.getTime() - now;
      if (diff < minimumLeadHours * 60 * 60 * 1000) {
        throw new BadRequestException(
          `La fecha de inicio debe tener al menos ${minimumLeadHours} horas de anticipación`,
        );
      }
    }

    return { votingStart, votingEnd, resultsPublishAt };
  }

  getCreateLeadHours() {
    return this.createLeadHours;
  }

  getOfficialPublicationLeadHours() {
    return this.officialPublicationLeadHours;
  }

  computePublishDeadline(votingStart?: Date | null) {
    if (!votingStart) return undefined;
    return new Date(votingStart.getTime() - this.officialPublicationLeadHours * 60 * 60 * 1000);
  }

  isOfficiallyPublishedState(state?: string | null) {
    return ['OFFICIALLY_PUBLISHED', 'PUBLISHED'].includes(String(state || ''));
  }

  isOfficialPublicationConfirmed(
    event: Pick<VotingEvent, 'state' | 'publicationConfirmed'>,
  ) {
    return (
      this.isOfficiallyPublishedState(event.state) ||
      event.publicationConfirmed === true
    );
  }

  isVotingActive(
    event: Pick<VotingEvent, 'state' | 'votingStart' | 'votingEnd'>,
    now = new Date(),
  ) {
    return (
      this.isOfficiallyPublishedState(event.state) &&
      Boolean(event.votingStart) &&
      Boolean(event.votingEnd) &&
      now >= new Date(event.votingStart as Date) &&
      now <= new Date(event.votingEnd as Date)
    );
  }

  canFullyEditEvent(
    event: Pick<
      VotingEvent,
      'state' | 'publishDeadline' | 'votingStart' | 'votingEnd' | 'publicationConfirmed'
    >,
    now = new Date(),
  ) {
    if (['PUBLICATION_EXPIRED', 'CLOSED', 'RESULTS_PUBLISHED'].includes(String(event.state || ''))) {
      return false;
    }

    if (this.isOfficialPublicationConfirmed(event)) {
      return false;
    }

    if (this.isVotingActive(event, now)) {
      return false;
    }

    if (!event.publishDeadline) {
      return true;
    }

    return now < new Date(event.publishDeadline as Date);
  }

  canModifyPadronDuringVoting(
    event: Pick<VotingEvent, 'state' | 'votingEnd' | 'publicationConfirmed'>,
    now = new Date(),
  ) {
    if (!this.isOfficialPublicationConfirmed(event)) {
      return false;
    }

    if (['PUBLICATION_EXPIRED', 'CLOSED', 'RESULTS_PUBLISHED'].includes(String(event.state || ''))) {
      return false;
    }

    if (!event.votingEnd) {
      return false;
    }

    return now <= new Date(event.votingEnd as Date);
  }

  hasPublicationWindowExpired(
    event: Pick<VotingEvent, 'publishDeadline'>,
    now = new Date(),
  ) {
    if (!event.publishDeadline) {
      return false;
    }
    return now >= new Date(event.publishDeadline as Date);
  }

  normalizeName(input: string): string {
    return input
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
}
