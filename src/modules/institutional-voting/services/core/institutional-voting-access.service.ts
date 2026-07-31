import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
  InstitutionalAdminApplication,
  InstitutionalAdminApplicationDocument,
} from '@/modules/institutional-admin-applications/schemas/institutional-admin-application.schema';
import {
  VotingEvent,
  VotingEventDocument,
} from '../../schemas/voting-event.schema';

@Injectable()
export class InstitutionalVotingAccessService {
  private readonly logger = new Logger(InstitutionalVotingAccessService.name);
  private readonly createLeadHours = 12;
  private readonly officialPublicationLeadHours = 6;

  constructor(
    @InjectModel(VotingEvent.name)
    private readonly votingEventModel: Model<VotingEventDocument>,
    @InjectModel(InstitutionalTenant.name)
    private readonly tenantModel: Model<InstitutionalTenantDocument>,
    @InjectModel(TenantAdminAssignment.name)
    private readonly assignmentModel: Model<TenantAdminAssignmentDocument>,
    @InjectModel(InstitutionalAdminApplication.name)
    private readonly applicationModel: Model<InstitutionalAdminApplicationDocument>,
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

    const tenant = await this.tenantModel.findById(tenantId, { active: 1 }).lean();
    if (!tenant || tenant.active !== true) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }

    const assignment = await this.assignmentModel
      .findOne(
        {
          tenantId,
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        { accountAddress: 1 },
      )
      .lean();

    if (!assignment) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }

    const accountAddress = assignment.accountAddress?.trim();
    if (!accountAddress) {
      throw new ConflictException('La relacion institucional no tiene wallet operativa');
    }
    await this.assertNoPendingInstitutionalRegularization(tenantId, new Types.ObjectId(requesterId));
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

  async resolveAdminWalletForTenant(userId: string, tenantId: string) {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException('userId o tenantId invalido');
    }

    const userObjectId = new Types.ObjectId(userId);
    const tenantObjectId = new Types.ObjectId(tenantId);
    const tenant = await this.tenantModel
      .findById(tenantObjectId, { active: 1 })
      .lean();

    if (!tenant || tenant.active !== true) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }

    const assignments = await this.assignmentModel
      .find(
        {
          tenantId: tenantObjectId,
          userId: userObjectId,
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        { tenantId: 1, userId: 1, accountAddress: 1, active: 1, status: 1, institutionalRole: 1 },
      )
      .lean();

    if (!assignments.length) {
      throw new ForbiddenException('No autorizado para operar este tenant');
    }

    const wallets = assignments
      .map((assignment) => assignment.accountAddress?.trim())
      .filter((accountAddress): accountAddress is string => Boolean(accountAddress));

    if (wallets.length !== assignments.length) {
      throw new ConflictException('La relacion institucional no tiene wallet operativa');
    }

    const roles = assignments
      .map((assignment) => assignment.institutionalRole)
      .filter((role): role is 'PRIMARY' | 'SECONDARY' => Boolean(role));
    if (roles.length !== assignments.length) {
      throw new ConflictException('La relacion institucional no tiene rol operativo');
    }

    const uniqueWallets = new Set(wallets.map((accountAddress) => accountAddress.toLowerCase()));
    if (uniqueWallets.size !== 1) {
      throw new ConflictException('Relaciones institucionales incompatibles para este tenant');
    }
    const uniqueRoles = new Set(roles);
    if (uniqueRoles.size !== 1) {
      throw new ConflictException('Relaciones institucionales incompatibles para este tenant');
    }
    await this.assertNoPendingInstitutionalRegularization(tenantObjectId, userObjectId);

    return {
      userId,
      tenantId,
      accountAddress: wallets[0],
      institutionalRole: roles[0],
    };
  }

  private async assertNoPendingInstitutionalRegularization(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
  ) {
    const pendingOperation = await this.applicationModel
      .findOne(
        {
          tenantId,
          userId,
          status: { $in: ['PENDING_CHAIN_CONFIRMATION', 'CHAIN_RETRY_PENDING', 'RECONCILIATION_PENDING'] },
          chainStatus: { $in: ['PENDING_SEND', 'SENT', 'RETRY_PENDING'] },
        },
        { _id: 1 },
      )
      .lean();

    if (pendingOperation) {
      throw new ConflictException({
        code: 'INSTITUTION_REGULARIZATION_PENDING_NETWORK_CONFIRMATION',
        message: 'La regularizacion institucional sigue pendiente de confirmacion de la red',
      });
    }
  }

  async resolveOfficialPublicationInstitution(
    event: Pick<VotingEventDocument, '_id' | 'tenantId'>,
    requester: any,
  ) {
    const requesterId = requester?.sub ? String(requester.sub) : '';
    if (!Types.ObjectId.isValid(requesterId)) {
      throw new ForbiddenException('No autorizado para publicar esta votacion');
    }

    const tenantId = event.tenantId as Types.ObjectId;
    const assignment = await this.assignmentModel
      .findOne(
        {
          tenantId,
          userId: new Types.ObjectId(requesterId),
          active: true,
          $or: [{ status: 'APPROVED' }, { status: { $exists: false } }],
        },
        {
          _id: 1,
          tenantId: 1,
          userId: 1,
          applicationId: 1,
          accountAddress: 1,
          institutionalRole: 1,
        },
      )
      .lean();

    if (!assignment) {
      throw new ForbiddenException('No autorizado para publicar esta votacion');
    }
    if (!assignment.applicationId) {
      throw new ConflictException({
        code: 'EVENT_INSTITUTION_RELATION_MISSING',
        message: 'La relacion institucional no tiene institucion on-chain asociada',
      });
    }
    const accountAddress = assignment.accountAddress?.trim();
    if (!accountAddress) {
      throw new ConflictException({
        code: 'EVENT_INSTITUTION_WALLET_MISSING',
        message: 'La relacion institucional no tiene wallet operativa',
      });
    }

    const application = await this.applicationModel
      .findOne(
        {
          _id: assignment.applicationId,
          tenantId,
          userId: new Types.ObjectId(requesterId),
          status: 'APPROVED',
        },
        { _id: 1, tenantId: 1, userId: 1, accountAddress: 1, status: 1, stableInstitutionId: 1 },
      )
      .lean();

    if (!application) {
      throw new ConflictException({
        code: 'EVENT_INSTITUTION_APPLICATION_NOT_FOUND',
        message: 'La institucion on-chain no esta disponible para esta votacion',
      });
    }

    const institutionId = this.resolveCanonicalInstitutionId({
      stableInstitutionId: application.stableInstitutionId,
      tenantId: application.tenantId,
      applicationId: assignment.applicationId,
    });
    const applicationWallet = application.accountAddress?.trim();
    if (
      applicationWallet &&
      applicationWallet.toLowerCase() !== accountAddress.toLowerCase()
    ) {
      throw new ConflictException({
        code: 'EVENT_INSTITUTION_WALLET_MISMATCH',
        message: 'La wallet institucional no coincide con la institucion on-chain',
      });
    }

    return {
      eventId: String(event._id),
      tenantId: String(tenantId),
      assignmentId: String(assignment._id),
      applicationId: String(assignment.applicationId),
      institutionId,
      accountAddress,
      signerUserId: requesterId,
      smartAccountAddress: accountAddress,
      institutionalRole: assignment.institutionalRole ?? null,
    };
  }

  private resolveCanonicalInstitutionId(input: {
    stableInstitutionId?: string | null;
    tenantId?: Types.ObjectId | string | null;
    applicationId?: Types.ObjectId | string | null;
  }) {
    // On-chain institution identity must use the persisted stableInstitutionId, never applicationId.
    const stableInstitutionId = input.stableInstitutionId?.trim();
    if (stableInstitutionId) return stableInstitutionId;

    this.logger.warn({
      event: 'EVENT_INSTITUTION_ID_NOT_AVAILABLE',
      applicationId: input.applicationId ? String(input.applicationId) : null,
      tenantId: input.tenantId ? String(input.tenantId) : null,
    });
    throw new ConflictException({
      code: 'EVENT_INSTITUTION_ID_NOT_AVAILABLE',
      message: 'La identidad institucional on-chain no esta disponible para esta votacion',
    });
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
    if (['PUBLICATION_EXPIRED', 'CLOSED', 'RESULTS_PUBLISHED', 'CANCELLED'].includes(String(event.state || ''))) {
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

    if (['PUBLICATION_EXPIRED', 'CLOSED', 'RESULTS_PUBLISHED', 'CANCELLED'].includes(String(event.state || ''))) {
      return false;
    }

    if (!event.votingEnd) {
      return false;
    }

    return now <= new Date(event.votingEnd as Date);
  }

  canEnableExistingPadronEntriesPostPublication(
    event: Pick<
      VotingEvent,
      'state' | 'votingEnd' | 'publicationConfirmed' | 'allowPostPublicationPadronEnable'
    >,
    now = new Date(),
  ) {
    if (!this.canModifyPadronDuringVoting(event, now)) {
      return false;
    }

    return event.allowPostPublicationPadronEnable !== false;
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
